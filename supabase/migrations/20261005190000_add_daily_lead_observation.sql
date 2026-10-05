-- Permite que o vendedor registre uma observacao opcional no cadastro manual
-- de um lead. A RPC nova preserva o contrato anterior para clientes que ainda
-- nao enviam p_notes e grava a observacao na trilha compartilhada do lead.

CREATE OR REPLACE FUNCTION public.create_my_qualified_seller_contact_lead_with_notes(
  p_name text,
  p_phone text,
  p_category text,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_lead_id uuid;
  v_seller_id uuid;
BEGIN
  IF char_length(coalesce(v_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'A observacao deve ter no maximo 1000 caracteres.';
  END IF;

  v_lead_id := public.create_my_qualified_seller_contact_lead(
    p_name,
    p_phone,
    p_category
  );

  IF v_notes IS NULL THEN
    RETURN v_lead_id;
  END IF;

  SELECT seller.id
  INTO v_seller_id
  FROM public.internal_users AS seller
  JOIN public.seller_contact_leads AS lead
    ON lead.id = v_lead_id
   AND lead.current_seller_id = seller.id
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente o responsavel ativo pode observar este lead.';
  END IF;

  INSERT INTO public.seller_contact_lead_history (
    lead_id, seller_id, event_type, metadata
  ) VALUES (
    v_lead_id,
    v_seller_id,
    'lead_observation',
    jsonb_build_object('source', 'manual_daily_lead', 'notes', v_notes)
  );

  RETURN v_lead_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_qualified_seller_contact_lead_with_notes(text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_qualified_seller_contact_lead_with_notes(text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.create_my_qualified_seller_contact_lead_with_notes(text, text, text, text)
  IS 'Cadastra ou requalifica lead e registra uma observacao inicial opcional.';
