-- Aba "Notificações" (configuracoes) só tinha estado local nos switches — nada
-- era salvo, e "Salvar preferências" não fazia nada. Cria a tabela real usada
-- para persistir as preferências de cada usuário.
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nova_comissao BOOLEAN NOT NULL DEFAULT true,
  saque_aprovado BOOLEAN NOT NULL DEFAULT true,
  subiu_nivel BOOLEAN NOT NULL DEFAULT true,
  consulta_pre_aprovada BOOLEAN NOT NULL DEFAULT true,
  canal_app BOOLEAN NOT NULL DEFAULT true,
  canal_email BOOLEAN NOT NULL DEFAULT true,
  canal_whatsapp BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário lê suas preferências de notificação"
  ON public.notification_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Usuário insere suas preferências de notificação"
  ON public.notification_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário atualiza suas preferências de notificação"
  ON public.notification_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
