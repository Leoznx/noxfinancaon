-- Painel individual de clientes convertidos pelos links de SDRs e Closers.
-- Cada vendedor ve somente os creditos comerciais vinculados ao proprio login.

CREATE OR REPLACE FUNCTION public.get_my_seller_link_clients_activity()
RETURNS TABLE (
  attribution_id uuid,
  profile_id uuid,
  client_name text,
  client_email text,
  client_phone text,
  profile_role text,
  registered_at timestamptz,
  weekly_consultation_count bigint,
  total_consultation_count bigint,
  active_contract_count bigint,
  last_consultation_at timestamptz,
  last_contract_at timestamptz,
  last_activity_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_week_start timestamptz;
  v_week_end timestamptz;
BEGIN
  SELECT seller.id
  INTO v_seller_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente SDRs e Closers ativos podem acompanhar clientes.';
  END IF;

  v_week_start := (
    date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo')
    AT TIME ZONE 'America/Sao_Paulo'
  );
  v_week_end := v_week_start + interval '7 days';

  RETURN QUERY
  WITH credits AS (
    SELECT
      attribution.id,
      attribution.registered_profile_id,
      attribution.profile_role,
      attribution.registered_email,
      attribution.created_at,
      profile.nome,
      profile.telefone,
      agency.id AS agency_id
    FROM public.seller_signup_attributions AS attribution
    JOIN public.profiles AS profile
      ON profile.id = attribution.registered_profile_id
    LEFT JOIN LATERAL (
      SELECT candidate.id
      FROM public.imobiliarias AS candidate
      WHERE attribution.profile_role = 'imobiliaria'
        AND lower(candidate.contato_email) = lower(attribution.registered_email)
      ORDER BY candidate.created_at
      LIMIT 1
    ) AS agency ON true
    WHERE attribution.seller_id = v_seller_id
      AND coalesce(attribution.source, 'link') = 'link'
  ), members AS (
    SELECT credit.id AS attribution_id, credit.registered_profile_id AS member_profile_id
    FROM credits AS credit

    UNION

    SELECT credit.id, broker.profile_id
    FROM credits AS credit
    JOIN public.corretores AS broker ON broker.imobiliaria_id = credit.agency_id
    WHERE credit.profile_role = 'imobiliaria'
  )
  SELECT
    credit.id,
    credit.registered_profile_id,
    coalesce(nullif(trim(credit.nome), ''), 'Cliente NOX'),
    lower(credit.registered_email),
    credit.telefone,
    credit.profile_role,
    credit.created_at,
    coalesce(consultations.weekly_total, 0),
    coalesce(consultations.total, 0),
    coalesce(contracts.active_total, 0),
    consultations.last_created_at,
    contracts.last_created_at,
    greatest(
      credit.created_at,
      consultations.last_created_at,
      contracts.last_created_at
    )
  FROM credits AS credit
  LEFT JOIN LATERAL (
    SELECT
      count(DISTINCT consultation.id) FILTER (
        WHERE consultation.created_at >= v_week_start
          AND consultation.created_at < v_week_end
      )::bigint AS weekly_total,
      count(DISTINCT consultation.id)::bigint AS total,
      max(consultation.created_at) AS last_created_at
    FROM members AS member
    JOIN public.consultas_credito AS consultation
      ON consultation.profile_id_solicitante = member.member_profile_id
     AND consultation.created_at >= credit.created_at
    WHERE member.attribution_id = credit.id
  ) AS consultations ON true
  LEFT JOIN LATERAL (
    SELECT
      count(DISTINCT policy.id)::bigint AS active_total,
      max(policy.created_at) AS last_created_at
    FROM members AS member
    JOIN public.consultas_credito AS consultation
      ON consultation.profile_id_solicitante = member.member_profile_id
     AND consultation.created_at >= credit.created_at
    JOIN public.apolices AS policy
      ON policy.consulta_id = consultation.id
     AND lower(coalesce(policy.status, '')) IN ('ativa', 'ativo', 'active', 'em_renovacao')
    WHERE member.attribution_id = credit.id
  ) AS contracts ON true
  ORDER BY
    greatest(credit.created_at, consultations.last_created_at, contracts.last_created_at) DESC,
    credit.nome;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_seller_link_clients_activity()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_link_clients_activity()
  TO authenticated;

COMMENT ON FUNCTION public.get_my_seller_link_clients_activity() IS
  'Retorna, somente ao SDR ou Closer autenticado, uma linha por cliente convertido por seus links com consultas da semana, contratos ativos e ultima movimentacao.';

