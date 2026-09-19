-- Corrige a listagem de corretores da imobiliaria. O PostgreSQL restringe o
-- ORDER BY ligado diretamente a UNION/INTERSECT/EXCEPT; a ordenacao passa a
-- atuar sobre o resultado nomeado da uniao, preservando ativos e pendentes.

CREATE OR REPLACE FUNCTION public.list_my_broker_agency_members()
RETURNS TABLE (
  membership_id uuid,
  corretor_id uuid,
  profile_id uuid,
  membership_status text,
  nome text,
  email text,
  telefone text,
  cpf text,
  creci text,
  commission_allocation_mode text,
  profile_status text,
  registered_at timestamptz,
  linked_at timestamptz,
  contracts_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_imobiliaria_id uuid;
BEGIN
  v_imobiliaria_id := public.current_imobiliaria_id();
  IF v_imobiliaria_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível identificar a imobiliária vinculada à sua conta.';
  END IF;

  RETURN QUERY
  SELECT
    members.membership_id,
    members.corretor_id,
    members.profile_id,
    members.membership_status,
    members.nome,
    members.email,
    members.telefone,
    members.cpf,
    members.creci,
    members.commission_allocation_mode,
    members.profile_status,
    members.registered_at,
    members.linked_at,
    members.contracts_count
  FROM (
    SELECT
      c.id AS membership_id,
      c.id AS corretor_id,
      c.profile_id,
      'active'::text AS membership_status,
      p.nome,
      p.email,
      p.telefone,
      c.cpf,
      c.creci,
      c.commission_allocation_mode,
      p.status::text AS profile_status,
      p.created_at AS registered_at,
      coalesce(latest_invite.accepted_at, c.updated_at) AS linked_at,
      (
        SELECT count(DISTINCT policy.id)
        FROM public.apolices AS policy
        LEFT JOIN public.consultas_credito AS credit
          ON credit.id = policy.consulta_id
        WHERE policy.commission_origin_broker_profile_id = c.profile_id
           OR policy.corretor_profile_id = c.profile_id
           OR (
             credit.profile_id_solicitante = c.profile_id
             AND lower(credit.role_solicitante) = 'corretor'
           )
      )::bigint AS contracts_count
    FROM public.corretores AS c
    JOIN public.profiles AS p ON p.id = c.profile_id
    LEFT JOIN LATERAL (
      SELECT invitation.accepted_at
      FROM public.broker_agency_invitations AS invitation
      WHERE invitation.corretor_id = c.id
        AND invitation.imobiliaria_id = v_imobiliaria_id
        AND invitation.status = 'accepted'
      ORDER BY invitation.accepted_at DESC NULLS LAST
      LIMIT 1
    ) AS latest_invite ON true
    WHERE c.imobiliaria_id = v_imobiliaria_id
      AND coalesce(c.vinculado_imobiliaria, true)

    UNION ALL

    SELECT
      invitation.id AS membership_id,
      invitation.corretor_id,
      invitation.broker_profile_id AS profile_id,
      'pending'::text AS membership_status,
      profile.nome,
      NULL::text AS email,
      NULL::text AS telefone,
      NULL::text AS cpf,
      NULL::text AS creci,
      invitation.commission_allocation_mode,
      profile.status::text AS profile_status,
      profile.created_at AS registered_at,
      invitation.requested_at AS linked_at,
      0::bigint AS contracts_count
    FROM public.broker_agency_invitations AS invitation
    JOIN public.profiles AS profile ON profile.id = invitation.broker_profile_id
    WHERE invitation.imobiliaria_id = v_imobiliaria_id
      AND invitation.status = 'pending'
      AND invitation.expires_at > now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.corretores AS broker
        WHERE broker.id = invitation.corretor_id
          AND broker.imobiliaria_id = v_imobiliaria_id
          AND coalesce(broker.vinculado_imobiliaria, true)
      )
  ) AS members
  ORDER BY
    CASE members.membership_status WHEN 'active' THEN 0 ELSE 1 END,
    members.linked_at DESC NULLS LAST,
    members.nome;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_broker_agency_members()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_broker_agency_members()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.list_my_broker_agency_members() IS
  'Lista corretores ativos e convites pendentes da imobiliaria com ordenacao valida apos UNION ALL.';

NOTIFY pgrst, 'reload schema';
