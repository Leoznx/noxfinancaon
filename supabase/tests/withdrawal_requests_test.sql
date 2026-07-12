-- Testes estruturais do sistema canônico de saque manual de comissões.
--
-- Pré-requisito: migrations até 20260719000020 aplicadas.
-- Execução local/staging:
--   supabase test db supabase/tests/withdrawal_requests_test.sql
-- ou:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/withdrawal_requests_test.sql
--
-- O arquivo não cria dados de negócio e roda dentro de uma transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(93);

-- -------------------------------------------------------------------------
-- Estrutura canônica e tipos monetários.
-- -------------------------------------------------------------------------
SELECT ok(to_regclass('public.withdrawal_requests') IS NOT NULL,
  'withdrawal_requests existe');
SELECT ok(to_regclass('public.withdrawal_commissions') IS NOT NULL,
  'withdrawal_commissions existe');
SELECT ok(to_regclass('public.financial_audit_logs') IS NOT NULL,
  'financial_audit_logs existe');
SELECT ok(to_regclass('public.commission_financial_ledger') IS NOT NULL,
  'commission_financial_ledger existe');
SELECT ok(to_regclass('public.commission_release_events') IS NOT NULL,
  'commission_release_events existe');

SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='withdrawal_requests'
    AND column_name='amount_cents' AND data_type='bigint' AND is_nullable='NO'
), 'valor bruto do saque é bigint em centavos e obrigatório');
SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='withdrawal_requests'
    AND column_name='fee_cents' AND data_type='bigint' AND column_default LIKE '%0%'
), 'taxa do saque é bigint em centavos com default zero');
SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='withdrawal_requests'
    AND column_name='net_amount_cents' AND data_type='bigint' AND is_nullable='NO'
), 'valor líquido do saque é bigint em centavos e obrigatório');
SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='comissoes'
    AND column_name='amount_cents' AND data_type='bigint' AND is_nullable='NO'
), 'valor da comissão é bigint em centavos e obrigatório');
SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='withdrawal_requests'
    AND column_name='pix_key_encrypted' AND data_type='bytea'
), 'chave Pix é armazenada cifrada em bytea');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='withdrawal_requests' AND column_name='pix_chave'
), 'coluna Pix em texto aberto foi removida');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='withdrawal_requests' AND column_name='valor_bruto'
), 'coluna decimal legada valor_bruto foi removida');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='withdrawal_requests' AND column_name='taxa_saque'
), 'coluna decimal legada taxa_saque foi removida');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='withdrawal_requests' AND column_name='valor_liquido'
), 'coluna decimal legada valor_liquido foi removida');

-- -------------------------------------------------------------------------
-- Constraints e índices que protegem saldo, estado e idempotência.
-- -------------------------------------------------------------------------
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='public.withdrawal_requests'::regclass
    AND conname='withdrawal_requests_amount_positive' AND contype='c'
), 'saque exige amount_cents positivo');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='public.withdrawal_requests'::regclass
    AND conname='withdrawal_requests_net_consistent' AND contype='c'
), 'valor líquido do saque precisa reconciliar com bruto e taxa');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='public.withdrawal_requests'::regclass
    AND conname='withdrawal_requests_status_check' AND contype='c'
), 'status do saque possui domínio canônico');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='public.withdrawal_requests'::regclass
    AND conname='withdrawal_requests_pix_type_check' AND contype='c'
), 'tipo da chave Pix possui domínio canônico');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='public.withdrawal_requests'::regclass
    AND conname='withdrawal_requests_receipt_metadata_check' AND contype='c'
), 'saque pago exige metadados íntegros do comprovante');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='public.comissoes'::regclass
    AND conname='comissoes_status_check' AND contype='c'
), 'status da comissão possui domínio canônico');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='public.commission_financial_ledger'::regclass
    AND contype='u' AND pg_get_constraintdef(oid) ILIKE '%idempotency_key%'
), 'razão financeira impede duplicidade por chave idempotente');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='public.commission_release_events'::regclass
    AND contype='u' AND pg_get_constraintdef(oid) ILIKE '%event_key%'
), 'eventos de liberação impedem processamento duplicado');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname='public' AND tablename='withdrawal_requests'
    AND indexname='withdrawal_requests_user_idempotency_uq'
    AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
), 'requisição de saque é idempotente por usuário e chave');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname='public' AND tablename='withdrawal_requests'
    AND indexname='withdrawal_requests_one_active_per_user_uq'
    AND indexdef ILIKE 'CREATE UNIQUE INDEX%WHERE%'
), 'existe no máximo um saque ativo por usuário');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname='public' AND tablename='withdrawal_commissions'
    AND indexname='withdrawal_commissions_one_active_commission_uq'
    AND indexdef ILIKE 'CREATE UNIQUE INDEX%WHERE%'
), 'uma comissão não pode estar ativa em dois saques');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname='public' AND tablename='comissoes'
    AND indexname='comissoes_source_event_uq'
    AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
), 'geração de comissão é idempotente pelo evento de origem');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.configuracoes_sistema WHERE chave='taxa_saque_brl'
), 'configuração legada de taxa fixa não existe');

-- -------------------------------------------------------------------------
-- RLS, privilégios e proteção de dados sensíveis.
-- -------------------------------------------------------------------------
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.withdrawal_requests'::regclass),
  'RLS está habilitada em withdrawal_requests');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.withdrawal_commissions'::regclass),
  'RLS está habilitada em withdrawal_commissions');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.financial_audit_logs'::regclass),
  'RLS está habilitada em financial_audit_logs');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.commission_financial_ledger'::regclass),
  'RLS está habilitada em commission_financial_ledger');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.commission_release_events'::regclass),
  'RLS está habilitada em commission_release_events');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname='public' AND tablename='withdrawal_requests'
    AND policyname='Users read own withdrawals and finance reads all' AND cmd='SELECT'
), 'saques têm policy de leitura por dono ou financeiro');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname='public' AND tablename='withdrawal_requests'
    AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
), 'cliente não possui policy de escrita direta em saques');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname='public' AND tablename='financial_audit_logs'
    AND policyname='Admins read financial audit' AND cmd='SELECT'
), 'log financeiro só possui leitura administrativa');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname='public' AND tablename='commission_release_events'
    AND policyname='Admins audit commission release events' AND cmd='SELECT'
), 'eventos de liberação só são auditáveis por administradores');

SELECT ok(NOT has_table_privilege('anon','public.withdrawal_requests','SELECT'),
  'anon não lê saques');
SELECT ok(NOT has_table_privilege('authenticated','public.withdrawal_requests','INSERT'),
  'authenticated não insere saques diretamente');
SELECT ok(NOT has_table_privilege('authenticated','public.withdrawal_requests','UPDATE'),
  'authenticated não altera saques diretamente');
SELECT ok(NOT has_table_privilege('authenticated','public.withdrawal_requests','DELETE'),
  'authenticated não apaga saques diretamente');
SELECT ok(NOT has_column_privilege('authenticated','public.withdrawal_requests','pix_key_encrypted','SELECT'),
  'ciphertext Pix não é selecionável pelo cliente');
SELECT ok(NOT has_column_privilege('authenticated','public.withdrawal_requests','receipt_path','SELECT'),
  'caminho privado do comprovante não é selecionável pelo cliente');
SELECT ok(NOT has_column_privilege('authenticated','public.withdrawal_requests','internal_notes','SELECT'),
  'observações internas não são selecionáveis pelo cliente');

SELECT ok(NOT has_table_privilege('anon','public.apolices','INSERT'),
  'anon não pode forjar apólice');
SELECT ok(NOT has_table_privilege('anon','public.apolices','UPDATE'),
  'anon não pode alterar status de apólice');
SELECT ok(NOT has_table_privilege('anon','public.mensalidades','INSERT'),
  'anon não pode forjar mensalidade');
SELECT ok(NOT has_table_privilege('anon','public.mensalidades','UPDATE'),
  'anon não pode marcar mensalidade como paga');
SELECT ok(NOT has_table_privilege('authenticated','public.comissoes','INSERT'),
  'authenticated não cria comissões diretamente');
SELECT ok(NOT has_table_privilege('authenticated','public.comissoes','UPDATE'),
  'authenticated não muda saldo/status de comissão diretamente');

SELECT ok(NOT has_schema_privilege('authenticated','private','USAGE'),
  'schema private não é acessível ao authenticated');
SELECT ok(NOT has_schema_privilege('anon','private','USAGE'),
  'schema private não é acessível ao anon');
SELECT ok(NOT has_table_privilege('authenticated','private.withdrawal_crypto_secrets','SELECT'),
  'segredo criptográfico não é legível pelo authenticated');

-- -------------------------------------------------------------------------
-- Views de compatibilidade não expõem segredo nem permitem bypass de RLS.
-- -------------------------------------------------------------------------
SELECT ok(EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='saldos_comissao' AND c.relkind='v'
    AND coalesce(c.reloptions, ARRAY[]::text[]) @> ARRAY['security_invoker=true']
), 'saldos_comissao é view security_invoker');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='solicitacoes_saque' AND c.relkind='v'
    AND coalesce(c.reloptions, ARRAY[]::text[]) @> ARRAY['security_invoker=true']
), 'compatibilidade solicitacoes_saque é view security_invoker');
SELECT ok(position('pix_key_encrypted' IN pg_get_viewdef('public.solicitacoes_saque'::regclass, true))=0,
  'view legada não expõe ciphertext Pix');
SELECT ok(position('receipt_path' IN pg_get_viewdef('public.solicitacoes_saque'::regclass, true))=0,
  'view legada não expõe caminho do comprovante');

-- -------------------------------------------------------------------------
-- RPCs: presença, SECURITY DEFINER e superfície de execução.
-- -------------------------------------------------------------------------
SELECT ok(to_regprocedure('public.request_withdrawal(text,text,text,text,uuid)') IS NOT NULL,
  'RPC request_withdrawal existe');
SELECT ok(to_regprocedure('public.approve_withdrawal(uuid)') IS NOT NULL,
  'RPC approve_withdrawal existe');
SELECT ok(to_regprocedure('public.reject_withdrawal(uuid,text)') IS NOT NULL,
  'RPC reject_withdrawal existe');
SELECT ok(to_regprocedure('public.mark_withdrawal_as_paid(uuid,text,text,text,bigint,text,text)') IS NOT NULL,
  'RPC mark_withdrawal_as_paid existe');
SELECT ok(to_regprocedure('public.reveal_withdrawal_pix(uuid)') IS NOT NULL,
  'RPC reveal_withdrawal_pix existe');
SELECT ok(to_regprocedure('public.authorize_withdrawal_receipt(uuid,text)') IS NOT NULL,
  'RPC authorize_withdrawal_receipt existe');
SELECT ok(to_regprocedure('public.get_finance_dashboard_summary()') IS NOT NULL,
  'RPC de resumo financeiro existe');
SELECT ok(to_regprocedure('public.list_finance_withdrawals(text,text,date,date,text,uuid,text,bigint,bigint)') IS NOT NULL,
  'RPC de listagem financeira filtrável existe');
SELECT ok(to_regprocedure('public.generate_commissions_for_policy(uuid,text,boolean)') IS NOT NULL,
  'geração backend de comissões existe');
SELECT ok(to_regprocedure('public.release_commissions_for_invoice(uuid,text)') IS NOT NULL,
  'liberação backend por fatura existe');

SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid='public.request_withdrawal(text,text,text,text,uuid)'::regprocedure),
  'request_withdrawal é SECURITY DEFINER');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid='public.mark_withdrawal_as_paid(uuid,text,text,text,bigint,text,text)'::regprocedure),
  'mark_withdrawal_as_paid é SECURITY DEFINER');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid='public.release_commissions_for_invoice(uuid,text)'::regprocedure),
  'release_commissions_for_invoice é SECURITY DEFINER');
SELECT ok(has_function_privilege('authenticated','public.request_withdrawal(text,text,text,text,uuid)','EXECUTE'),
  'authenticated pode pedir saque apenas pela RPC');
SELECT ok(NOT has_function_privilege('authenticated','public.release_commissions_for_invoice(uuid,text)','EXECUTE'),
  'authenticated não libera comissão por evento de fatura');
SELECT ok(has_function_privilege('service_role','public.release_commissions_for_invoice(uuid,text)','EXECUTE'),
  'service_role pode processar evento idempotente de fatura');
SELECT ok(NOT has_function_privilege('authenticated','private.decrypt_withdrawal_pix(bytea,integer)','EXECUTE'),
  'authenticated não chama decrypt Pix diretamente');
SELECT ok(NOT EXISTS (
  SELECT 1
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  WHERE p.oid='public.request_withdrawal(text,text,text,text,uuid)'::regprocedure
    AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
), 'PUBLIC não executa request_withdrawal');

-- -------------------------------------------------------------------------
-- Bucket e acesso a comprovantes.
-- -------------------------------------------------------------------------
SELECT ok(EXISTS (
  SELECT 1 FROM storage.buckets b
  WHERE b.id='withdrawal-receipts' AND b.name='withdrawal-receipts'
    AND b.public=false AND b.file_size_limit=10485760
), 'bucket de comprovantes é privado e limitado a 10 MB');
SELECT ok((
  SELECT allowed_mime_types @> ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[]
     AND allowed_mime_types <@ ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[]
  FROM storage.buckets WHERE id='withdrawal-receipts'
), 'bucket aceita somente os MIME types previstos');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects'
    AND policyname IN (
      'Anyone authenticated can view proofs', 'Admins can upload proofs',
      'withdrawal_receipts_read', 'withdrawal_receipts_insert',
      'withdrawal_receipts_update', 'withdrawal_receipts_delete'
    )
), 'não há policy legada de acesso direto aos comprovantes');

-- -------------------------------------------------------------------------
-- Triggers e eventos financeiros do backend.
-- -------------------------------------------------------------------------
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid='public.withdrawal_requests'::regclass
    AND tgname='enforce_withdrawal_status_transition' AND NOT tgisinternal AND tgenabled<>'D'
), 'trigger bloqueia transições inválidas de saque');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid='public.apolices'::regclass
    AND tgname='apolice_ativada_calcular_comissoes' AND NOT tgisinternal AND tgenabled<>'D'
), 'ativação de apólice gera comissão pelo backend');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid='public.faturas_inquilino'::regclass
    AND tgname='external_commission_invoice_status' AND NOT tgisinternal AND tgenabled<>'D'
), 'mudança de fatura externa aciona liberação de comissão');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid='public.mensalidades'::regclass
    AND tgname='external_commission_mensalidade_status' AND NOT tgisinternal AND tgenabled<>'D'
), 'mensalidade legada mantém ponte idempotente');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='withdrawal_requests'
), 'saques estão publicados no Realtime');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='comissoes'
), 'comissões estão publicadas no Realtime');
SELECT ok(position('confirmed' IN lower(pg_get_functiondef('private.has_qualifying_first_payment(uuid)'::regprocedure)))=0,
  'PAYMENT_CONFIRMED não libera comissão como pagamento liquidado');
SELECT ok(position('numero_parcela = 1' IN lower(pg_get_functiondef('private.has_qualifying_first_payment(uuid)'::regprocedure)))>0,
  'somente a primeira parcela qualifica a liberação');

-- -------------------------------------------------------------------------
-- Validação server-side de Pix (regressões de formato e dígitos verificadores).
-- -------------------------------------------------------------------------
SELECT ok(public.is_valid_cpf('529.982.247-25'), 'CPF válido é aceito');
SELECT ok(NOT public.is_valid_cpf('111.111.111-11'), 'CPF repetitivo é recusado');
SELECT ok(public.is_valid_cnpj('11.222.333/0001-81'), 'CNPJ válido é aceito');
SELECT ok(NOT public.is_valid_cnpj('11.111.111/1111-11'), 'CNPJ inválido é recusado');
SELECT ok(public.is_valid_pix_key('EMAIL','financeiro@noxfianca.com.br'), 'Pix por e-mail válido é aceito');
SELECT ok(public.is_valid_pix_key('PHONE','11987654321'), 'Pix por telefone válido é aceito');
SELECT ok(public.is_valid_pix_key('RANDOM','123e4567-e89b-42d3-a456-426614174000'),
  'Pix por chave aleatória UUID válida é aceito');
SELECT ok(NOT public.is_valid_pix_key('RANDOM','chave-livre-invalida'),
  'chave aleatória fora do padrão é recusada');

SELECT * FROM finish();
ROLLBACK;
