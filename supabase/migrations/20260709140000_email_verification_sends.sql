-- =============================================================================
-- Rate limit do reenvio de e-mail de verificação (resendVerificationEmail).
-- Só é acessada via supabaseAdmin (service role), que ignora RLS — a tabela
-- fica sem nenhuma policy de propósito, bloqueando qualquer acesso direto
-- via anon/authenticated (defesa em profundidade, não é o mecanismo real).
-- =============================================================================

CREATE TABLE public.email_verification_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verification_sends_email_sent_at_idx
  ON public.email_verification_sends (email, sent_at DESC);

ALTER TABLE public.email_verification_sends ENABLE ROW LEVEL SECURITY;
