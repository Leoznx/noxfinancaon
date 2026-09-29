BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(23);

SELECT has_column('public', 'seller_contact_leads', 'lead_category', 'lead guarda a jornada escolhida');
SELECT has_column('public', 'seller_contact_leads', 'rotation_locked', 'lead pode bloquear rotacao');
SELECT has_column('public', 'seller_contact_lead_tasks', 'next_step', 'tarefa guarda o proximo passo');
SELECT has_column('public', 'seller_contact_lead_tasks', 'response_notes', 'tarefa guarda observacao do contato');
SELECT has_function('public', 'create_my_qualified_seller_contact_lead', ARRAY['text','text','text'], 'RPC qualificada de cadastro existe');
SELECT has_function('public', 'get_my_qualified_seller_contact_leads', ARRAY['text'], 'RPC qualificada de carteira existe');
SELECT has_function('public', 'respond_to_my_qualified_seller_contact_lead_task', ARRAY['uuid','text','text','text'], 'RPC qualificada de resposta existe');
SELECT ok(has_function_privilege('authenticated', 'public.create_my_qualified_seller_contact_lead(text,text,text)', 'EXECUTE'), 'authenticated cadastra lead qualificado');
SELECT ok(NOT has_function_privilege('anon', 'public.create_my_qualified_seller_contact_lead(text,text,text)', 'EXECUTE'), 'anon nao cadastra lead qualificado');
SELECT is(public.seller_contact_lead_attempt_limit('cold'), 2, 'lead frio usa duas tentativas');
SELECT is(public.seller_contact_lead_attempt_limit('potential'), 4, 'lead potencial usa quatro tentativas');
SELECT is(public.seller_contact_lead_attempt_limit('meeting_scheduled'), 1, 'reuniao agenda uma tarefa por ciclo');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'qualified-seller-1@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'qualified-seller-2@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.internal_users (
  id, auth_user_id, full_name, email, role, status, seller_type,
  exclude_from_commercial_metrics
) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Qualified Seller 1', 'qualified-seller-1@example.invalid', 'vendedor', 'ativo', 'sdr', false),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 'Qualified Seller 2', 'qualified-seller-2@example.invalid', 'vendedor', 'ativo', 'closer', false);

SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

CREATE TEMP TABLE _qualified_leads (
  category text PRIMARY KEY,
  id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO _qualified_leads VALUES
  ('cold', public.create_my_qualified_seller_contact_lead('Lead Frio Teste', '(11) 97777-1001', 'cold')),
  ('potential', public.create_my_qualified_seller_contact_lead('Lead Potencial Teste', '(11) 97777-1002', 'potential')),
  ('meeting_scheduled', public.create_my_qualified_seller_contact_lead('Lead Reuniao Teste', '(11) 97777-1003', 'meeting_scheduled'));

SELECT is((SELECT lead_category FROM public.seller_contact_leads WHERE id = (SELECT id FROM _qualified_leads WHERE category = 'cold')), 'cold', 'cadastro preserva categoria frio');
SELECT is((SELECT count(*) FROM public.seller_contact_lead_tasks WHERE lead_id = (SELECT id FROM _qualified_leads WHERE category = 'cold') AND status = 'pending'), 2::bigint, 'frio recebe duas tarefas');
SELECT is((SELECT count(*) FROM public.seller_contact_lead_tasks WHERE lead_id = (SELECT id FROM _qualified_leads WHERE category = 'potential') AND status = 'pending'), 4::bigint, 'potencial recebe quatro tarefas');
SELECT is((SELECT count(*) FROM public.seller_contact_lead_tasks WHERE lead_id = (SELECT id FROM _qualified_leads WHERE category = 'meeting_scheduled') AND status = 'pending'), 1::bigint, 'reuniao recebe uma tarefa recorrente');
SELECT is((SELECT rotation_locked FROM public.seller_contact_leads WHERE id = (SELECT id FROM _qualified_leads WHERE category = 'meeting_scheduled')), true, 'reuniao bloqueia rotacao');

SELECT ok(
  (
    public.respond_to_qualified_seller_contact_lead_task(
      'd2000000-0000-4000-8000-000000000001',
      (
        SELECT appointment.id
        FROM public.seller_contact_lead_tasks AS task
        JOIN public.seller_appointments AS appointment ON appointment.contact_lead_task_id = task.id
        WHERE task.lead_id = (SELECT id FROM _qualified_leads WHERE category = 'meeting_scheduled')
          AND task.status = 'pending'
      ),
      'sem_retorno',
      'continue_follow_up',
      'Continuar com o mesmo vendedor',
      (
        SELECT task.due_at
        FROM public.seller_contact_lead_tasks AS task
        WHERE task.lead_id = (SELECT id FROM _qualified_leads WHERE category = 'meeting_scheduled')
          AND task.status = 'pending'
      )
    )->>'transferred'
  )::boolean = false,
  'reuniao sem retorno nao transfere o lead'
);
SELECT is((SELECT current_seller_id FROM public.seller_contact_leads WHERE id = (SELECT id FROM _qualified_leads WHERE category = 'meeting_scheduled')), 'd2000000-0000-4000-8000-000000000001'::uuid, 'reuniao continua com o mesmo vendedor');
SELECT is((SELECT count(*) FROM public.seller_contact_lead_tasks WHERE lead_id = (SELECT id FROM _qualified_leads WHERE category = 'meeting_scheduled') AND status = 'pending'), 1::bigint, 'reuniao cria o proximo contato de 15 dias');
SELECT ok(EXISTS (SELECT 1 FROM public.seller_contact_lead_tasks WHERE lead_id = (SELECT id FROM _qualified_leads WHERE category = 'meeting_scheduled') AND next_step = 'continue_follow_up' AND response_notes = 'Continuar com o mesmo vendedor'), 'resultado guarda proximo passo e observacao');

SELECT ok(
  (
    SELECT bool_and(
      extract(isodow FROM due_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 1 AND 5
      AND (due_at AT TIME ZONE 'America/Sao_Paulo')::time >= time '08:00'
      AND (due_at AT TIME ZONE 'America/Sao_Paulo')::time < time '18:00'
    )
    FROM public.seller_contact_lead_tasks
    WHERE lead_id = (SELECT id FROM _qualified_leads WHERE category = 'potential')
  ),
  'quatro contatos do potencial respeitam dias uteis e horario comercial'
);

SELECT is(
  jsonb_array_length(public.get_my_qualified_seller_contact_leads(NULL)),
  3,
  'carteira qualificada retorna as tres jornadas do vendedor'
);

SELECT * FROM finish();
ROLLBACK;
