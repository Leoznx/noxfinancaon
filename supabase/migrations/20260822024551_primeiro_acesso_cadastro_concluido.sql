-- Marca quando o usuário já passou pela tela /cadastro-concluido — a URL que
-- existe só para o Pixel da Meta e o Google Ads registrarem a conversão de
-- cadastro. Enquanto for NULL, o primeiro acesso ainda não foi contabilizado;
-- depois de preenchida, a tela nunca mais aparece para aquele usuário.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cadastro_concluido_em timestamptz;

COMMENT ON COLUMN public.profiles.cadastro_concluido_em IS
  'Momento em que a conversão de cadastro foi disparada para os pixels. NULL = primeiro acesso ainda não aconteceu.';

-- Quem já tem conta não é cadastro novo: preenche todo mundo que existe hoje
-- para que a tela de conversão só apareça para contas criadas a partir daqui.
UPDATE public.profiles
SET cadastro_concluido_em = COALESCE(created_at, now())
WHERE cadastro_concluido_em IS NULL;

-- O próprio usuário grava a marcação no primeiro acesso (a policy de UPDATE de
-- profiles já restringe a linha a auth.uid() = id).
GRANT UPDATE (cadastro_concluido_em) ON public.profiles TO authenticated;
