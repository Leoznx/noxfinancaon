# Reativação e estabilização da automação de crédito — 2026-10-19

Este documento registra por que a simulação de crédito NOX → Loft parou, o que foi
corrigido e como religar o worker da VPS. Não contém CPF, CNPJ, cookie, token ou
credencial; os números abaixo são agregados.

## Contexto

A Loft liberou a conta da integração para o módulo Fiança (tela **Nova proposta**,
`/fianca-aluguel/imobiliaria/proposta`). A restrição `PROVIDER_ACCESS_RESTRICTED`
que parou a fila em 16–18/10 deixou de ser a barreira. Mesmo assim a automação seguia
sem processar nada, por duas razões independentes.

## O que estava parado (evidências)

### 1. O botão "Simular crédito" do site não chegava mais ao worker

Em 19/10 (commits `0b7be34` … `a165de2`) o site passou a chamar primeiro a Edge Function
`simular-loft`, um cliente OAuth2 "direto" para endpoints da Loft que **não têm contrato
oficial** (a própria documentação de 16/10 registra isso) e que sem credenciais devolvia
um resultado **"preview" falso** (`em_analise`, `proposalId = preview-…`).

- Quando a função falhava, o fluxo caía na fila, mas só depois de criar uma linha
  `painel_interno` pelo caminho antigo (`upsertConsultaCredito`), que reaproveita e
  sobrescreve a última consulta do mesmo usuário/CPF — exatamente o defeito que a
  migração da fila durável havia eliminado.
- Em produção: 4 solicitações de usuários reais (2 corretores, 2 imobiliárias) geraram
  linhas órfãs `painel_interno`. Em 2 delas existe a linha correspondente na fila; as
  outras 2 **nunca entraram na fila** (não há consulta equivalente).
- Nenhuma linha chegou a ser concluída por essa via; o aplicativo nunca teve o desvio.

### 2. O worker da VPS não tinha sessão válida e ficava em ciclo de falha

Estado observado em `/health` e em `automation_errors` (versão `c035400`):

| Sintoma | Causa (comprovada pelo código e pelos registros, salvo onde indicado "provável") |
| --- | --- |
| `auth` alternando `checking` → `required`, `lastAuthSuccessAt = null`, navegador recriado a cada 1–2 min | a sessão expirou e a renovação automática não concluía; a cada 2 falhas o worker recriava o Chromium, o que não resolve login |
| `O botão Entrar do portal não foi encontrado` | a checagem do botão era imediata; o Login Loft monta o botão depois dos campos |
| `locator.press / page.waitForTimeout: Target page, context or browser has been closed` | o watchdog da validação (90 s) era menor que navegação + login e fechava a aba no meio do login |
| `browser.newContext: Error setting storage state` e, depois, `Target page… has been closed` em todas as validações | arquivo de sessão inválido/truncado; a falha ao reabrir deixava o worker usando um navegador **já fechado** |
| `O portal da CredPago não informou o estado da autenticação` | a SPA da Loft leva de 2 a ~10 s depois de `domcontentloaded` para exibir o formulário; o worker decidia em 8 s |
| `net::ERR_ABORTED; maybe frame was detached` | redirecionamento do SSO durante `page.goto` tratado como portal indisponível |
| pico de CPU > 90 %, `AbortError` nas chamadas ao Supabase | provável: reinícios do Chromium em sequência (coincidem no tempo; causalidade não medida) |
| incidentes de "worker não pronto" repetidos | o runbook do reparador reinicia o worker para erros de autenticação/sessão, mesmo quando só uma pessoa resolve o login |

Fila no momento da análise: **15 consultas `queued`** (a mais antiga de 19/10 08:10 BRT,
7 solicitantes, 13 documentos distintos), 14 em `requer_verificacao` de 16–18/10
(`PROVIDER_ACCESS_RESTRICTED`, preservadas de propósito) e circuito fechado (12 falhas
acumuladas, última em 18/10 10:01).

## O que mudou

### Site
- `src/routes/consultas.nova.tsx` volta ao fluxo único: RPC `enqueue_credit_simulation`
  (fila durável com idempotência) → acompanhamento em tempo real.
- Removidos o desvio e o código que o sustentava: `src/lib/simularLoftDireto.ts`,
  `supabase/functions/simular-loft/` e `automation/loftApiClient.ts` /
  `loftDirectProcessor.ts` (endpoints inventados, sem contrato). Continuam no histórico do git.

### Aplicativo
Sem alteração: o app sempre usou `enqueue_credit_simulation` e já trata
`aguardando_autenticacao` e `aguardando_liberacao_parceiro`. A mudança no site restabelece a
paridade; não há contrato novo de banco, RPC ou texto.

### Backend compartilhado (Supabase)
Nenhuma migração. A Edge Function `simular-loft` continua publicada no Supabase até ser
removida manualmente (veja Pendências). O reset opcional do circuito está em
[Religar](#religar-o-worker-na-vps).

### Worker (VPS)
- **`sessionStore.ts` / `browserSession.ts`** — o arquivo de sessão é validado antes de ir ao
  Chromium (o estado entra como objeto), gravado de forma atômica com backup, e só é gravado
  quando o login está confirmado e o arquivo não foi trocado por uma pessoa. Arquivo
  corrompido vai para quarentena e o `.bak` é restaurado. O navegador morto é detectado antes
  do uso e um novo é aberto **antes** de fechar o antigo.
- **Recarga automática da sessão:** o worker observa o arquivo; ao ser substituído (novo login
  manual) ele recria o navegador e revalida em segundos, **sem reiniciar o container**.
- **`authRecovery.ts`** — classifica a falha (bloqueio do parceiro, CAPTCHA/código/credencial,
  sessão expirada, navegador ou portal indisponível). Backoff exponencial (30 s → 10 min);
  quando só uma pessoa resolve, espera 20 min em vez de insistir no login (cada tentativa extra
  conta contra a conta no provedor). O Chromium só é recriado por problema de navegador/portal e
  no máximo a cada 5 min.
- **Login:** aguarda o botão ser montado/habilitado e usa Enter como alternativa; CAPTCHA, código
  e credencial recusada não são reenviados; aba fechada ou timeout deixam de ser tratados como
  "credencial inválida".
- **Prazos:** a decisão "logado ou não" espera até 30 s (retorna na hora quando já sabe); o
  watchdog da validação passou de 90 s para 210 s (piso, mesmo que o `.env` da VPS ainda traga
  90000).
- **Navegação:** `ERR_ABORTED`/"frame was detached" com a página já em um destino válido deixa de
  contar como indisponibilidade; o aviso da primeira tentativa não vira incidente.
- **Etapa da fila (inalterada de propósito):** `aguardando_liberacao_parceiro` continua sendo o
  rótulo de qualquer espera pelo serviço externo, inclusive sessão expirada. O nome é histórico:
  site e aplicativo o apresentam como "Em análise" e o aplicativo só faz isso para essa etapa;
  relabelar para `aguardando_autenticacao` faria o celular voltar a exibir "Consultando…". O motivo
  real da espera fica em `/health` (`auth`, `authFailureKind`, `authRequiresHuman`).
- **Reparador:** não reinicia mais o worker quando `authRequiresHuman` está ativo — registra
  ação manual necessária.
- **Docker:** versões exatas em `automation/package.json` e `package-lock.json` versionado
  (antes cada rebuild resolvia `^1.49.1` para o Playwright mais novo do dia).
- **Ferramentas:** `npm run automation:interactive-login` agora exige marcadores reais da tela
  (antes aceitaria a casca da SPA deslogada) e inicializa o módulo Fiança;
  `npm run automation:refresh-vps-session` faz login, envio por scp e confirmação no `/health`;
  `npm run automation:copy-vps-command -- deploy|session` prepara, na área de transferência, os
  blocos para colar no terminal da Hostinger (sem SSH); `automation/deployVps.sh` implanta o worker
  com verificação de consultas ativas e imagem de rollback.
- **Arquivo de sessão ilegível** (por exemplo, copiado como root com permissão 600): o worker avisa,
  preserva o arquivo, nunca o sobrescreve e o recarrega sozinho quando ele passa a ser legível
  (trocar o dono não muda mtime nem tamanho, por isso a releitura).

### `/health` e `/ready`
Campos novos: `authRequiresHuman`, `authFailureKind`, `nextAuthCheckAt`, `lastBrowserRestartAt`,
`sessionSource` (`primary`/`backup`/`none`) e `sessionReloads`.

## Religar o worker na VPS

Pré-requisito: nenhuma simulação em andamento (`activeConsultations: 0` em `/health`).

**1. Atualizar o código e recriar somente o worker** (na VPS):

```bash
cd <checkout do repositório>
git pull --ff-only
bash automation/deployVps.sh
```

`deployVps.sh` recusa continuar se houver consulta em andamento, guarda a imagem atual para
rollback (`nox-automacao-credpago:pre-<versão>-<data>`), reconstrói e recria somente o worker e mostra
`/health` e os logs. **Sem SSH no seu computador:** `npm run automation:copy-vps-command -- deploy`
copia para a área de transferência um bloco que descobre a pasta do compose pelo Docker, faz o
`git pull` e roda esse script; cole no terminal da Hostinger (hPanel → VPS → Terminal).

**2. Renovar a sessão** (o login é sempre manual):

```bash
npm run automation:interactive-login        # abre o Chromium; você entra na Loft
```

Depois, uma de duas formas de levar `automation/data/credpago-session.json` à VPS:

- **Com SSH:** `export VPS_SSH_TARGET=usuario@IP_DA_VPS VPS_DATA_DIR=<pasta automation/data na VPS>` e
  `npm run automation:refresh-vps-session` (login, scp, troca atômica e confirmação no `/health`).
- **Sem SSH:** `npm run automation:copy-vps-command -- session` copia para a área de transferência um
  instalador (a sessão só vai para a área de transferência, nunca para a tela); cole no terminal da
  Hostinger. Ele confere o hash, guarda o arquivo anterior como `.pre-<data>`, ajusta o dono **antes** de
  renomear (o worker lê o arquivo assim que ele aparece) e desliga o histórico do shell durante a colagem.
  Depois de colar, copie outro texto para limpar a área de transferência.

O arquivo equivale a uma senha: nunca por e-mail ou chat; apague a cópia local depois. Se o arquivo
chegar com o dono errado, o worker avisa no log, preserva o arquivo e o recarrega sozinho quando ele
passar a ser legível (`docker exec -u root nox-automacao-credpago chown nox:nox /app/data/credpago-session.json`).

**3. Conferir** (`curl https://automacao.noxfianca.com/ready`): `ready: true`, `auth: "ok"`,
`cancellationReady: true`. Se `auth` for `required` com `authRequiresHuman: true`, repita o
passo 2.

**4. (Opcional) Zerar o contador do circuito**, acumulado desde a restrição de 16–18/10:

```sql
update public.credit_automation_provider_state
set consecutive_failures = 0, circuit_open_until = null, last_error_category = null
where provider_key = 'loft-primary';
```

**5. Acompanhar a primeira simulação real.** As 15 consultas em fila serão processadas em
ordem, uma por vez; cada envio cria uma proposta na Loft e agenda o cancelamento em 30 min.
Depois de concluídas, as 14 em `requer_verificacao` continuam aguardando reconciliação manual.

## Validação executada (19/10/2026)

- `npm run test:automation`: **176/176** (eram 140; 36 novos: sessão, navegador real, recuperação
  de autenticação, fluxo de login com páginas simuladas, monitor, reparador).
- TypeScript do worker: 0 erros (os 6 que já existiam no HEAD foram corrigidos).
- TypeScript do site, ESLint dos arquivos alterados e `npm run build`: aprovados; testes de crédito do
  site: 13/13.
- Contra o portal real, com uma sessão obtida por login manual e **sem enviar nenhuma simulação**:
  - ERP `Análise de crédito` e Fiança Aluguel `Nova proposta` validam todos os controles críticos;
    CEP, aluguel, condomínio e IPTU entram corretos (soma R$ 2.230,00 nas duas telas) e as coberturas
    ligam/desligam como esperado;
  - validação da tela de cancelamento e listagem de propostas (snapshot) funcionam;
  - worker real em execução local (Supabase simulado como inacessível): autentica pela sessão,
    recarrega ao ter o arquivo substituído (< 1 s), recupera de um arquivo truncado pelo backup,
    entra em "precisa de uma pessoa" sem tempestade de reinícios e volta a `ok` ~7 s depois de uma
    nova sessão ser colocada no arquivo.

**Não validado:** o envio real (POST), a leitura do resultado e o cancelamento posterior com a conta
já liberada — dependem de uma consulta real (veja a etapa 5) e de um worker implantado.

## Pendências

- Implantar o worker na VPS e renovar a sessão (etapas 1–2); exige acesso SSH à VPS.
- Remover a Edge Function publicada: `npx supabase functions delete simular-loft`.
- 2 solicitações perdidas pelo desvio (corretores, 19/10 15:31 e 15:44) precisam ser reenviadas
  pelos usuários ou reenfileiradas; 2 linhas `painel_interno` duplicadas (17:27 e 17:37) podem ser
  encerradas.
- Reconciliar as 14 consultas em `requer_verificacao` (16–18/10) consultando a Loft pelo identificador.
- Se a Loft passar a exigir CAPTCHA/OTP com frequência, avaliar um canal de entrega de sessão sem
  SSH (por exemplo, envio pelo painel administrativo) e alerta ativo para a equipe quando
  `authRequiresHuman` ficar ativo.

## Decisão operacional posterior — 19/10/2026

O proprietário decidiu que as 19 solicitações ainda na fila não deveriam criar propostas na Loft.
A migração `20261020002000_cancel_credit_backlog_and_expose_real_status.sql` encerra somente esse
conjunto histórico, preservando os registros para auditoria com `technical_status = 'cancelled'`,
`status = 'cancelada'` e `provider_submission_state = 'not_submitted'`. O corte imutável é
`queue_enqueued_at <= 2026-10-19 23:49:39.04028+00` e a transação aborta se não encontrar exatamente
19 registros. Novas simulações não entram nesse corte e seguem normalmente para a fila.

Site e aplicativo passaram a apresentar o estado real do worker: Na fila, Consultando, Aguardando
autenticação, Aguardando serviço externo, Aguardando resultado, Erro, Requer verificação ou
Cancelada sem envio. “Em análise” ficou reservado exclusivamente ao resultado real
`resultado = 'em_analise'` retornado pelo provedor.

## Correção do endpoint e da tela de espera — 20/10/2026

A página publicada pela Loft passou a enviar a simulação por
`/fianca-aluguel/imobiliaria/api/solicitacao/simulacao`. O observador do worker reconhecia apenas
`/api/internal-rental-guarantee/simulation`; por isso o clique acontecia, mas o POST real não era
associado à consulta. O worker preservava o caso como `requer_verificacao` e a fila causal de
cancelamento bloqueava a próxima solicitação para evitar duplicidade.

- O observador agora aceita os dois endpoints e interpreta o contrato atual
  `{ data: { id, analise: { status } } }`, mantendo o ID e o veredito ligados à mesma resposta.
- Um cancelamento ainda `prepared`, sem POST observado, é reconciliado contra a lista real da Loft e
  expira em dois minutos quando nenhuma proposta nova existe. Envios observados continuam respeitando
  integralmente a janela configurada de cancelamento.
- O experimento de API direta reintroduzido depois da reativação foi retirado do botão. Ele criava uma
  consulta intermediária e, ao falhar, criava outra para o worker. Cada clique volta a produzir uma
  única consulta na fila autenticada.
- As rotas de detalhe do site e do aplicativo não exibem mais uma tela terminal “Na fila” enquanto o
  worker está operando. Elas mantêm o modal **Consultando crédito** e só mostram Aprovado, Recusado ou
  Em análise depois de um resultado real da Loft. “Preparando a análise” passou a “Preparando a
  consulta” para não sugerir um veredito inexistente.
