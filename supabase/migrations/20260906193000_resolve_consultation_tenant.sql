-- The strict tenant RLS introduced in 20260905120000 correctly hides unrelated
-- personal data, but it also made the consultation bootstrap unable to reuse an
-- existing CPF/CNPJ: the client could not see the row, attempted a duplicate
-- insert, and PostgREST then failed while coercing an empty result to one object.
-- Resolve only the UUID needed for the foreign key inside a narrowly-scoped,
-- authenticated SECURITY DEFINER function. No tenant data is exposed.

CREATE OR REPLACE FUNCTION public.resolve_consultation_tenant(
  p_document text,
  p_tenant_type text,
  p_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_document text := regexp_replace(coalesce(p_document, ''), '\D', '', 'g');
  v_tenant_type text := upper(coalesce(p_tenant_type, ''));
  v_name text := nullif(btrim(p_name), '');
  v_tenant_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_tenant_type NOT IN ('PF', 'PJ') THEN
    RAISE EXCEPTION 'Invalid tenant type' USING ERRCODE = '22023';
  END IF;

  IF (v_tenant_type = 'PF' AND length(v_document) <> 11)
    OR (v_tenant_type = 'PJ' AND length(v_document) <> 14) THEN
    RAISE EXCEPTION 'Invalid tenant document' USING ERRCODE = '22023';
  END IF;

  v_name := coalesce(v_name, v_document);

  SELECT tenant.id
    INTO v_tenant_id
  FROM public.inquilinos AS tenant
  WHERE tenant.cpf = v_document
     OR (v_tenant_type = 'PJ' AND tenant.cnpj = v_document)
  ORDER BY (tenant.cpf = v_document) DESC, tenant.created_at ASC
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    INSERT INTO public.inquilinos (
      nome,
      cpf,
      razao_social,
      cnpj,
      tipo,
      created_by
    )
    VALUES (
      v_name,
      v_document,
      CASE WHEN v_tenant_type = 'PJ' THEN v_name ELSE NULL END,
      CASE WHEN v_tenant_type = 'PJ' THEN v_document ELSE NULL END,
      v_tenant_type,
      v_caller
    )
    ON CONFLICT (cpf) DO NOTHING
    RETURNING id INTO v_tenant_id;

    -- Handles a concurrent request that inserted the same document first.
    IF v_tenant_id IS NULL THEN
      SELECT tenant.id
        INTO v_tenant_id
      FROM public.inquilinos AS tenant
      WHERE tenant.cpf = v_document
      ORDER BY tenant.created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve tenant' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_consultation_tenant(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_consultation_tenant(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_consultation_tenant(text, text, text) TO authenticated;
