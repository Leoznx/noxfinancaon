-- Endurece a automacao semanal em tres pontos:
-- 1. um WhatsApp compartilhado pertence, para este envio, a conta ativa mais
--    recentemente no site;
-- 2. duas entregas ficam separadas por pelo menos sete dias;
-- 3. uma tentativa de resultado incerto nunca e repetida automaticamente.

CREATE OR REPLACE FUNCTION public.resolve_weekly_whatsapp_followup_recipients()
RETURNS TABLE (
  profile_id uuid,
  recipient_name text,
  recipient_role text,
  recipient_phone text,
  last_sign_in_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  WITH eligible_accounts AS (
    SELECT
      profile.id,
      profile.nome,
      profile.role::text AS role,
      normalized.phone,
      login.last_sign_in_at,
      row_number() OVER (
        PARTITION BY normalized.phone
        ORDER BY
          -- O telefone informado diretamente pela conta vence os cadastros
          -- auxiliares de proprietario ou imobiliaria.
          CASE
            WHEN nullif(btrim(profile.telefone), '') IS NOT NULL THEN 0
            ELSE 1
          END,
          login.last_sign_in_at DESC NULLS LAST,
          profile.updated_at DESC NULLS LAST,
          profile.created_at DESC,
          profile.id
      ) AS phone_rank
    FROM public.profiles AS profile
    JOIN auth.users AS login ON login.id = profile.id
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
          nullif(btrim(profile.telefone), ''),
          nullif(btrim(owner_phone.telefone), ''),
          nullif(btrim(agency_phone.contato_telefone), '')
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
        FROM public.weekly_whatsapp_followup_excluded_phones AS excluded
        WHERE excluded.phone = normalized.phone
      )
  )
  SELECT
    account.id,
    account.nome,
    account.role,
    account.phone,
    account.last_sign_in_at
  FROM eligible_accounts AS account
  WHERE account.phone_rank = 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_weekly_whatsapp_followup_recipients()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_weekly_whatsapp_followup_recipients()
  TO service_role;

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
  WITH planned_accounts AS (
    SELECT
      account.profile_id,
      account.recipient_name,
      account.recipient_role,
      account.recipient_phone,
      chosen.local_slot
    FROM public.resolve_weekly_whatsapp_followup_recipients() AS account
    LEFT JOIN LATERAL (
      SELECT max(
        coalesce(
          followup.sent_at,
          followup.locked_at,
          followup.updated_at
        )
      ) AS last_contact_at
      FROM public.weekly_whatsapp_followups AS followup
      WHERE followup.recipient_phone = account.recipient_phone
        AND NOT followup.is_test
        AND (
          followup.status IN (
            'processing', 'queued', 'sent', 'delivered', 'read'
          )
          OR (
            followup.status = 'skipped'
            AND followup.last_error LIKE 'delivery_uncertain_not_retried%'
          )
        )
    ) AS history ON true
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
        AND (
          history.last_contact_at IS NULL
          OR candidate.local_slot AT TIME ZONE 'America/Sao_Paulo'
            >= history.last_contact_at + interval '7 days'
        )
      ORDER BY md5(
        account.recipient_phone || ':' || v_week_start::text || ':'
          || candidate.local_slot::text
      )
      LIMIT 1
    ) AS chosen
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
    account.profile_id,
    v_week_start,
    account.recipient_name,
    account.recipient_role,
    account.recipient_phone,
    (
      ('x' || substr(
        md5(account.profile_id::text || ':' || v_week_start::text),
        1,
        8
      ))::bit(32)::bigint % 8
    )::smallint,
    account.local_slot AT TIME ZONE 'America/Sao_Paulo',
    account.local_slot AT TIME ZONE 'America/Sao_Paulo',
    'planned'
  FROM planned_accounts AS account
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
  WITH skipped_exclusions AS (
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
  ), skipped_stale_processing AS (
    -- A Z-API pode ter aceitado a mensagem antes de uma queda de rede. Repetir
    -- uma reserva abandonada criaria duplicidade, portanto ela vai para
    -- conciliacao em vez de voltar automaticamente para a fila.
    UPDATE public.weekly_whatsapp_followups AS followup
    SET
      status = 'skipped',
      last_error = 'delivery_uncertain_not_retried:stale_processing_lock',
      next_attempt_at = NULL,
      updated_at = p_now
    WHERE NOT followup.is_test
      AND followup.status = 'processing'
      AND followup.locked_at < p_now - interval '20 minutes'
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
      account.recipient_name,
      account.recipient_role,
      coalesce(followup.next_attempt_at, followup.scheduled_at) AS due_at,
      row_number() OVER (
        PARTITION BY followup.recipient_phone, followup.week_start
        ORDER BY
          coalesce(followup.next_attempt_at, followup.scheduled_at),
          followup.id
      ) AS phone_rank
    FROM public.weekly_whatsapp_followups AS followup
    JOIN public.resolve_weekly_whatsapp_followup_recipients() AS account
      ON account.recipient_phone = followup.recipient_phone
    WHERE NOT followup.is_test
      AND followup.attempts < 3
      AND followup.status IN ('planned', 'failed')
      AND coalesce(followup.next_attempt_at, followup.scheduled_at) <= p_now
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
    SELECT
      followup.id,
      candidate.recipient_name,
      candidate.recipient_role
    FROM public.weekly_whatsapp_followups AS followup
    JOIN due_candidates AS candidate ON candidate.id = followup.id
    WHERE candidate.phone_rank = 1
    ORDER BY candidate.due_at, followup.id
    FOR UPDATE OF followup SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 50)
  )
  UPDATE public.weekly_whatsapp_followups AS followup
  SET
    recipient_name = due.recipient_name,
    recipient_role = due.recipient_role,
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

COMMENT ON FUNCTION public.resolve_weekly_whatsapp_followup_recipients() IS
  'Escolhe uma unica conta por WhatsApp, priorizando o telefone direto e o login mais recente.';
COMMENT ON FUNCTION public.plan_weekly_whatsapp_followups(timestamptz) IS
  'Planeja no maximo um follow-up por WhatsApp e semana, em horario aleatorio e com intervalo minimo de sete dias.';
COMMENT ON FUNCTION public.claim_due_weekly_whatsapp_followups(integer, timestamptz) IS
  'Reserva uma unica entrega semanal, atualiza o nome pela conta ativa e nao repete entregas de resultado incerto.';
