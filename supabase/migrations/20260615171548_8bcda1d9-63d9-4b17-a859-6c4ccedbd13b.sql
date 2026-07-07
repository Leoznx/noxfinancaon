
CREATE TABLE public.dados_financeiros_recebimento (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  receiver_full_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  pix_key_type TEXT NOT NULL CHECK (pix_key_type IN ('cpf','cnpj','email','telefone','aleatoria')),
  pix_key TEXT NOT NULL,
  pix_key_normalized TEXT NOT NULL,
  financial_data_status TEXT NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dados_financeiros_recebimento TO authenticated;
GRANT ALL ON public.dados_financeiros_recebimento TO service_role;

ALTER TABLE public.dados_financeiros_recebimento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário lê seus dados financeiros"
  ON public.dados_financeiros_recebimento FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "Usuário insere seus dados financeiros"
  ON public.dados_financeiros_recebimento FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário atualiza seus dados financeiros"
  ON public.dados_financeiros_recebimento FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário remove seus dados financeiros"
  ON public.dados_financeiros_recebimento FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER dados_financeiros_updated_at
  BEFORE UPDATE ON public.dados_financeiros_recebimento
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
