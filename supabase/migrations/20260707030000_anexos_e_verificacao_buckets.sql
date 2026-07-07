-- ============================================================================
-- Buckets "anexos" (foto de perfil) e "documentos-verificacao" (CNH/RG/selfie)
-- nunca foram criados — só existiam as RLS policies para eles (ver migrations
-- 20260623013832 e 20260615161342), então todo upload falhava com
-- "Bucket not found". Mesmo bug já corrigido antes para "approval-documents".
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'anexos',
  'anexos',
  false,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documentos-verificacao',
  'documentos-verificacao',
  false,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
