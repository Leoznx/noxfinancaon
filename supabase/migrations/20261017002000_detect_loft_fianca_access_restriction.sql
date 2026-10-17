-- Classify the new Loft permission screen that appears only after a simulation
-- POST. Existing uncertain submissions remain quarantined; queued work is kept
-- durable and visibly paused until the partner restores access.

DO $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  UPDATE public.consultas_credito
  SET
    last_error_category = 'PROVIDER_ACCESS_RESTRICTED',
    error_message =
      'A conta de integração aguarda liberação de acesso ao módulo Fiança pelo parceiro.',
    updated_at = v_now
  WHERE origem = 'nox_financa'
    AND technical_status = 'requires_verification'
    AND coalesce(raw_response ->> 'textoCapturado', '')
      ~* 'liberar (o )?seu acesso (a|em) Fian(ç|c)a.{0,120}Adm Aluguel';

  IF FOUND THEN
    INSERT INTO public.credit_automation_provider_state(
      provider_key,
      consecutive_failures,
      circuit_open_until,
      last_error_category,
      last_failure_at,
      updated_at
    )
    SELECT DISTINCT
      coalesce(provider_credential_key, 'loft-primary'),
      1,
      v_now + interval '30 minutes',
      'PROVIDER_ACCESS_RESTRICTED',
      v_now,
      v_now
    FROM public.consultas_credito
    WHERE origem = 'nox_financa'
      AND technical_status = 'requires_verification'
      AND coalesce(raw_response ->> 'textoCapturado', '')
        ~* 'liberar (o )?seu acesso (a|em) Fian(ç|c)a.{0,120}Adm Aluguel'
    ON CONFLICT (provider_key) DO UPDATE SET
      consecutive_failures = greatest(
        public.credit_automation_provider_state.consecutive_failures,
        1
      ),
      circuit_open_until = greatest(
        coalesce(public.credit_automation_provider_state.circuit_open_until, v_now),
        v_now + interval '30 minutes'
      ),
      last_error_category = EXCLUDED.last_error_category,
      last_failure_at = EXCLUDED.last_failure_at,
      updated_at = EXCLUDED.updated_at;

    UPDATE public.consultas_credito
    SET
      automation_step = 'aguardando_liberacao_parceiro',
      mensagem =
        'Consulta salva. A automação será retomada quando a Loft liberar o acesso ao módulo Fiança.',
      updated_at = v_now
    WHERE origem = 'nox_financa'
      AND status = 'pendente'
      AND technical_status = 'queued';
  END IF;
END;
$$;

