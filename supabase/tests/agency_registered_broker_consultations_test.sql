BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(8);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'AGENCIA-ESCOPO@example.invalid', '', now(), '{}'::jsonb, '{"nome":"Agencia Escopo","role":"imobiliaria"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'corretor-vinculado@example.invalid', '', now(), '{}'::jsonb, '{"nome":"Corretor Vinculado","role":"corretor"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'corretor-outra@example.invalid', '', now(), '{}'::jsonb, '{"nome":"Corretor Outra","role":"corretor"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'corretor-sem-vinculo@example.invalid', '', now(), '{}'::jsonb, '{"nome":"Corretor Sem Vinculo","role":"corretor"}'::jsonb, now(), now());

INSERT INTO public.imobiliarias (
  id, razao_social, nome_fantasia, cnpj, creci, contato_email
) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'Agencia Escopo LTDA', 'Agencia Escopo', '10.000.000/0001-01', 'CRECI-A', 'agencia-escopo@example.invalid'),
  ('a2000000-0000-4000-8000-000000000002', 'Outra Agencia LTDA', 'Outra Agencia', '20.000.000/0001-02', 'CRECI-B', 'outra-agencia@example.invalid');

INSERT INTO public.corretores (
  id, profile_id, cpf, creci, imobiliaria_id, vinculado_imobiliaria
) VALUES
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', '10000000001', 'CRECI-1', 'a2000000-0000-4000-8000-000000000001', true),
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', '10000000002', 'CRECI-2', 'a2000000-0000-4000-8000-000000000002', true),
  ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000004', '10000000003', 'CRECI-3', NULL, false);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);

SELECT is(
  public.current_imobiliaria_id(),
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'a imobiliaria e resolvida mesmo com capitalizacao diferente no e-mail'
);

SELECT ok(
  public.eh_dono_ou_imobiliaria_da_consulta('a1000000-0000-4000-8000-000000000001'),
  'a imobiliaria continua vendo a propria consulta'
);

SELECT ok(
  public.eh_dono_ou_imobiliaria_da_consulta('a1000000-0000-4000-8000-000000000002'),
  'a imobiliaria ve a consulta do corretor cadastrado nela'
);

SELECT ok(
  NOT public.eh_dono_ou_imobiliaria_da_consulta('a1000000-0000-4000-8000-000000000003'),
  'a imobiliaria nao ve a consulta do corretor cadastrado em outra empresa'
);

SELECT ok(
  NOT public.eh_dono_ou_imobiliaria_da_consulta('a1000000-0000-4000-8000-000000000004'),
  'a imobiliaria nao ve a consulta do corretor sem vinculo'
);

SELECT matches(
  pg_get_functiondef('public.eh_dono_ou_imobiliaria_da_consulta(uuid)'::regprocedure),
  'broker\.imobiliaria_id = public\.current_imobiliaria_id\(\)',
  'a autorizacao usa o vinculo atual do corretor com a imobiliaria'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.eh_dono_ou_imobiliaria_da_consulta(uuid)',
    'EXECUTE'
  ),
  'usuarios autenticados podem usar a verificacao via RLS'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.eh_dono_ou_imobiliaria_da_consulta(uuid)',
    'EXECUTE'
  ),
  'visitantes anonimos nao podem consultar vinculos de equipe'
);

SELECT * FROM finish();
ROLLBACK;
