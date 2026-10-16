# NOX FINANÇA

Sistema para corretores e administradores de seguro fiança locatícia. Frontend em React/Vite/TanStack Start + TypeScript, backend em Supabase. Projeto criado e sincronizado com o [Lovable](https://lovable.dev) — veja `.lovable/project.json`.

## Guia rápido

### Instalar

```bash
npm install
```

### Rodar localmente

```bash
cp .env.example .env   # preencha com os valores do seu projeto Supabase (veja abaixo)
npm run dev
```

Abre em `http://localhost:8080`.

### Variáveis de ambiente

O `.env` da raiz alimenta tanto o frontend (bundle do navegador, via `import.meta.env.VITE_*`)
quanto o código servidor desta mesma app (SSR do TanStack Start, via `process.env.*` sem
prefixo). Copie `.env.example` para `.env` e preencha:

| Variável                                                     | Uso                                                                     | Onde conseguir                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `VITE_SUPABASE_URL` / `SUPABASE_URL`                         | URL do projeto (frontend / SSR)                                         | Painel Supabase → Project Settings → API                  |
| `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` | Chave pública anon/publishable (frontend / SSR)                         | Painel Supabase → Project Settings → API                  |
| `VITE_SUPABASE_PROJECT_ID` / `SUPABASE_PROJECT_ID`           | Ref do projeto                                                          | Painel Supabase → Project Settings → General              |
| `SUPABASE_SERVICE_ROLE_KEY`                                  | Secreta — só usada em código server-side desta app (`client.server.ts`) | Painel Supabase → Project Settings → API → `service_role` |

**Nunca** prefixe `SUPABASE_SERVICE_ROLE_KEY` com `VITE_` — isso a exporia no bundle do
navegador. O `.env` real nunca deve ser commitado (já está no `.gitignore`).

A automação local (`automation/`) tem suas próprias variáveis, em `automation/.env` — veja a
seção [Automação de simulação de crédito](#automação-de-simulação-de-crédito-credpago) abaixo.

### Conectar o Supabase

Este projeto usa o Supabase gerenciado pelo Lovable Cloud (projeto já provisionado). Para
apontar para o seu próprio projeto Supabase:

1. Crie/abra um projeto em [supabase.com](https://supabase.com).
2. Copie URL, `anon`/`publishable key` e `service_role key` de Project Settings → API para o
   `.env` (veja a tabela acima).
3. Aplique as migrations existentes: `npx supabase link --project-ref SEU_PROJECT_REF` e depois
   `npx supabase db push` (veja a lista completa em
   [Migrations do Supabase aplicadas neste trabalho](#migrations-do-supabase-aplicadas-neste-trabalho)).
4. Se for usar a automação de crédito, crie também `automation/.env` (veja a seção específica).

### Build de produção

```bash
npm run build   # gera .vercel/output/ (SSR, preset Vercel via Nitro)
npm run preview # testa o build Nitro/Vercel localmente
```

### Deploy (Vercel)

O `npm run build` gera `.vercel/output/` no formato Build Output API v3 (preset `vercel` do
Nitro, configurado em `vite.config.ts`) — zero-config: basta importar o repositório na Vercel,
sem precisar de `vercel.json`. Configure as mesmas variáveis de ambiente da tabela acima em
Project Settings → Environment Variables — sem elas o app sobe mas falha ao conectar no
Supabase.

`wrangler.jsonc` continua no repositório apenas para quem também publicar via Cloudflare
Workers/Pages (ex.: publicação direta pelo próprio Lovable) — a Vercel ignora esse arquivo.

### Rodar a automação em uma VPS separada

O worker de automação (`automation/`) é um processo Node **separado** do frontend — não faz
parte do build/deploy da app principal, porque abre um Chrome real via Playwright (precisa de
um SO com interface gráfica disponível ao menos na primeira vez, para o login manual). Para
rodar em uma VPS:

1. Suba só a pasta do projeto (ou `git clone`) na VPS, com Node 18+ instalado.
2. `npm install && npx playwright install chromium --with-deps` (`--with-deps` instala as
   bibliotecas de sistema que o Chromium precisa em Linux).
3. Crie `automation/.env` (veja [Configurar `.env`](#configurar-env) na seção da automação).
4. Na **primeira** execução, rode com `HEADLESS=false` e um servidor gráfico/VNC disponível
   (ou localmente, copiando depois a pasta `automation/chrome-profile-credpago/` já logada
   para a VPS) — o login na CredPago é sempre manual.
5. Depois de logado, ative `HEADLESS=true` e rode `npm run automation:credpago` sob um
   supervisor de processo (`pm2`, `systemd`, etc.) para manter o worker no ar.

## Automação de simulação de crédito (CredPago)

A tela **Nova Consulta** (`/consultas/nova`) permite ao corretor simular crédito no portal
externo (`https://app.loft.com.br/erp/proposta/analise-de-credito`) sem sair do NOX FINANÇA. O fluxo é:

1. Corretor preenche os dados do inquilino/imóvel e clica em **Simular crédito**.
2. O frontend cria um registro em `public.consultas_credito` com `status = "pendente"` e
   `origem = "nox_financa"`, e abre um modal bloqueante ("Consultando crédito...").
3. Um **worker Node.js local** (`automation/`), rodando na máquina do corretor/imobiliária,
   busca consultas pendentes, abre o Chrome com um **perfil persistente**, preenche o
   formulário da CredPago e clica em "Simular Crédito".
4. O worker lê o resultado da página (aprovado / recusado / em análise / erro) e atualiza o
   registro no Supabase.
5. O frontend recebe a atualização via **Supabase Realtime** (com polling de fallback),
   fecha o modal e redireciona para `/consultas/:id/status`.

Login na CredPago é sempre **manual** — a automação nunca preenche usuário/senha e nunca
tenta contornar captcha. O perfil do Chrome (`automation/chrome-profile-credpago/`) mantém a
sessão entre execuções, então o login só é pedido na primeira vez.

### Múltiplos corretores enviando consultas

O worker roda **um único** navegador/contexto autenticado por processo. Site e aplicativo podem
enviar várias consultas ao mesmo tempo, mas elas ficam na fila do Supabase e são entregues ao
portal **uma por vez**. O portal compartilha o andamento da proposta no storage da sessão;
abrir duas análises em abas paralelas faz uma sobrescrever a outra e pode devolver ambas ao
formulário sem resultado.

- **Fila serializada** (`MAX_CONCURRENT_CONSULTAS=1`): as consultas excedentes esperam e começam
  automaticamente assim que a análise anterior termina. Valores maiores são limitados a `1`
  pelo próprio worker para proteger a sessão compartilhada.
- **Isolamento por consulta**: cada consulta recebe uma aba limpa, seus próprios dados (vindos
  da linha do Supabase) e seu próprio bloco de log prefixado com os 8 primeiros caracteres do
  `id` (ex.: `[4dfbfa8f] Preenchendo dados`) — dá pra acompanhar várias consultas ao mesmo tempo
  no terminal sem confundir uma com a outra.
- **Reivindicação atômica**: `claim_next_credit_simulation` usa lock transacional e
  `FOR UPDATE SKIP LOCKED`, grava `worker_id`, `lease_token` e `execution_version` e serializa a
  credencial externa. Heartbeats renovam o lease; somente o mesmo token/versão pode finalizar.
- **Timeout por consulta** (`CONSULTA_TIMEOUT_MS`, padrão `420000` = 420s): antes do envio, uma
  falha temporária usa backoff limitado; depois de `submitting`, `submitted` ou estado incerto, a
  consulta vai para `requer_verificacao` e nunca é reenviada cegamente. Timeout não é recusa.
- **Fechamento seguro**: só a aba da consulta que terminou é fechada (`page.close()`). O
  navegador/contexto inteiro só fecha quando o worker inteiro é encerrado (Ctrl+C ou fim do
  `--once`), e mesmo aí ele espera todas as consultas em andamento terminarem antes de fechar.
- **Login compartilhado**: a sessão é validada antes de retirar uma consulta da fila e é renovada
  uma única vez quando necessário.

⚠️ **Não rode `npm run automation:credpago` duas vezes ao mesmo tempo** (dois terminais, dois
processos) apontando para o mesmo `CREDPAGO_PROFILE_DIR` — isso arrisca conflito no perfil e no
estado da análise. Escale a fila, não a quantidade de análises simultâneas na mesma conta.

Modo headless (`HEADLESS=true`) mantém tudo isso funcionando, só sem janela visível — útil para
rodar em produção depois que a sessão já está logada (o login manual exige janela visível; se
`HEADLESS=true` e a sessão expirar, o worker falha com uma mensagem clara em vez de travar
esperando um Enter que ninguém consegue responder).

### Arquitetura

```
src/
  components/simulacao/
    FormularioSimulacao.tsx   # formulário (existente) — ganhou prop `disabled`
    ModalConsultando.tsx      # modal com engrenagem animada + estado de erro/retry
    ResultadoAutomacao.tsx    # card de resultado (status grande + dados + valores)
  routes/
    consultas.nova.tsx        # cria a consulta, abre o modal, escuta o resultado
    consultas.$id.status.tsx  # tela de resultado da automação (rota nova)
  lib/
    consultasCredito.ts        # criarConsultaParaAutomacao, watchConsultaCredito, maskDocumento...
    supabase.ts                # alias de conveniência para o client Supabase

automation/                     # worker local — processo Node separado do frontend
  env.ts                # carrega e valida variáveis de ambiente do worker
  logger.ts             # logs com timestamp + mascaramento de CPF/CNPJ
  supabaseAdmin.ts       # client Supabase com service role key (uso local apenas)
  credpagoSelectors.ts   # seletores tolerantes (label/placeholder/role/texto)
  credpagoParser.ts      # interpreta o texto da página e classifica o resultado
  credpagoWorker.ts       # fila serializada, timeout e claim atômico por consulta
  chrome-profile-credpago/ # perfil persistente do Chrome (gitignored — contém sua sessão)

supabase/migrations/
  20260704180000_consultas_credito_worker_local.sql        # tabela/colunas/índices/RLS/Realtime
  20260704190000_consultas_credito_status_check_automacao.sql # amplia CHECK de status
```

### Instalar dependências

```bash
npm install
npx playwright install chromium   # baixa o Chromium usado pelo Playwright (ou: npm run automation:install-browsers)
```

### Configurar `.env`

O `.env` da raiz (usado pelo frontend) já existe. Confirme que aponta para o **mesmo**
projeto Supabase que você vai usar no worker — hoje o projeto ativo é
`njheoytyidsghittjilr` (veja `VITE_SUPABASE_URL`).

Crie `automation/.env` a partir de `automation/.env.example`:

```bash
cp automation/.env.example automation/.env
```

Preencha:

| Variável                         | Onde conseguir                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                   | Mesma URL do projeto usado no frontend (`https://njheoytyidsghittjilr.supabase.co`)   |
| `SUPABASE_SERVICE_ROLE_KEY`      | Painel Supabase → Project Settings → API → `service_role` (secreta!)                  |
| `CREDPAGO_PROFILE_DIR`           | Pasta do perfil do Chrome (padrão: `./automation/chrome-profile-credpago`)            |
| `AUTOMATION_POLL_INTERVAL_MS`    | Intervalo de verificação de novas consultas (padrão: `5000`)                          |
| `CREDIT_PROVIDER_CREDENTIAL_KEY` | Identidade da credencial externa serializada no banco (padrão: `loft-primary`)        |
| `CREDIT_HEARTBEAT_INTERVAL_MS`   | Renovação do lease da consulta em processamento (padrão: `15000`)                     |
| `QUEUE_METRICS_INTERVAL_MS`      | Atualiza tamanho/idade/falhas da fila no health (padrão: `60000`)                     |
| `CREDPAGO_URL`                   | `https://app.loft.com.br/erp/proposta/analise-de-credito`                             |
| `MAX_CONCURRENT_CONSULTAS`       | Concorrência pedida; limitada a `1` pela sessão do parceiro (padrão: `1`)             |
| `CONSULTA_TIMEOUT_MS`            | Prazo total; envio incerto termina em verificação, nunca em recusa (padrão: `420000`) |
| `LOFT_CANCELLATION_ENABLED`      | Ativa o cancelamento programado de propostas (padrão: `true`)                         |
| `LOFT_CANCELLATION_REQUIRED`     | Inclui a fila de cancelamentos na prontidão do worker (padrão: `true`)                |
| `LOFT_CANCELLATION_MODE`         | `portal` usa a sessão Playwright; `api` exige OAuth homologado (padrão: `portal`)     |
| `LOFT_CANCELLATION_REASON`       | Preferência de motivo; o rótulo efetivamente escolhido é auditado                     |
| `LOFT_CANCELLATION_DELAY_MS`     | Prazo contado de cada envio real até o cancelamento (padrão: `1800000`)               |
| `HEADLESS`                       | `true` para rodar sem janela visível (requer sessão já logada) — padrão `false`       |

> Nota: o `.env.example` sugerido para este tipo de automação às vezes cita
> `CHROME_USER_DATA_DIR`/`CHROME_PROFILE_DIRECTORY` (nomenclatura de Selenium/Chrome puro).
> Como o worker usa Playwright (`chromium.launchPersistentContext`), o equivalente exato já
> existente é `CREDPAGO_PROFILE_DIR` — não é preciso (nem existe) um "profile directory"
> separado dentro dele.

O procedimento completo de configuração, migrations, deploy e validação está em
[`docs/loft-proposal-cancellation.md`](docs/loft-proposal-cancellation.md).

Com o cancelamento obrigatório, o fluxo legado de CNPJ é bloqueado antes do clique porque
a Loft ainda não devolve nele um ID causal da proposta. O worker não usa a proposta “mais
nova” do mesmo CNPJ como substituto; isso evita cancelar uma proposta manual ou externa.

**Nunca** commite `automation/.env` nem a pasta `automation/chrome-profile-credpago/` — ambos
já estão no `.gitignore`. O `.env` da raiz também foi adicionado ao `.gitignore` nesta
mudança (não estava antes).

### Rodar o frontend

```bash
npm run dev
```

Acesse `http://localhost:8080`, faça login (ou use os botões de perfil demo) e vá em
**Nova Consulta** no menu lateral.

### Rodar o worker local

Em outro terminal:

```bash
npm run automation:credpago     # loop contínuo — fica escutando novas consultas
# ou
npm run automation:once         # processa uma única consulta pendente e encerra
```

### Primeiro login na CredPago

Na primeira execução (perfil vazio), o worker abre o Chrome, navega até a CredPago e detecta
a tela de login. No terminal aparece:

```
Faça login manualmente na CredPago. Depois pressione Enter para continuar.
```

Faça o login **manualmente** na janela do Chrome que abriu e, só depois, volte ao terminal e
pressione Enter. A sessão fica salva em `automation/chrome-profile-credpago/` — nas próximas
execuções o login não será pedido novamente (a menos que a sessão expire).

Se a CredPago exibir um captcha, o worker não tenta resolvê-lo: ele marca a consulta como
`erro` com uma mensagem explicando o motivo, para você resolver manualmente e reenviar.

### Testar com dados fictícios

Use CPF/CNPJ fictícios com dígito verificador válido (a validação do formulário rejeita
sequências aleatórias). Exemplo de CPF de teste válido: `111.444.777-35`. Nunca use dados
reais de clientes em ambiente de teste.

Passo a passo:

1. `npm run dev` e `npm run automation:credpago` em terminais separados.
2. No NOX FINANÇA, entre como corretor e abra **Nova Consulta**.
3. Preencha CPF de teste, CEP, tipo de imóvel e valor do aluguel.
4. Clique em **Simular crédito** — o modal "Consultando crédito" deve aparecer e o botão
   fica bloqueado (não é possível clicar de novo enquanto processa).
5. No terminal do worker, acompanhe os logs (`Consulta recebida`, `Abrindo CredPago`,
   `Preenchendo dados`, `Enviando simulação`, `Aguardando resultado`, `Resultado
   identificado`, `Consulta atualizada`).
6. Se for a primeira vez, faça o login manual na janela do Chrome e pressione Enter no
   terminal para continuar.
7. Quando o worker terminar, o modal do NOX FINANÇA fecha sozinho (via Realtime) e você é
   redirecionado para `/consultas/:id/status`, com o status em destaque, dados do
   inquilino/imóvel, valores informados e os botões **Nova Consulta** / **Ver minhas
   consultas**.

### Testar a fila com 2 ou 3 consultas simultâneas

1. Deixe `npm run dev` e `npm run automation:credpago` rodando normalmente.
2. Abra o NOX FINANÇA em **duas ou três abas/janelas diferentes** do navegador (pode ser a
   mesma conta de corretor ou contas diferentes).
3. Em cada aba, vá em **Nova Consulta**, preencha dados de um cliente fictício diferente (CPF,
   CEP e aluguel diferentes em cada aba) e clique em **Simular crédito** — o mais próximo
   possível umas das outras no tempo, pra forçar a concorrência.
4. No terminal do worker, você deve ver a primeira consulta terminar antes da próxima começar:
   ```
   [4dfbfa8f] Consulta recebida (documento 111.***.***-35)
   [4dfbfa8f] Abrindo CredPago
   [4dfbfa8f] Preenchendo dados
   [4dfbfa8f] Resultado identificado: aprovado
   [8b3a1539] Consulta recebida (documento 039.***.***-35)
   [8b3a1539] Abrindo CredPago
   [8b3a1539] Preenchendo dados
   [8b3a1539] Resultado identificado: em_analise
   ```
5. Na janela do Chrome, haverá somente uma análise ativa por vez; a seguinte abre depois que a
   anterior termina.
6. Cada aba do NOX FINANÇA deve fechar seu próprio modal e redirecionar para o `/status` da
   **sua própria** consulta, com o status correto — nunca o de outra aba.
7. A segunda deve ficar visivelmente `pendente` (sem abrir aba nova) até a primeira terminar,
   e só então começar sozinha.

### Segurança

- A automação nunca preenche usuário/senha da CredPago nem tenta contornar captcha/login.
- CPF/CNPJ são mascarados em toda tela e log (`documento_masked`, `maskDocumento`) — o
  documento completo só existe na coluna `documento`, usada exclusivamente pelo worker.
- `SUPABASE_SERVICE_ROLE_KEY` só é usada pelo worker local (`automation/`) e nunca é
  importada pelo código do frontend.
- Rode o worker apenas em máquinas autorizadas pela imobiliária — quem tiver acesso ao
  perfil persistente do Chrome tem acesso à sessão logada na CredPago.

## Migrations do Supabase aplicadas neste trabalho

```bash
npx supabase db push
```

Isso aplica (idempotentemente):

- `20260704180000_consultas_credito_worker_local.sql` — colunas/índices/RLS/Realtime usados
  pelo fluxo de automação.
- `20260704190000_consultas_credito_status_check_automacao.sql` — amplia a constraint de
  `status` para aceitar `processando`, `recusado`, `em_analise` e `erro` (os valores legados
  continuam válidos).
- `20261008203000_loft_proposal_cancellation_queue.sql` — cria a fila persistente, leases,
  tentativas e RLS do cancelamento programado.
- `20261013100000_loft_cancellation_jobs_per_execution.sql` — torna a fila append-only por
  envio real, prepara/confirma o job em duas fases, preserva o snapshot dos IDs anteriores,
  permite múltiplas propostas por consulta e exige o ID exato devolvido por cada envio antes
  de qualquer cancelamento.
- `20261016183000_credit_automation_durable_queue.sql` — adiciona idempotência por operação,
  fila persistente com claim/lease/heartbeat versionados, estados técnicos separados, backoff,
  limite de admissão, circuito persistente e quarentena de resultados incertos.

### Operação contínua em produção

O frontend da Vercel não executa o Playwright. Em produção, o worker roda continuamente na
VPS pelo `automation/docker-compose.yml`, com `restart: unless-stopped`, uma aba isolada por
consulta e processamento serializado para preservar o estado da sessão do parceiro. O mesmo
processo consome a fila de cancelamentos e, no modo padrão `portal`, reutiliza essa sessão
autenticada. Atualizar apenas a Vercel não publica o worker: a imagem precisa ser reconstruída
na VPS e as migrations precisam ser aplicadas no Supabase. Como a migration nova troca a
assinatura da RPC, pare o worker antigo antes de aplicá-la e suba a imagem nova logo depois;
o procedimento coordenado está no documento de cancelamento.

As proteções contra fila travada são complementares:

- cada acesso ao Supabase, validação de login e consulta possui prazo máximo;
- a autenticação só é aceita quando há uma rota interna ou o formulário real de simulação;
- após falhas consecutivas, contexto e navegador são recriados sem reiniciar a VPS;
- indisponibilidade temporária do portal antes do envio devolve a consulta à fila em vez de
  registrar uma reprovação/erro definitivo;
- a resposta explícita de erro interno do portal após o envio aciona uma única recuperação
  automática (novo carregamento, novo preenchimento e novo envio), sem ciclo infinito;
- falhas do Supabase têm retentativa, não encerram o processo e preservam um resultado já lido;
- uma aba que excede o timeout é fechada antes de liberar a vaga, impedindo envio duplicado;
- leases interrompidos antes do envio voltam à fila; depois do início do envio ficam em
  `requer_verificacao`, impedindo duplicação por reenvio cego;
- `/health` mede se o loop está vivo e também expõe a prontidão e as métricas das duas filas;
  `/ready` exige autenticação, navegador, fila de simulações e, quando
  `LOFT_CANCELLATION_REQUIRED=true`, cancelamento habilitado, fila acessível e nenhuma falha
  operacional de cancelamento aguardando uma retentativa bem-sucedida;
- site e aplicativo usam Realtime com polling não sobreposto, cancelamento e timeout local.

O endpoint público de monitoramento é `https://automacao.noxfianca.com/health`; prontidão é
exposta em `https://automacao.noxfianca.com/ready`. Nunca exponha credenciais, cookies ou a
service role nesses endpoints.

Se o Login Loft exigir reCAPTCHA/OTP, a recuperação precisa de uma pessoa autorizada — o worker
não tenta contornar a verificação. Rode `npm run automation:interactive-login` em um computador
com interface gráfica, conclua o desafio na janela aberta e transfira o arquivo de sessão gerado
para a VPS pelo canal SSH já configurado. O processo volta a ser totalmente automático depois
que a sessão válida é carregada.

## Scripts disponíveis

| Script                                 | Descrição                                                          |
| -------------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                          | Sobe o frontend (Vite dev server)                                  |
| `npm run build`                        | Build de produção                                                  |
| `npm run automation:credpago`          | Inicia o worker local em loop contínuo                             |
| `npm run automation:once`              | Processa uma consulta pendente e encerra                           |
| `npm run automation:install-browsers`  | Baixa o Chromium do Playwright                                     |
| `npm run automation:interactive-login` | Renova a sessão com janela visível quando houver CAPTCHA/OTP       |
| `npm run test:automation`              | Testa detecção de login/sessão sem acessar dados reais de clientes |
