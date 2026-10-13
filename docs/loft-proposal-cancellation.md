# Cancelamento programado de propostas Loft

Imediatamente antes de cada envio de uma simulação da NOX, o worker prepara um job para
cancelar a proposta que aquele clique criar 30 minutos depois. O modo padrão é `portal`: ele
reutiliza a sessão autenticada do Playwright, abre a lista de propostas da Loft, localiza a
linha correta, abre **Ações → Cancelar proposta**, seleciona o motivo configurado (ou a
primeira opção real disponível se a Loft tiver mudado a lista) e confirma.

O modo `api` continua disponível como alternativa somente quando a Loft fornecer e homologar
credenciais OAuth para esse contrato. A Vercel hospeda o site, mas não executa este worker nem o
Playwright; o cancelamento roda no mesmo serviço Docker da automação na VPS.

## Garantias operacionais

- O prazo é contado a partir do clique que realmente enviou a simulação, não da leitura
  posterior do resultado. O timestamp original segue na confirmação idempotente mesmo se o
  Supabase só responder em uma retentativa.
- A fila é append-only para a identidade dos envios: imediatamente antes de cada clique, o
  worker cria um `submission_token` próprio e acrescenta um job em `prepared`. Quando o clique
  retorna, uma segunda RPC idempotente muda o job para `scheduled` e inicia os 30 minutos.
  Repetir o mesmo token é idempotente; uma recuperação que faz outro envio cria outro job,
  sem sobrescrever a proposta anterior. O status e as tentativas atualizam apenas a linha
  daquele envio.
- Quando o resultado informa o identificador da proposta, ele é anexado uma única vez ao job.
  Uma tentativa de trocar esse identificador é rejeitada.
- Antes do clique, o worker guarda no job um snapshot dos IDs que já existem para aquele
  CPF/CNPJ, como veto adicional e para auditoria. Um ID que já constava nesse snapshot é
  rejeitado. O cancelamento nunca escolhe uma linha por
  CPF/CNPJ: ele exige o ID exato devolvido pela resposta do próprio envio. O observer também
  reconhece o campo `id` usado pelo BFF atual da Loft. Se esse ID não for capturado, a fila
  falha fechada e novos envios aguardam reconciliação; nenhuma proposta é alterada por
  aproximação.
- Antes de abrir o menu e antes de confirmar, o worker relê a linha e valida novamente o
  identificador e, quando disponível, o documento. Redirecionamento para outro host, ausência de correspondência
  exata ou confirmação sem evidência de sucesso falham de forma fechada.
- Se a Loft concluir o cancelamento mas a confirmação visual falhar, a retentativa procura o
  mesmo ID também na aba **Canceladas** e encerra de forma idempotente; nunca troca para outra
  linha do mesmo CPF/CNPJ.
- A fila usa um lease de 10 minutos para impedir que dois workers processem o mesmo job durante
  navegação, login e confirmação. Falhas retornam com espera progressiva; depois de 12
  tentativas o item fica como `failed` e gera incidente.
- Se a RPC de preparação perder a resposta antes do clique, o worker grava um tombstone
  `aborted` com o mesmo `submission_token`; um agendamento tardio com esse token é rejeitado.
  Um job que ainda permaneça em `prepared` indica que nem o abort pôde ser confirmado. Um job
  enviado que esgote as tentativas fica em `failed`. Nesses dois últimos casos o claim falha
  fechado, `/ready` fica indisponível e novos envios param até intervenção; o worker nunca
  presume que uma proposta posterior pertence àquele clique.
- A fila não guarda CPF, CNPJ, endereço ou credenciais. Para a busca de contingência, o worker
  lê o documento diretamente da consulta vinculada usando a `service_role`.
- O motivo não é sorteado. A configuração é a preferência auditável; se esse rótulo deixar de
  existir no painel, o worker usa a primeira opção real oferecida e registra exatamente o
  rótulo efetivamente usado. O comentário é opcional.
- O formulário legado de CNPJ ainda não expõe um ID causal do POST. Com cancelamento
  obrigatório, esse fluxo é interrompido antes do clique; o worker nunca usa “a proposta mais
  nova do mesmo CNPJ” como identidade destrutiva. Para liberar PJ será necessário mapear um ID
  retornado pela própria submissão da Loft.

## Configuração padrão: portal

Configure somente no `automation/.env` da VPS:

```dotenv
LOFT_CANCELLATION_ENABLED=true
LOFT_CANCELLATION_REQUIRED=true
LOFT_CANCELLATION_MODE="portal"
LOFT_CANCELLATION_REASON="Inquilino desistiu do aluguel"
LOFT_CANCELLATION_COMMENT=""
LOFT_CANCELLATION_DELAY_MS=1800000
LOFT_CANCELLATION_REQUEST_TIMEOUT_MS=45000
```

O modo `portal` não exige OAuth, mas exige que `CREDPAGO_STORAGE_STATE_PATH` ou o perfil
persistente contenha uma sessão válida com acesso à lista de propostas. Se Login Loft pedir
CAPTCHA ou OTP, renove a sessão manualmente; o worker não contorna esses desafios.

`LOFT_CANCELLATION_REQUIRED=true` faz o cancelamento participar da prontidão. O Compose respeita
os valores do `.env` e usa `true`/`portal` somente como defaults. Nesse caso,
desabilitar a rotina, perder acesso à fila ou ter uma execução real indisponível deixa
`/ready` em HTTP 503. Depois de uma falha real, novas simulações aguardam até uma retentativa de
cancelamento terminar com sucesso. Use `false` apenas durante uma manutenção deliberada.
Enquanto a rotina continuar habilitada, uma falha da fila ainda interrompe novos envios para
não criar propostas sem rastreamento; jobs pendentes nunca são descartados.

Quando o cancelamento é obrigatório, uma simulação só é enviada depois que o snapshot e o job
forem persistidos. Se essa preparação falhar, o clique no portal não acontece.

## Alternativa: API homologada

Use este modo somente com contrato e permissão confirmados pela Loft:

```dotenv
LOFT_CANCELLATION_MODE="api"
LOFT_API_BASE_URL="https://api.loft.com.br"
LOFT_OAUTH_TOKEN_URL="https://auth.loft.com.br/v2/oauth/token"
LOFT_OAUTH_CLIENT_ID="..."
LOFT_OAUTH_CLIENT_SECRET="..."
LOFT_OAUTH_SCOPE="loft-aluguel"
```

Quando houver delegação da imobiliária, configure também
`LOFT_OAUTH_AUTHORIZATION_DETAILS` com o `grant_id` entregue pela parceira. As credenciais
ficam exclusivamente na VPS.

## Banco e publicação

Esta mudança troca a assinatura da RPC de agendamento. Faça o rollout coordenado: pare o
worker antigo antes da migration. Enquanto ele estiver parado, site e aplicativo apenas
mantêm novas consultas como pendentes; nenhuma proposta é enviada sem o respectivo job.

As duas migrations fazem parte da ativação e devem ser aplicadas na ordem do repositório:

1. `20261008203000_loft_proposal_cancellation_queue.sql` cria a tabela, RLS, lease e estados.
2. `20261013100000_loft_cancellation_jobs_per_execution.sql` adiciona o
   `submission_token`, a confirmação em duas fases e o snapshot de propostas anteriores,
   permite vários jobs por consulta, recupera leases expirados em uma transação separada e
   bloqueia o processamento enquanto um job confirmado não tiver identificador externo exato.

Antes de reiniciar o worker, confira se o backfill encontrou itens que exigem identidade exata:

Primeiro, **antes do `db push`**, confirme que o índice único de proposta poderá ser criado. Se
esta consulta devolver qualquer linha, não aplique a migration: preserve os registros e escale
a duplicidade para investigação manual.

```sql
select proposal_id, count(*)
from public.loft_proposal_cancellations
where proposal_id is not null
group by proposal_id
having count(*) > 1;
```

Depois da migration, confira os bloqueios que precisam de tratamento:

```sql
select status, count(*)
from public.loft_proposal_cancellations
where status in ('prepared', 'failed')
   or (proposal_id is null and status <> 'aborted')
group by status;
```

Um operador com `service_role`, ou um administrador no SQL Editor do projeto, pode liberar um
item somente depois de conferir o ID exato no painel da Loft; a RPC rejeita IDs presentes no
snapshot anterior, preserva o delay original e registra a reconciliação:

```sql
select public.reconcile_loft_proposal_cancellation(
  'UUID_DO_JOB',
  'ID_EXATO_DA_PROPOSTA',
  '2026-10-13T15:30:00Z'::timestamptz
);
```

Se, e somente se, os logs comprovarem que o clique nunca ocorreu, a preparação órfã pode ser
encerrada com `abort_loft_proposal_preparation`, informando o mesmo `consultation_id`,
`submission_token` e snapshot do job. A RPC recusa estados em que o envio possa ter ocorrido.

```sql
select public.abort_loft_proposal_preparation(
  consultation_id,
  submission_token,
  known_proposal_ids
)
from public.loft_proposal_cancellations
where id = 'UUID_DO_JOB';
```

Consultas com cancelamento `prepared`, `scheduled`, `processing`, `retry` ou `failed` não podem
ser apagadas pela limpeza administrativa: a FK e o CHECK abortam a exclusão em vez de remover
silenciosamente o job. Após `cancelled` ou `aborted`, a consulta pode ser removida e o registro
de auditoria é preservado com `consultation_id = NULL`.

Na VPS, primeiro pare somente o worker:

```bash
cd automation
docker compose stop credpago-worker
```

Depois, no projeto Supabase vinculado:

```bash
npx supabase db push
```

Por fim, na VPS, depois de atualizar o checkout e preservar o `automation/.env` e
`automation/data/credpago-session.json`:

```bash
cd automation
docker compose build
docker compose up -d
docker compose logs --tail=100 credpago-worker
```

Um push no GitHub/Vercel não substitui esses dois passos: migrations precisam chegar ao
Supabase e a imagem do worker precisa ser reconstruída na VPS.

## Verificação

`GET /health` continua sendo liveness: informa se o loop e o navegador estão vivos. Seu campo
`ready`, porém, só fica `true` quando autenticação, fila de simulações, navegador e, quando
obrigatória, fila de cancelamentos estiverem prontos. Antes de liberar a primeira simulação e
periodicamente, o worker abre a lista e valida URL e seletor de busca sem alterar propostas.

`GET /ready` responde HTTP 200 apenas quando todos esses componentes obrigatórios estão
prontos e o loop/autenticação continuam recentes; loop travado também responde HTTP 503. Os
dois endpoints expõem:

- `cancellationEnabled`, `cancellationRequired` e `cancellationMode`;
- `cancellationQueue`, `cancellationExecution` e `cancellationReady`;
- horários do último sucesso/erro da fila e falhas consecutivas;
- no `/health`, cancelamento ativo, totais de sucessos/falhas e horário do último sucesso.

Exemplo de conferência local na VPS:

```bash
curl --fail-with-body http://127.0.0.1:3000/ready
curl --fail-with-body http://127.0.0.1:3000/health
```

Antes de considerar a publicação concluída, confirme `cancellationEnabled: true`,
`cancellationMode: "portal"`, `cancellationQueue: "ok"`,
`cancellationExecution: "ok"`, `cancellationReady: true` e `ready: true`.

## Estados da fila

- `prepared`: snapshot e job persistidos antes do clique; ainda não pode ser processado.
- `aborted`: preparação encerrada de forma idempotente com prova de que o clique não ocorreu.
- `scheduled`: aguardando o horário de execução com o identificador externo exato; sem ele, a
  fila para para reconciliação e não executa o cancelamento.
- `processing`: um worker possui o lease temporário.
- `retry`: nova tentativa programada com backoff.
- `cancelled`: o portal ou a API confirmou o cancelamento da proposta esperada.
- `failed`: tentativas esgotadas; exige investigação.

Consultas e diagnósticos administrativos podem ler `loft_proposal_cancellations`; clientes
comuns não têm permissão para executar as RPCs da fila por causa do RLS e das concessões
restritas à `service_role`.
