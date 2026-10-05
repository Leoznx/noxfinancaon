BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(20);

SELECT has_table(
  'public',
  'seller_departure_transfers',
  'transferencias de desligamento possuem trilha propria'
);
SELECT has_function(
  'public',
  'redistribute_departed_seller_workload',
  ARRAY['uuid', 'text'],
  'RPC privilegiada de redistribuicao existe'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.redistribute_departed_seller_workload(uuid,text)',
    'EXECUTE'
  ),
  'service_role pode redistribuir a agenda'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.redistribute_departed_seller_workload(uuid,text)',
    'EXECUTE'
  ),
  'cliente autenticado nao chama a redistribuicao diretamente'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.seller_departure_transfers',
    'INSERT'
  ),
  'cliente autenticado nao forja a trilha de transferencia'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'departure-sdr@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'departure-sdr-a@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'departure-sdr-b@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'departure-closer@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'departure-closer-a@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.internal_users (
  id, auth_user_id, full_name, email, role, status, seller_type,
  exclude_from_commercial_metrics
) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'SDR desligado', 'departure-sdr@example.invalid', 'vendedor', 'ativo', 'sdr', false),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'SDR ativo A', 'departure-sdr-a@example.invalid', 'vendedor', 'ativo', 'sdr', false),
  ('e2000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000003', 'SDR ativo B', 'departure-sdr-b@example.invalid', 'vendedor', 'ativo', 'sdr', false),
  ('e2000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000004', 'Closer desligado', 'departure-closer@example.invalid', 'vendedor', 'ativo', 'closer', false),
  ('e2000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000005', 'Closer ativo', 'departure-closer-a@example.invalid', 'vendedor', 'ativo', 'closer', false);

CREATE TEMP TABLE _departure_appointments (
  key text PRIMARY KEY,
  id uuid NOT NULL
) ON COMMIT DROP;

WITH inserted AS (
  INSERT INTO public.seller_appointments (
    seller_id, title, type, status, scheduled_at, notes, source
  ) VALUES (
    'e2000000-0000-4000-8000-000000000001',
    'Ligacao SDR 1', 'call', 'agendado', now() + interval '2 days',
    'Primeira observacao', 'manual'
  )
  RETURNING id
)
INSERT INTO _departure_appointments (key, id)
SELECT 'sdr-call-1', inserted.id FROM inserted;

WITH inserted AS (
  INSERT INTO public.seller_appointments (
    seller_id, title, type, status, scheduled_at, notes, source
  ) VALUES (
    'e2000000-0000-4000-8000-000000000001',
    'Ligacao SDR 2', 'call', 'agendado', now() + interval '3 days',
    NULL, 'manual'
  )
  RETURNING id
)
INSERT INTO _departure_appointments (key, id)
SELECT 'sdr-call-2', inserted.id FROM inserted;

WITH inserted AS (
  INSERT INTO public.seller_appointments (
    seller_id, assigned_closer_id, title, type, status,
    scheduled_at, notes, source, duration_minutes
  ) VALUES (
    'e2000000-0000-4000-8000-000000000004',
    'e2000000-0000-4000-8000-000000000004',
    'Reuniao do Closer', 'reuniao', 'agendado',
    now() + interval '4 days', 'Cliente prioritario', 'manual', 60
  )
  RETURNING id
)
INSERT INTO _departure_appointments (key, id)
SELECT 'closer-meeting', inserted.id FROM inserted;

WITH inserted AS (
  INSERT INTO public.seller_appointments (
    seller_id, title, type, status, scheduled_at, notes, source
  ) VALUES (
    'e2000000-0000-4000-8000-000000000004',
    'Historico concluido', 'call', 'concluido', now() - interval '1 day',
    'Historico preservado', 'manual'
  )
  RETURNING id
)
INSERT INTO _departure_appointments (key, id)
SELECT 'closer-completed', inserted.id FROM inserted;

CREATE TEMP TABLE _departure_lead (id uuid PRIMARY KEY) ON COMMIT DROP;
WITH inserted AS (
  INSERT INTO public.seller_contact_leads (
    full_name, phone_normalized, phone_display, current_seller_id,
    status, lead_category
  ) VALUES (
    'Lead da saida', '11999990001', '(11) 99999-0001',
    'e2000000-0000-4000-8000-000000000001', 'active', 'cold'
  ) RETURNING id
)
INSERT INTO _departure_lead
SELECT id FROM inserted;
SELECT public.schedule_seller_contact_lead_cycle((SELECT id FROM _departure_lead));

CREATE TEMP TABLE _departure_results (
  key text PRIMARY KEY,
  summary jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO _departure_results VALUES (
  'sdr',
  public.redistribute_departed_seller_workload(
    'e2000000-0000-4000-8000-000000000001', NULL
  )
);

SELECT is(
  (SELECT (summary->>'contact_lead_count')::integer FROM _departure_results WHERE key = 'sdr'),
  1,
  'lead inteligente inteiro foi redistribuido'
);
SELECT is(
  (SELECT (summary->>'appointment_count')::integer FROM _departure_results WHERE key = 'sdr'),
  4,
  'dois compromissos e dois lembretes rotativos foram redistribuidos'
);
SELECT is(
  (SELECT (summary->>'recipient_count')::integer FROM _departure_results WHERE key = 'sdr'),
  2,
  'carga do SDR foi balanceada entre os dois substitutos'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.seller_appointments
    WHERE status NOT IN ('concluido', 'cancelado', 'nao_compareceu')
      AND 'e2000000-0000-4000-8000-000000000001'::uuid IN
        (seller_id, sdr_id, assigned_closer_id)
  ),
  0::bigint,
  'nenhum compromisso ativo permanece com o SDR desligado'
);
SELECT ok(
  (
    SELECT bool_and(owner.seller_type = 'sdr')
    FROM public.seller_appointments AS appointment
    JOIN public.internal_users AS owner ON owner.id = appointment.seller_id
    WHERE appointment.id IN (
      SELECT id FROM _departure_appointments WHERE key LIKE 'sdr-%'
      UNION ALL
      SELECT appointment.id
      FROM public.seller_contact_lead_tasks AS task
      JOIN public.seller_appointments AS appointment
        ON appointment.contact_lead_task_id = task.id
      WHERE task.lead_id = (SELECT id FROM _departure_lead)
    )
  ),
  'itens do SDR foram somente para SDRs'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.seller_appointments
    WHERE id IN (
      SELECT id FROM _departure_appointments WHERE key LIKE 'sdr-%'
      UNION ALL
      SELECT appointment.id
      FROM public.seller_contact_lead_tasks AS task
      JOIN public.seller_appointments AS appointment
        ON appointment.contact_lead_task_id = task.id
      WHERE task.lead_id = (SELECT id FROM _departure_lead)
    )
      AND notes LIKE '%LEAD COLABORADOR QUE SAIU%'
  ),
  4::bigint,
  'todos os itens transferidos recebem a marca solicitada'
);
SELECT ok(
  (
    SELECT owner.seller_type = 'sdr'
    FROM public.seller_contact_leads AS lead
    JOIN public.internal_users AS owner ON owner.id = lead.current_seller_id
    WHERE lead.id = (SELECT id FROM _departure_lead)
  ),
  'carteira inteligente continua com a mesma especialidade'
);
SELECT ok(
  (
    SELECT bool_and(task.seller_id = lead.current_seller_id)
    FROM public.seller_contact_lead_tasks AS task
    JOIN public.seller_contact_leads AS lead ON lead.id = task.lead_id
    WHERE task.lead_id = (SELECT id FROM _departure_lead)
      AND task.status = 'pending'
  ),
  'tarefas pendentes acompanham o novo responsavel pelo lead'
);

INSERT INTO _departure_results VALUES (
  'closer',
  public.redistribute_departed_seller_workload(
    'e2000000-0000-4000-8000-000000000004', NULL
  )
);

SELECT is(
  (SELECT (summary->>'appointment_count')::integer FROM _departure_results WHERE key = 'closer'),
  1,
  'agenda ativa do Closer foi redistribuida'
);
SELECT is(
  (
    SELECT seller_type
    FROM public.internal_users
    WHERE id = (
      SELECT assigned_closer_id
      FROM public.seller_appointments
      WHERE id = (SELECT id FROM _departure_appointments WHERE key = 'closer-meeting')
    )
  ),
  'closer',
  'reuniao do Closer foi somente para outro Closer'
);
SELECT is(
  (
    SELECT seller_id
    FROM public.seller_appointments
    WHERE id = (SELECT id FROM _departure_appointments WHERE key = 'closer-completed')
  ),
  'e2000000-0000-4000-8000-000000000004'::uuid,
  'historico concluido permanece com o colaborador original'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.seller_departure_transfers
    WHERE departed_seller_id IN (
      'e2000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000004'
    )
  ),
  4::bigint,
  'cada lead ou cadeia de agenda gera uma trilha idempotente'
);

UPDATE public.internal_users
SET seller_type = NULL,
    status = 'excluido'
WHERE id = 'e2000000-0000-4000-8000-000000000001';

WITH inserted AS (
  INSERT INTO public.seller_appointments (
    seller_id, title, type, status, scheduled_at, notes, source
  ) VALUES (
    'e2000000-0000-4000-8000-000000000001',
    'Lead de desligamento anterior', 'call', 'agendado',
    now() + interval '5 days', NULL, 'manual'
  )
  RETURNING id
)
INSERT INTO _departure_appointments (key, id)
SELECT 'retroactive', inserted.id FROM inserted;

INSERT INTO _departure_results VALUES (
  'retroactive',
  public.redistribute_departed_seller_workload(
    'e2000000-0000-4000-8000-000000000001', 'sdr'
  )
);

SELECT isnt(
  (
    SELECT seller_id
    FROM public.seller_appointments
    WHERE id = (SELECT id FROM _departure_appointments WHERE key = 'retroactive')
  ),
  'e2000000-0000-4000-8000-000000000001'::uuid,
  'override reconcilia colaborador ja anonimizado'
);
SELECT like(
  (
    SELECT notes
    FROM public.seller_appointments
    WHERE id = (SELECT id FROM _departure_appointments WHERE key = 'retroactive')
  ),
  '%LEAD COLABORADOR QUE SAIU%',
  'reconciliacao retroativa tambem recebe a marca vermelha'
);
SELECT is(
  (SELECT (summary->>'seller_type') FROM _departure_results WHERE key = 'retroactive'),
  'sdr',
  'resumo confirma a especialidade usada na reconciliacao'
);

SELECT * FROM finish();
ROLLBACK;
