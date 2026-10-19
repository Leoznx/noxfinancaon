# Estabilização da simulação de crédito — 2026-10-16

Este documento registra evidências, mudanças, validação e operação da fila de
simulações NOX → Loft. Ele não contém CPF, CNPJ, cookie, token ou credencial.

> Atualização de 19/10/2026: reativação após a liberação do módulo Fiança, desvio da API
> direta removido e estabilização da sessão/login do worker —
> veja [`CREDIT_AUTOMATION_REATIVACAO_2026-10-19.md`](CREDIT_AUTOMATION_REATIVACAO_2026-10-19.md).

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

Esse snapshot inicial, isoladamente, não provava a causa individual das três
falhas. Depois da autorização operacional, a VPS, o banco e os logs internos
foram inspecionados e a implantação foi acompanhada ao vivo.

O diagnóstico versionado de 11/09/2026 registrou 198 simulações em 30 dias, 18
erros finais e ocorrência de Gateway Timeout na fila Supabase. Na inspeção de
16/10, a VPS confirmou 2 vCPU, aproximadamente 8 GiB de RAM e 100 GB de disco.
Com a versão final, o container mediu aproximadamente 2,7% de CPU e 400 MiB de
memória (9,8% do limite Docker de 4 GiB). O kernel não registrou OOM kill nas 24
horas consultadas. As quedas observadas não foram atribuídas à Hostinger nem à
falta de recursos.

### Causas comprovadas em produção

- a validação obrigatória da superfície de cancelamentos podia ficar em
  `checking` indefinidamente. O processo e o navegador continuavam vivos, mas
  `/ready` permanecia falso e nenhuma simulação era reivindicada;
- cancelamentos e reconciliações reais também não tinham um watchdog total
  externo aos timeouts internos do Playwright;
- no timeout seguro de uma simulação, a transição para
  `requires_verification` limpava corretamente o lease. Um heartbeat que já
  estava em voo podia então receber `ConsultaLeaseLostError`; o worker marcava
  isso incorretamente como indisponibilidade da fila;
- essa indisponibilidade momentânea deixava o worker não pronto. O monitor de
  logs criava incidentes duplicados e o reparador escolhia
  `RESTART_CREDIT_WORKER`, gerando reinício desnecessário depois de uma falha já
  tratada;
- uma solicitação legada com mais de 13 dias havia sido backfilled como pronta
  para envio. Ela foi colocada em `requires_verification` antes de o worker ser
  liberado, evitando envio tardio sem autorização atual.
- nas duas solicitações reais mais recentes, a Loft exibiu uma nova tela de
  restrição de acesso: a conta de integração precisa ser liberada para o módulo
  Fiança no portal Adm Aluguel. O texto sanitizado foi confirmado tanto no
  estado persistido quanto no terminal da VPS;
- o parser anterior não reconhecia essa nova mensagem. Como o POST já havia
  ocorrido, ele aguardava todo o timeout de resultado de 300 segundos e
  encerrava como `result_not_recognized`, explicando a lentidão percebida e a
  ausência de uma decisão de crédito;
- reiniciar navegador, container ou VPS não corrige esse bloqueio de permissão
  no provedor. Repetir automaticamente também seria inseguro, pois a Loft pode
  ter recebido o envio antes de mostrar a restrição.

Evidência sanitizada da primeira execução real observada após a migração:

- a fila passou de 4 para 3 e manteve `activeConsultations = 1` e concorrência
  efetiva 1;
- o documento apareceu mascarado no log;
- o worker abriu o portal, preencheu, criou o snapshot causal, enviou uma única
  vez e aguardou até 300 segundos sem reclique;
- como a Loft não devolveu decisão no prazo, a consulta terminou em
  `technical_status = requires_verification`, `status = requer_verificacao` e
  `provider_submission_state = submitted`, sem resultado de crédito falso;
- o container final `545cc54` permaneceu `running/healthy`, com `RestartCount =
0` durante a observação posterior.

Uma segunda execução real já existente na fila foi acompanhada até o mesmo
limite seguro, depois que a reconciliação anterior terminou sem encontrar uma
nova proposta. Às 23:20 UTC, o worker retomou a fila, preencheu a consulta,
observou o envio e aguardou a Loft sem reclique. Às 23:25 UTC, como não apareceu
uma decisão de crédito reconhecida, finalizou tecnicamente em
`requires_verification`. O reparador classificou o incidente como
`manual_required`, não emitiu `RESTART_CREDIT_WORKER` e o Docker continuou
`healthy`, `RestartCount = 0`, versão `545cc54` e zero leases expirados. A
reconciliação desse envio incerto bloqueou novos claims de propósito; o objetivo
é impedir uma segunda proposta até que a janela de reconciliação termine, não
mascarar essa espera como prontidão para novo trabalho.

Em 17/10/2026, a mensagem de restrição foi reclassificada sem expor documentos
ou credenciais. Três envios incertos existentes ficaram com
`PROVIDER_ACCESS_RESTRICTED`; duas solicitações ainda não enviadas permaneceram
duráveis na fila com etapa `aguardando_liberacao_parceiro`. O circuito da
credencial foi aberto para impedir novo envio cego.

### Hipóteses ainda não confirmadas

- frequência real de expiração da sessão e alteração de seletores na Loft;
- respostas 429/5xx e latência p95/p99 reais do provedor;
- se o login Loft permite mais de uma operação simultânea na mesma credencial.

Não foi localizado log histórico suficiente para atribuir cada uma das três
falhas do processo anterior. A sessão compartilhada continuará serializada até
existir autorização e evidência do provedor para qualquer concorrência maior.

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

A migração `20261017002000_detect_loft_fianca_access_restriction.sql` preserva
os envios incertos, classifica a nova restrição de acesso, abre o circuito da
credencial e sinaliza as linhas ainda em fila como aguardando a liberação do
parceiro. Ela não apaga, conclui, recusa nem reenvia consultas.

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
- aplica watchdog total de 120 s à validação da tela de cancelamentos e de 240 s
  a cancelamentos/reconciliações, abaixo do lease de 10 minutos dessa fila;
- expõe início e travamento das checagens/operações de cancelamento no health;
- trata perda de lease como conflito da execução antiga, sem declarar a fila
  indisponível;
- timeouts controlados aguardam a dependência/validação e não acionam reinício
  do processo de crédito;
- o supervisor ignora eventos operacionais já tratados e registrados pelo fluxo
  durável, evitando incidentes duplicados e ciclos de reparo;
- preserva logs sanitizados com correlation ID, consulta, etapa, tentativa,
  worker, categoria e duração.
- reconhece imediatamente a nova restrição de acesso ao módulo Fiança e não
  aguarda o timeout de cinco minutos;
- persiste `PROVIDER_ACCESS_RESTRICTED`, bloqueia a credencial por um intervalo
  configurável e restaura esse bloqueio após reinício do processo.

### Site e aplicativo

- geram a mesma chave lógica para clique duplo, nova aba e resposta HTTP perdida,
  sem guardar documento em storage;
- mantêm compatibilidade temporária com o overload antigo durante a implantação;
- mostram “Requer verificação” como estado técnico verdadeiro;
- não oferecem retry ao usuário quando um envio anterior pode ter chegado à
  Loft;
- retry explícito passa por RPC autorizada e só aceita falha anterior ao envio;
- “Erro” deixou de ser agrupado como “Recusado” no aplicativo.
- site e aplicativo encerram o modal bloqueante quando a consulta entra em
  `aguardando_liberacao_parceiro`, abrem o registro persistido pelo mesmo ID e
  explicam que a execução depende da liberação da Loft.

## Limites iniciais recomendados

- concorrência por credencial Loft: **1**;
- concorrência efetiva deste worker: **1**;
- lease: **120 s**, renovado a cada **15 s**;
- timeout total da consulta: **420 s**;
- validação total de cancelamento: **120 s**;
- cancelamento/reconciliação: **240 s**, abaixo do lease de **600 s**;
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

### Implantação executada em 16/10/2026

- backup lógico restrito no schema `ops_backup`: 694 consultas, 84 jobs de
  cancelamento e 16 definições de funções; RLS permaneceu habilitado;
- migração `20261016183000_credit_automation_durable_queue.sql` aplicada em
  transação e validada com 8 overloads de RPC, fila máxima 500 e zero leases
  expirados;
- migração de quarentena
  `20261016233000_quarantine_stale_legacy_credit_queue.sql` aplicada ao único
  pedido legado antigo elegível;
- imagem anterior preservada como
  `nox-automacao-credpago:pre-6310532-20261016` e `.env` anterior salvo com modo
  600;
- checkout atualizado por fast-forward, imagem reconstruída e container
  recriado somente quando não havia simulação ativa;
- versão final implantada: `545cc54`; Docker `restart: unless-stopped`, health
  local e dois processos independentes (crédito e reparo) confirmados.

### Correção complementar implantada em 17/10/2026

- migração de classificação da restrição aplicada e validada em produção: duas
  linhas em `aguardando_liberacao_parceiro`, três em
  `PROVIDER_ACCESS_RESTRICTED` e circuito persistente aberto;
- checkout da VPS atualizado por fast-forward, imagem reconstruída e somente o
  serviço `credpago-worker` recriado, com zero consultas ativas;
- versão implantada: `c035400`;
- startup confirmou sessão portátil, mutex exclusivo, concorrência 1 e
  restauração do bloqueio do provedor sem reivindicar as duas consultas;
- Docker terminou `running/healthy`, `RestartCount = 0`, zero leases expirados
  e nenhum processamento ou falha durante a inicialização da nova versão.

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
- suíte de automação Playwright: **140/140** aprovada;
- testes de idempotência do site: **3/3** aprovados;
- testes novos de fila/política/carga/falhas estão incluídos na suíte;
- TypeScript do aplicativo: aprovado;
- ESLint dos arquivos alterados do aplicativo: aprovado;
- `expo install --check`: dependências compatíveis;
- export Expo iOS/Android/Web: aprovado, 66 rotas estáticas;
- Expo Doctor: 16/21; cinco checks não concluíram porque o runtime de validação
  não disponibilizava o executável `npm`. O aviso de `.expo` foi verificado como
  falso positivo: `.gitignore` ignora `.expo/` e nenhum arquivo está rastreado.

Os testes intensivos usaram somente o simulador local e dados sintéticos; nenhum
CPF real foi criado para teste de carga. A migração, o rebuild, a recuperação de
uma reconciliação, um reinício controlado e duas solicitações reais já existentes
na fila foram observados em produção. Nas duas, o POST foi observado, mas a Loft
não exibiu decisão reconhecida dentro do prazo; ambas foram preservadas para
verificação, sem decisão de crédito inventada. Na segunda execução, já com a
correção final, o tratamento não reiniciou o worker. Não foi executado soak de 24
horas nem uma bateria PF/PJ criada exclusivamente para esta validação. O estado
correto é: implementado, testado localmente e implantado; fluxo de
falha/resultado incerto e recuperação sem reinício validados em produção;
aprovação, recusa e em análise ainda não revalidados ponta a ponta nesta versão.
O reconhecimento da tela de restrição e o bloqueio persistente foram validados
em produção; a emissão de uma nova decisão continua impossibilitada pelo acesso
externo da conta ao módulo Fiança.

## Intervenção humana ainda necessária

- um administrador da conta Loft deve liberar o usuário da integração no módulo
  Fiança do portal Adm Aluguel. Essa é a dependência comprovada que ainda impede
  novas decisões de crédito; a permissão não foi alterada automaticamente;
- reconciliar as linhas que chegaram a `requires_verification` consultando a
  Loft pelo identificador confiável disponível;
- renovar sessão manualmente se houver CAPTCHA, MFA, credencial revogada ou
  bloqueio comercial;
- atualizar seletores/parser quando a Loft fizer mudança incompatível;
- executar soak de 24 horas e validações reais PF/PJ, em volume controlado e
  autorizado, para medir p50/p95/p99 e taxa de falha.

Uma única VPS continua sendo ponto único de falha. O lease permite recuperar o
processo com segurança, mas não torna o host redundante. Redundância de host só
deve ser introduzida depois da medição; mesmo com dois hosts, a credencial Loft
permanece serializada pelo banco.
