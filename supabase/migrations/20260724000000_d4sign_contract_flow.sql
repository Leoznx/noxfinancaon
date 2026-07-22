-- Fluxo de contratos D4Sign: pagamento confirmado -> assinatura -> apolice ativa.

CREATE TABLE IF NOT EXISTS public.contract_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL UNIQUE REFERENCES public.consultas_credito(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.apolices(id) ON DELETE SET NULL,
  tenant_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  plan_name text NOT NULL,
  template_file text NOT NULL,
  d4sign_document_uuid text UNIQUE,
  d4sign_signer_key text,
  status text NOT NULL DEFAULT 'processing' CHECK (
    status IN ('processing', 'awaiting_signature', 'signed', 'active', 'cancelled', 'error')
  ),
  error_code text,
  error_message text,
  send_attempts integer NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
  sent_at timestamptz,
  signed_at timestamptz,
  activated_at timestamptz,
  last_webhook_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contract_signatures_tenant_idx
  ON public.contract_signatures (tenant_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contract_signatures_status_idx
  ON public.contract_signatures (status, updated_at);

CREATE TABLE IF NOT EXISTS public.contract_signature_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_signature_id uuid NOT NULL REFERENCES public.contract_signatures(id) ON DELETE CASCADE,
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contract_signature_events_signature_idx
  ON public.contract_signature_events (contract_signature_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.contract_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_signature_id uuid NOT NULL REFERENCES public.contract_signatures(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'push')),
  notification_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'not_configured')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_signature_id, channel, notification_type)
);

ALTER TABLE public.documentos_proposta
  ADD COLUMN IF NOT EXISTS contract_signature_id uuid
    REFERENCES public.contract_signatures(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS documentos_proposta_contract_signature_idx
  ON public.documentos_proposta (contract_signature_id)
  WHERE contract_signature_id IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contratos-assinados',
  'contratos-assinados',
  false,
  20971520,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.contract_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_signature_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_notification_deliveries ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.contract_signatures TO service_role;
GRANT ALL ON public.contract_signature_events TO service_role;
GRANT ALL ON public.contract_notification_deliveries TO service_role;

DROP POLICY IF EXISTS "contract_signatures_select_related" ON public.contract_signatures;
CREATE POLICY "contract_signatures_select_related"
ON public.contract_signatures FOR SELECT TO authenticated
USING (
  tenant_user_id = auth.uid()
  OR public.is_internal(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.consultas_credito consulta
    WHERE consulta.id = contract_signatures.consultation_id
      AND consulta.profile_id_solicitante = auth.uid()
  )
);

DROP POLICY IF EXISTS "contract_signature_events_select_related" ON public.contract_signature_events;
CREATE POLICY "contract_signature_events_select_related"
ON public.contract_signature_events FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.contract_signatures assinatura
    LEFT JOIN public.consultas_credito consulta
      ON consulta.id = assinatura.consultation_id
    WHERE assinatura.id = contract_signature_events.contract_signature_id
      AND (
        assinatura.tenant_user_id = auth.uid()
        OR consulta.profile_id_solicitante = auth.uid()
        OR public.is_internal(auth.uid())
      )
  )
);

REVOKE ALL ON public.contract_signatures FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.contract_signatures FROM authenticated;
GRANT SELECT ON public.contract_signatures TO authenticated;
REVOKE ALL ON public.contract_signature_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.contract_signature_events FROM authenticated;
GRANT SELECT ON public.contract_signature_events TO authenticated;
REVOKE ALL ON public.contract_notification_deliveries FROM anon, authenticated;

DROP POLICY IF EXISTS "tenant_reads_signed_contracts" ON storage.objects;
CREATE POLICY "tenant_reads_signed_contracts"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'contratos-assinados'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_internal(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.consultas_credito consulta
      WHERE consulta.id::text = (storage.foldername(name))[2]
        AND consulta.profile_id_solicitante = auth.uid()
    )
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'contract_signatures'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.contract_signatures';
  END IF;
END $$;

ALTER TABLE public.contract_signatures REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.touch_contract_signature_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_signatures_touch_updated_at ON public.contract_signatures;
CREATE TRIGGER contract_signatures_touch_updated_at
BEFORE UPDATE ON public.contract_signatures
FOR EACH ROW EXECUTE FUNCTION public.touch_contract_signature_updated_at();

DROP TRIGGER IF EXISTS contract_notifications_touch_updated_at ON public.contract_notification_deliveries;
CREATE TRIGGER contract_notifications_touch_updated_at
BEFORE UPDATE ON public.contract_notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.touch_contract_signature_updated_at();

COMMENT ON TABLE public.contract_signatures IS
  'Estado idempotente do contrato entre pagamento Asaas, assinatura D4Sign e ativacao da apolice.';
COMMENT ON COLUMN public.documentos_proposta.contract_signature_id IS
  'Vincula o PDF final assinado ao fluxo D4Sign que o originou.';
