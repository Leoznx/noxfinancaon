-- Automacoes operacionais solicitadas para o WhatsApp da NOX:
-- 1. revisao administrativa depois do envio dos documentos complementares;
-- 2. acompanhamento de contas externas sem atividade ha mais de tres dias;
-- 3. a entrega do PDF assinado e concluida na Edge Function D4Sign.

CREATE TABLE IF NOT EXISTS public.platform_user_activity (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('web', 'mobile')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_user_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_user_activity FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_user_activity TO service_role;

CREATE OR REPLACE FUNCTION public.record_platform_activity(p_source text)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_activity_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF v_source NOT IN ('web', 'mobile') THEN
    RAISE EXCEPTION 'INVALID_ACTIVITY_SOURCE' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_user_activity AS activity (
    user_id,
    last_activity_at,
    source,
    updated_at
  ) VALUES (
    v_uid,
    clock_timestamp(),
    v_source,
    clock_timestamp()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    last_activity_at = excluded.last_activity_at,
    source = excluded.source,
    updated_at = excluded.updated_at
  -- O cliente pode sinalizar ao voltar ao primeiro plano. Limitar a gravacao
  -- evita transformar uso continuo em uma escrita por navegacao.
  WHERE activity.last_activity_at < excluded.last_activity_at - interval '10 minutes'
  RETURNING last_activity_at INTO v_activity_at;

  IF v_activity_at IS NULL THEN
    SELECT activity.last_activity_at INTO v_activity_at
    FROM public.platform_user_activity AS activity
    WHERE activity.user_id = v_uid;
  END IF;
  RETURN v_activity_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_platform_activity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_platform_activity(text) TO authenticated;

DROP FUNCTION IF EXISTS public.resolve_weekly_whatsapp_followup_recipients();
CREATE FUNCTION public.resolve_weekly_whatsapp_followup_recipients()
RETURNS TABLE (
  profile_id uuid,
  recipient_name text,
  recipient_role text,
  recipient_phone text,
  last_activity_at timestamptz
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
      greatest(
        coalesce(activity.last_activity_at, '-infinity'::timestamptz),
        coalesce(login.last_sign_in_at, '-infinity'::timestamptz),
        profile.created_at
      ) AS last_activity_at,
      row_number() OVER (
        PARTITION BY normalized.phone
        ORDER BY
          CASE
            WHEN nullif(btrim(profile.telefone), '') IS NOT NULL THEN 0
            ELSE 1
          END,
          greatest(
            coalesce(activity.last_activity_at, '-infinity'::timestamptz),
            coalesce(login.last_sign_in_at, '-infinity'::timestamptz),
            profile.created_at
          ) DESC,
          profile.updated_at DESC NULLS LAST,
          profile.created_at DESC,
          profile.id
      ) AS phone_rank
    FROM public.profiles AS profile
    JOIN auth.users AS login ON login.id = profile.id
    LEFT JOIN public.platform_user_activity AS activity
      ON activity.user_id = profile.id
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
    account.last_activity_at
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
    WHERE account.last_activity_at <= p_now - interval '3 days'
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
  ), skipped_recent_activity AS (
    UPDATE public.weekly_whatsapp_followups AS followup
    SET
      status = 'skipped',
      last_error = 'user_active_again',
      next_attempt_at = NULL,
      locked_at = NULL,
      updated_at = p_now
    WHERE NOT followup.is_test
      AND followup.status IN ('planned', 'failed')
      AND EXISTS (
        SELECT 1
        FROM public.resolve_weekly_whatsapp_followup_recipients() AS account
        WHERE account.recipient_phone = followup.recipient_phone
          AND account.last_activity_at > p_now - interval '3 days'
      )
    RETURNING followup.id
  ), skipped_stale_processing AS (
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
      AND account.last_activity_at <= p_now - interval '3 days'
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
  'Escolhe uma conta externa por WhatsApp e usa o uso mais recente entre site, app e login.';
COMMENT ON FUNCTION public.plan_weekly_whatsapp_followups(timestamptz) IS
  'Planeja acompanhamento comercial somente depois de tres dias completos sem atividade.';
COMMENT ON FUNCTION public.claim_due_weekly_whatsapp_followups(integer, timestamptz) IS
  'Cancela o envio se a conta voltou a usar a plataforma e reserva uma entrega idempotente.';

CREATE TABLE IF NOT EXISTS public.whatsapp_contract_automation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  dispatch_enabled boolean NOT NULL DEFAULT true,
  admin_phone text NOT NULL DEFAULT '5547999614166'
    CHECK (admin_phone ~ '^55[0-9]{10,11}$'),
  batch_size integer NOT NULL DEFAULT 20 CHECK (batch_size BETWEEN 1 AND 50),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.whatsapp_contract_automation_settings (
  id, enabled, dispatch_enabled, admin_phone, batch_size
) VALUES (true, true, true, '5547999614166', 20)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.whatsapp_contract_automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultas_credito(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('admin_review', 'requester_decision')),
  decision text CHECK (decision IS NULL OR decision IN ('aprovado', 'recusado')),
  status text NOT NULL DEFAULT 'planned' CHECK (
    status IN ('planned', 'processing', 'sent', 'failed', 'skipped')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  recipient_phone text,
  provider_message_id text,
  score_document_provider_message_id text,
  commitment_document_provider_message_id text,
  action_provider_message_id text,
  provider_status text,
  last_error text,
  resolved_at timestamptz,
  resolution_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultation_id, job_type),
  CHECK (
    (job_type = 'admin_review' AND decision IS NULL)
    OR (job_type = 'requester_decision' AND decision IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS whatsapp_contract_automation_jobs_due_idx
  ON public.whatsapp_contract_automation_jobs(next_attempt_at, status)
  WHERE status IN ('planned', 'failed', 'processing');
CREATE INDEX IF NOT EXISTS whatsapp_contract_automation_jobs_provider_idx
  ON public.whatsapp_contract_automation_jobs(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.whatsapp_contract_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contract_automation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_contract_automation_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_contract_automation_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_contract_automation_settings TO service_role;
GRANT ALL ON public.whatsapp_contract_automation_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_credit_review_whatsapp_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_review_job boolean;
  v_decision text;
BEGIN
  IF NEW.status = 'em_analise'
     AND NEW.substatus = 'documentacao_complementar_enviada'
     AND (
       OLD.status IS DISTINCT FROM NEW.status
       OR OLD.substatus IS DISTINCT FROM NEW.substatus
     ) THEN
    DELETE FROM public.whatsapp_contract_automation_jobs
    WHERE consultation_id = NEW.id
      AND job_type = 'requester_decision';

    INSERT INTO public.whatsapp_contract_automation_jobs (
      consultation_id,
      job_type,
      next_attempt_at
    ) VALUES (
      NEW.id,
      'admin_review',
      clock_timestamp()
    )
    ON CONFLICT (consultation_id, job_type) DO UPDATE SET
      status = 'planned',
      attempts = 0,
      next_attempt_at = clock_timestamp(),
      locked_at = NULL,
      recipient_phone = NULL,
      provider_message_id = NULL,
      score_document_provider_message_id = NULL,
      commitment_document_provider_message_id = NULL,
      action_provider_message_id = NULL,
      provider_status = NULL,
      last_error = NULL,
      resolved_at = NULL,
      resolution_source = NULL,
      updated_at = clock_timestamp();
  END IF;

  v_decision := CASE
    WHEN NEW.resultado = 'aprovado' THEN 'aprovado'
    WHEN NEW.resultado IN ('recusado', 'reprovado') THEN 'recusado'
    ELSE NULL
  END;
  IF v_decision IS NOT NULL
     AND NEW.resultado IS DISTINCT FROM OLD.resultado THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.whatsapp_contract_automation_jobs AS job
      WHERE job.consultation_id = NEW.id
        AND job.job_type = 'admin_review'
    ) INTO v_has_review_job;

    IF v_has_review_job THEN
      INSERT INTO public.whatsapp_contract_automation_jobs (
        consultation_id,
        job_type,
        decision,
        next_attempt_at
      ) VALUES (
        NEW.id,
        'requester_decision',
        v_decision,
        clock_timestamp()
      )
      ON CONFLICT (consultation_id, job_type) DO UPDATE SET
        decision = excluded.decision,
        status = CASE
          WHEN whatsapp_contract_automation_jobs.status IN ('sent', 'skipped')
            THEN whatsapp_contract_automation_jobs.status
          ELSE 'planned'
        END,
        next_attempt_at = CASE
          WHEN whatsapp_contract_automation_jobs.status IN ('sent', 'skipped')
            THEN whatsapp_contract_automation_jobs.next_attempt_at
          ELSE clock_timestamp()
        END,
        updated_at = clock_timestamp();

      -- A notificacao dentro da plataforma continua centralizada no trigger
      -- notify_credit_result, que respeita as preferencias do solicitante.
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_credit_review_whatsapp_automation_trigger
  ON public.consultas_credito;
CREATE TRIGGER enqueue_credit_review_whatsapp_automation_trigger
AFTER UPDATE OF status, substatus, resultado
ON public.consultas_credito
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_credit_review_whatsapp_automation();

REVOKE ALL ON FUNCTION public.enqueue_credit_review_whatsapp_automation()
  FROM PUBLIC, anon, authenticated;

-- Solicita revisao tambem para os dossies que ja estavam aguardando no momento
-- do deploy. Decisoes antigas nao sao reenviadas.
INSERT INTO public.whatsapp_contract_automation_jobs (
  consultation_id,
  job_type,
  next_attempt_at
)
SELECT
  consultation.id,
  'admin_review',
  clock_timestamp()
FROM public.consultas_credito AS consultation
WHERE consultation.status = 'em_analise'
  AND consultation.substatus = 'documentacao_complementar_enviada'
ON CONFLICT (consultation_id, job_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_contract_automation_jobs(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
)
RETURNS SETOF public.whatsapp_contract_automation_jobs
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH stale AS (
    UPDATE public.whatsapp_contract_automation_jobs AS job
    SET
      status = 'skipped',
      last_error = 'delivery_uncertain_not_retried:stale_processing_lock',
      locked_at = NULL,
      updated_at = p_now
    WHERE job.status = 'processing'
      AND job.locked_at < p_now - interval '20 minutes'
    RETURNING job.id
  ), due AS (
    SELECT job.id
    FROM public.whatsapp_contract_automation_jobs AS job
    WHERE job.status IN ('planned', 'failed')
      AND job.attempts < 3
      AND job.next_attempt_at <= p_now
    ORDER BY job.next_attempt_at, job.created_at, job.id
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 50)
  )
  UPDATE public.whatsapp_contract_automation_jobs AS job
  SET
    status = 'processing',
    attempts = job.attempts + 1,
    locked_at = p_now,
    updated_at = p_now
  FROM due
  WHERE job.id = due.id
  RETURNING job.*;
$$;

REVOKE ALL ON FUNCTION public.claim_whatsapp_contract_automation_jobs(integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_contract_automation_jobs(integer, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_admin_credit_review(
  p_consultation_id uuid,
  p_decision text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_consultation public.consultas_credito%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = v_uid
        AND profile.role::text IN ('admin', 'admin_master', 'analista', 'juridico')
        AND coalesce(profile.status, 'ativo') NOT IN ('bloqueado', 'excluido')
    )
    OR public.has_internal_role(v_uid, 'admin_master'::public.internal_role)
    OR public.has_internal_role(v_uid, 'juridico'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_decision NOT IN ('aprovado', 'recusado') THEN
    RAISE EXCEPTION 'Decisão inválida.' USING ERRCODE = '22023';
  END IF;
  IF v_decision = 'recusado' AND nullif(btrim(coalesce(p_rejection_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da recusa.' USING ERRCODE = '22023';
  END IF;

  SELECT consultation.* INTO v_consultation
  FROM public.consultas_credito AS consultation
  WHERE consultation.id = p_consultation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consulta não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_consultation.status <> 'em_analise'
     OR v_consultation.substatus <> 'documentacao_complementar_enviada' THEN
    RETURN 'already_resolved';
  END IF;

  UPDATE public.consultas_credito
  SET
    status = CASE WHEN v_decision = 'aprovado' THEN 'aprovado' ELSE 'reprovado' END,
    resultado = v_decision,
    approved_by = CASE WHEN v_decision = 'aprovado' THEN v_uid ELSE approved_by END,
    approved_at = CASE WHEN v_decision = 'aprovado' THEN clock_timestamp() ELSE approved_at END,
    rejected_by = CASE WHEN v_decision = 'recusado' THEN v_uid ELSE rejected_by END,
    rejected_at = CASE WHEN v_decision = 'recusado' THEN clock_timestamp() ELSE rejected_at END,
    rejection_reason = CASE
      WHEN v_decision = 'recusado' THEN left(btrim(p_rejection_reason), 1000)
      ELSE NULL
    END,
    updated_at = clock_timestamp()
  WHERE id = p_consultation_id;

  INSERT INTO public.proposta_historico (consulta_id, tipo_evento, descricao)
  VALUES (
    p_consultation_id,
    'analise_documental_' || v_decision,
    CASE
      WHEN v_decision = 'aprovado' THEN 'Análise documental aprovada no painel administrativo.'
      ELSE 'Análise documental recusada no painel administrativo.'
    END
  );
  RETURN v_decision;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_admin_credit_review(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_admin_credit_review(uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_admin_credit_review_via_whatsapp(
  p_consultation_id uuid,
  p_decision text,
  p_sender_phone text,
  p_provider_message_id text,
  p_reference_message_id text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_sender_phone text := regexp_replace(coalesce(p_sender_phone, ''), '[^0-9]', '', 'g');
  v_expected_phone text;
  v_job public.whatsapp_contract_automation_jobs%ROWTYPE;
  v_consultation public.consultas_credito%ROWTYPE;
  v_admin_id uuid;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF v_decision NOT IN ('aprovado', 'recusado') THEN
    RAISE EXCEPTION 'Invalid decision' USING ERRCODE = '22023';
  END IF;

  SELECT settings.admin_phone INTO v_expected_phone
  FROM public.whatsapp_contract_automation_settings AS settings
  WHERE settings.id = true
    AND settings.enabled
    AND settings.dispatch_enabled;
  IF v_expected_phone IS NULL OR v_sender_phone IS DISTINCT FROM v_expected_phone THEN
    RAISE EXCEPTION 'Unauthorized WhatsApp sender' USING ERRCODE = '42501';
  END IF;

  SELECT job.* INTO v_job
  FROM public.whatsapp_contract_automation_jobs AS job
  WHERE job.consultation_id = p_consultation_id
    AND job.job_type = 'admin_review'
  FOR UPDATE;
  IF NOT FOUND OR v_job.action_provider_message_id IS NULL THEN
    RAISE EXCEPTION 'Review action not available' USING ERRCODE = '55000';
  END IF;
  IF nullif(btrim(coalesce(p_reference_message_id, '')), '') IS NULL
     OR p_reference_message_id IS DISTINCT FROM v_job.action_provider_message_id THEN
    RAISE EXCEPTION 'Review message mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT consultation.* INTO v_consultation
  FROM public.consultas_credito AS consultation
  WHERE consultation.id = p_consultation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_consultation.status <> 'em_analise'
     OR v_consultation.substatus <> 'documentacao_complementar_enviada' THEN
    RETURN 'already_resolved';
  END IF;

  SELECT profile.id INTO v_admin_id
  FROM public.profiles AS profile
  LEFT JOIN public.internal_users AS employee
    ON employee.auth_user_id = profile.id
  WHERE regexp_replace(coalesce(profile.telefone, ''), '[^0-9]', '', 'g') IN (
      v_expected_phone,
      regexp_replace(v_expected_phone, '^55', '')
    )
    AND (
      profile.role::text IN ('admin', 'admin_master')
      OR (employee.role::text = 'admin_master' AND employee.status = 'ativo')
    )
  ORDER BY profile.updated_at DESC NULLS LAST
  LIMIT 1;

  UPDATE public.consultas_credito
  SET
    status = CASE WHEN v_decision = 'aprovado' THEN 'aprovado' ELSE 'reprovado' END,
    resultado = v_decision,
    approved_by = CASE WHEN v_decision = 'aprovado' THEN v_admin_id ELSE approved_by END,
    approved_at = CASE WHEN v_decision = 'aprovado' THEN clock_timestamp() ELSE approved_at END,
    rejected_by = CASE WHEN v_decision = 'recusado' THEN v_admin_id ELSE rejected_by END,
    rejected_at = CASE WHEN v_decision = 'recusado' THEN clock_timestamp() ELSE rejected_at END,
    rejection_reason = CASE
      WHEN v_decision = 'recusado' THEN 'Recusado pelo administrador via WhatsApp.'
      ELSE NULL
    END,
    updated_at = clock_timestamp()
  WHERE id = p_consultation_id;

  UPDATE public.whatsapp_contract_automation_jobs
  SET
    resolved_at = clock_timestamp(),
    resolution_source = 'whatsapp',
    provider_status = 'answered',
    updated_at = clock_timestamp()
  WHERE id = v_job.id;

  INSERT INTO public.proposta_historico (consulta_id, tipo_evento, descricao)
  VALUES (
    p_consultation_id,
    'analise_documental_' || v_decision || '_whatsapp',
    format(
      'Análise documental %s pelo WhatsApp administrativo. Evento Z-API: %s.',
      v_decision,
      left(coalesce(p_provider_message_id, 'sem-id'), 120)
    )
  );
  RETURN v_decision;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_admin_credit_review_via_whatsapp(
  uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_admin_credit_review_via_whatsapp(
  uuid, text, text, text, text
) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.unschedule('whatsapp-contratos-nox')
      WHERE EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-contratos-nox'
      );
    PERFORM cron.schedule(
      'whatsapp-contratos-nox',
      '*/2 * * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://njheoytyidsghittjilr.supabase.co/functions/v1/process-whatsapp-contract-automations',
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
    RAISE NOTICE 'Agendador das automacoes WhatsApp nao criado: pg_cron/pg_net indisponiveis.';
  END IF;
END $$;

COMMENT ON TABLE public.platform_user_activity IS
  'Ultimo uso autenticado do site ou aplicativo, com escrita limitada pela RPC.';
COMMENT ON TABLE public.whatsapp_contract_automation_jobs IS
  'Fila idempotente da revisao documental e da comunicacao da decisao ao solicitante.';
