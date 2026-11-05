BEGIN;
SELECT plan(16);

SELECT has_table(
  'public',
  'platform_user_activity',
  'atividade compartilhada entre site e aplicativo existe'
);
SELECT has_table(
  'public',
  'whatsapp_contract_automation_settings',
  'configuração das automações contratuais existe'
);
SELECT has_table(
  'public',
  'whatsapp_contract_automation_jobs',
  'fila durável das automações contratuais existe'
);

SELECT has_column(
  'public',
  'whatsapp_contract_automation_jobs',
  'score_document_provider_message_id',
  'envio do PDF de score possui auditoria própria'
);
SELECT has_column(
  'public',
  'whatsapp_contract_automation_jobs',
  'commitment_document_provider_message_id',
  'envio do PDF de compromisso possui auditoria própria'
);
SELECT has_column(
  'public',
  'whatsapp_contract_automation_jobs',
  'action_provider_message_id',
  'mensagem decisória possui id verificável'
);

SELECT has_function('public', 'record_platform_activity', ARRAY['text']);
SELECT has_function(
  'public',
  'claim_whatsapp_contract_automation_jobs',
  ARRAY['integer', 'timestamp with time zone']
);
SELECT has_function(
  'public',
  'resolve_admin_credit_review',
  ARRAY['uuid', 'text', 'text']
);
SELECT has_function(
  'public',
  'resolve_admin_credit_review_via_whatsapp',
  ARRAY['uuid', 'text', 'text', 'text', 'text']
);

SELECT function_privs_are(
  'public',
  'resolve_admin_credit_review',
  ARRAY['uuid', 'text', 'text'],
  'authenticated',
  ARRAY['EXECUTE'],
  'painéis autenticados podem resolver a análise pela RPC protegida'
);
SELECT function_privs_are(
  'public',
  'resolve_admin_credit_review_via_whatsapp',
  ARRAY['uuid', 'text', 'text', 'text', 'text'],
  'service_role',
  ARRAY['EXECUTE'],
  'somente o backend pode encaminhar a decisão recebida no WhatsApp'
);

SELECT has_trigger(
  'public',
  'consultas_credito',
  'enqueue_credit_review_whatsapp_automation_trigger',
  'envio dos documentos cria a automação de revisão'
);
SELECT like(
  pg_get_functiondef('public.enqueue_credit_review_whatsapp_automation()'::regprocedure),
  '%documentacao_complementar_enviada%',
  'fila administrativa nasce apenas na etapa documental correta'
);
SELECT like(
  pg_get_functiondef(
    'public.resolve_admin_credit_review_via_whatsapp(uuid,text,text,text,text)'::regprocedure
  ),
  '%p_reference_message_id IS DISTINCT FROM v_job.action_provider_message_id%',
  'decisão exige referência à mensagem de botões emitida pela NOX'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'whatsapp-contratos-nox'
      AND schedule = '*/2 * * * *'
  ),
  'processador das automações roda a cada dois minutos'
);

SELECT * FROM finish();
ROLLBACK;
