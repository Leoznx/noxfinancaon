-- =============================================================================
-- Cria o profile automaticamente quando um usuário se cadastra (auth.users INSERT).
--
-- BUG CRÍTICO CORRIGIDO: o comentário "Profile já é criado por trigger" em
-- src/routes/cadastro.tsx sempre presumiu que esse trigger existia, mas ele nunca
-- foi de fato criado (nem nas migrations, nem no banco ao vivo — confirmado por
-- consulta direta). Resultado: TODO cadastro real (qualquer tipo de conta) criava
-- o usuário em auth.users, mas nunca uma linha em public.profiles — o .update()
-- seguinte no cadastro.tsx não falhava (só afetava 0 linhas), então o cadastro
-- "parecia" funcionar, mas o login subsequente falhava ao buscar o profile
-- (.single() sem nenhuma linha) e nenhuma tela de perfil funcionava.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  meta_nome TEXT;
  meta_role TEXT;
  resolved_role public.user_role;
BEGIN
  meta_nome := COALESCE(NULLIF(NEW.raw_user_meta_data->>'nome', ''), split_part(NEW.email, '@', 1));
  meta_role := NEW.raw_user_meta_data->>'role';

  BEGIN
    resolved_role := COALESCE(NULLIF(meta_role, ''), 'inquilino')::public.user_role;
  EXCEPTION WHEN invalid_text_representation THEN
    resolved_role := 'inquilino';
  END;

  INSERT INTO public.profiles (id, nome, email, role)
  VALUES (NEW.id, meta_nome, NEW.email, resolved_role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
