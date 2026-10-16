# Estabilização da simulação de crédito — 2026-10-16

Este documento registra evidências, mudanças, validação e operação da fila de
simulações NOX → Loft. Ele não contém CPF, CNPJ, cookie, token ou credencial.

## Escopo observado

Fluxo confirmado no repositório:

1. site e aplicativo validam PF/PJ, imóvel residencial/comercial, documento,
   CEP operacional e aluguel/condomínio/taxas;
2. `enqueue_credit_simulation` persiste imóvel e consulta no Supabase;
3. o worker Node/Playwright na VPS usa uma sessão Loft persistida;
4. o worker preenche e confere o formulário, observa o POST, interpreta a
   resposta e persiste o resultado;
5. site e aplicativo acompanham a mesma linha por Realtime/polling e mantêm a
   consulta em “Minhas Consultas”.

Não foi encontrado contrato de API oficial para criar a simulação de crédito.
Há integração autorizada por API apenas no fluxo separado de cancelamento. A
simulação continua usando a navegação já existente, sem contornar CAPTCHA, MFA
ou bloqueios da conta.

## Evidências e causas

### Comprovadas pelo código anterior

- A idempotência usava o par usuário + CPF/CNPJ. Uma segunda operação legítima
  do mesmo inquilino podia reaproveitar e sobrescrever a consulta anterior,
  mesmo com imóvel ou valores diferentes.
- O trabalho era buscado e depois mudado para `processando`, sem lease, token de
  posse ou versão de execução persistentes. A recuperação considerava apenas a
  idade de `automation_started_at`.
- A recuperação devolvia qualquer execução antiga à fila. Ela não diferenciava
  uma queda antes do envio de uma queda depois de a Loft possivelmente ter
  recebido o pedido, portanto podia repetir um envio incerto.
- Uma resposta atrasada não era protegida por token + versão; o `WHERE status =
  'processando'` reduzia o risco, mas não identificava qual worker possuía a
  execução.
- Falha técnica era persistida também em `resultado = 'erro'`, misturando o
  estado operacional com o veredito de crédito.
- O circuit breaker de autenticação era apenas memória do processo. Reiniciar o
  container apagava o histórico de falhas do provedor.
- O snapshot da lista de propostas era aberto em paralelo ao preenchimento da
  simulação no mesmo BrowserContext. Além disso, probes periódicos podiam abrir
  outra página quando uma consulta ultrapassava o intervalo de verificação. Isso
  contrariava a própria evidência do código de que a sessão Loft possui estado
  mutável compartilhado.
- A fila não possuía limite global nem por conta no ponto transacional de
  admissão.

### Evidência operacional disponível

Em 16/10/2026, aproximadamente 14:06 BRT, os endpoints públicos do worker
responderam `/health = 200` e `/ready = 200`, versão `391b296`, com:

- 8 simulações processadas e 3 falhas no processo corrente (37,5%);
- concorrência configurada e efetiva igual a 1;
- zero consultas ativas naquele instante;
- 5 cancelamentos concluídos e 31 falhas de cancelamento;
- última falha da fila de cancelamento às 13:18 BRT;
- autenticação, navegador e fila reportados como disponíveis;
- `/metrics` inexistente (HTTP 404).

Esse é um snapshot sanitizado de health, não um log interno da VPS e não prova a
causa individual das três falhas.

O diagnóstico versionado de 11/09/2026 registrou 198 simulações em 30 dias, 18
erros finais e ocorrência de Gateway Timeout na fila Supabase. Naquela medição,
a VPS reportava aproximadamente 7,8 GiB de RAM, 6,9 GiB disponíveis e 12% de
disco ocupado. Portanto, não há evidência disponível para atribuir as quedas a
falta de CPU, memória, disco ou à Hostinger.

### Hipóteses ainda não confirmadas

- distribuição por categoria/etapa das três falhas atuais;
- eventual OOM kill, reinício do host ou limite do processo;
- frequência real de expiração da sessão e alteração de seletores na Loft;
- respostas 429/5xx e latência p95/p99 reais do provedor;
- se o login Loft permite mais de uma operação simultânea na mesma credencial.

Confirmar essas hipóteses exige journal/container logs, eventos do kernel,
métricas da VPS e traces sanitizados do intervalo da queda. Nenhum acesso SSH,
painel Hostinger, banco de produção ou credencial Loft estava disponível nesta
execução.

## Correções implementadas

### Banco e fila compartilhados

A migração `20261016183000_credit_automation_durable_queue.sql` adiciona:

- idempotência por conta + chave de operação e fingerprint do payload;
- rejeição da mesma chave quando os dados não correspondem;
- remoção da deduplicação por CPF/CNPJ;
- admissão atômica e durável, com limites iniciais de 500 ativos no total e 10
  por conta;
- claim transacional com `FOR UPDATE SKIP LOCKED`, serialização por credencial,
  `worker_id`, `lease_token`, heartbeat e `execution_version`;
- concorrência externa inicial de uma operação por credencial;
- recuperação automática somente quando o provedor certamente não foi chamado;
- quarentena `requires_verification` para `submitting`, `submitted` ou `unknown`;
- backoff exponencial com jitter, no máximo três tentativas e no máximo dez
  minutos entre tentativas;
- circuit breaker persistente, inicialmente 5 falhas e abertura por 120 segundos;
- finalização condicional que bloqueia respostas atrasadas de outro lease;
- estados técnicos separados do resultado `aprovado`, `recusado` ou
  `em_analise`;
- métricas persistentes de tamanho/idade da fila, retentativas, leases expirados,
  verificações e circuito.

Como fila e registro são a mesma transação PostgreSQL, não existe uma janela
entre “salvar a consulta” e “publicar o trabalho”; não foi necessário introduzir
Redis nem outbox separada.

### Worker

- usa as RPCs de claim, heartbeat, finalização e falha em vez de updates soltos;
- registra `submitting` antes do clique e `submitted` assim que observa o POST;
- fecha a página no timeout e impede reenvio automático quando o recebimento é
  incerto;
- mantém uma página por execução e fecha recursos em `finally`;
- serializa snapshot, simulação, probes e cancelamento no contexto autenticado;
  nenhuma segunda superfície do portal abre enquanto a simulação está ativa;
- continua limitando a sessão compartilhada da Loft a uma execução;
- classifica indisponibilidade/autenticação/navegador/rede como falhas técnicas;
- não grava mais timeout, login, navegador, indisponibilidade ou tela desconhecida
  como recusa;
- expõe no health as métricas da fila e o estado do circuito;
- preserva logs sanitizados com correlation ID, consulta, etapa, tentativa,
  worker, categoria e duração.

### Site e aplicativo

- geram a mesma chave lógica para clique duplo, nova aba e resposta HTTP perdida,
  sem guardar documento em storage;
- mantêm compatibilidade temporária com o overload antigo durante a implantação;
- mostram “Requer verificação” como estado técnico verdadeiro;
- não oferecem retry ao usuário quando um envio anterior pode ter chegado à
  Loft;
- retry explícito passa por RPC autorizada e só aceita falha anterior ao envio;
- “Erro” deixou de ser agrupado como “Recusado” no aplicativo.

## Limites iniciais recomendados

- concorrência por credencial Loft: **1**;
- concorrência efetiva deste worker: **1**;
- lease: **120 s**, renovado a cada **15 s**;
- timeout total da consulta: **420 s**;
- tentativas seguras: **3**;
- fila ativa por conta: **10**;
- fila ativa total: **500**;
- circuito: **5** falhas de provedor, aberto por **120 s**.

O simulador confirmou que 1, 5, 10, 25 e 50 clientes podem ser aceitos e
processados sem ultrapassar uma execução externa concorrente. Isso valida a
política da fila em memória de teste, não a vazão real da Loft. Os limites devem
ser revistos com p50/p95/p99 e taxa de falha reais; não aumentar concorrência da
credencial sem autorização e evidência do provedor.

## Implantação

1. Fazer backup lógico do banco e registrar a versão atual do container.
2. Parar novos claims no worker atual e aguardar a execução ativa terminar.
3. Parar o worker de crédito e aplicar a migração aditiva no Supabase.
4. Confirmar que as RPCs existem e que a fila antiga foi backfilled.
5. Publicar/recriar o container com a nova versão e uma única réplica ativa.
6. Confirmar `/health`, `/ready`, `queueDepth`, `expiredLeases`,
   `requiresVerification` e `circuitOpen`.
7. Fazer uma simulação autorizada e controlada para PF e, separadamente, PJ.
8. Observar por pelo menos uma hora antes de alterar os limites.

O push do site aciona a Vercel, mas não aplica a migração Supabase nem reinicia o
worker da VPS. Esses dois passos exigem acesso operacional autorizado.

### Rollback

- reimplantar o commit anterior do site/worker;
- deixar as tabelas/colunas/RPCs aditivas no banco durante o rollback; removê-las
  em emergência seria mais arriscado e não é necessário para o cliente antigo;
- não restaurar o índice exclusivo por CPF/CNPJ, pois ele rejeita operações
  legítimas distintas;
- consultas em `requires_verification` devem continuar bloqueadas até
  reconciliação humana ou por identificador externo confiável;
- se o worker novo falhar antes do processamento real, parar a réplica nova e
  reativar somente uma réplica antiga, sem rodar os dois fluxos em paralelo.

## Diagnóstico e alertas

Alertar usando o canal operacional já existente quando ocorrer qualquer um:

- `/health` ou `/ready` indisponível por duas verificações;
- fila mais antiga que dez minutos;
- lease expirado;
- circuito aberto;
- aumento de `requiresVerification`;
- cinco falhas técnicas em quinze minutos;
- três reinícios do container em dez minutos.

Na VPS, coletar de forma sanitizada:

```text
docker compose ps
docker compose logs --since 2h --timestamps nox-automation
journalctl --since "2 hours ago" --no-pager
dmesg --ctime | grep -Ei "oom|killed process|out of memory"
docker stats --no-stream
```

Não publicar screenshots/traces brutos: eles podem conter documentos e dados da
sessão. Manter rotação do runtime do Docker e retenção compatível com o volume da
VPS.

## Validação executada

- TypeScript do site: aprovado;
- TypeScript isolado do worker: aprovado;
- ESLint dos arquivos alterados do site/worker: aprovado;
- build Vercel/TanStack: aprovado;
- suíte de automação Playwright: **131/131** aprovada;
- testes de idempotência do site: **3/3** aprovados;
- testes novos de fila/política/carga/falhas estão incluídos na suíte;
- TypeScript do aplicativo: aprovado;
- ESLint dos arquivos alterados do aplicativo: aprovado;
- `expo install --check`: dependências compatíveis;
- export Expo iOS/Android/Web: aprovado, 66 rotas estáticas;
- Expo Doctor: 16/21; cinco checks não concluíram porque o runtime de validação
  não disponibilizava o executável `npm`. O aviso de `.expo` foi verificado como
  falso positivo: `.gitignore` ignora `.expo/` e nenhum arquivo está rastreado.

Os testes intensivos usaram somente um simulador local e dados sintéticos. Não
foram executadas consulta real, carga contra a Loft, migração em produção, teste
de reinício real, medição comparativa de recursos nem soak de 24 horas por falta
de acesso/autorização. Assim, o estado correto desta entrega é: implementado e
testado localmente; ainda não validado na integração real nem em produção.

## Intervenção humana ainda necessária

- aplicar a migração e implantar o worker na VPS;
- reconciliar qualquer linha que chegar a `requires_verification` consultando a
  Loft pelo identificador confiável disponível;
- renovar sessão manualmente se houver CAPTCHA, MFA, credencial revogada ou
  bloqueio comercial;
- atualizar seletores/parser quando a Loft fizer mudança incompatível;
- fornecer os logs sanitizados da queda recente para fechar as hipóteses ainda
  abertas;
- executar soak de 24 horas e uma pequena validação real autorizada após a
  implantação.

Uma única VPS continua sendo ponto único de falha. O lease permite recuperar o
processo com segurança, mas não torna o host redundante. Redundância de host só
deve ser introduzida depois da medição; mesmo com dois hosts, a credencial Loft
permanece serializada pelo banco.
