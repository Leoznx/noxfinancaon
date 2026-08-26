BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(20);

SELECT is(
  public.normalize_cpf_lookup('091.355.439-14'),
  '09135543914',
  'CPF mascarado é normalizado para onze dígitos'
);
SELECT is(
  public.normalize_cpf_lookup('123'),
  NULL,
  'CPF incompleto não participa da busca'
);
SELECT is(
  public.normalize_br_phone_lookup('+55 (11) 99999-8888'),
  '11999998888',
  'telefone remove máscara e código do Brasil'
);
SELECT is(
  public.normalize_br_phone_lookup('9999'),
  NULL,
  'telefone inválido não participa da busca'
);

SELECT is(
  public.is_corretor_linkable_status('ativo'),
  true,
  'corretor ativo pode ser vinculado'
);
SELECT is(
  public.is_corretor_linkable_status('pendente'),
  true,
  'corretor pendente pode ser vinculado'
);
SELECT is(
  public.is_corretor_linkable_status('pendente_aprovacao'),
  true,
  'corretor aguardando aprovação pode ser vinculado'
);
SELECT is(
  public.is_corretor_linkable_status('bloqueado'),
  false,
  'corretor bloqueado não pode ser vinculado'
);
SELECT is(
  public.is_corretor_linkable_status(NULL::text),
  false,
  'corretor sem status não pode ser vinculado'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.find_corretor(text,text)', 'EXECUTE'),
  'imobiliária autenticada pode buscar corretor'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.find_corretor(text,text)', 'EXECUTE'),
  'visitante anônimo não pode enumerar corretores'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.link_my_corretor(uuid)', 'EXECUTE'),
  'imobiliária autenticada usa RPC atômica de vínculo'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.unlink_my_corretor(uuid)', 'EXECUTE'),
  'imobiliária autenticada usa RPC atômica de desvínculo'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.link_my_corretor(uuid)', 'EXECUTE'),
  'visitante anônimo não pode vincular corretor'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.unlink_my_corretor(uuid)', 'EXECUTE'),
  'visitante anônimo não pode desvincular corretor'
);

SELECT ok(EXISTS (
  SELECT 1
  FROM pg_trigger
  WHERE tgrelid = 'public.profiles'::regclass
    AND tgname = 'sync_corretor_directory_from_profile'
    AND NOT tgisinternal
), 'profile de corretor sincroniza automaticamente o diretório');

SELECT ok(EXISTS (
  SELECT 1
  FROM pg_trigger
  WHERE tgrelid = 'public.corretores'::regclass
    AND tgname = 'normalize_corretor_directory_row'
    AND NOT tgisinternal
), 'escritas no diretório normalizam CPF e estado do vínculo');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'corretores'
    AND indexname = 'corretores_cpf_normalized_lookup_idx'
), 'busca normalizada por CPF possui índice');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'profiles'
    AND indexname = 'profiles_corretor_email_lookup_idx'
), 'busca normalizada por e-mail possui índice');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'profiles'
    AND indexname = 'profiles_corretor_phone_lookup_idx'
), 'busca normalizada por telefone possui índice');

SELECT * FROM finish();
ROLLBACK;
