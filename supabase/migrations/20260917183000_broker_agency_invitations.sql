-- Convite e aceite obrigatório para vínculos entre imobiliárias e corretores.
--
-- A solicitação não altera public.corretores. O vínculo, a regra de comissão e
-- as permissões financeiras só passam a valer no aceite atômico do convite.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.broker_agency_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corretor_id uuid NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
  broker_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  imobiliaria_id uuid NOT NULL REFERENCES public.imobiliarias(id) ON DELETE CASCADE,
  agency_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  commission_allocation_mode text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  invitation_email_sent_at timestamptz,
  broker_activation_email_sent_at timestamptz,
  agency_activation_email_sent_at timestamptz,
  last_email_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broker_agency_invitation_mode_check
    CHECK (commission_allocation_mode IN ('broker_full', 'split_50', 'agency_full')),
  CONSTRAINT broker_agency_invitation_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS broker_agency_one_pending_per_broker_idx
  ON public.broker_agency_invitations (broker_profile_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS broker_agency_invitations_agency_status_idx
  ON public.broker_agency_invitations (agency_profile_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS broker_agency_invitations_broker_status_idx
  ON public.broker_agency_invitations (broker_profile_id, status, requested_at DESC);

ALTER TABLE public.broker_agency_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Invitation participants can read" ON public.broker_agency_invitations;
CREATE POLICY "Invitation participants can read"
ON public.broker_agency_invitations
FOR SELECT TO authenticated
USING (agency_profile_id = auth.uid() OR broker_profile_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.broker_agency_invitations FROM anon, authenticated;
GRANT SELECT ON public.broker_agency_invitations TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'broker_agency_invitations'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.broker_agency_invitations;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_my_broker_agency_invitation(
  p_corretor_id uuid,
  p_commission_allocation_mode text,
  p_agency_profile_id uuid
)
RETURNS TABLE (
  invitation_id uuid,
  invitation_token text,
  invitation_expires_at timestamptz,
  broker_name text,
  broker_email text,
  agency_name text,
  agency_email text,
  allocation_mode text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_imobiliaria_id uuid;
  v_agency_profile_id uuid := p_agency_profile_id;
  v_linked_imobiliaria_id uuid;
  v_existing_pending_agency_id uuid;
  v_status text;
  v_mode text := lower(trim(coalesce(p_commission_allocation_mode, '')));
  v_token text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operação restrita ao serviço de convites.' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('broker_full', 'split_50', 'agency_full') THEN
    RAISE EXCEPTION 'Escolha uma regra de comissão válida.';
  END IF;

  SELECT i.id
    INTO v_imobiliaria_id
  FROM public.imobiliarias i
  JOIN public.profiles p ON lower(p.email) = lower(i.contato_email)
  WHERE p.id = v_agency_profile_id
    AND p.role::text = 'imobiliaria'
  ORDER BY i.created_at
  LIMIT 1;
  IF v_imobiliaria_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível identificar a imobiliária vinculada à sua conta.';
  END IF;

  -- Serializa convites concorrentes para o mesmo corretor.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_corretor_id::text, 0));

  SELECT c.imobiliaria_id, p.status
    INTO v_linked_imobiliaria_id, v_status
  FROM public.corretores c
  JOIN public.profiles p ON p.id = c.profile_id
  WHERE c.id = p_corretor_id
    AND p.role::text = 'corretor'
  FOR UPDATE OF c;

  IF NOT FOUND THEN RAISE EXCEPTION 'Corretor não encontrado.'; END IF;
  IF NOT public.is_corretor_linkable_status(v_status) THEN
    RAISE EXCEPTION 'Este corretor está bloqueado ou indisponível para vínculo.';
  END IF;

  IF v_linked_imobiliaria_id IS NOT NULL THEN
    IF public.is_my_imobiliaria(v_linked_imobiliaria_id) THEN
      RAISE EXCEPTION 'Este corretor já está vinculado à sua imobiliária.';
    ELSIF public.has_registered_imobiliaria_owner(v_linked_imobiliaria_id) THEN
      RAISE EXCEPTION 'Este corretor já possui vínculo ativo com outra imobiliária.';
    END IF;
  END IF;

  UPDATE public.broker_agency_invitations bai
  SET status = 'expired', updated_at = now()
  WHERE bai.broker_profile_id = (
      SELECT c.profile_id FROM public.corretores c WHERE c.id = p_corretor_id
    )
    AND bai.status = 'pending'
    AND bai.expires_at <= now();

  SELECT bai.imobiliaria_id
    INTO v_existing_pending_agency_id
  FROM public.broker_agency_invitations bai
  JOIN public.corretores c ON c.profile_id = bai.broker_profile_id
  WHERE c.id = p_corretor_id
    AND bai.status = 'pending'
    AND bai.expires_at > now()
  LIMIT 1;

  IF v_existing_pending_agency_id IS NOT NULL
     AND v_existing_pending_agency_id <> v_imobiliaria_id THEN
    RAISE EXCEPTION 'Este corretor já possui um convite pendente de outra imobiliária.';
  END IF;

  -- Um novo envio da mesma imobiliária invalida o link anterior.
  UPDATE public.broker_agency_invitations bai
  SET status = 'revoked', updated_at = now()
  WHERE bai.broker_profile_id = (
      SELECT c.profile_id FROM public.corretores c WHERE c.id = p_corretor_id
    )
    AND bai.imobiliaria_id = v_imobiliaria_id
    AND bai.status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  RETURN QUERY
  WITH inserted AS (
    INSERT INTO public.broker_agency_invitations (
      corretor_id, broker_profile_id, imobiliaria_id, agency_profile_id,
      commission_allocation_mode, token_hash
    )
    SELECT
      c.id, c.profile_id, v_imobiliaria_id, v_agency_profile_id,
      v_mode, encode(extensions.digest(v_token, 'sha256'), 'hex')
    FROM public.corretores c
    WHERE c.id = p_corretor_id
    RETURNING id, expires_at, broker_profile_id, imobiliaria_id,
      agency_profile_id, commission_allocation_mode
  )
  SELECT
    inserted.id,
    v_token,
    inserted.expires_at,
    broker_profile.nome,
    broker_profile.email,
    agency.razao_social,
    agency_profile.email,
    inserted.commission_allocation_mode
  FROM inserted
  JOIN public.profiles broker_profile ON broker_profile.id = inserted.broker_profile_id
  JOIN public.imobiliarias agency ON agency.id = inserted.imobiliaria_id
  JOIN public.profiles agency_profile ON agency_profile.id = inserted.agency_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.inspect_broker_agency_invitation(p_token text)
RETURNS TABLE (
  invitation_id uuid,
  invitation_status text,
  invitation_expires_at timestamptz,
  broker_name text,
  agency_name text,
  allocation_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
  SELECT
    bai.id,
    CASE
      WHEN bai.status = 'pending' AND bai.expires_at <= now() THEN 'expired'
      ELSE bai.status
    END,
    bai.expires_at,
    broker_profile.nome,
    agency.razao_social,
    bai.commission_allocation_mode
  FROM public.broker_agency_invitations bai
  JOIN public.profiles broker_profile ON broker_profile.id = bai.broker_profile_id
  JOIN public.imobiliarias agency ON agency.id = bai.imobiliaria_id
  WHERE bai.token_hash = encode(extensions.digest(trim(coalesce(p_token, '')), 'sha256'), 'hex')
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_broker_agency_invitation(p_token text)
RETURNS TABLE (
  invitation_id uuid,
  activated_now boolean,
  broker_profile_id uuid,
  broker_name text,
  broker_email text,
  agency_profile_id uuid,
  agency_name text,
  agency_email text,
  allocation_mode text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_inv record;
  v_linked_imobiliaria_id uuid;
  v_activated_now boolean := false;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operação restrita ao serviço de convites.' USING ERRCODE = '42501';
  END IF;

  SELECT
    bai.*,
    broker_profile.nome AS resolved_broker_name,
    broker_profile.email AS resolved_broker_email,
    agency.razao_social AS resolved_agency_name,
    agency_profile.email AS resolved_agency_email
  INTO v_inv
  FROM public.broker_agency_invitations bai
  JOIN public.profiles broker_profile ON broker_profile.id = bai.broker_profile_id
  JOIN public.imobiliarias agency ON agency.id = bai.imobiliaria_id
  JOIN public.profiles agency_profile ON agency_profile.id = bai.agency_profile_id
  WHERE bai.token_hash = encode(extensions.digest(trim(coalesce(p_token, '')), 'sha256'), 'hex')
  FOR UPDATE OF bai;

  IF NOT FOUND THEN RAISE EXCEPTION 'Convite inválido.'; END IF;
  IF v_inv.status IN ('revoked', 'expired') THEN RAISE EXCEPTION 'Convite inválido ou expirado.'; END IF;
  IF v_inv.status = 'pending' AND v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'Convite inválido ou expirado.';
  END IF;

  IF v_inv.status = 'pending' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_inv.corretor_id::text, 0));

    SELECT c.imobiliaria_id
      INTO v_linked_imobiliaria_id
    FROM public.corretores c
    WHERE c.id = v_inv.corretor_id
    FOR UPDATE;

    IF v_linked_imobiliaria_id IS NOT NULL
       AND v_linked_imobiliaria_id <> v_inv.imobiliaria_id
       AND public.has_registered_imobiliaria_owner(v_linked_imobiliaria_id) THEN
      RAISE EXCEPTION 'O corretor já possui vínculo ativo com outra imobiliária.';
    END IF;

    UPDATE public.corretores c
    SET imobiliaria_id = v_inv.imobiliaria_id,
        vinculado_imobiliaria = true,
        commission_allocation_mode = v_inv.commission_allocation_mode,
        commission_allocation_updated_at = now(),
        commission_allocation_updated_by = v_inv.agency_profile_id,
        updated_at = now()
    WHERE c.id = v_inv.corretor_id;

    UPDATE public.broker_agency_invitations bai
    SET status = 'accepted', accepted_at = now(), updated_at = now()
    WHERE bai.id = v_inv.id;

    UPDATE public.broker_agency_invitations bai
    SET status = 'revoked', updated_at = now()
    WHERE bai.broker_profile_id = v_inv.broker_profile_id
      AND bai.id <> v_inv.id
      AND bai.status = 'pending';

    v_activated_now := true;
  END IF;

  RETURN QUERY SELECT
    v_inv.id,
    v_activated_now,
    v_inv.broker_profile_id,
    v_inv.resolved_broker_name,
    v_inv.resolved_broker_email,
    v_inv.agency_profile_id,
    v_inv.resolved_agency_name,
    v_inv.resolved_agency_email,
    v_inv.commission_allocation_mode;
END;
$$;

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
DECLARE
  v_imobiliaria_id uuid;
BEGIN
  v_imobiliaria_id := public.current_imobiliaria_id();
  IF v_imobiliaria_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível identificar a imobiliária vinculada à sua conta.';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.id,
    c.profile_id,
    'active'::text,
    p.nome,
    p.email,
    p.telefone,
    c.cpf,
    c.creci,
    c.commission_allocation_mode,
    p.status,
    p.created_at,
    coalesce(latest_invite.accepted_at, c.updated_at),
    (
      SELECT count(DISTINCT a.id)
      FROM public.apolices a
      LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
      WHERE a.commission_origin_broker_profile_id = c.profile_id
         OR a.corretor_profile_id = c.profile_id
         OR (q.profile_id_solicitante = c.profile_id AND lower(q.role_solicitante) = 'corretor')
    )::bigint
  FROM public.corretores c
  JOIN public.profiles p ON p.id = c.profile_id
  LEFT JOIN LATERAL (
    SELECT bai.accepted_at
    FROM public.broker_agency_invitations bai
    WHERE bai.corretor_id = c.id
      AND bai.imobiliaria_id = v_imobiliaria_id
      AND bai.status = 'accepted'
    ORDER BY bai.accepted_at DESC NULLS LAST
    LIMIT 1
  ) latest_invite ON true
  WHERE c.imobiliaria_id = v_imobiliaria_id
    AND coalesce(c.vinculado_imobiliaria, true)

  UNION ALL

  SELECT
    bai.id,
    bai.corretor_id,
    bai.broker_profile_id,
    'pending'::text,
    p.nome,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text,
    bai.commission_allocation_mode,
    p.status,
    p.created_at,
    bai.requested_at,
    0::bigint
  FROM public.broker_agency_invitations bai
  JOIN public.profiles p ON p.id = bai.broker_profile_id
  WHERE bai.imobiliaria_id = v_imobiliaria_id
    AND bai.status = 'pending'
    AND bai.expires_at > now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.corretores c
      WHERE c.id = bai.corretor_id
        AND c.imobiliaria_id = v_imobiliaria_id
        AND coalesce(c.vinculado_imobiliaria, true)
    )
  ORDER BY membership_status, linked_at DESC;
END;
$$;

-- Clientes não podem mais pular o aceite chamando o vínculo direto.
REVOKE ALL ON FUNCTION public.link_my_corretor(uuid,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.link_my_corretor(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.link_my_corretor(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_my_corretor(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.create_my_broker_agency_invitation(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inspect_broker_agency_invitation(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_broker_agency_invitation(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_broker_agency_members() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_my_broker_agency_invitation(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.inspect_broker_agency_invitation(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_broker_agency_invitation(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_my_broker_agency_members() TO authenticated, service_role;

COMMENT ON TABLE public.broker_agency_invitations IS
  'Convites de vínculo que exigem aceite do corretor antes de ativar equipe e comissão.';
COMMENT ON FUNCTION public.create_my_broker_agency_invitation(uuid,text,uuid) IS
  'Cria ou reenvia convite seguro sem alterar o vínculo do corretor.';
COMMENT ON FUNCTION public.accept_broker_agency_invitation(text) IS
  'Aceita o token uma única vez e ativa vínculo e regra financeira atomicamente.';
COMMENT ON FUNCTION public.list_my_broker_agency_members() IS
  'Lista corretores pendentes e ativos da imobiliária, com cadastro e contratos dos ativos.';

NOTIFY pgrst, 'reload schema';
