-- Unifica a aba Clientes com a mesma fonte canonica usada por metas e ranking.
-- Antes, get_my_seller_link_clients_activity descartava explicitamente a origem
-- manual, embora register_my_seller_client ja tivesse gravado o credito correto.

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
      credit.credit_id AS id,
      credit.registered_profile_id,
      credit.profile_role,
      credit.registered_email,
      credit.credited_at AS created_at,
      profile.nome,
      profile.telefone,
      agency.id AS agency_id
    FROM public.seller_registration_credits_for(v_seller_id) AS credit
    JOIN public.profiles AS profile
      ON profile.id = credit.registered_profile_id
    LEFT JOIN LATERAL (
      SELECT candidate.id
      FROM public.imobiliarias AS candidate
      WHERE credit.profile_role = 'imobiliaria'
        AND lower(candidate.contato_email) = lower(credit.registered_email)
      ORDER BY candidate.created_at
      LIMIT 1
    ) AS agency ON true
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
  'Retorna a carteira unificada do SDR ou Closer, incluindo cadastros por link, manuais e vinculos legados sem duplicidade.';

NOTIFY pgrst, 'reload schema';
