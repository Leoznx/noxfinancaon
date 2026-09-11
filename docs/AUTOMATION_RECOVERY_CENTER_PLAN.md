# Plano técnico — Central de Auto-Recuperação da automação de crédito

Data da auditoria: 11/09/2026
Escopo: site NOX Fiança, aplicativo Expo, Supabase compartilhado e worker Playwright na VPS.

## Estado encontrado antes das alterações

- Site: TanStack Start/React 19, Supabase JS e deploy automático da branch `main` na Vercel.
- Aplicativo: Expo SDK 57/React Native 0.86, Expo Router e o mesmo projeto Supabase do site.
- Automação: um container Docker `nox-automacao-credpago`, Playwright 1.49.1, Chromium headless, sessão portátil em `/app/data/credpago-session.json`, health em `127.0.0.1:3000` e Nginx em `https://automacao.noxfianca.com`.
- Supervisão: `restart: unless-stopped`; não há PM2/systemd específico nem worker separado de reparo.
- VPS: 7,8 GiB de RAM (aprox. 6,9 GiB disponíveis durante a auditoria), disco de 96 GiB com 12% usado, container saudável e autenticação/fila prontas.
- Dados dos últimos 30 dias: 198 simulações `nox_financa`, 18 erros finais e nenhuma consulta presa em `processando` no momento da auditoria.
- Falha operacional observada: `Gateway Timeout` no acesso do worker à fila Supabase. Os erros históricos também contêm falhas de seletor, autenticação e mensagens não classificadas.
- Segurança existente: RLS, `public.is_admin`, `public.has_internal_role`, `internal_audit_logs`, service role somente no backend/worker e storage privado já são padrões do projeto.
- Alteração local alheia preservada: `src/components/landing/home-hero.css` não pertence a esta tarefa e não será incluída em commit.

## Arquitetura escolhida

```text
site/app (admin autenticado)
  -> RPC SECURITY DEFINER start_automation_repair
  -> repair_jobs no Supabase (persistente e idempotente)
  -> processo repairWorker independente do processo credpagoWorker
  -> diagnóstico + runbook permitido + snapshot
  -> supervisor reinicia somente o processo de crédito quando necessário
  -> health checks + validação Playwright sem enviar CPF/CNPJ
  -> repair_steps/system_health/automation_errors
  -> Supabase Realtime + polling de fallback no site e app
```

O worker de reparo e o worker de crédito serão processos separados sob um supervisor mínimo no mesmo container. Isso permite reiniciar apenas o worker/Chromium, preserva o job quando o navegador ou a aba administrativa fecham e evita conceder acesso irrestrito ao Docker socket ou comandos shell arbitrários. Uma queda do container inteiro continua coberta pelo `restart: unless-stopped`.

## Banco e contratos

Nova migration:

- adiciona `correlation_id` a `consultas_credito`, com padrão `NOX-SIM-YYYYMMDD-XXXXXXXX`, índice único e backfill;
- cria `automation_errors`, `repair_jobs`, `repair_steps`, `repair_locks` e `system_health`;
- cria bucket privado `automation-error-artifacts` e política de leitura somente para admin/admin master;
- habilita RLS sem políticas de exclusão pela interface comum;
- publica as tabelas operacionais no Supabase Realtime;
- cria RPCs protegidas:
  - `start_automation_repair(uuid)` — valida admin no servidor, aplica lock distribuído e devolve job existente quando já há reparo ativo;
  - `claim_next_repair_job(text)` — somente service role, usa lease e `SKIP LOCKED`;
  - `record_automation_error(jsonb)` — somente service role, deduplica por correlação/fingerprint;
  - `renew_repair_job_lease(uuid,text)` e `release_repair_lock(uuid,text)` — somente service role;
- sincroniza o estado legível do erro a partir da máquina de estados do job;
- registra início de reparo em `internal_audit_logs`.

Estados do job: `QUEUED`, `COLLECTING_CONTEXT`, `DIAGNOSING`, `SNAPSHOTTING`, `REPAIRING`, `RESTARTING`, `VALIDATING`, `SUCCESS`, `FAILED`, `ROLLING_BACK`, `ROLLED_BACK`, `MANUAL_REQUIRED`.

## Worker e VPS

Arquivos novos previstos em `automation/`:

- `recoveryTypes.ts`: contratos, categorias, severidades e estados;
- `errorClassifier.ts`: classificação determinística e diagnóstico inicial;
- `redaction.ts`: remoção de credenciais, tokens, CPF/CNPJ, e-mail, telefone e limites de payload;
- `correlation.ts`: geração/validação de correlation IDs;
- `automationLock.ts`: mutex `credit-automation.lock`, heartbeat e detecção segura de lock obsoleto;
- `safeArtifacts.ts`: screenshot mascarada e texto DOM limitado, sem capturar resultado pós-envio;
- `errorReporter.ts`: persistência idempotente, storage privado e spool local redigido em falha de banco;
- `repairEngine.ts`: máquina de estados, máximo de 3 tentativas, backoff e rollback quando o runbook oferecer reversão real;
- `systemDiagnostics.ts`: CPU, memória/cgroup, disco, rede, banco, worker, navegador, fila e versão;
- `repairWorker.ts`: consumidor persistente de jobs, watchdog e health independente;
- `supervisor.ts`: mantém processos de crédito e reparo separados e aceita apenas a ação interna fixa de reiniciar o processo de crédito;
- testes unitários/de integração simulada para correlação, classificação, redaction, lock, retentativa, restart, falha de validação, rollback e saúde.

Arquivos existentes previstos para alteração:

- `credpagoWorker.ts`: correlação fim a fim, captura de erro final, últimos passos, duração, lock, health enriquecido e logs estruturados;
- `credpagoSelectors.ts`: diagnóstico sanitizado e validação segura do formulário sem submissão;
- `env.ts`, `.env.example`: configurações validadas do repair worker, tokens apenas server-side e limites;
- `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, `package.json`: supervisor/processos, portas 3000/3001, volumes e health;
- `README.md`: operação, endpoints, runbooks, recuperação manual e rollback.

O Nginx receberá uma rota dedicada `/repair-health` para `127.0.0.1:3001/health`. Detalhes sensíveis continuarão fora da rota pública; o painel lê métricas sanitizadas do Supabase.

## Site

- `src/lib/automation-recovery.ts`: leitura tipada, RPC de correção, assinatura Realtime, polling e URL assinada de artefato;
- `src/routes/admin.central-erros.tsx`: cards, indicador online/instável/offline, filtros, lista responsiva, detalhe técnico/auditoria e modal de progresso real;
- `src/components/DashboardLayout.tsx`: item administrativo “Central de Erros”, invisível para analista e demais cargos;
- `src/lib/consultasCredito.ts`: correlation ID em criação e reenvio;
- tipos Supabase e árvore de rotas gerados/ajustados conforme o build.

## Aplicativo

- `src/lib/automation-recovery.ts`: mesmo contrato Supabase/RPC/Reatime do site;
- `src/app/admin/central-erros.tsx`: experiência nativa equivalente e responsiva;
- `src/constants/menu-items.ts`: item apenas para admin/admin master;
- `src/lib/consultas-credito.ts`: mesma correlação em criação e reenvio.

## Runbooks permitidos

- validar sessão e formulário sem enviar simulação;
- reiniciar somente o processo de crédito/Chromium quando não houver consulta ativa recente;
- aguardar dependência externa com backoff limitado;
- recuperar lock próprio somente quando comprovadamente obsoleto;
- limpar somente artefatos temporários pertencentes à automação e fora da retenção;
- testar Supabase/rede/portal e atualizar health.

Nunca serão aceitos comandos fornecidos por usuário, IA, mensagem de erro ou banco. CAPTCHA, OTP, credencial recusada, mudança de seletor não reconhecida, indisponibilidade externa persistente, migração quebrada e rollback de deploy sem imagem conhecida terminam em `MANUAL_REQUIRED`, sem falso sucesso.

## Riscos e mitigação

- **Duplicar simulação:** toda validação de reparo para antes do envio e nunca preenche documento; restart aguarda ausência de consulta ativa recente.
- **Segredos/PII em logs:** redaction central, tamanhos máximos, screenshot apenas quando segura, inputs mascarados e bucket privado.
- **Dois reparos concorrentes:** índice parcial, tabela `repair_locks`, lease e claim transacional.
- **Job perdido ao fechar navegador:** estado persistido no Supabase; UI reconecta por Realtime + polling.
- **Loop infinito:** máximo de três tentativas por job, backoff e estado terminal explícito.
- **Rollback enganoso:** só marcar `ROLLED_BACK` quando uma reversão real for executada e validada; caso contrário usar `FAILED` ou `MANUAL_REQUIRED`.
- **Worker de reparo comprometendo o host:** sem shell arbitrário e sem Docker socket; o supervisor só aceita uma mensagem IPC fixa vinda do processo conhecido.
- **Mudança de fornecedor/CAPTCHA:** não contornar proteções; registrar evidência sanitizada e exigir intervenção.

## Validação e publicação

- testes automatizados do worker/engine e validações estáticas de RLS/estado/progresso;
- typecheck, lint e build do site;
- TypeScript, lint, `expo install --check`, `expo-doctor` e export compatível no app;
- aplicação da migration no Supabase compartilhado;
- deploy da VPS com backup do checkout/configuração, rebuild, health local/público e validação Playwright segura;
- teste de acesso negado sem admin e teste de job admin quando houver sessão de teste apropriada;
- commits contendo somente arquivos desta tarefa e push de site e aplicativo para os GitHubs configurados.
