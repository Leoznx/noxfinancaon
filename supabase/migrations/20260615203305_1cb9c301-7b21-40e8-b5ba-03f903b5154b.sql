ALTER TABLE public.leads_contato DROP CONSTRAINT IF EXISTS leads_contato_perfil_check;
ALTER TABLE public.leads_contato ADD CONSTRAINT leads_contato_perfil_check
  CHECK (perfil = ANY (ARRAY['corretor','imobiliaria','proprietario','influenciador','candidato','parceiro','outro']));

ALTER TABLE public.leads_contato ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE public.leads_contato ADD COLUMN IF NOT EXISTS area_interesse text;
CREATE INDEX IF NOT EXISTS leads_contato_referral_code_idx ON public.leads_contato(referral_code);
CREATE INDEX IF NOT EXISTS leads_contato_origem_idx ON public.leads_contato(origem);