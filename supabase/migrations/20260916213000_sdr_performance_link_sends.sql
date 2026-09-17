-- Histórico auditável de envios dos links comerciais.
-- Os links continuam permanentes; cada ação de copiar/compartilhar gera um evento.

CREATE TABLE IF NOT EXISTS public.seller_signup_link_send_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.seller_signup_links(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  source_sdr_id uuid REFERENCES public.internal_users(id) ON DELETE SET NULL,
  profile_role text NOT NULL CHECK (profile_role IN ('proprietario', 'imobiliaria', 'corretor')),
  channel text NOT NULL CHECK (channel IN ('copy', 'whatsapp', 'share')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_signup_link_send_events_seller_created_idx
  ON public.seller_signup_link_send_events (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS seller_signup_link_send_events_sdr_created_idx
  ON public.seller_signup_link_send_events (source_sdr_id, created_at DESC)
  WHERE source_sdr_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'seller_signup_link_send_events'
     ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.seller_signup_link_send_events;
  END IF;
END;
$$;

ALTER TABLE public.seller_signup_link_send_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_signup_link_send_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_signup_link_send_events TO authenticated;
GRANT ALL ON public.seller_signup_link_send_events TO service_role;

DROP POLICY IF EXISTS "Equipe comercial visualiza envios dos seus links"
  ON public.seller_signup_link_send_events;
CREATE POLICY "Equipe comercial visualiza envios dos seus links"
  ON public.seller_signup_link_send_events FOR SELECT TO authenticated
  USING (
    seller_id = public.internal_user_id(auth.uid())
    OR source_sdr_id = public.internal_user_id(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  );

CREATE OR REPLACE FUNCTION public.record_my_seller_signup_link_send(
  p_token text,
  p_profile_role text,
  p_channel text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_link public.seller_signup_links%ROWTYPE;
  v_event_id uuid;
BEGIN
  IF p_profile_role NOT IN ('proprietario', 'imobiliaria', 'corretor') THEN
    RAISE EXCEPTION 'Perfil de cadastro inválido.';
  END IF;
  IF p_channel NOT IN ('copy', 'whatsapp', 'share') THEN
    RAISE EXCEPTION 'Canal de envio inválido.';
  END IF;

  SELECT seller.id INTO v_seller_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente SDRs e Closers ativos podem registrar envios.';
  END IF;

  SELECT link.* INTO v_link
  FROM public.seller_signup_links AS link
  WHERE link.token = trim(p_token)
    AND link.profile_role = p_profile_role
    AND link.seller_id = v_seller_id
    AND link.active
  LIMIT 1;

  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Link de cadastro inválido ou inativo.';
  END IF;

  INSERT INTO public.seller_signup_link_send_events (
    link_id,
    seller_id,
    source_sdr_id,
    profile_role,
    channel
  ) VALUES (
    v_link.id,
    v_link.seller_id,
    v_link.source_sdr_id,
    v_link.profile_role,
    p_channel
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_my_seller_signup_link_send(text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_my_seller_signup_link_send(text, text, text)
  TO authenticated;

COMMENT ON TABLE public.seller_signup_link_send_events IS
  'Eventos de cópia e compartilhamento dos links comerciais para acompanhamento por SDR e Closer.';
