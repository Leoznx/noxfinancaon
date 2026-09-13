-- Evita colisao entre os nomes das colunas do indice parcial e os parametros
-- de saida de RETURNS TABLE. Sem esta diretiva, a RPC compila, mas falha em
-- tempo de execucao ao gerar os tres links do vendedor.

CREATE OR REPLACE FUNCTION public.get_my_seller_signup_links(p_source_sdr_id uuid DEFAULT NULL)
RETURNS TABLE (profile_role text, token text, source_sdr_id uuid, source_sdr_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_seller_id uuid;
  v_seller_type text;
BEGIN
  SELECT seller.id, seller.seller_type INTO v_seller_id, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL OR coalesce(v_seller_type, '') NOT IN ('sdr', 'closer') THEN
    RAISE EXCEPTION 'Somente SDRs e Closers ativos podem gerar links de cadastro.';
  END IF;

  IF p_source_sdr_id IS NOT NULL THEN
    IF v_seller_type <> 'closer' THEN
      RAISE EXCEPTION 'Apenas Closers podem compartilhar um cadastro com um SDR.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.seller_appointments AS appointment
      JOIN public.internal_users AS sdr ON sdr.id = appointment.sdr_id
      WHERE appointment.assigned_closer_id = v_seller_id
        AND appointment.sdr_id = p_source_sdr_id
        AND appointment.source = 'sdr_handoff'
        AND sdr.role = 'vendedor'
        AND sdr.seller_type = 'sdr'
        AND sdr.status = 'ativo'
    ) THEN
      RAISE EXCEPTION 'Este SDR não possui reunião encaminhada para o Closer atual.';
    END IF;

    INSERT INTO public.seller_signup_links (seller_id, profile_role, source_sdr_id)
    SELECT v_seller_id, role_name, p_source_sdr_id
    FROM unnest(ARRAY['proprietario', 'imobiliaria', 'corretor']) AS role_name
    ON CONFLICT (seller_id, source_sdr_id, profile_role) WHERE source_sdr_id IS NOT NULL
    DO UPDATE SET active = true, updated_at = now();
  ELSE
    INSERT INTO public.seller_signup_links (seller_id, profile_role, source_sdr_id)
    SELECT v_seller_id, role_name, NULL::uuid
    FROM unnest(ARRAY['proprietario', 'imobiliaria', 'corretor']) AS role_name
    ON CONFLICT (seller_id, profile_role) WHERE source_sdr_id IS NULL
    DO UPDATE SET active = true, updated_at = now();
  END IF;

  RETURN QUERY
  SELECT link.profile_role, link.token, link.source_sdr_id, source_sdr.full_name
  FROM public.seller_signup_links AS link
  LEFT JOIN public.internal_users AS source_sdr ON source_sdr.id = link.source_sdr_id
  WHERE link.seller_id = v_seller_id
    AND link.source_sdr_id IS NOT DISTINCT FROM p_source_sdr_id
    AND link.active
  ORDER BY array_position(ARRAY['proprietario', 'imobiliaria', 'corretor'], link.profile_role);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_seller_signup_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_signup_links(uuid) TO authenticated;
