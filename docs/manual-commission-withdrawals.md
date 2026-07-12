# Saque manual de comissões

Este documento descreve a implementação canônica de saque manual de comissões da NOX Fiança. O fluxo calcula e reserva o saldo no banco, exige revisão humana e comprovante para concluir o pagamento, mas **não realiza transferência Pix automática**. O Asaas continua sendo autoridade apenas para pagamentos recebidos de inquilinos.

## Escopo e invariantes

As seguintes regras são obrigatórias em todos os ambientes:

- valores monetários persistidos pelo novo fluxo usam `bigint` em centavos;
- o frontend informa intenção e dados bancários, nunca o valor, a taxa ou o status do saque;
- o servidor recalcula o saldo elegível e reserva exatamente as comissões vinculadas;
- cada usuário pode ter no máximo um saque ativo;
- uma comissão pode pertencer a no máximo um saque ativo;
- saques novos têm taxa zero: `fee_cents = 0` e `net_amount_cents = amount_cents`;
- apenas a primeira parcela efetivamente recebida (`paid`, `pago`, `received` ou `paid_via_consolidated`) libera uma comissão;
- `PAYMENT_CONFIRMED` não é tratado como liquidação financeira;
- um saque somente chega a `PAID` com comprovante privado válido e metadados consistentes;
- a chave Pix completa nunca é retornada por consultas comuns nem gravada em logs;
- nenhuma RPC ou Edge Function deste módulo cria transferência de saída no Asaas.

## Componentes

| Camada | Componente | Responsabilidade |
| --- | --- | --- |
| Banco | `withdrawal_requests` | Registro canônico da solicitação, dados bancários protegidos, estado e metadados do comprovante |
| Banco | `withdrawal_commissions` | Snapshot das comissões e contratos reservados para cada saque |
| Banco | `comissoes` | Saldo por comissão nos estados canônicos |
| Banco | `commission_financial_ledger` | Razão imutável/idempotente de criação, liberação, reserva, pagamento e ajustes |
| Banco | `financial_audit_logs` | Trilha de ações humanas e automáticas, incluindo revelação Pix e acesso a comprovante |
| Banco | `commission_release_events` | Deduplicação dos eventos que liberam comissões após o recebimento da primeira parcela |
| Banco | RPCs públicas protegidas | Intenções transacionais e consultas filtradas por usuário/papel |
| Banco | Funções `private` | Criptografia, notificações, auditoria e avaliação de risco financeiro |
| Storage | bucket `withdrawal-receipts` | Comprovantes privados, até 10 MB, sem policy de acesso direto |
| Edge | `mark-withdrawal-paid` | Valida JWT, origem, arquivo e confirmação; faz upload e conclui a transação no banco |
| Edge | `withdrawal-receipt-url` | Autoriza acesso no banco e emite URL assinada por 300 segundos |
| Edge/Asaas | `asaas-webhook` e `asaas-get-payment` | Sincronizam faturas recebidas e acionam a liberação idempotente de comissões |
| Frontend | área do beneficiário | Exibe saldos reais, contratos, comissões e saques; envia a solicitação por RPC |
| Frontend | Financeiro/Admin | Revisa, aprova, recusa, revela Pix de modo auditado e registra o pagamento manual |

### Fluxo de dados

```text
Ativação válida da apólice
  -> generate_commissions_for_policy
  -> comissão PENDING + ledger/auditoria

Primeira parcela recebida pelo Asaas
  -> faturas_inquilino
  -> release_commissions_for_invoice
  -> commission_release_events (idempotência)
  -> comissão AVAILABLE + ledger/auditoria/notificação

Beneficiário solicita saque
  -> request_withdrawal
  -> lock do usuário e das comissões
  -> withdrawal_requests PENDING_REVIEW
  -> snapshots em withdrawal_commissions
  -> comissões RESERVED + ledger/auditoria/notificação

Financeiro aprova
  -> approve_withdrawal
  -> revalidação de todos os contratos
  -> AWAITING_PAYMENT ou MANUAL_REVIEW

Financeiro realiza o Pix fora do sistema e anexa comprovante
  -> mark-withdrawal-paid (Edge)
  -> validação de extensão, MIME, assinatura binária, tamanho e SHA-256
  -> upload privado
  -> mark_withdrawal_as_paid (RPC transacional)
  -> saque PAID + comissões PAID + ledger/auditoria/notificação

Usuário ou equipe autorizada abre comprovante
  -> withdrawal-receipt-url
  -> authorize_withdrawal_receipt
  -> auditoria de view/download
  -> URL assinada com validade de 5 minutos
```

## Estados

### Solicitação de saque

| Estado | Significado | Entradas normais | Saídas permitidas |
| --- | --- | --- | --- |
| `PENDING_REVIEW` | Solicitação criada e saldo reservado | `request_withdrawal` | `AWAITING_PAYMENT`, `REJECTED`, `CANCELLED`, `MANUAL_REVIEW`; `APPROVED` é aceito apenas como compatibilidade |
| `APPROVED` | Estado intermediário legado | migração/compatibilidade | `AWAITING_PAYMENT`, `REJECTED`, `CANCELLED`, `MANUAL_REVIEW` |
| `AWAITING_PAYMENT` | Revisão aprovada; pagamento manual ainda não confirmado | `approve_withdrawal` | `PAID`, `REJECTED`, `CANCELLED`, `MANUAL_REVIEW` |
| `MANUAL_REVIEW` | Existe divergência de contrato, saldo ou cadastro legado | validação financeira, risco ou migração | `PENDING_REVIEW`, `APPROVED`, `AWAITING_PAYMENT`, `REJECTED`, `CANCELLED` |
| `PAID` | Pagamento manual confirmado com comprovante | `mark_withdrawal_as_paid` | terminal |
| `REJECTED` | Solicitação recusada com motivo; reserva liberada/revertida | `reject_withdrawal` | terminal |
| `CANCELLED` | Solicitação encerrada sem pagamento | reconciliação/ação administrativa controlada | terminal |

O trigger `enforce_withdrawal_status_transition` rejeita qualquer transição fora dessa matriz. As RPCs ainda conferem o estado sob `FOR UPDATE`, portanto a proteção não depende apenas do trigger.

### Comissão

| Estado | Significado | Próximo estado esperado |
| --- | --- | --- |
| `PENDING` | Gerada pela ativação da apólice; aguarda primeira parcela recebida | `AVAILABLE`, `MANUAL_REVIEW` ou `REVERSED` |
| `AVAILABLE` | Elegível para saque | `RESERVED`, `MANUAL_REVIEW` ou `REVERSED` |
| `RESERVED` | Vinculada a um saque ativo | `PAID`, `AVAILABLE`, `MANUAL_REVIEW` ou `REVERSED` |
| `MANUAL_REVIEW` | Contrato/saldo exige análise humana | `RESERVED`, `AVAILABLE` ou `REVERSED` conforme a decisão |
| `PAID` | Incluída em saque pago | preservado; risco posterior gera `ADJUSTMENT_REQUIRED` no ledger |
| `REVERSED` | Comissão não paga estornada por cancelamento/risco | terminal para o saldo corrente |

Um cancelamento ou chargeback antes do pagamento envia saques ativos para revisão e pode reverter comissões não pagas. Se o saque já estiver pago, o histórico e o comprovante são preservados; o sistema registra um lançamento negativo `ADJUSTMENT_REQUIRED` para tratamento financeiro posterior.

## Permissões

As decisões usam `can_manage_withdrawals`, `can_audit_withdrawals` e as permissões internas dos módulos `financeiro`/`saques`. A tabela resume o comportamento esperado:

| Ator | Ler próprios dados | Solicitar | Ler todos | Aprovar/recusar | Marcar pago | Revelar Pix | Abrir comprovante | Ler auditoria bruta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `corretor`, `imobiliaria`, `proprietario` autenticado | sim | sim | não | não | não | não; recebe só máscara | somente o próprio e pago | não |
| `financeiro` autorizado e ativo | não se aplica | não | sim | sim, quando `can_approve` é exigido pelo cadastro interno | sim | sim, com evento auditado | sim | não pela policy administrativa |
| `admin` / `admin_master` | sim | não | sim | sim | sim | sim, com evento auditado | sim | sim |
| `analista`, demais perfis ou usuário bloqueado | apenas o que outras policies do produto permitirem | não | não | não | não | não | não | não |
| `service_role` | backend | não | backend | backend | somente por fluxos internos | funções privadas | upload/assinatura | backend |

O papel `authenticated` não possui `INSERT`, `UPDATE` ou `DELETE` direto em `withdrawal_requests` ou `comissoes`. `anon` perdeu os privilégios que permitiam forjar apólices/mensalidades e, por consequência, liberar saldo.

## Segurança e privacidade

### Chave Pix

- A chave é normalizada e validada no cliente por conveniência e novamente no PostgreSQL por segurança.
- CPF e CNPJ têm validação de dígitos; e-mail, telefone e UUID aleatório têm formato restrito.
- O valor normalizado é cifrado com `pgcrypto`/AES-256 em `pix_key_encrypted`.
- A chave simétrica versionada fica em `private.withdrawal_crypto_secrets`; os papéis `anon` e `authenticated` não têm `USAGE` no schema nem leitura da tabela.
- Consultas comuns retornam apenas `pix_key_masked`.
- `reveal_withdrawal_pix` exige permissão de gestão e registra `PIX_KEY_REVEALED` em `financial_audit_logs`.
- Não registrar chave completa, JWT, `SUPABASE_SERVICE_ROLE_KEY` ou conteúdo do comprovante em logs de aplicação.

A chave criptográfica do banco faz parte do backup crítico. Excluir `private.withdrawal_crypto_secrets` torna as chaves Pix existentes irrecuperáveis.

### Comprovante

- bucket: `withdrawal-receipts`;
- visibilidade: privada;
- tamanho máximo: 10 MiB;
- formatos: PDF, JPEG, PNG e WebP;
- caminho gerado: `{user_id}/{withdrawal_id}/{uuid}.{ext}`;
- validações: extensão, MIME declarado, magic bytes, tamanho real e SHA-256;
- upload sempre com `upsert: false`;
- se a RPC final falhar, a Edge Function remove o objeto recém-enviado;
- não há policy de leitura/escrita direta para clientes;
- acesso ocorre por URL assinada de 300 segundos e é auditado como visualização ou download.

### Concorrência e idempotência

- `request_withdrawal` usa advisory lock por usuário, `FOR UPDATE` nas comissões e índice único do saque ativo;
- `(user_id, idempotency_key)` permite repetir com segurança a mesma requisição;
- `withdrawal_commissions_one_active_commission_uq` impede dupla reserva;
- aprovação, recusa e pagamento travam o saque e conferem o estado corrente;
- `source_event_key`, `commission_release_events.event_key` e `commission_financial_ledger.idempotency_key` deduplicam eventos do backend;
- um segundo envio de pagamento só é idempotente quando o SHA-256 coincide com o comprovante já registrado.

## Variáveis e configuração

### Frontend/SSR

| Variável | Uso | Exposição |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | URL pública do Supabase no navegador | pública |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | chave publishable/anon no navegador | pública |
| `VITE_SUPABASE_PROJECT_ID` | referência do projeto | pública |
| `SUPABASE_URL` | URL usada no SSR | servidor |
| `SUPABASE_PUBLISHABLE_KEY` | chave pública usada no SSR | servidor |
| `SUPABASE_SERVICE_ROLE_KEY` | operações estritamente server-side já existentes | secreta; nunca usar prefixo `VITE_` |

### Supabase Edge Functions

| Variável | Obrigatória | Observação |
| --- | --- | --- |
| `SUPABASE_URL` | sim | disponibilizada pelo runtime Supabase |
| `SUPABASE_ANON_KEY` | sim | disponibilizada pelo runtime; usada para RPC com o JWT do usuário |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | disponibilizada pelo runtime; usada apenas no Storage/Auth administrativo |
| `ALLOWED_ORIGINS` | recomendada | lista exata separada por vírgulas, sem curingas; tem precedência sobre `FRONTEND_URL` |
| `FRONTEND_URL` | alternativa | fallback de origem quando `ALLOWED_ORIGINS` não é definido |
| `ASAAS_WEBHOOK_TOKEN` | sim no webhook | valida a origem do webhook Asaas |
| `ASAAS_API_KEY` | sim nas funções Asaas que consultam a API | segredo do gateway de recebimentos |

Em desenvolvimento, a ausência de `ALLOWED_ORIGINS` e `FRONTEND_URL` usa `http://localhost:8080`. Em produção, defina explicitamente todos os domínios autorizados. `mark-withdrawal-paid`, `withdrawal-receipt-url` e `calcular-comissoes-contrato` têm `verify_jwt = true` em `supabase/config.toml`.

## Implantação

### Pré-implantação

1. Use staging com cópia anonimizada e aplique todas as migrations do repositório.
2. Execute o teste pgTAP deste módulo e os testes TypeScript descritos abaixo.
3. Crie um backup recuperável/PITR imediatamente antes da janela. Inclua `public`, `private.withdrawal_crypto_secrets`, metadados de `storage` e os objetos existentes.
4. Registre o timestamp do backup, a versão do frontend/Edge Functions e o conjunto de migrations aplicado.
5. Coloque somente as ações de saque em manutenção durante a troca; recebimentos Asaas devem continuar sendo registrados ou ficar em fila para replay.
6. Confirme que `ALLOWED_ORIGINS` contém os domínios exatos de produção e que o token do webhook Asaas está configurado.

### Ordem obrigatória

1. **Banco — schema e segurança:** `20260719000000_manual_withdrawals_schema.sql`.
2. **Banco — RPCs transacionais:** `20260719000010_manual_withdrawals_rpcs.sql`.
3. **Banco — geração/liberação por eventos:** `20260719000020_commission_backend_events.sql`.
4. **Edge Functions de saque:** `mark-withdrawal-paid` e `withdrawal-receipt-url`.
5. **Edge Functions que chamam as novas RPCs:** `asaas-webhook`, `asaas-get-payment` e `calcular-comissoes-contrato`; publique também `asaas-create-installment-plan` quando o mesmo pacote contiver a correção de vínculo da apólice.
6. **Frontend:** publique as telas do beneficiário e do Financeiro/Admin.
7. **Validação de produção:** execute os smoke tests sem usar valores reais e, só depois, libere as ações de saque.

Com o projeto já vinculado à CLI, a sequência operacional é:

```bash
supabase migration list
supabase db push
supabase functions deploy mark-withdrawal-paid
supabase functions deploy withdrawal-receipt-url
supabase functions deploy asaas-webhook
supabase functions deploy asaas-get-payment
supabase functions deploy calcular-comissoes-contrato
supabase functions deploy asaas-create-installment-plan
npm run build
```

Não publique as funções Asaas atualizadas antes de `release_commissions_for_invoice` existir. Não publique o frontend novo antes das RPCs e Edge Functions.

## Validação

### Automatizada

```bash
npm run test:withdrawals
supabase test db supabase/tests/withdrawal_requests_test.sql
npm run build
```

O teste SQL verifica 93 invariantes: tabelas, tipos em centavos, remoção de plaintext, constraints, índices idempotentes, RLS, privilégios, RPCs, bucket privado, triggers, Realtime e validação Pix.

### Smoke tests em staging/produção

1. Prepare um beneficiário de teste com uma comissão `AVAILABLE` proveniente de um contrato válido.
2. Solicite o saque e confirme que o valor foi calculado no servidor, o saque ficou `PENDING_REVIEW`, as comissões ficaram `RESERVED` e a soma dos snapshots é exatamente o valor do saque.
3. Repita a mesma chamada com a mesma chave idempotente; deve retornar o mesmo saque. Tente uma segunda chave enquanto o saque estiver ativo; deve retornar `ACTIVE_WITHDRAWAL_EXISTS`.
4. Recuse um saque com motivo; confirme `REJECTED`, vínculos inativos, saldo liberado/revertido, ledger, auditoria e notificação.
5. Em outro saque, aprove com todos os contratos regulares; confirme `AWAITING_PAYMENT`. Simule contrato vencido/cancelado e confirme `MANUAL_REVIEW` sem permitir pagamento.
6. Tente comprovante vazio, acima de 10 MiB, extensão/MIME divergentes e conteúdo com magic bytes inválidos; todos devem falhar sem marcar o saque como pago.
7. Anexe arquivo válido após realizar o Pix manual; confirme `PAID`, comissões `PAID`, vínculo inativo, SHA-256, ledger e notificação.
8. Verifique que o objeto não possui URL pública. Abra como dono e como Financeiro/Admin; a URL deve expirar em 300 segundos. Um terceiro usuário deve receber acesso negado.
9. Reenvie o mesmo evento de primeira parcela recebida; `commission_release_events` deve impedir nova liberação. Um evento `PAYMENT_CONFIRMED` isolado não deve liberar a comissão.
10. Teste chargeback/cancelamento antes e depois do saque pago; antes deve revisar/reverter saldo, depois deve preservar o pagamento e criar `ADJUSTMENT_REQUIRED`.

### Consultas de reconciliação

As consultas abaixo não exibem chave Pix nem caminho de comprovante.

```sql
-- Saques ativos cujo valor não bate com os snapshots ativos.
SELECT w.id, w.status, w.amount_cents,
       coalesce(sum(wc.amount_cents) FILTER (WHERE wc.active), 0) AS linked_cents
FROM public.withdrawal_requests w
LEFT JOIN public.withdrawal_commissions wc ON wc.withdrawal_id = w.id
WHERE w.status IN ('PENDING_REVIEW','APPROVED','AWAITING_PAYMENT','MANUAL_REVIEW')
GROUP BY w.id
HAVING coalesce(sum(wc.amount_cents) FILTER (WHERE wc.active), 0) <> w.amount_cents;

-- Comissões reservadas sem um vínculo ativo correspondente.
SELECT c.id, c.beneficiario_id, c.contrato_id, c.status
FROM public.comissoes c
WHERE c.status IN ('RESERVED','MANUAL_REVIEW')
  AND NOT EXISTS (
    SELECT 1 FROM public.withdrawal_commissions wc
    WHERE wc.commission_id = c.id AND wc.active
  );

-- A constraint deveria tornar este resultado sempre vazio.
SELECT id, status, paid_at, paid_by, receipt_file_name, receipt_mime_type, receipt_size_bytes
FROM public.withdrawal_requests
WHERE status='PAID'
  AND (paid_at IS NULL OR paid_by IS NULL OR receipt_file_name IS NULL
       OR receipt_mime_type IS NULL OR receipt_size_bytes IS NULL);

-- Filas operacionais por idade.
SELECT status, count(*) AS quantidade, min(requested_at) AS mais_antigo
FROM public.withdrawal_requests
WHERE status IN ('PENDING_REVIEW','AWAITING_PAYMENT','MANUAL_REVIEW')
GROUP BY status ORDER BY status;
```

Todas as consultas operacionais devem rodar com uma conta administrativa controlada, nunca com a service role em uma estação compartilhada.

## Observabilidade

Monitore continuamente:

- idade do item mais antigo em `PENDING_REVIEW`, `AWAITING_PAYMENT` e `MANUAL_REVIEW`;
- quantidade e valor por estado, sempre em centavos;
- divergências das consultas de reconciliação acima;
- taxa de respostas `4xx`/`5xx` das duas Edge Functions de saque;
- logs seguros com os códigos `receipt_upload_failed`, `mark_paid_failed`, `withdrawal_conflict`, `signed_url_failed` e `receipt_access_denied`;
- crescimento de `commission_release_events` e repetição esperada dos webhooks idempotentes;
- entradas `ADJUSTMENT_REQUIRED` ainda não reconciliadas;
- falhas/atraso dos webhooks Asaas e diferença entre eventos recebidos e faturas atualizadas;
- objetos do bucket sem referência em `withdrawal_requests`, investigando antes de qualquer remoção.

As fontes de auditoria são:

- `financial_audit_logs`: criação, reserva, aprovação, recusa, revisão, pagamento, revelação Pix e acesso ao comprovante;
- `commission_financial_ledger`: efeito financeiro idempotente;
- `commission_release_events`: processamento/ignorância de eventos externos;
- `notificacoes`: comunicação para beneficiários e equipe;
- logs das Edge Functions: apenas operação, código seguro e UUID do saque validado.

Alertas recomendados: item em `PENDING_REVIEW` acima do SLA interno, item em `AWAITING_PAYMENT` acima do prazo de pagamento, qualquer linha de reconciliação, aumento de `MANUAL_REVIEW`, erro de upload/assinatura e webhook Asaas sem processamento correspondente.

## Rollback e recuperação

Estas migrations transformam dados legados, cifram a chave Pix e removem colunas plaintext. Por isso, o rollback preferencial é **corrigir para frente**, sem recriar escrita direta ou restaurar a chave Pix aberta.

### Falha apenas no frontend ou Edge Functions

1. Desabilite temporariamente os botões de solicitar/aprovar/pagar.
2. Restaure a versão anterior do frontend/Edge que não depende do componente com falha, mantendo o banco novo.
3. Não reative o formulário legado de escrita direta; a view `solicitacoes_saque` é somente leitura por desenho.
4. Preserve o bucket privado e todos os registros novos.
5. Publique a correção e repita testes automatizados, reconciliação e smoke tests antes de reabrir o fluxo.

### Falha durante a sequência de migrations

Cada arquivo é aplicado como uma unidade, mas os três arquivos são dependentes. Se o schema aplicar e uma etapa posterior falhar:

1. mantenha ações de saque em manutenção;
2. não implante frontend/Edge novos nem restaure policies inseguras;
3. identifique o erro e aplique uma migration corretiva posterior;
4. execute o teste estrutural e as consultas de reconciliação;
5. se não houver correção segura dentro da janela, restaure o backup/PITR completo em ambiente isolado, valide a consistência e só então faça a troca controlada.

### Necessidade de restauração total

1. Interrompa as ações de saque e preserve os logs da janela.
2. Registre o último webhook Asaas processado e mantenha eventos posteriores disponíveis para replay/reconciliação.
3. Restaure o snapshot/PITR anterior às migrations, incluindo o schema `private` e Storage.
4. Se o Storage não fizer parte do mesmo ponto de restauração, não apague objetos: inventarie os órfãos e reconcilie por UUID/SHA-256 após recuperar o banco.
5. Reimplante uma versão compatível com o banco restaurado, mantendo o fluxo legado de saque desabilitado porque ele permitia escrita insegura.
6. Reprocesse/sincronize recebimentos Asaas ocorridos após o ponto restaurado e valide que nenhuma comissão foi liberada duas vezes.
7. Execute testes, reconciliação de saldo, amostragem de auditoria e somente então reabra o serviço.

Nunca faça rollback seletivo apagando `withdrawal_requests`, `withdrawal_commissions`, o ledger, auditoria, comprovantes ou `private.withdrawal_crypto_secrets`. Nunca marque saques pagos de volta como disponíveis; qualquer correção pós-pagamento deve ser um lançamento compensatório auditável.

## Referência de implementação

- `supabase/migrations/20260719000000_manual_withdrawals_schema.sql`: schema, migração legada, criptografia, RLS, views, constraints e bucket.
- `supabase/migrations/20260719000010_manual_withdrawals_rpcs.sql`: validação Pix, transações, consultas, autorização e auditoria.
- `supabase/migrations/20260719000020_commission_backend_events.sql`: geração/liberação idempotente, risco e triggers do backend.
- `supabase/functions/_shared/withdrawals.ts`: autenticação, CORS, validação binária, hash e paths seguros.
- `supabase/functions/mark-withdrawal-paid/index.ts`: upload privado e conclusão atômica.
- `supabase/functions/withdrawal-receipt-url/index.ts`: autorização e URL assinada.
- `supabase/tests/withdrawal_requests_test.sql`: contrato estrutural pgTAP do módulo.
