-- Reduce the motivational commission campaign from two reminders per day to
-- one reminder every two days. Transactional alerts (new commission, active
-- contract, payments, approvals, etc.) keep their own immediate cadence.
--
-- Every row inserted in notificacoes is already forwarded to registered
-- phones by trg_deliver_notification_as_push.

-- Cancel reminders prepared by the previous twice-daily cadence. Historical
-- notifications remain available in the notification center.
UPDATE public.commission_reminder_schedule
SET cancelled_at = now()
WHERE delivered_at IS NULL
  AND cancelled_at IS NULL;
CREATE OR REPLACE FUNCTION public.prepare_commission_reminders(p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  -- 2026-07-18 is only a stable cadence anchor. A single slot is prepared on
  -- alternating days, at a random time between 09:00 and 20:00 (São Paulo).
  IF mod(p_date - DATE '2026-07-18', 2) <> 0 THEN
    RETURN 0;
  END IF;

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
      1,
      (
        p_date::timestamp
        + make_interval(mins => 540 + floor(random() * 661)::integer)
      ) AT TIME ZONE 'America/Sao_Paulo'
    FROM eligible_users eligible
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
CREATE OR REPLACE FUNCTION public.process_due_commission_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_delivered integer := 0;
BEGIN
  -- Never turn a delayed cron execution into a burst of old reminders.
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
    RETURNING schedule.user_id, schedule.reminder_date
  ), personalized AS (
    SELECT
      claimed.*,
      get_byte(
        decode(md5(claimed.user_id::text || ':' || claimed.reminder_date::text), 'hex'),
        0
      ) % 6 AS variant
    FROM claimed
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
      personalized.user_id,
      CASE personalized.variant
        WHEN 0 THEN 'Bora vender! 🚀'
        WHEN 1 THEN 'Vamos fechar mais um?'
        WHEN 2 THEN 'Tem oportunidade esperando'
        WHEN 3 THEN 'Seu próximo contrato começa hoje'
        WHEN 4 THEN 'Mais negócios, mais conquistas'
        ELSE 'Bora pra cima!'
      END,
      CASE personalized.variant
        WHEN 0 THEN 'Seu próximo contrato pode começar agora. Chame um cliente e avance com a NOX!'
        WHEN 1 THEN 'Cada novo contrato fortalece sua carteira e aumenta suas comissões. Vamos avançar?'
        WHEN 2 THEN 'Uma conversa hoje pode virar contrato e comissão. Retome seus contatos e faça acontecer!'
        WHEN 3 THEN 'Aproveite o dia para criar novas oportunidades e continuar crescendo com a NOX.'
        WHEN 4 THEN 'Cada contrato soma no seu resultado. Mantenha o ritmo e conquiste sua próxima comissão!'
        ELSE 'Uma nova oportunidade pode estar a uma mensagem de distância. Conte com a NOX!'
      END,
      'lembrete_comissoes',
      'amarelo',
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.internal_users u
          WHERE u.auth_user_id = personalized.user_id
            AND u.role::text = 'vendedor'
            AND u.status::text = 'ativo'
        ) THEN '/vendedor/comissoes'
        ELSE '/minhas-comissoes'
      END
    FROM personalized
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
-- The existing hourly preparation and minutely dispatch cron jobs call these
-- function names, so replacing the functions changes the cadence atomically.
SELECT public.prepare_current_commission_reminders();
SELECT public.process_due_commission_reminders();
