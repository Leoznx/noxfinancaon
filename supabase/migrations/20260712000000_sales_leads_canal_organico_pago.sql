-- Classifica cada sales_lead como 'organico' ou 'trafego_pago', pra dar pra
-- separar a Distribuicao de Leads em duas abas e pro vendedor saber a origem
-- de verdade do lead que recebeu (nao so o texto livre de "origin").
ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'organico'
  CHECK (canal IN ('organico', 'trafego_pago'));

-- Extrai o miolo de distribuir_sales_lead() pra uma funcao interna
-- compartilhada, pra nao duplicar toda a logica de rodizio/fila/historico/
-- notificacao entre a RPC de staff (distribuir_sales_lead, exige permissao)
-- e a nova RPC publica do formulario de contato do site (sem permissao,
-- chamada por visitante anonimo).
CREATE OR REPLACE FUNCTION public._distribuir_sales_lead_core(
  p_full_name text,
  p_phone text,
  p_email text,
  p_origin text,
  p_city text,
  p_type text,
  p_interest text,
  p_notes text,
  p_canal text,
  p_actor uuid
)
RETURNS public.sales_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue public.lead_distribution_queue%ROWTYPE;
  v_lead public.sales_leads%ROWTYPE;
  v_auth_user uuid;
  v_canal text;
BEGIN
  IF NULLIF(trim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nome do lead e obrigatorio';
  END IF;

  v_canal := CASE WHEN p_canal = 'trafego_pago' THEN 'trafego_pago' ELSE 'organico' END;

  PERFORM pg_advisory_xact_lock(hashtext('nox_sales_lead_distribution'));
  PERFORM public.sincronizar_fila_vendedores_leads();

  SELECT q.*
  INTO v_queue
  FROM public.lead_distribution_queue q
  JOIN public.internal_users u ON u.id = q.vendedor_id
  WHERE q.ativo = true
    AND u.role = 'vendedor'
    AND u.status = 'ativo'
  ORDER BY COALESCE(q.ultimo_recebimento, '1970-01-01'::timestamptz), q.ordem, q.created_at
  LIMIT 1
  FOR UPDATE OF q;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nenhum vendedor ativo na fila de distribuicao';
  END IF;

  INSERT INTO public.sales_leads (
    assigned_seller_id,
    full_name,
    phone,
    email,
    origin,
    city,
    type,
    interest,
    canal,
    status,
    notes,
    distributed_at,
    last_interaction_at
  )
  VALUES (
    v_queue.vendedor_id,
    trim(p_full_name),
    NULLIF(trim(COALESCE(p_phone, '')), ''),
    NULLIF(trim(COALESCE(p_email, '')), ''),
    NULLIF(trim(COALESCE(p_origin, '')), ''),
    NULLIF(trim(COALESCE(p_city, '')), ''),
    NULLIF(trim(COALESCE(p_type, '')), ''),
    NULLIF(trim(COALESCE(p_interest, '')), ''),
    v_canal,
    'pendente',
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    now(),
    now()
  )
  RETURNING * INTO v_lead;

  UPDATE public.lead_distribution_queue
  SET ultimo_recebimento = now(),
      total_leads_recebidos = total_leads_recebidos + 1
  WHERE id = v_queue.id;

  INSERT INTO public.lead_history (lead_id, user_id, acao, status_novo, observacao)
  VALUES (v_lead.id, p_actor, 'lead_distribuido', 'pendente', 'Lead distribuido automaticamente pelo rodizio.');

  SELECT auth_user_id
  INTO v_auth_user
  FROM public.internal_users
  WHERE id = v_queue.vendedor_id;

  IF v_auth_user IS NOT NULL THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
    VALUES (
      v_auth_user,
      'Novo lead recebido',
      'Voce recebeu um novo lead (' || CASE WHEN v_canal = 'trafego_pago' THEN 'trafego pago' ELSE 'organico' END || '): ' || v_lead.full_name,
      'lead_novo',
      'amarelo',
      '/vendedor/leads'
    );
  END IF;

  RETURN v_lead;
END;
$$;

-- distribuir_sales_lead(): mesma assinatura de antes + p_canal opcional no
-- final (nao quebra nenhuma chamada existente), agora so faz a checagem de
-- permissao e delega o miolo pra funcao compartilhada.
CREATE OR REPLACE FUNCTION public.distribuir_sales_lead(
  p_full_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_interest text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_canal text DEFAULT 'organico'
)
RETURNS public.sales_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_sales_leads(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para distribuir leads';
  END IF;

  RETURN public._distribuir_sales_lead_core(
    p_full_name, p_phone, p_email, p_origin, p_city, p_type, p_interest, p_notes, p_canal, auth.uid()
  );
END;
$$;

-- Nova RPC publica: o formulario de Contato do site (visitante nao
-- autenticado) chama isso direto pra cair de verdade na esteira de
-- distribuicao (antes so gravava em leads_contato, tabela que nenhuma tela
-- admin le). Sempre entra como canal organico e com origem/tipo fixos —
-- visitante anonimo nao deve poder escolher o canal.
CREATE OR REPLACE FUNCTION public.criar_lead_site_publico(
  p_full_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_interest text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.sales_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._distribuir_sales_lead_core(
    p_full_name, p_phone, p_email,
    'Formulario de contato do site', p_city, 'contato_site', p_interest, p_notes,
    'organico', NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_lead_site_publico(text, text, text, text, text, text) TO anon, authenticated;
