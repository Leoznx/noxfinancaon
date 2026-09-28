BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(68);

-- Contratos estruturais compartilhados por web e aplicativo.
SELECT has_table('public', 'seller_contact_leads', 'dominio dedicado de leads existe');
SELECT has_table('public', 'seller_contact_lead_tasks', 'tarefas de contato existem');
SELECT has_table('public', 'seller_contact_lead_history', 'historico de leads existe');
SELECT has_table('public', 'seller_commercial_events', 'eventos comerciais existem');
SELECT has_column('public', 'seller_team_goals', 'target_calls_daily', 'meta visual de ligacoes existe');
SELECT has_column('public', 'seller_team_goals', 'target_leads_contacted_daily', 'meta diaria de contatos existe');
SELECT has_column('public', 'seller_appointments', 'contact_lead_task_id', 'agenda referencia a tarefa rotativa');
SELECT has_function('public', 'upsert_seller_control_goals', ARRAY['text','integer','integer','integer','integer'], 'RPC de metas existe');
SELECT has_function('public', 'create_my_seller_contact_lead', ARRAY['text','text'], 'RPC de cadastro existe');
SELECT has_function('public', 'get_my_seller_contact_leads', ARRAY['text'], 'RPC de busca existe');
SELECT has_function('public', 'respond_to_my_seller_contact_lead_task', ARRAY['uuid','text'], 'RPC de resposta existe');
SELECT has_function('public', 'process_seller_contact_lead_automation', ARRAY['timestamp with time zone'], 'automacao existe');
SELECT has_function('public', 'get_my_seller_control_dashboard', ARRAY['text','date'], 'painel do vendedor existe');
SELECT has_function('public', 'get_admin_seller_control_report', ARRAY['text','date'], 'relatorio administrativo existe');
SELECT ok(has_function_privilege('authenticated', 'public.create_my_seller_contact_lead(text,text)', 'EXECUTE'), 'authenticated pode cadastrar lead');
SELECT ok(NOT has_function_privilege('anon', 'public.create_my_seller_contact_lead(text,text)', 'EXECUTE'), 'anon nao cadastra lead');
SELECT ok(has_function_privilege('service_role', 'public.process_seller_contact_lead_automation(timestamptz)', 'EXECUTE'), 'service_role executa automacao');
SELECT ok(NOT has_function_privilege('authenticated', 'public.process_seller_contact_lead_automation(timestamptz)', 'EXECUTE'), 'vendedor nao executa automacao');
SELECT trigger_is('public', 'seller_commercial_events', 'trg_guard_seller_commercial_event_immutability', 'public', 'guard_seller_commercial_event_immutability', 'eventos sao append-only');
SELECT trigger_is('public', 'seller_appointments', 'trg_guard_rotating_lead_appointment', 'public', 'guard_rotating_lead_appointment', 'agenda rotativa so muda pelas RPCs');
SELECT trigger_is('public', 'seller_appointments', 'trg_record_seller_appointment_reschedule_event', 'public', 'record_seller_appointment_reschedule_event', 'reagendamento gera evento auditavel');
SELECT is(public.seller_appointment_blocks_availability('follow_up', 'agendado'), false, 'follow-up nao ocupa agenda');
SELECT is(
  public.seller_contact_lead_task_at('b0000000-0000-4000-8000-000000000001', 1, 1, '2026-09-28 12:00:00+00'),
  public.seller_contact_lead_task_at('b0000000-0000-4000-8000-000000000001', 1, 1, '2026-09-28 12:00:00+00'),
  'alocacao e deterministica'
);
SELECT ok(
  extract(isodow FROM public.seller_contact_lead_task_at('b0000000-0000-4000-8000-000000000001', 1, 1, '2026-09-28 12:00:00+00') AT TIME ZONE 'America/Sao_Paulo') BETWEEN 1 AND 5,
  'primeira tarefa cai em dia util'
);
SELECT ok(
  (public.seller_contact_lead_task_at('b0000000-0000-4000-8000-000000000001', 1, 2, '2026-09-28 12:00:00+00') AT TIME ZONE 'America/Sao_Paulo')::time >= time '08:00'
  AND (public.seller_contact_lead_task_at('b0000000-0000-4000-8000-000000000001', 1, 2, '2026-09-28 12:00:00+00') AT TIME ZONE 'America/Sao_Paulo')::time < time '18:00',
  'segunda tarefa respeita 08-18'
);
SELECT isnt(
  public.seller_contact_lead_task_at('b0000000-0000-4000-8000-000000000001', 1, 1, '2026-09-28 12:00:00+00'),
  public.seller_contact_lead_task_at('b0000000-0000-4000-8000-000000000001', 1, 2, '2026-09-28 12:00:00+00'),
  'as duas tentativas possuem datas diferentes'
);
SELECT is(
  public.seller_signup_link_send_event_key(
    '{"id":"10000000-0000-4000-8000-000000000001"}'::jsonb
  ),
  '10000000-0000-4000-8000-000000000001',
  'evento legado sem send_group_id usa o proprio id'
);
SELECT is(
  public.seller_signup_link_send_event_key(
    '{"id":"10000000-0000-4000-8000-000000000001","send_group_id":"20000000-0000-4000-8000-000000000002"}'::jsonb
  ),
  '20000000-0000-4000-8000-000000000002',
  'se existir, send_group_id deduplica o mesmo envio'
);
SELECT ok(
  position(
    'send.source_sdr_id = v_seller.id'
    IN pg_get_functiondef(
      'public.seller_control_dashboard_for(uuid,text,date)'::regprocedure
    )
  ) > 0,
  'o mesmo envio credita o vendedor e o SDR de origem'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.internal_users AS seller
    WHERE lower(seller.email) = 'vendedornox@nox.com'
      AND seller.role = 'vendedor'
  )
  OR EXISTS (
    SELECT 1
    FROM public.internal_users AS seller
    JOIN public.seller_contact_leads AS lead
      ON lead.id = '90000000-0000-4000-8000-000000000001'::uuid
     AND lead.current_seller_id = seller.id
    JOIN public.seller_contact_lead_tasks AS first_task
      ON first_task.lead_id = lead.id
     AND first_task.cycle_number = lead.cycle_number
     AND first_task.attempt_no = 1
    JOIN public.seller_appointments AS first_appointment
      ON first_appointment.contact_lead_task_id = first_task.id
    JOIN public.seller_contact_lead_tasks AS second_task
      ON second_task.lead_id = lead.id
     AND second_task.cycle_number = lead.cycle_number
     AND second_task.attempt_no = 2
    WHERE lower(seller.email) = 'vendedornox@nox.com'
      AND seller.role = 'vendedor'
      AND lead.is_demo
      AND first_task.status = 'pending'
      AND second_task.status = 'pending'
      AND (first_task.due_at AT TIME ZONE 'America/Sao_Paulo')::date
          = public.next_seller_business_day(
              (now() AT TIME ZONE 'America/Sao_Paulo')::date
            )
      AND first_appointment.status = 'agendado'
      AND first_appointment.source = 'rotating_lead'
      AND first_appointment.scheduled_at = first_task.due_at
      AND (
        first_appointment.visible_from AT TIME ZONE 'America/Sao_Paulo'
      )::date = (
        first_task.due_at AT TIME ZONE 'America/Sao_Paulo'
      )::date
      AND second_task.due_at > first_task.due_at
  ),
  'seed demo deixa o primeiro lembrete visivel no dia util e o segundo futuro'
);

-- Fixtures transacionais: nenhum dado permanece apos o ROLLBACK.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'seller-control-1@example.invalid', '', now(), '{}'::jsonb, '{"nome":"Seller Control 1"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'seller-control-2@example.invalid', '', now(), '{}'::jsonb, '{"nome":"Seller Control 2"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'seller-control-admin@example.invalid', '', now(), '{}'::jsonb, '{"nome":"Seller Control Admin"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'seller-control-demo@example.invalid', '', now(), '{}'::jsonb, '{"nome":"Seller Control Demo"}'::jsonb, now(), now());

INSERT INTO public.internal_users (
  id, auth_user_id, full_name, email, role, status, seller_type,
  exclude_from_commercial_metrics
) VALUES
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Seller Control 1', 'seller-control-1@example.invalid', 'vendedor', 'ativo', 'sdr', false),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'Seller Control 2', 'seller-control-2@example.invalid', 'vendedor', 'ativo', 'closer', false),
  ('b2000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', 'Seller Control Admin', 'seller-control-admin@example.invalid', 'admin_master', 'ativo', NULL, false),
  ('b2000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000004', 'Seller Control Demo', 'seller-control-demo@example.invalid', 'vendedor', 'ativo', 'sdr', true);

CREATE TEMP TABLE _seller_control_test_ids (
  key text PRIMARY KEY,
  id uuid NOT NULL
) ON COMMIT DROP;

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000004', true);
INSERT INTO _seller_control_test_ids (key, id)
VALUES (
  'demo',
  public.create_my_seller_contact_lead('Lead Demo Proprio', '(11) 98888-0005')
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);

INSERT INTO _seller_control_test_ids (key, id)
VALUES ('dedupe', public.create_my_seller_contact_lead('Lead Dedupe', '(11) 98888-0001'));

SELECT is(
  public.create_my_seller_contact_lead('Lead Dedupe', '11 98888 0001'),
  (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe'),
  'mesmo telefone retorna o mesmo lead'
);
SELECT is((SELECT count(*) FROM public.seller_contact_leads WHERE phone_normalized = '11988880001'), 1::bigint, 'telefone nao duplica lead');
SELECT is((SELECT count(*) FROM public.seller_commercial_events WHERE subject_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe') AND event_type = 'lead_contacted'), 1::bigint, 'contato diario nao duplica evento');
SELECT is((SELECT count(*) FROM public.seller_contact_lead_tasks WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe')), 2::bigint, 'ciclo cria duas tarefas');
SELECT is((SELECT count(*) FROM public.seller_appointments WHERE contact_lead_task_id IN (SELECT id FROM public.seller_contact_lead_tasks WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe'))), 2::bigint, 'ciclo cria dois lembretes na agenda');
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.seller_contact_lead_tasks
    WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe')
      AND (
        extract(isodow FROM due_at AT TIME ZONE 'America/Sao_Paulo') NOT BETWEEN 1 AND 5
        OR (due_at AT TIME ZONE 'America/Sao_Paulo')::time < time '08:00'
        OR (due_at AT TIME ZONE 'America/Sao_Paulo')::time >= time '18:00'
      )
  ),
  'as duas tarefas respeitam dias uteis e horario comercial'
);

SELECT ok(
  (
    public.respond_to_seller_contact_lead_task(
      'b2000000-0000-4000-8000-000000000001',
      (
        SELECT appointment.id
        FROM public.seller_contact_lead_tasks AS task
        JOIN public.seller_appointments AS appointment ON appointment.contact_lead_task_id = task.id
        WHERE task.lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe')
          AND task.attempt_no = 1
      ),
      'sem_retorno',
      (
        SELECT due_at FROM public.seller_contact_lead_tasks
        WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe')
          AND attempt_no = 1
      )
    )->>'outcome'
  ) = 'sem_retorno',
  'primeira tentativa aceita sem_retorno'
);
SELECT is((SELECT no_response_count FROM public.seller_contact_leads WHERE id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe')), 1, 'primeira ausencia incrementa contador');
SELECT is((SELECT current_seller_id FROM public.seller_contact_leads WHERE id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe')), 'b2000000-0000-4000-8000-000000000001'::uuid, 'primeira ausencia mantem vendedor');

SELECT ok(
  (
    public.respond_to_seller_contact_lead_task(
      'b2000000-0000-4000-8000-000000000001',
      (
        SELECT appointment.id
        FROM public.seller_contact_lead_tasks AS task
        JOIN public.seller_appointments AS appointment ON appointment.contact_lead_task_id = task.id
        WHERE task.lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe')
          AND task.attempt_no = 2 AND task.status = 'pending'
      ),
      'sem_retorno',
      (
        SELECT due_at FROM public.seller_contact_lead_tasks
        WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe')
          AND attempt_no = 2 AND status = 'pending'
      )
    )->>'transferred'
  )::boolean,
  'segunda ausencia transfere imediatamente'
);
SELECT isnt((SELECT current_seller_id FROM public.seller_contact_leads WHERE id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe')), 'b2000000-0000-4000-8000-000000000001'::uuid, 'lead saiu da carteira anterior');
SELECT ok(EXISTS (SELECT 1 FROM public.seller_contact_lead_history WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'dedupe') AND event_type = 'transferred'), 'transferencia fica no historico');

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
INSERT INTO _seller_control_test_ids (key, id)
VALUES ('contacted', public.create_my_seller_contact_lead('Lead Em Contato', '(11) 98888-0002'));

SELECT ok(
  (
    public.respond_to_seller_contact_lead_task(
      'b2000000-0000-4000-8000-000000000001',
      (
        SELECT appointment.id
        FROM public.seller_contact_lead_tasks AS task
        JOIN public.seller_appointments AS appointment ON appointment.contact_lead_task_id = task.id
        WHERE task.lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'contacted')
          AND task.attempt_no = 1
      ),
      'em_contato',
      (
        SELECT due_at FROM public.seller_contact_lead_tasks
        WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'contacted')
          AND attempt_no = 1
      )
    )->>'outcome'
  ) = 'em_contato',
  'resultado em_contato e aceito'
);
SELECT is((SELECT cycle_number FROM public.seller_contact_leads WHERE id = (SELECT id FROM _seller_control_test_ids WHERE key = 'contacted')), 2, 'contato reinicia ciclo de 30 dias');
SELECT is((SELECT count(*) FROM public.seller_contact_lead_tasks WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'contacted') AND status = 'pending'), 2::bigint, 'novo ciclo recebe duas tarefas');
SELECT is((SELECT count(*) FROM public.seller_contact_lead_tasks WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'contacted') AND status = 'cancelled'), 1::bigint, 'tarefa antiga pendente e cancelada');

-- Tarefa perdida: no proximo dia util o lead muda automaticamente de vendedor.
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
INSERT INTO _seller_control_test_ids (key, id)
VALUES ('missed', public.create_my_seller_contact_lead('Lead Perdido', '(11) 98888-0003'));
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000003', true);
SELECT set_config('nox.contact_lead_mutation', '1', true);
UPDATE public.seller_contact_lead_tasks
SET due_at = '2026-10-05 09:00:00 America/Sao_Paulo'
WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'missed')
  AND attempt_no = 1;
UPDATE public.seller_appointments AS appointment
SET scheduled_at = task.due_at
FROM public.seller_contact_lead_tasks AS task
WHERE appointment.contact_lead_task_id = task.id
  AND task.lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'missed')
  AND task.attempt_no = 1;

SELECT ok((public.process_seller_contact_lead_automation('2026-10-06 09:00:00 America/Sao_Paulo')->>'missed_tasks')::integer >= 1, 'automacao processa tarefa vencida');
SELECT is((SELECT status FROM public.seller_contact_lead_tasks WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'missed') AND attempt_no = 1 AND cycle_number = 1), 'missed', 'tarefa vencida fica missed');
SELECT isnt((SELECT current_seller_id FROM public.seller_contact_leads WHERE id = (SELECT id FROM _seller_control_test_ids WHERE key = 'missed')), 'b2000000-0000-4000-8000-000000000001'::uuid, 'perda transfere no proximo dia util');
SELECT ok(EXISTS (SELECT 1 FROM public.seller_contact_lead_history WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'missed') AND event_type = 'task_missed'), 'perda fica no historico');

-- Expiracao de 30 dias usa a mesma rotacao e nao depende de horario ocupado.
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
INSERT INTO _seller_control_test_ids (key, id)
VALUES ('expired', public.create_my_seller_contact_lead('Lead Expirado', '(11) 98888-0004'));
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000003', true);
UPDATE public.seller_contact_leads
SET rotation_due_at = '2026-10-05 08:00:00 America/Sao_Paulo'
WHERE id = (SELECT id FROM _seller_control_test_ids WHERE key = 'expired');
UPDATE public.seller_contact_lead_tasks
SET due_at = '2026-10-20 09:00:00 America/Sao_Paulo'
WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'expired');
UPDATE public.seller_appointments AS appointment
SET scheduled_at = task.due_at
FROM public.seller_contact_lead_tasks AS task
WHERE appointment.contact_lead_task_id = task.id
  AND task.lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'expired');

SELECT ok((public.process_seller_contact_lead_automation('2026-10-06 10:00:00 America/Sao_Paulo')->>'expired_leads')::integer >= 1, 'automacao processa ciclo expirado');
SELECT isnt((SELECT current_seller_id FROM public.seller_contact_leads WHERE id = (SELECT id FROM _seller_control_test_ids WHERE key = 'expired')), 'b2000000-0000-4000-8000-000000000001'::uuid, 'expiracao transfere o lead');
SELECT ok(EXISTS (SELECT 1 FROM public.seller_contact_lead_history WHERE lead_id = (SELECT id FROM _seller_control_test_ids WHERE key = 'expired') AND event_type = 'transferred' AND metadata->>'reason' = 'cycle_expired'), 'motivo de expiracao fica auditado');

-- Metas e relatorios.
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000003', true);
SELECT ok((public.upsert_seller_control_goals('sdr', 9, 2026, 40, 8)->>'calls_daily')::integer = 40, 'admin grava meta de ligacoes');
SELECT is((SELECT target_leads_contacted_daily FROM public.seller_team_goals WHERE seller_type = 'sdr' AND month = 9 AND year = 2026), 8, 'meta de contatos fica persistida');

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000004', true);
SELECT ok(
  (
    public.get_my_seller_control_dashboard(
      'daily', (now() AT TIME ZONE 'America/Sao_Paulo')::date
    )->'metrics'->>'active_leads'
  )::bigint >= 1
  AND (
    public.get_my_seller_control_dashboard(
      'daily', (now() AT TIME ZONE 'America/Sao_Paulo')::date
    )->'metrics'->>'leads_contacted'
  )::bigint >= 1,
  'vendedor demo enxerga os proprios leads e eventos demo no painel'
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
SELECT is(public.get_my_seller_control_dashboard('monthly', '2026-09-28')->'period'->>'kind', 'monthly', 'painel retorna objeto de periodo');
SELECT is((public.get_my_seller_control_dashboard('monthly', '2026-09-28')->'goals'->>'calls_daily')::integer, 40, 'painel retorna meta visual');
SELECT ok((public.get_my_seller_control_dashboard('monthly', '2026-09-28')->'metrics') ?& ARRAY['leads_contacted','links_sent','registrations','reschedules','active_leads','missed_leads'], 'painel retorna todas as metricas');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.get_my_seller_contact_leads(text)'::regprocedure AND 'created_at' = ANY(proargnames)), 'busca de leads retorna created_at');
SELECT ok(
  position(
    'seller_name'
    IN pg_get_functiondef('public.get_my_seller_contact_leads(text)'::regprocedure)
  ) > 0,
  'historico retorna nome do vendedor'
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000003', true);
SELECT is(public.get_admin_seller_control_report('monthly', '2026-09-28')->'period'->>'kind', 'monthly', 'relatorio retorna objeto de periodo');
SELECT ok(EXISTS (
  SELECT 1
  FROM jsonb_array_elements(public.get_admin_seller_control_report('monthly', '2026-09-28')->'sellers') AS item
  WHERE item->'seller'->>'id' = 'b2000000-0000-4000-8000-000000000001'
), 'relatorio inclui vendedor real');
SELECT ok(NOT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(public.get_admin_seller_control_report('monthly', '2026-09-28')->'sellers') AS item
  WHERE item->'seller'->>'id' = 'b2000000-0000-4000-8000-000000000004'
), 'relatorio administrativo exclui a conta demo');
SELECT ok((public.get_admin_seller_control_report('monthly', '2026-09-28')->'totals') ?& ARRAY['leads_contacted','links_sent','registrations','reschedules','active_leads','missed_leads'], 'relatorio retorna totais completos');
SELECT is(
  (public.seller_control_dashboard_for('b2000000-0000-4000-8000-000000000001', 'monthly', '2026-09-28')->'metrics'->>'active_leads')::bigint,
  (SELECT count(*) FROM public.seller_contact_leads WHERE current_seller_id = 'b2000000-0000-4000-8000-000000000001' AND status = 'active' AND NOT is_demo),
  'relatorio real exclui leads demo'
);
SELECT ok(
  position(
    'exclude_from_commercial_metrics'
    IN pg_get_functiondef(
      'public.get_admin_seller_control_report(text,date)'::regprocedure
    )
  ) > 0,
  'relatorio exclui contas de demonstracao'
);
SELECT ok(
  position(
    'IS NOT DISTINCT FROM'
    IN pg_get_functiondef(
      'public.record_seller_appointment_reschedule_event()'::regprocedure
    )
  ) > 0,
  'reagendamento so conta quando a data muda'
);

SELECT * FROM finish();
ROLLBACK;
