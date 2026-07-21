-- Two motivational commission reminders per day for active partners and
-- sellers. Times are randomized per user in America/Sao_Paulo, split into two
-- windows so the messages do not arrive nearly together.

CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS lembrete_comissoes boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.commission_reminder_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_date date NOT NULL,
  slot smallint NOT NULL CHECK (slot IN (1, 2)),
  scheduled_for timestamptz NOT NULL,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reminder_date, slot)
);

CREATE INDEX IF NOT EXISTS commission_reminder_schedule_due_idx
  ON public.commission_reminder_schedule(scheduled_for)
  WHERE delivered_at IS NULL AND cancelled_at IS NULL;

ALTER TABLE public.commission_reminder_schedule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_reminder_schedule FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.commission_reminder_schedule TO service_role;

CREATE OR REPLACE FUNCTION public.is_commission_reminder_eligible(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = p_user_id
          AND p.role::text IN ('corretor', 'imobiliaria', 'proprietario')
          AND COALESCE(p.status, 'ativo') = 'ativo'
      )
      OR EXISTS (
        SELECT 1
        FROM public.internal_users u
        WHERE u.auth_user_id = p_user_id
          AND u.role::text = 'vendedor'
          AND u.status::text = 'ativo'
          AND EXISTS (
            SELECT 1
            FROM public.role_permissions rp
            WHERE rp.role::text = 'vendedor'
              AND rp.module IN ('comissoes_proprias', 'comissoes')
              AND rp.can_view = true
          )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.notification_preferences pref
      WHERE pref.user_id = p_user_id
        AND pref.lembrete_comissoes = false
    );
$$;

REVOKE ALL ON FUNCTION public.is_commission_reminder_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_commission_reminder_eligible(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_commission_reminders(p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH eligible_users AS (
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.role::text IN ('corretor', 'imobiliaria', 'proprietario')
      AND COALESCE(p.status, 'ativo') = 'ativo'
    UNION
    SELECT u.auth_user_id
    FROM public.internal_users u
    WHERE u.role::text = 'vendedor'
      AND u.status::text = 'ativo'
  ), prepared AS (
    INSERT INTO public.commission_reminder_schedule (
      user_id,
      reminder_date,
      slot,
      scheduled_for
    )
    SELECT
      eligible.user_id,
      p_date,
      slots.slot,
      (
        p_date::timestamp
        + make_interval(
            mins => CASE slots.slot
              WHEN 1 THEN 510 + floor(random() * 420)::integer -- 08:30-15:29
              ELSE 930 + floor(random() * 451)::integer       -- 15:30-23:00
            END
          )
      ) AT TIME ZONE 'America/Sao_Paulo'
    FROM eligible_users eligible
    CROSS JOIN (VALUES (1::smallint), (2::smallint)) AS slots(slot)
    WHERE public.is_commission_reminder_eligible(eligible.user_id)
    ON CONFLICT (user_id, reminder_date, slot) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_inserted FROM prepared;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_commission_reminders(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_commission_reminders(date) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_current_commission_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_inserted integer := 0;
BEGIN
  v_inserted := public.prepare_commission_reminders(v_today);
  v_inserted := v_inserted + public.prepare_commission_reminders(v_today + 1);
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_current_commission_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_current_commission_reminders() TO service_role;

CREATE OR REPLACE FUNCTION public.process_due_commission_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_delivered integer := 0;
BEGIN
  -- A schedule first created after its intended time is skipped instead of
  -- sending an unexpected burst when this migration or a delayed job starts.
  UPDATE public.commission_reminder_schedule schedule
  SET cancelled_at = now()
  WHERE schedule.delivered_at IS NULL
    AND schedule.cancelled_at IS NULL
    AND schedule.scheduled_for <= now()
    AND (
      schedule.created_at > schedule.scheduled_for
      OR NOT public.is_commission_reminder_eligible(schedule.user_id)
    );

  WITH due AS (
    SELECT schedule.id
    FROM public.commission_reminder_schedule schedule
    WHERE schedule.delivered_at IS NULL
      AND schedule.cancelled_at IS NULL
      AND schedule.created_at <= schedule.scheduled_for
      AND schedule.scheduled_for <= now()
      AND public.is_commission_reminder_eligible(schedule.user_id)
    ORDER BY schedule.scheduled_for
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.commission_reminder_schedule schedule
    SET delivered_at = now()
    FROM due
    WHERE schedule.id = due.id
    RETURNING schedule.user_id, schedule.slot
  ), delivered AS (
    INSERT INTO public.notificacoes (
      user_id,
      titulo,
      mensagem,
      tipo,
      cor_destaque,
      link
    )
    SELECT
      claimed.user_id,
      'Mais contratos, mais comissÃµes',
      CASE claimed.slot
        WHEN 1 THEN 'Quanto mais contratos, mais comissÃµes. Aproveite o dia para gerar novas oportunidades!'
        ELSE 'Cada novo contrato aumenta suas comissÃµes. Continue avanÃ§ando com a NOX!'
      END,
      'lembrete_comissoes',
      'amarelo',
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.internal_users u
          WHERE u.auth_user_id = claimed.user_id
            AND u.role::text = 'vendedor'
            AND u.status::text = 'ativo'
        ) THEN '/vendedor/comissoes'
        ELSE '/minhas-comissoes'
      END
    FROM claimed
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_delivered FROM delivered;

  DELETE FROM public.commission_reminder_schedule
  WHERE reminder_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date - 90;

  RETURN v_delivered;
END;
$$;

REVOKE ALL ON FUNCTION public.process_due_commission_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_commission_reminders() TO service_role;

-- Prepare both today and tomorrow now. Past slots from today are marked as
-- skipped, so enabling the feature never causes a notification burst.
SELECT public.prepare_current_commission_reminders();
SELECT public.process_due_commission_reminders();

-- Refresh eligible users hourly and dispatch due reminders every minute.
SELECT cron.schedule(
  'nox-prepare-commission-reminders',
  '5 * * * *',
  'SELECT public.prepare_current_commission_reminders();'
);

SELECT cron.schedule(
  'nox-dispatch-commission-reminders',
  '* * * * *',
  'SELECT public.process_due_commission_reminders();'
);
