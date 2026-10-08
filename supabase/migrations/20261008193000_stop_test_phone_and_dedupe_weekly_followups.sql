-- Follow-ups reais usam somente os telefones das contas e nunca os numeros
-- usados em testes manuais. Um mesmo WhatsApp recebe no maximo uma mensagem
-- por semana, mesmo quando cadastros duplicados compartilham o telefone.

CREATE TABLE IF NOT EXISTS public.weekly_whatsapp_followup_excluded_phones (
  phone text PRIMARY KEY CHECK (phone ~ '^55[0-9]{10,11}$'),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.weekly_whatsapp_followup_excluded_phones ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.weekly_whatsapp_followup_excluded_phones
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.weekly_whatsapp_followup_excluded_phones TO service_role;

-- Todo numero que ja recebeu teste fica permanentemente fora dos disparos
-- reais. A trilha antiga continua preservada para auditoria.
INSERT INTO public.weekly_whatsapp_followup_excluded_phones (
  phone, reason, created_at, updated_at
)
SELECT DISTINCT
  followup.recipient_phone,
  'historical_test_phone',
  now(),
  now()
FROM public.weekly_whatsapp_followups AS followup
WHERE followup.is_test
ON CONFLICT (phone) DO UPDATE SET
  reason = excluded.reason,
  updated_at = now();

UPDATE public.weekly_whatsapp_followups AS followup
SET
  status = 'skipped',
  last_error = 'excluded_test_phone',
  next_attempt_at = NULL,
  locked_at = NULL,
  updated_at = now()
WHERE NOT followup.is_test
  AND followup.status IN ('planned', 'failed', 'processing')
  AND EXISTS (
    SELECT 1
    FROM public.weekly_whatsapp_followup_excluded_phones AS excluded
    WHERE excluded.phone = followup.recipient_phone
  );

-- Se duas contas compartilham o mesmo telefone nesta semana, preserva a
-- entrega ja realizada. Quando nenhuma saiu, mantem somente a primeira.
WITH ranked AS (
  SELECT
    followup.id,
    followup.status,
    row_number() OVER (
      PARTITION BY followup.recipient_phone, followup.week_start
      ORDER BY
        CASE
          WHEN followup.status IN (
            'processing', 'queued', 'sent', 'delivered', 'read'
          ) THEN 0
          ELSE 1
        END,
        coalesce(followup.sent_at, followup.scheduled_at),
        followup.id
    ) AS phone_rank
  FROM public.weekly_whatsapp_followups AS followup
  WHERE NOT followup.is_test
)
UPDATE public.weekly_whatsapp_followups AS followup
SET
  status = 'skipped',
  last_error = 'duplicate_phone_for_week',
  next_attempt_at = NULL,
  locked_at = NULL,
  updated_at = now()
FROM ranked
WHERE ranked.id = followup.id
  AND ranked.phone_rank > 1
  AND followup.status IN ('planned', 'failed');

-- A partir da proxima semana a garantia tambem fica no banco, impedindo que
-- qualquer caminho futuro crie duas mensagens reais para o mesmo telefone.
CREATE UNIQUE INDEX IF NOT EXISTS weekly_whatsapp_followups_phone_week_idx
  ON public.weekly_whatsapp_followups(recipient_phone, week_start)
  WHERE NOT is_test AND week_start >= DATE '2026-10-12';

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
  WITH eligible_accounts AS (
    SELECT
      profile.id,
      profile.nome,
      profile.role::text AS role,
      normalized.phone,
      row_number() OVER (
        PARTITION BY normalized.phone
        ORDER BY profile.created_at, profile.id
      ) AS phone_rank
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
    WHERE profile.role::text IN (
      'corretor', 'imobiliaria', 'proprietario', 'inquilino'
    )
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.weekly_whatsapp_followup_excluded_phones AS excluded
        WHERE excluded.phone = normalized.phone
      )
  ), planned_accounts AS (
    SELECT
      account.id,
      account.nome,
      account.role,
      account.phone,
      chosen.local_slot
    FROM eligible_accounts AS account
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
        account.id::text || ':' || v_week_start::text || ':'
          || candidate.local_slot::text
      )
      LIMIT 1
    ) AS chosen
    WHERE account.phone_rank = 1
  )
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
    account.id,
    v_week_start,
    account.nome,
    account.role,
    account.phone,
    (
      ('x' || substr(md5(account.id::text || ':' || v_week_start::text), 1, 8))::bit(32)::bigint
      % 8
    )::smallint,
    account.local_slot AT TIME ZONE 'America/Sao_Paulo',
    account.local_slot AT TIME ZONE 'America/Sao_Paulo',
    'planned'
  FROM planned_accounts AS account
  -- A fila e um retrato semanal. Se o planejador rodar novamente, qualquer
  -- conflito por perfil ou telefone conserva a primeira linha valida.
  ON CONFLICT DO NOTHING;

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
  ), skipped_exclusions AS (
    UPDATE public.weekly_whatsapp_followups AS followup
    SET
      status = 'skipped',
      last_error = 'excluded_test_phone',
      next_attempt_at = NULL,
      locked_at = NULL,
      updated_at = p_now
    WHERE NOT followup.is_test
      AND followup.status IN ('planned', 'failed')
      AND EXISTS (
        SELECT 1
        FROM public.weekly_whatsapp_followup_excluded_phones AS excluded
        WHERE excluded.phone = followup.recipient_phone
      )
    RETURNING followup.id
  ), skipped_duplicates AS (
    UPDATE public.weekly_whatsapp_followups AS followup
    SET
      status = 'skipped',
      last_error = 'duplicate_phone_for_week',
      next_attempt_at = NULL,
      locked_at = NULL,
      updated_at = p_now
    WHERE NOT followup.is_test
      AND followup.status IN ('planned', 'failed')
      AND EXISTS (
        SELECT 1
        FROM public.weekly_whatsapp_followups AS preferred
        WHERE preferred.recipient_phone = followup.recipient_phone
          AND preferred.week_start = followup.week_start
          AND NOT preferred.is_test
          AND preferred.id <> followup.id
          AND (
            preferred.status IN (
              'processing', 'queued', 'sent', 'delivered', 'read'
            )
            OR (
              preferred.status IN ('planned', 'failed')
              AND preferred.id < followup.id
            )
          )
      )
    RETURNING followup.id
  ), due_candidates AS (
    SELECT
      followup.id,
      coalesce(followup.next_attempt_at, followup.scheduled_at) AS due_at,
      row_number() OVER (
        PARTITION BY followup.recipient_phone, followup.week_start
        ORDER BY
          coalesce(followup.next_attempt_at, followup.scheduled_at),
          followup.id
      ) AS phone_rank
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.weekly_whatsapp_followup_excluded_phones AS excluded
        WHERE excluded.phone = followup.recipient_phone
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.weekly_whatsapp_followups AS already_sent
        WHERE already_sent.recipient_phone = followup.recipient_phone
          AND already_sent.week_start = followup.week_start
          AND NOT already_sent.is_test
          AND already_sent.id <> followup.id
          AND already_sent.status IN (
            'processing', 'queued', 'sent', 'delivered', 'read'
          )
      )
  ), due AS (
    SELECT followup.id
    FROM public.weekly_whatsapp_followups AS followup
    JOIN due_candidates AS candidate ON candidate.id = followup.id
    WHERE candidate.phone_rank = 1
    ORDER BY candidate.due_at, followup.id
    FOR UPDATE OF followup SKIP LOCKED
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

COMMENT ON TABLE public.weekly_whatsapp_followup_excluded_phones IS
  'Telefones operacionais ou de teste que nunca podem receber follow-ups reais.';
COMMENT ON FUNCTION public.plan_weekly_whatsapp_followups(timestamptz) IS
  'Planeja um follow-up por WhatsApp distinto para cada semana, usando nome e telefone da conta ativa e excluindo numeros de teste.';
COMMENT ON FUNCTION public.claim_due_weekly_whatsapp_followups(integer, timestamptz) IS
  'Reserva atomicamente somente follow-ups reais, nao excluidos e sem duplicidade de telefone na semana.';
