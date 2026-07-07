# NOX FINANÇA

Sistema para corretores e administradores de seguro fiança locatícia. Frontend em React/Vite/TanStack Start + TypeScript, backend em Supabase.

## Automação de simulação de crédito (CredPago)

A tela **Nova Consulta** (`/consultas/nova`) permite ao corretor simular crédito no site da
CredPago (`https://credpago.com/imobiliaria/proposta`) sem sair do NOX FINANÇA. O fluxo é:

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

### Múltiplos corretores consultando ao mesmo tempo

O worker roda **um único** navegador/contexto persistente (`chromium.launchPersistentContext`)
por processo, e cada consulta abre sua **própria aba** (`context.newPage()`) dentro desse
mesmo contexto — nunca reaproveita a aba de outra consulta, nunca lança um segundo processo de
Chrome apontando pro mesmo perfil. Isso permite processar várias consultas em paralelo sem
misturar dados nem arriscar corromper o perfil.

- **Fila com limite de concorrência** (`MAX_CONCURRENT_CONSULTAS`, padrão `3`): se chegarem
  mais consultas do que o limite, as excedentes esperam e começam automaticamente assim que uma
  aba libera.
- **Isolamento por consulta**: cada consulta tem sua própria aba, seus próprios dados (vindos
  da linha do Supabase) e seu próprio bloco de log prefixado com os 8 primeiros caracteres do
  `id` (ex.: `[4dfbfa8f] Preenchendo dados`) — dá pra acompanhar várias consultas ao mesmo tempo
  no terminal sem confundir uma com a outra.
- **Reivindicação atômica**: antes de processar, o worker faz um `UPDATE ... WHERE status =
  'pendente'` condicional — se duas execuções tentarem pegar a mesma consulta ao mesmo tempo,
  só uma consegue: a outra recebe zero linhas afetadas e segue para a próxima. Isso é o que
  garante que o resultado nunca vai parar na consulta errada.
- **Timeout por consulta** (`CONSULTA_TIMEOUT_MS`, padrão `90000` = 90s): se uma consulta travar
  na CredPago, só ela é marcada como `erro` — as outras continuam rodando normalmente.
- **Fechamento seguro**: só a aba da consulta que terminou é fechada (`page.close()`). O
  navegador/contexto inteiro só fecha quando o worker inteiro é encerrado (Ctrl+C ou fim do
  `--once`), e mesmo aí ele espera todas as consultas em andamento terminarem antes de fechar.
- **Login compartilhado**: se várias abas detectarem "não logado" ao mesmo tempo (típico só na
  primeiríssima execução, com o perfil ainda vazio), o worker mostra o prompt de login **uma
  única vez** no terminal — as outras abas esperam essa mesma confirmação e depois recarregam
  sozinhas para herdar a sessão (cookies são por contexto, não por aba).

⚠️ **Não rode `npm run automation:credpago` duas vezes ao mesmo tempo** (dois terminais, dois
processos) apontando para o mesmo `CREDPAGO_PROFILE_DIR` — isso sim arrisca conflito no perfil
do Chrome. Se precisar de mais capacidade, aumente `MAX_CONCURRENT_CONSULTAS` em vez de abrir um
segundo processo.

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
  credpagoWorker.ts       # loop com fila de concorrência: N abas em paralelo, timeout e claim atômico por consulta
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

| Variável | Onde conseguir |
|---|---|
| `SUPABASE_URL` | Mesma URL do projeto usado no frontend (`https://njheoytyidsghittjilr.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Painel Supabase → Project Settings → API → `service_role` (secreta!) |
| `CREDPAGO_PROFILE_DIR` | Pasta do perfil do Chrome (padrão: `./automation/chrome-profile-credpago`) |
| `AUTOMATION_POLL_INTERVAL_MS` | Intervalo de verificação de novas consultas (padrão: `5000`) |
| `CREDPAGO_URL` | `https://credpago.com/imobiliaria/proposta` |
| `MAX_CONCURRENT_CONSULTAS` | Quantas consultas rodam em paralelo, cada uma em sua aba (padrão: `3`) |
| `CONSULTA_TIMEOUT_MS` | Tempo máximo por consulta antes de marcar erro (padrão: `90000`) |
| `HEADLESS` | `true` para rodar sem janela visível (requer sessão já logada) — padrão `false` |

> Nota: o `.env.example` sugerido para este tipo de automação às vezes cita
> `CHROME_USER_DATA_DIR`/`CHROME_PROFILE_DIRECTORY` (nomenclatura de Selenium/Chrome puro).
> Como o worker usa Playwright (`chromium.launchPersistentContext`), o equivalente exato já
> existente é `CREDPAGO_PROFILE_DIR` — não é preciso (nem existe) um "profile directory"
> separado dentro dele.

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

### Testar com 2 ou 3 consultas simultâneas

1. Deixe `npm run dev` e `npm run automation:credpago` rodando normalmente.
2. Abra o NOX FINANÇA em **duas ou três abas/janelas diferentes** do navegador (pode ser a
   mesma conta de corretor ou contas diferentes).
3. Em cada aba, vá em **Nova Consulta**, preencha dados de um cliente fictício diferente (CPF,
   CEP e aluguel diferentes em cada aba) e clique em **Simular crédito** — o mais próximo
   possível umas das outras no tempo, pra forçar a concorrência.
4. No terminal do worker, você deve ver logs entrelaçados com prefixos diferentes, um por
   consulta, por exemplo:
   ```
   [4dfbfa8f] Consulta recebida (documento 111.***.***-35)
   [8b3a1539] Consulta recebida (documento 039.***.***-35)
   [4dfbfa8f] Abrindo CredPago
   [8b3a1539] Abrindo CredPago
   [4dfbfa8f] Preenchendo dados
   [8b3a1539] Preenchendo dados
   [4dfbfa8f] Resultado identificado: aprovado
   [8b3a1539] Resultado identificado: em_analise
   ```
5. Na janela do Chrome, você verá **abas separadas** (uma por consulta) preenchendo e enviando
   ao mesmo tempo, sem uma interferir na outra.
6. Cada aba do NOX FINANÇA deve fechar seu próprio modal e redirecionar para o `/status` da
   **sua própria** consulta, com o status correto — nunca o de outra aba.
7. Para testar o limite da fila, ajuste `MAX_CONCURRENT_CONSULTAS=1` no `automation/.env`,
   reinicie o worker e dispare 2 consultas — a segunda deve ficar visivelmente "pendente" (sem
   abrir aba nova) até a primeira terminar, e só então começar sozinha.

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

## Scripts disponíveis

| Script | Descrição |
|---|---|
| `npm run dev` | Sobe o frontend (Vite dev server) |
| `npm run build` | Build de produção |
| `npm run automation:credpago` | Inicia o worker local em loop contínuo |
| `npm run automation:once` | Processa as consultas pendentes disponíveis (até `MAX_CONCURRENT_CONSULTAS`) e encerra |
| `npm run automation:install-browsers` | Baixa o Chromium do Playwright |
