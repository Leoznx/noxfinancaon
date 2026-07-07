-- =====================================================================
-- TESTE SQL DETERMINÍSTICO: comissão / reserva / clawback / bônus
-- Seguro: roda dentro de BEGIN ... ROLLBACK; nada persiste.
-- Todos os registros usam prefixo TESTE_SQL_COMISSAO_ para auditoria.
-- Como executar (dev/preview, com role com privilégios DML):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/comissao_vendedor_test.sql
-- Para rodar do agente: usar o tool supabase--insert com este conteúdo.
-- Sucesso = "TODOS OS 5 CENARIOS PASSARAM"; falha levanta exception.
-- =====================================================================
BEGIN;
DO $$
DECLARE
  v_seller_id uuid; v_inquilino_id uuid; v_imovel_id uuid;
  v_consulta_id uuid; v_apolice_id uuid; v_mens_id uuid;
  v_mes int := EXTRACT(MONTH FROM now())::int;
  v_ano int := EXTRACT(YEAR FROM now())::int;
  v_comm record; v_perf record;
  v_failures text[] := ARRAY[]::text[];
  v_i int;
BEGIN
  RAISE NOTICE '=== INICIANDO TESTE DETERMINISTICO ===';

  SELECT id INTO v_seller_id FROM public.internal_users
  WHERE email='vendedor@nox.com' AND role='vendedor' AND status='ativo' LIMIT 1;
  IF v_seller_id IS NULL THEN RAISE EXCEPTION 'vendedor demo nao encontrado em internal_users'; END IF;

  -- Limpa residuos de execucoes anteriores deste vendedor no mes corrente
  DELETE FROM public.seller_commissions
  WHERE seller_id=v_seller_id AND month=v_mes AND year=v_ano
    AND contract_id IN (SELECT id FROM public.apolices WHERE numero LIKE 'TESTE_SQL_COMISSAO_%');
  DELETE FROM public.seller_performance WHERE seller_id=v_seller_id AND month=v_mes AND year=v_ano;

  -- Setup: inquilino + imovel + consulta + 10 apolices ativas com 1a parcela paga
  -- (usa-se 10 contratos para entrar na faixa de comissao > 0 da regra atual)
  INSERT INTO public.inquilinos(nome, cpf) VALUES ('TESTE_SQL_COMISSAO_Inq', '00000000001')
  RETURNING id INTO v_inquilino_id;
  INSERT INTO public.imoveis(tipo, valor_aluguel) VALUES ('apartamento', 2000)
  RETURNING id INTO v_imovel_id;
  INSERT INTO public.consultas_credito(inquilino_id, imovel_id, tenant_name)
  VALUES (v_inquilino_id, v_imovel_id, 'TESTE_SQL_COMISSAO_Consulta')
  RETURNING id INTO v_consulta_id;

  FOR v_i IN 1..10 LOOP
    INSERT INTO public.apolices(numero, consulta_id, vigencia_inicio, vigencia_fim, valor_premio, status)
    VALUES ('TESTE_SQL_COMISSAO_'||v_i||'_'||substr(gen_random_uuid()::text,1,6),
            v_consulta_id, now()::date, (now()+interval '12 months')::date, 200, 'ativa')
    RETURNING id INTO v_apolice_id;
    INSERT INTO public.seller_commissions(seller_id, contract_id, apolice_id, month, year, status)
    VALUES (v_seller_id, v_apolice_id, v_apolice_id, v_mes, v_ano, 'aguardando_primeira_parcela');
    INSERT INTO public.mensalidades(apolice_id, valor, data_vencimento, status, data_pagamento, numero_parcela)
    VALUES (v_apolice_id, 200, now()::date, 'pago', now(), 1)
    RETURNING id INTO v_mens_id;
  END LOOP;

  -- ====================== CENARIO 1 ======================
  -- Materializacao apos 1a parcela paga
  PERFORM public.materializar_comissoes_vendedor(v_mes, v_ano);
  SELECT * INTO v_comm FROM public.seller_commissions
  WHERE seller_id=v_seller_id AND contract_id=v_apolice_id;
  IF v_comm.status NOT IN ('elegivel','retida') THEN
    v_failures := v_failures || format('C1 status=%s', v_comm.status);
  ELSE
    RAISE NOTICE 'C1 OK status=% commission=%', v_comm.status, v_comm.commission_amount;
  END IF;

  -- ====================== CENARIO 2 ======================
  -- Reserva 15% / liberado 85% / reserve_release_at +60d / clawback_until +90d
  IF v_comm.commission_amount > 0 THEN
    IF round(v_comm.reserve_amount / v_comm.commission_amount, 2) <> 0.15 THEN
      v_failures := v_failures || format('C2 reserva: %s/%s', v_comm.reserve_amount, v_comm.commission_amount);
    END IF;
    IF round(v_comm.released_amount / v_comm.commission_amount, 2) <> 0.85 THEN
      v_failures := v_failures || format('C2 liberado: %s/%s', v_comm.released_amount, v_comm.commission_amount);
    END IF;
  ELSE
    v_failures := v_failures || 'C2 commission_amount=0 (esperava >0 com 10 contratos)';
  END IF;
  IF v_comm.reserve_release_at::date <> (now()+interval '60 days')::date THEN
    v_failures := v_failures || format('C2 reserve_release_at=%s', v_comm.reserve_release_at);
  END IF;
  IF v_comm.clawback_until::date <> (now()+interval '90 days')::date THEN
    v_failures := v_failures || format('C2 clawback_until=%s', v_comm.clawback_until);
  END IF;
  RAISE NOTICE 'C2 OK reserve=% released=% release_at=% clawback_until=%',
    v_comm.reserve_amount, v_comm.released_amount, v_comm.reserve_release_at, v_comm.clawback_until;

  -- ====================== CENARIO 3 ======================
  -- Liberacao da reserva apos data alcancada (simula passagem de 60d)
  UPDATE public.seller_commissions SET reserve_release_at = now() - interval '1 day' WHERE id=v_comm.id;
  PERFORM public.liberar_reservas_vendedor();
  SELECT * INTO v_comm FROM public.seller_commissions WHERE id=v_comm.id;
  IF v_comm.status <> 'liberada_total' OR v_comm.reserve_amount <> 0 OR v_comm.released_at IS NULL THEN
    v_failures := v_failures || format('C3 status=%s reserve=%s released_at=%s',
      v_comm.status, v_comm.reserve_amount, v_comm.released_at);
  ELSE
    RAISE NOTICE 'C3 OK liberada_total released_at=%', v_comm.released_at;
  END IF;

  -- ====================== CENARIO 4 ======================
  -- Clawback de 90 dias: cancela apolice dentro do prazo -> status='estornada'
  SELECT id INTO v_apolice_id FROM public.apolices
  WHERE numero LIKE 'TESTE_SQL_COMISSAO_%' AND status='ativa' LIMIT 1;
  UPDATE public.apolices SET status='cancelada' WHERE id=v_apolice_id;
  UPDATE public.seller_commissions
  SET status='retida', clawback_until = now()+interval '1 day',
      clawback_applied_at=NULL, clawback_reason=NULL
  WHERE contract_id=v_apolice_id;
  PERFORM public.aplicar_clawback_vendedor();
  SELECT * INTO v_comm FROM public.seller_commissions WHERE contract_id=v_apolice_id;
  IF v_comm.status <> 'estornada' OR v_comm.clawback_applied_at IS NULL OR v_comm.clawback_reason IS NULL THEN
    v_failures := v_failures || format('C4 status=%s applied=%s reason=%s',
      v_comm.status, v_comm.clawback_applied_at, v_comm.clawback_reason);
  ELSE
    RAISE NOTICE 'C4 OK estornada reason=%', v_comm.clawback_reason;
  END IF;

  -- ====================== CENARIO 5 ======================
  -- Cancelamento >20% bloqueia bonus do proximo mes
  UPDATE public.apolices SET status='cancelada'
  WHERE id IN (
    SELECT id FROM public.apolices
    WHERE numero LIKE 'TESTE_SQL_COMISSAO_%' AND status='ativa' LIMIT 2
  );
  UPDATE public.seller_commissions
  SET status='retida', clawback_until = now()+interval '1 day'
  WHERE contract_id IN (
    SELECT id FROM public.apolices WHERE numero LIKE 'TESTE_SQL_COMISSAO_%' AND status='cancelada'
  ) AND status NOT IN ('estornada');
  PERFORM public.aplicar_clawback_vendedor();
  SELECT * INTO v_perf FROM public.seller_performance
  WHERE seller_id=v_seller_id
    AND month = CASE WHEN v_mes=12 THEN 1 ELSE v_mes+1 END
    AND year  = CASE WHEN v_mes=12 THEN v_ano+1 ELSE v_ano END;
  IF v_perf.bonus_bloqueado IS NOT TRUE THEN
    v_failures := v_failures || format('C5 bonus_bloqueado=%s', v_perf.bonus_bloqueado);
  ELSE
    RAISE NOTICE 'C5 OK bonus_bloqueado=true mes %/%', v_perf.month, v_perf.year;
  END IF;

  -- ====================== RELATORIO ======================
  IF array_length(v_failures,1) IS NULL THEN
    RAISE NOTICE '=== TODOS OS 5 CENARIOS PASSARAM ===';
  ELSE
    RAISE EXCEPTION 'FALHAS: %', v_failures;
  END IF;
END $$;
ROLLBACK;
