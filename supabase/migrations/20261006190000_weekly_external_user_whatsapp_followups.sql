-- Follow-up semanal via WhatsApp para logins externos da NOX.
-- Contas presentes em internal_users nunca entram na fila, independentemente
-- do role legado mantido em profiles.

CREATE TABLE IF NOT EXISTS public.weekly_whatsapp_followup_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  dispatch_enabled boolean NOT NULL DEFAULT true,
  batch_size integer NOT NULL DEFAULT 20 CHECK (batch_size BETWEEN 1 AND 50),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.weekly_whatsapp_followup_settings (
  id, enabled, dispatch_enabled, batch_size, timezone
) VALUES (true, true, true, 20, 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET
  enabled = excluded.enabled,
  dispatch_enabled = excluded.dispatch_enabled,
  batch_size = excluded.batch_size,
  timezone = excluded.timezone,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.weekly_whatsapp_followup_opt_outs (
  phone text PRIMARY KEY CHECK (phone ~ '^55[0-9]{10,11}$'),
  reason text NOT NULL DEFAULT 'user_request',
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.weekly_whatsapp_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  week_start date NOT NULL,
  recipient_name text NOT NULL,
  recipient_role text NOT NULL,
  recipient_phone text NOT NULL CHECK (recipient_phone ~ '^55[0-9]{10,11}$'),
  message_variant smallint NOT NULL DEFAULT 0 CHECK (message_variant BETWEEN 0 AND 7),
  scheduled_at timestamptz NOT NULL,
  next_attempt_at timestamptz,
  status text NOT NULL DEFAULT 'planned' CHECK (
    status IN (
      'planned', 'processing', 'queued', 'sent', 'delivered', 'read',
      'failed', 'skipped'
    )
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  provider_message_id text,
  provider_status text,
  last_error text,
  locked_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_whatsapp_followups_profile_week_idx
  ON public.weekly_whatsapp_followups(recipient_profile_id, week_start)
  WHERE NOT is_test AND recipient_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS weekly_whatsapp_followups_due_idx
  ON public.weekly_whatsapp_followups(
    coalesce(next_attempt_at, scheduled_at), status
  )
  WHERE NOT is_test AND status IN ('planned', 'failed', 'processing');

CREATE INDEX IF NOT EXISTS weekly_whatsapp_followups_provider_idx
  ON public.weekly_whatsapp_followups(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.weekly_whatsapp_followup_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_whatsapp_followup_opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_whatsapp_followups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.weekly_whatsapp_followup_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.weekly_whatsapp_followup_opt_outs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.weekly_whatsapp_followups FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.weekly_whatsapp_followup_settings TO service_role;
GRANT ALL ON public.weekly_whatsapp_followup_opt_outs TO service_role;
GRANT ALL ON public.weekly_whatsapp_followups TO service_role;

CREATE OR REPLACE FUNCTION public.plan_weekly_whatsapp_followups(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_week_start date := date_trunc(
    'week', p_now AT TIME ZONE 'America/Sao_Paulo'
  )::date;
  v_inserted integer := 0;
BEGIN
  INSERT INTO public.weekly_whatsapp_followups (
    recipient_profile_id,
    week_start,
    recipient_name,
    recipient_role,
    recipient_phone,
    message_variant,
    scheduled_at,
    next_attempt_at,
    status
  )
  SELECT
    profile.id,
    v_week_start,
    profile.nome,
    profile.role::text,
    normalized.phone,
    (
      ('x' || substr(md5(profile.id::text || ':' || v_week_start::text), 1, 8))::bit(32)::bigint
      % 8
    )::smallint,
    chosen.local_slot AT TIME ZONE 'America/Sao_Paulo',
    chosen.local_slot AT TIME ZONE 'America/Sao_Paulo',
    'planned'
  FROM public.profiles AS profile
  LEFT JOIN LATERAL (
    SELECT owner.telefone
    FROM public.proprietarios AS owner
    WHERE owner.profile_id = profile.id
    ORDER BY owner.updated_at DESC
    LIMIT 1
  ) AS owner_phone ON true
  LEFT JOIN LATERAL (
    SELECT agency.contato_telefone
    FROM public.imobiliarias AS agency
    WHERE lower(btrim(agency.contato_email)) = lower(btrim(profile.email))
    ORDER BY agency.updated_at DESC
    LIMIT 1
  ) AS agency_phone ON true
  CROSS JOIN LATERAL (
    SELECT regexp_replace(
      coalesce(
        nullif(profile.telefone, ''),
        nullif(owner_phone.telefone, ''),
        nullif(agency_phone.contato_telefone, '')
      ),
      '[^0-9]',
      '',
      'g'
    ) AS digits
  ) AS raw_phone
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN raw_phone.digits LIKE '55%' THEN raw_phone.digits
      ELSE '55' || raw_phone.digits
    END AS phone
  ) AS normalized
  CROSS JOIN LATERAL (
    SELECT candidate.local_slot
    FROM generate_series(
      v_week_start::timestamp + interval '9 hours',
      v_week_start::timestamp + interval '4 days 17 hours 50 minutes',
      interval '10 minutes'
    ) AS candidate(local_slot)
    WHERE candidate.local_slot::time BETWEEN time '09:00' AND time '17:50'
      AND candidate.local_slot AT TIME ZONE 'America/Sao_Paulo'
        > p_now + interval '2 minutes'
    ORDER BY md5(
      profile.id::text || ':' || v_week_start::text || ':' || candidate.local_slot::text
    )
    LIMIT 1
  ) AS chosen
  WHERE profile.role::text IN ('corretor', 'imobiliaria', 'proprietario', 'inquilino')
    AND lower(coalesce(profile.status, 'ativo')) NOT IN (
      'bloqueado', 'bloqueada', 'reprovado', 'reprovada', 'excluido',
      'excluida', 'inativo', 'inativa', 'desativado', 'desativada'
    )
    AND normalized.phone ~ '^55[0-9]{10,11}$'
    AND NOT EXISTS (
      SELECT 1
      FROM public.internal_users AS employee
      WHERE employee.auth_user_id = profile.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.weekly_whatsapp_followup_opt_outs AS opt_out
      WHERE opt_out.phone = normalized.phone
    )
  ON CONFLICT (recipient_profile_id, week_start)
    WHERE NOT is_test AND recipient_profile_id IS NOT NULL
  DO UPDATE SET
    recipient_name = excluded.recipient_name,
    recipient_role = excluded.recipient_role,
    recipient_phone = excluded.recipient_phone,
    updated_at = now()
  WHERE weekly_whatsapp_followups.status = 'planned';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_weekly_whatsapp_followups(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
)
RETURNS SETOF public.weekly_whatsapp_followups
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH skipped_opt_outs AS (
    UPDATE public.weekly_whatsapp_followups AS followup
    SET
      status = 'skipped',
      last_error = 'user_opt_out',
      next_attempt_at = NULL,
      locked_at = NULL,
      updated_at = p_now
    WHERE NOT followup.is_test
      AND followup.status IN ('planned', 'failed')
      AND EXISTS (
        SELECT 1
        FROM public.weekly_whatsapp_followup_opt_outs AS opt_out
        WHERE opt_out.phone = followup.recipient_phone
      )
    RETURNING followup.id
  ), due AS (
    SELECT followup.id
    FROM public.weekly_whatsapp_followups AS followup
    WHERE NOT followup.is_test
      AND followup.attempts < 3
      AND (
        (
          followup.status IN ('planned', 'failed')
          AND coalesce(followup.next_attempt_at, followup.scheduled_at) <= p_now
        )
        OR (
          followup.status = 'processing'
          AND followup.locked_at < p_now - interval '20 minutes'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.weekly_whatsapp_followup_opt_outs AS opt_out
        WHERE opt_out.phone = followup.recipient_phone
      )
    ORDER BY coalesce(followup.next_attempt_at, followup.scheduled_at), followup.id
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 50)
  )
  UPDATE public.weekly_whatsapp_followups AS followup
  SET
    status = 'processing',
    attempts = followup.attempts + 1,
    locked_at = p_now,
    updated_at = p_now
  FROM due
  WHERE followup.id = due.id
  RETURNING followup.*;
$$;

REVOKE ALL ON FUNCTION public.plan_weekly_whatsapp_followups(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_weekly_whatsapp_followups(integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_weekly_whatsapp_followups(timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_weekly_whatsapp_followups(integer, timestamptz)
  TO service_role;

COMMENT ON TABLE public.weekly_whatsapp_followups IS
  'Fila idempotente de um follow-up semanal por login externo, distribuido em dias e horarios comerciais aleatorios.';
COMMENT ON FUNCTION public.plan_weekly_whatsapp_followups(timestamptz) IS
  'Planeja a semana para corretor, imobiliaria, proprietario e inquilino; qualquer auth_user_id de internal_users e excluido.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net indisponiveis: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.unschedule('followup-semanal-usuarios-nox')
      WHERE EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'followup-semanal-usuarios-nox'
      );

    PERFORM cron.schedule(
      'followup-semanal-usuarios-nox',
      '*/10 12-20 * * 1-5',
      $cron$
      SELECT net.http_post(
        url := 'https://njheoytyidsghittjilr.supabase.co/functions/v1/process-weekly-user-followups',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'cron_notifications_secret'
          )
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  ELSE
    RAISE NOTICE 'Agendador semanal nao criado porque pg_cron/pg_net nao estao ativos.';
  END IF;
END $$;
