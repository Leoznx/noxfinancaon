-- Metas visuais de ligacoes e contatos sao compartilhadas por toda a equipe
-- comercial. As metas de reunioes e cadastros continuam independentes para
-- Vendedor (seller_type = sdr) e Closer.

CREATE OR REPLACE FUNCTION public.backfill_shared_seller_control_goals()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated bigint := 0;
BEGIN
  -- A leitura de source e target usa o mesmo snapshot. Assim, quando cada
  -- equipe possui metade da configuracao, as duas recebem o valor ausente no
  -- mesmo comando. Valores ja definidos nunca sao sobrescritos.
  UPDATE public.seller_team_goals AS target
  SET target_calls_daily = coalesce(
        target.target_calls_daily,
        source.target_calls_daily
      ),
      target_leads_contacted_daily = coalesce(
        target.target_leads_contacted_daily,
        source.target_leads_contacted_daily
      ),
      updated_at = now()
  FROM public.seller_team_goals AS source
  WHERE source.month = target.month
    AND source.year = target.year
    AND source.seller_type <> target.seller_type
    AND source.seller_type IN ('sdr', 'closer')
    AND target.seller_type IN ('sdr', 'closer')
    AND (
      (
        target.target_calls_daily IS NULL
        AND source.target_calls_daily IS NOT NULL
      )
      OR (
        target.target_leads_contacted_daily IS NULL
        AND source.target_leads_contacted_daily IS NOT NULL
      )
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_shared_seller_control_goals()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.backfill_shared_seller_control_goals();

CREATE OR REPLACE FUNCTION public.upsert_seller_control_goals(
  p_seller_type text,
  p_month integer,
  p_year integer,
  p_target_calls_daily integer,
  p_target_leads_contacted_daily integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_at timestamptz := now();
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem definir estas metas.';
  END IF;

  IF p_seller_type NOT IN ('sdr', 'closer') THEN
    RAISE EXCEPTION 'Equipe comercial invalida.';
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2000 AND 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;
  IF p_target_calls_daily IS NULL OR p_target_calls_daily < 0
     OR p_target_leads_contacted_daily IS NULL
     OR p_target_leads_contacted_daily < 0 THEN
    RAISE EXCEPTION
      'As metas devem ser numeros inteiros maiores ou iguais a zero.';
  END IF;

  -- Mantem a assinatura antiga, mas a unidade de gravacao agora e a equipe
  -- comercial inteira. O mesmo statement evita configuracao parcial.
  INSERT INTO public.seller_team_goals AS target (
    seller_type,
    month,
    year,
    target_calls_daily,
    target_leads_contacted_daily,
    updated_at
  ) VALUES
    (
      'sdr', p_month, p_year,
      p_target_calls_daily, p_target_leads_contacted_daily, v_updated_at
    ),
    (
      'closer', p_month, p_year,
      p_target_calls_daily, p_target_leads_contacted_daily, v_updated_at
    )
  ON CONFLICT (seller_type, month, year) DO UPDATE
  SET target_calls_daily = EXCLUDED.target_calls_daily,
      target_leads_contacted_daily = EXCLUDED.target_leads_contacted_daily,
      updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'seller_type', p_seller_type,
    'month', p_month,
    'year', p_year,
    'calls_daily', p_target_calls_daily,
    'leads_contacted_daily', p_target_leads_contacted_daily,
    'shared_seller_types', jsonb_build_array('sdr', 'closer'),
    'updated_at', v_updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_seller_team_goals_complete(
  p_seller_type text,
  p_month integer,
  p_year integer,
  p_target_meetings_daily integer,
  p_target_meetings_weekly integer,
  p_target_meetings_monthly integer,
  p_target_clients_daily integer,
  p_target_clients_weekly integer,
  p_target_clients_monthly integer,
  p_target_calls_daily integer,
  p_target_leads_contacted_daily integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_at timestamptz := now();
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem definir metas da equipe.';
  END IF;

  IF p_seller_type NOT IN ('sdr', 'closer') THEN
    RAISE EXCEPTION 'Equipe comercial invalida.';
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2000 AND 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;
  IF p_target_meetings_daily IS NULL
     OR p_target_meetings_weekly IS NULL
     OR p_target_meetings_monthly IS NULL
     OR p_target_clients_daily IS NULL
     OR p_target_clients_weekly IS NULL
     OR p_target_clients_monthly IS NULL
     OR p_target_calls_daily IS NULL
     OR p_target_leads_contacted_daily IS NULL
     OR least(
       p_target_meetings_daily,
       p_target_meetings_weekly,
       p_target_meetings_monthly,
       p_target_clients_daily,
       p_target_clients_weekly,
       p_target_clients_monthly,
       p_target_calls_daily,
       p_target_leads_contacted_daily
     ) < 0 THEN
    RAISE EXCEPTION
      'As oito metas devem ser numeros inteiros maiores ou iguais a zero.';
  END IF;

  -- As duas linhas sao inseridas/atualizadas no mesmo statement e sempre na
  -- mesma ordem. Somente a equipe selecionada recebe as seis metas especificas;
  -- ligacoes e contatos sao gravados para ambas.
  INSERT INTO public.seller_team_goals AS target (
    seller_type,
    month,
    year,
    target_meetings_daily,
    target_meetings_weekly,
    target_meetings_monthly,
    target_clients_daily,
    target_clients_weekly,
    target_clients_monthly,
    target_calls_daily,
    target_leads_contacted_daily,
    updated_at
  ) VALUES
    (
      'sdr',
      p_month,
      p_year,
      CASE WHEN p_seller_type = 'sdr' THEN p_target_meetings_daily END,
      CASE WHEN p_seller_type = 'sdr' THEN p_target_meetings_weekly END,
      CASE WHEN p_seller_type = 'sdr' THEN p_target_meetings_monthly END,
      CASE WHEN p_seller_type = 'sdr' THEN p_target_clients_daily END,
      CASE WHEN p_seller_type = 'sdr' THEN p_target_clients_weekly END,
      CASE WHEN p_seller_type = 'sdr' THEN p_target_clients_monthly END,
      p_target_calls_daily,
      p_target_leads_contacted_daily,
      v_updated_at
    ),
    (
      'closer',
      p_month,
      p_year,
      CASE WHEN p_seller_type = 'closer' THEN p_target_meetings_daily END,
      CASE WHEN p_seller_type = 'closer' THEN p_target_meetings_weekly END,
      CASE WHEN p_seller_type = 'closer' THEN p_target_meetings_monthly END,
      CASE WHEN p_seller_type = 'closer' THEN p_target_clients_daily END,
      CASE WHEN p_seller_type = 'closer' THEN p_target_clients_weekly END,
      CASE WHEN p_seller_type = 'closer' THEN p_target_clients_monthly END,
      p_target_calls_daily,
      p_target_leads_contacted_daily,
      v_updated_at
    )
  ON CONFLICT (seller_type, month, year) DO UPDATE
  SET target_meetings_daily = CASE
        WHEN EXCLUDED.seller_type = p_seller_type
          THEN EXCLUDED.target_meetings_daily
        ELSE target.target_meetings_daily
      END,
      target_meetings_weekly = CASE
        WHEN EXCLUDED.seller_type = p_seller_type
          THEN EXCLUDED.target_meetings_weekly
        ELSE target.target_meetings_weekly
      END,
      target_meetings_monthly = CASE
        WHEN EXCLUDED.seller_type = p_seller_type
          THEN EXCLUDED.target_meetings_monthly
        ELSE target.target_meetings_monthly
      END,
      target_clients_daily = CASE
        WHEN EXCLUDED.seller_type = p_seller_type
          THEN EXCLUDED.target_clients_daily
        ELSE target.target_clients_daily
      END,
      target_clients_weekly = CASE
        WHEN EXCLUDED.seller_type = p_seller_type
          THEN EXCLUDED.target_clients_weekly
        ELSE target.target_clients_weekly
      END,
      target_clients_monthly = CASE
        WHEN EXCLUDED.seller_type = p_seller_type
          THEN EXCLUDED.target_clients_monthly
        ELSE target.target_clients_monthly
      END,
      target_calls_daily = EXCLUDED.target_calls_daily,
      target_leads_contacted_daily = EXCLUDED.target_leads_contacted_daily,
      updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'seller_type', p_seller_type,
    'month', p_month,
    'year', p_year,
    'meetings', jsonb_build_object(
      'daily', p_target_meetings_daily,
      'weekly', p_target_meetings_weekly,
      'monthly', p_target_meetings_monthly
    ),
    'registrations', jsonb_build_object(
      'daily', p_target_clients_daily,
      'weekly', p_target_clients_weekly,
      'monthly', p_target_clients_monthly
    ),
    'calls_daily', p_target_calls_daily,
    'leads_contacted_daily', p_target_leads_contacted_daily,
    'shared_seller_types', jsonb_build_array('sdr', 'closer'),
    'updated_at', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_seller_control_goals(
  text, integer, integer, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_seller_control_goals(
  text, integer, integer, integer, integer
) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_seller_team_goals_complete(
  text, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_seller_team_goals_complete(
  text, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer
) TO authenticated;

COMMENT ON FUNCTION public.backfill_shared_seller_control_goals() IS
  'Preenche somente metas compartilhadas ausentes usando o outro papel comercial no mesmo mes.';
COMMENT ON FUNCTION public.upsert_seller_control_goals(
  text, integer, integer, integer, integer
) IS
  'Mantem o contrato legado e grava ligacoes/leads atomicamente para Vendedor e Closer.';
COMMENT ON FUNCTION public.upsert_seller_team_goals_complete(
  text, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer
) IS
  'Grava seis metas especificas da equipe selecionada e duas metas compartilhadas de toda a equipe comercial.';
