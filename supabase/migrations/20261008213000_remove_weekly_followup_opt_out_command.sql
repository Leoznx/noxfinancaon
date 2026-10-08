-- Remove por completo os comandos SAIR/VOLTAR da automacao semanal.
-- A tabela antiga permanece somente como trilha historica e nao participa
-- mais do planejamento nem da reserva de mensagens.

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

COMMENT ON TABLE public.weekly_whatsapp_followup_opt_outs IS
  'Registro historico legado. A automacao semanal nao consulta mais esta tabela.';
COMMENT ON FUNCTION public.plan_weekly_whatsapp_followups(timestamptz) IS
  'Planeja um follow-up por WhatsApp distinto sem comandos de saida ou reativacao.';
COMMENT ON FUNCTION public.claim_due_weekly_whatsapp_followups(integer, timestamptz) IS
  'Reserva follow-ups reais sem interpretar preferencias por mensagem recebida.';
