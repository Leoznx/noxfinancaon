-- Cadastro de clientes parceiros e acompanhamento mensal do portal vendedor.
-- A equipe da imobiliaria nao e copiada para esta tabela: ela e resolvida a
-- cada consulta a partir de corretores.imobiliaria_id. Assim, novos corretores
-- vinculados passam a aparecer automaticamente no site e no aplicativo.

CREATE TABLE IF NOT EXISTS public.seller_client_partnerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  client_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  imobiliaria_id uuid REFERENCES public.imobiliarias(id) ON DELETE CASCADE,
  partner_type text NOT NULL CHECK (partner_type IN ('corretor_autonomo', 'imobiliaria')),
  registered_email text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_client_partnerships_type_check CHECK (
    (partner_type = 'corretor_autonomo' AND imobiliaria_id IS NULL)
    OR (partner_type = 'imobiliaria' AND imobiliaria_id IS NOT NULL)
  ),
  UNIQUE (seller_id, client_profile_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_client_partnerships_seller_imobiliaria_key
  ON public.seller_client_partnerships (seller_id, imobiliaria_id)
  WHERE imobiliaria_id IS NOT NULL;

-- Um cliente/equipe pertence a um unico vendedor. Isso evita que o mesmo
-- contrato seja contado (e comissionado) para duas pessoas diferentes.
CREATE UNIQUE INDEX IF NOT EXISTS seller_client_partnerships_imobiliaria_owner_key
  ON public.seller_client_partnerships (imobiliaria_id)
  WHERE imobiliaria_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS seller_client_partnerships_autonomous_owner_key
  ON public.seller_client_partnerships (client_profile_id)
  WHERE partner_type = 'corretor_autonomo';

CREATE INDEX IF NOT EXISTS seller_client_partnerships_seller_created_idx
  ON public.seller_client_partnerships (seller_id, created_at DESC);

ALTER TABLE public.seller_client_partnerships ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seller_client_partnerships FROM anon, authenticated;
GRANT SELECT ON public.seller_client_partnerships TO authenticated;
GRANT ALL ON public.seller_client_partnerships TO service_role;

DROP POLICY IF EXISTS "Vendedor visualiza seus clientes parceiros" ON public.seller_client_partnerships;
CREATE POLICY "Vendedor visualiza seus clientes parceiros"
  ON public.seller_client_partnerships FOR SELECT TO authenticated
  USING (
    seller_id IN (
      SELECT internal_user.id
      FROM public.internal_users AS internal_user
      WHERE internal_user.auth_user_id = auth.uid()
        AND internal_user.role = 'vendedor'
        AND internal_user.status = 'ativo'
    )
  );

CREATE OR REPLACE FUNCTION public.register_my_seller_client(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_corretor public.corretores%ROWTYPE;
  v_imobiliaria public.imobiliarias%ROWTYPE;
  v_partner_type text;
  v_existing_id uuid;
  v_existing_seller_id uuid;
  v_partnership_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
BEGIN
  SELECT internal_user.id
  INTO v_seller_id
  FROM public.internal_users AS internal_user
  WHERE internal_user.auth_user_id = auth.uid()
    AND internal_user.role = 'vendedor'
    AND internal_user.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem cadastrar clientes.';
  END IF;

  IF v_email = '' OR position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION 'Informe um e-mail valido.';
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE lower(profile.email) = v_email
    AND coalesce(profile.status, 'ativo') = 'ativo'
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Nenhum login ativo foi encontrado para este e-mail.';
  END IF;

  IF v_profile.role::text = 'corretor' THEN
    SELECT corretor.*
    INTO v_corretor
    FROM public.corretores AS corretor
    WHERE corretor.profile_id = v_profile.id
    LIMIT 1;

    IF v_corretor.id IS NULL THEN
      RAISE EXCEPTION 'O login informado ainda nao possui cadastro profissional de corretor.';
    END IF;

    IF v_corretor.imobiliaria_id IS NULL THEN
      v_partner_type := 'corretor_autonomo';
    ELSE
      v_partner_type := 'imobiliaria';
      SELECT imobiliaria.*
      INTO v_imobiliaria
      FROM public.imobiliarias AS imobiliaria
      WHERE imobiliaria.id = v_corretor.imobiliaria_id;
    END IF;
  ELSIF v_profile.role::text = 'imobiliaria' THEN
    v_partner_type := 'imobiliaria';
    SELECT imobiliaria.*
    INTO v_imobiliaria
    FROM public.imobiliarias AS imobiliaria
    WHERE lower(imobiliaria.contato_email) = v_email
    LIMIT 1;

    IF v_imobiliaria.id IS NULL THEN
      RAISE EXCEPTION 'O login informado ainda nao possui cadastro de imobiliaria.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Cadastre apenas logins de corretor ou imobiliaria.';
  END IF;

  IF v_partner_type = 'imobiliaria' AND v_imobiliaria.id IS NULL THEN
    RAISE EXCEPTION 'Nao foi possivel localizar a imobiliaria vinculada a este login.';
  END IF;

  SELECT partnership.id
  INTO v_existing_id
  FROM public.seller_client_partnerships AS partnership
  WHERE partnership.seller_id = v_seller_id
    AND (
      (v_partner_type = 'imobiliaria' AND partnership.imobiliaria_id = v_imobiliaria.id)
      OR
      (v_partner_type = 'corretor_autonomo' AND partnership.client_profile_id = v_profile.id)
    )
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  SELECT partnership.seller_id
  INTO v_existing_seller_id
  FROM public.seller_client_partnerships AS partnership
  WHERE
    (v_partner_type = 'imobiliaria' AND partnership.imobiliaria_id = v_imobiliaria.id)
    OR
    (v_partner_type = 'corretor_autonomo' AND partnership.client_profile_id = v_profile.id)
  LIMIT 1;

  IF v_existing_seller_id IS NOT NULL AND v_existing_seller_id <> v_seller_id THEN
    RAISE EXCEPTION 'Este cliente ja esta vinculado a outro vendedor.';
  END IF;

  INSERT INTO public.seller_client_partnerships (
    seller_id,
    client_profile_id,
    imobiliaria_id,
    partner_type,
    registered_email,
    created_by
  ) VALUES (
    v_seller_id,
    v_profile.id,
    CASE WHEN v_partner_type = 'imobiliaria' THEN v_imobiliaria.id ELSE NULL END,
    v_partner_type,
    v_email,
    auth.uid()
  )
  RETURNING id INTO v_partnership_id;

  RETURN v_partnership_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_seller_clients()
RETURNS TABLE (
  partnership_id uuid,
  partner_type text,
  partner_name text,
  partner_email text,
  partner_city text,
  registered_by_name text,
  registered_at timestamptz,
  broker_count integer,
  brokers jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH seller AS (
    SELECT internal_user.id, internal_user.full_name
    FROM public.internal_users AS internal_user
    WHERE internal_user.auth_user_id = auth.uid()
      AND internal_user.role = 'vendedor'
      AND internal_user.status = 'ativo'
    LIMIT 1
  )
  SELECT
    partnership.id AS partnership_id,
    partnership.partner_type,
    CASE
      WHEN partnership.partner_type = 'imobiliaria'
        THEN coalesce(imobiliaria.nome_fantasia, imobiliaria.razao_social, profile.nome)
      ELSE profile.nome
    END AS partner_name,
    CASE
      WHEN partnership.partner_type = 'imobiliaria'
        THEN coalesce(imobiliaria.contato_email, partnership.registered_email)
      ELSE partnership.registered_email
    END AS partner_email,
    CASE
      WHEN partnership.partner_type = 'imobiliaria' THEN imobiliaria.cidade
      ELSE corretor.cidade
    END AS partner_city,
    seller.full_name AS registered_by_name,
    partnership.created_at AS registered_at,
    CASE
      WHEN partnership.partner_type = 'imobiliaria'
        THEN coalesce(jsonb_array_length(team.brokers), 0)
      ELSE 0
    END AS broker_count,
    CASE
      WHEN partnership.partner_type = 'imobiliaria' THEN coalesce(team.brokers, '[]'::jsonb)
      ELSE '[]'::jsonb
    END AS brokers
  FROM public.seller_client_partnerships AS partnership
  JOIN seller ON seller.id = partnership.seller_id
  JOIN public.profiles AS profile ON profile.id = partnership.client_profile_id
  LEFT JOIN public.corretores AS corretor ON corretor.profile_id = partnership.client_profile_id
  LEFT JOIN public.imobiliarias AS imobiliaria ON imobiliaria.id = partnership.imobiliaria_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'profile_id', broker_profile.id,
        'nome', broker_profile.nome,
        'email', broker_profile.email,
        'cidade', coalesce(team_broker.cidade, imobiliaria.cidade)
      )
      ORDER BY broker_profile.nome
    ) AS brokers
    FROM public.corretores AS team_broker
    JOIN public.profiles AS broker_profile ON broker_profile.id = team_broker.profile_id
    WHERE team_broker.imobiliaria_id = partnership.imobiliaria_id
      AND coalesce(broker_profile.status, 'ativo') = 'ativo'
  ) AS team ON true
  ORDER BY partnership.created_at DESC;
$$;

-- Funcao interna reutilizada pelos dois relatorios abaixo. A associacao entre
-- parceria e membros e montada em tempo real para refletir a equipe atual.
CREATE OR REPLACE FUNCTION public.seller_client_contract_events_for(p_seller_id uuid)
RETURNS TABLE (
  partnership_id uuid,
  partner_name text,
  partner_type text,
  contract_id uuid,
  contract_number text,
  requester_profile_id uuid,
  requester_name text,
  contract_closed_at timestamptz,
  city text,
  first_installment_paid boolean,
  first_installment_paid_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH partnerships AS (
    SELECT
      partnership.id,
      partnership.client_profile_id,
      partnership.imobiliaria_id,
      partnership.partner_type,
      partnership.created_at AS registered_at,
      CASE
        WHEN partnership.partner_type = 'imobiliaria'
          THEN coalesce(imobiliaria.nome_fantasia, imobiliaria.razao_social, profile.nome)
        ELSE profile.nome
      END AS partner_name,
      CASE
        WHEN partnership.partner_type = 'imobiliaria' THEN imobiliaria.cidade
        ELSE autonomous_broker.cidade
      END AS partner_city
    FROM public.seller_client_partnerships AS partnership
    JOIN public.profiles AS profile ON profile.id = partnership.client_profile_id
    LEFT JOIN public.imobiliarias AS imobiliaria ON imobiliaria.id = partnership.imobiliaria_id
    LEFT JOIN public.corretores AS autonomous_broker
      ON autonomous_broker.profile_id = partnership.client_profile_id
    WHERE partnership.seller_id = p_seller_id
  ),
  members AS (
    SELECT partnership.id AS partnership_id, partnership.client_profile_id AS profile_id
    FROM partnerships AS partnership
    UNION
    SELECT partnership.id, broker.profile_id
    FROM partnerships AS partnership
    JOIN public.corretores AS broker ON broker.imobiliaria_id = partnership.imobiliaria_id
    WHERE partnership.partner_type = 'imobiliaria'
    UNION
    SELECT partnership.id, agency_profile.id
    FROM partnerships AS partnership
    JOIN public.imobiliarias AS agency ON agency.id = partnership.imobiliaria_id
    JOIN public.profiles AS agency_profile
      ON lower(agency_profile.email) = lower(agency.contato_email)
    WHERE partnership.partner_type = 'imobiliaria'
  ),
  contract_rows AS (
    SELECT DISTINCT ON (partnership.id, policy.id)
      partnership.id AS partnership_id,
      partnership.partner_name,
      partnership.partner_type,
      partnership.partner_city,
      policy.id AS contract_id,
      policy.numero AS contract_number,
      consultation.profile_id_solicitante AS requester_profile_id,
      requester.nome AS requester_name,
      policy.created_at AS contract_closed_at,
      coalesce(consultation.imovel_cidade, requester_broker.cidade, partnership.partner_city) AS city,
      paid.paid_at AS first_installment_paid_at
    FROM partnerships AS partnership
    JOIN members AS member ON member.partnership_id = partnership.id
    JOIN public.consultas_credito AS consultation
      ON consultation.profile_id_solicitante = member.profile_id
    JOIN public.apolices AS policy
      ON policy.consulta_id = consultation.id
     AND policy.created_at >= partnership.registered_at
    JOIN public.profiles AS requester ON requester.id = consultation.profile_id_solicitante
    LEFT JOIN public.corretores AS requester_broker
      ON requester_broker.profile_id = consultation.profile_id_solicitante
    LEFT JOIN LATERAL (
      SELECT min(payment_event.paid_at) AS paid_at
      FROM (
        SELECT coalesce(invoice.pago_em, invoice.updated_at, invoice.created_at) AS paid_at
        FROM public.faturas_inquilino AS invoice
        WHERE invoice.apolice_id = policy.id
          AND invoice.numero_parcela = 1
          AND lower(coalesce(invoice.status, '')) IN (
            'paid', 'pago', 'confirmed', 'received', 'paid_via_consolidated'
          )
        UNION ALL
        SELECT coalesce(monthly_invoice.data_pagamento, monthly_invoice.created_at) AS paid_at
        FROM public.mensalidades AS monthly_invoice
        WHERE monthly_invoice.apolice_id = policy.id
          AND coalesce(monthly_invoice.numero_parcela, 1) = 1
          AND lower(coalesce(monthly_invoice.status, '')) IN ('paid', 'pago', 'received')
        UNION ALL
        SELECT coalesce(asaas.received_at, asaas.confirmed_at, asaas.updated_at) AS paid_at
        FROM public.asaas_payments AS asaas
        WHERE asaas.consultation_id = consultation.id
          AND lower(coalesce(asaas.status, '')) IN ('paid', 'pago', 'confirmed', 'received')
      ) AS payment_event
    ) AS paid ON true
    ORDER BY partnership.id, policy.id
  )
  SELECT
    contract.partnership_id,
    contract.partner_name,
    contract.partner_type,
    contract.contract_id,
    contract.contract_number,
    contract.requester_profile_id,
    contract.requester_name,
    contract.contract_closed_at,
    contract.city,
    contract.first_installment_paid_at IS NOT NULL AS first_installment_paid,
    contract.first_installment_paid_at
  FROM contract_rows AS contract;
$$;

CREATE OR REPLACE FUNCTION public.get_my_seller_client_monthly_history()
RETURNS TABLE (
  month integer,
  year integer,
  contracts_closed bigint,
  first_installments_paid bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  SELECT internal_user.id
  INTO v_seller_id
  FROM public.internal_users AS internal_user
  WHERE internal_user.auth_user_id = auth.uid()
    AND internal_user.role = 'vendedor'
    AND internal_user.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem consultar este historico.';
  END IF;

  RETURN QUERY
  WITH events AS (
    SELECT * FROM public.seller_client_contract_events_for(v_seller_id)
  ),
  months AS (
    SELECT DISTINCT
      extract(month FROM event.contract_closed_at)::integer AS month,
      extract(year FROM event.contract_closed_at)::integer AS year
    FROM events AS event
    UNION
    SELECT extract(month FROM now())::integer, extract(year FROM now())::integer
  )
  SELECT
    calendar.month,
    calendar.year,
    count(event.contract_id)::bigint AS contracts_closed,
    count(event.contract_id) FILTER (WHERE event.first_installment_paid)::bigint
      AS first_installments_paid
  FROM months AS calendar
  LEFT JOIN events AS event
    ON extract(month FROM event.contract_closed_at)::integer = calendar.month
   AND extract(year FROM event.contract_closed_at)::integer = calendar.year
  GROUP BY calendar.month, calendar.year
  ORDER BY calendar.year DESC, calendar.month DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_seller_client_contracts(
  p_month integer DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS TABLE (
  partnership_id uuid,
  partner_name text,
  partner_type text,
  contract_id uuid,
  contract_number text,
  requester_profile_id uuid,
  requester_name text,
  contract_closed_at timestamptz,
  city text,
  first_installment_paid boolean,
  first_installment_paid_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_month integer := coalesce(p_month, extract(month FROM now())::integer);
  v_year integer := coalesce(p_year, extract(year FROM now())::integer);
BEGIN
  IF v_month < 1 OR v_month > 12 OR v_year < 2000 OR v_year > 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;

  SELECT internal_user.id
  INTO v_seller_id
  FROM public.internal_users AS internal_user
  WHERE internal_user.auth_user_id = auth.uid()
    AND internal_user.role = 'vendedor'
    AND internal_user.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem consultar contratos de clientes.';
  END IF;

  RETURN QUERY
  SELECT event.*
  FROM public.seller_client_contract_events_for(v_seller_id) AS event
  WHERE extract(month FROM event.contract_closed_at)::integer = v_month
    AND extract(year FROM event.contract_closed_at)::integer = v_year
  ORDER BY event.contract_closed_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.register_my_seller_client(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_seller_clients() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_client_contract_events_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_seller_client_monthly_history() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_seller_client_contracts(integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.register_my_seller_client(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_clients() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_client_monthly_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_client_contracts(integer, integer) TO authenticated;

COMMENT ON TABLE public.seller_client_partnerships IS
  'Clientes parceiros cadastrados por vendedor; equipes de imobiliaria sao resolvidas dinamicamente.';
COMMENT ON FUNCTION public.register_my_seller_client(text) IS
  'Vincula ao vendedor autenticado um corretor autonomo ou uma imobiliaria pelo e-mail de login.';
