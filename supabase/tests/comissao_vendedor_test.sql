-- Teste deterministico da regra mensal de comissao em folha.
-- Seguro: nenhuma linha e alterada; falhas levantam exception.
DO $$
DECLARE
  v_failures text[] := ARRAY[]::text[];
  v_trigger_count integer;
BEGIN
  IF public.calcular_comissao_vendedor(15) <> 375 THEN
    v_failures := v_failures || '15 contratos deveria totalizar R$ 375';
  END IF;
  IF public.calcular_comissao_vendedor(16) <> 410 THEN
    v_failures := v_failures || '16 contratos deveria totalizar R$ 410';
  END IF;
  IF public.calcular_comissao_vendedor(26) <> 770 THEN
    v_failures := v_failures || '26 contratos deveria totalizar R$ 770';
  END IF;
  IF public.calcular_bonus_vendedor(15) <> 400
     OR public.calcular_bonus_vendedor(30) <> 1000
     OR public.calcular_bonus_vendedor(45) <> 2200 THEN
    v_failures := v_failures || 'bonus cumulativos de 15/30/45 incorretos';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seller_commissions'
      AND column_name = 'client_name'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seller_commissions'
      AND column_name = 'contract_sequence'
  ) THEN
    v_failures := v_failures || 'colunas nominais da folha ausentes';
  END IF;

  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger AS pgtrg
  JOIN pg_class AS relation ON relation.oid = pgtrg.tgrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'seller_commissions'
    AND pgtrg.tgname IN (
      'trg_no_seller_production_bonus',
      'trg_equalize_sdr_closer_commission_pair'
    )
    AND NOT pgtrg.tgisinternal;
  IF v_trigger_count <> 0 THEN
    v_failures := v_failures || 'triggers legados de bloqueio/igualacao ainda ativos';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.seller_commissions
    WHERE status = 'contabilizada'
      AND (reserve_amount <> 0 OR released_amount <> 0)
  ) THEN
    v_failures := v_failures || 'linha contabilizada possui reserva ou valor liberado';
  END IF;

  IF array_length(v_failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHAS: %', v_failures;
  END IF;

  RAISE NOTICE 'TODOS OS CENARIOS DE COMISSAO MENSAL PASSARAM';
END;
$$;
