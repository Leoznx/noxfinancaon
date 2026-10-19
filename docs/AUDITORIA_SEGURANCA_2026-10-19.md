# Auditoria de segurança e correção — NOX Fiança (site)

Data: 2026-10-19
Repositório: noxfinancaon
Escopo: 36 Edge Functions, 139 rotas, 246 migrations SQL, integrações Asaas / D4Sign / Cakto / Z-API.

Metodologia: 4 varreduras paralelas (pagamentos, contratos/saques/comissões, frontend por cargo, RLS/migrations) + inspeção direta de fluxos críticos.

**Nenhuma alteração de código foi feita.** Esta é a lista para decisão.

---

## Resumo executivo

- 5 achados CRÍTICOS (um deles permite tomada de conta por CPF; outro quebra 100% dos refresh de fatura hoje; outro aceita qualquer palavra "cancel" como cancelamento de contrato; e um admin page sem guard de role).
- 15 achados HIGH (IDOR em várias Edge Functions, idempotência quebrada, valor de pagamento vindo do cliente, aceite de termos forjável, janela de inconsistência contrato×Asaas).
- 11 achados MEDIUM e 10 LOW.
- A base RLS já passou por bons endurecimentos recentes — a maioria dos riscos agora é na camada de **Edge Functions e server functions** que usam service_role e dependem de checks internos, não da RLS.

---

## CRÍTICO

### CR-1 — Tomada de conta de inquilino por CPF
`supabase/functions/account-access/index.ts:240-271`

No signup de inquilino, após criar o auth user, o código reivindica **toda `consultas_credito` cujo `tenant_document` bate com o CPF enviado** e vincula as faturas e documentos ao novo usuário — sem prova de posse do CPF (sem OTP, sem foto do documento, sem conferir o e-mail do consulta).

**Impacto:** quem souber o CPF da vítima (semi-público no Brasil) faz signup com qualquer e-mail e herda contratos pendentes, faturas (`faturas_inquilino`) e documentos (`documentos_proposta`). O guard `byCpf.profile_id !== userId` só dispara depois do inquilino legítimo ter se cadastrado — corrida "primeiro cadastro vence". Rate limit (5/h/IP+email) é contornável rodando por e-mails diferentes.

**Correção:** exigir prova out-of-band — token one-time enviado pelo corretor/imobiliária, ou match do e-mail já cadastrado na consulta. Nunca resolver vínculo só por CPF.

---

### CR-2 — `d4sign-webhook` trata qualquer substring "cancel" como cancelamento
`supabase/functions/d4sign-webhook/index.ts:103`

```ts
const cancelled = normalizedMessage.includes("cancel") || eventType === "3";
```

Qualquer mensagem D4Sign com "cancel" (ex.: "Signature cancellation declined", "Documento não cancelado", variações em idiomas) cancela apólice + assinatura Asaas e marca a apólice como cancelada.

**Impacto:** webhook ambíguo da D4Sign cancela contratos válidos; a dedupe de eventos previne reprocessar o MESMO payload, mas o primeiro webhook com essa forma, entregue antes do estado terminal, passa.

**Correção:** exigir `eventType === "3"` AND/OR substrings explícitos ("document cancelled" / "documento cancelado") com word boundary, não substring.

---

### CR-3 — `asaas-manage-payment` refresh crasha com ReferenceError
`supabase/functions/asaas-manage-payment/index.ts:468-473`

No branch `if (body.action === "refresh")`, o código usa `reissueApplied` e `status`, que só são declarados dentro do branch `reissue` (linhas 573-574).

**Impacto:** **toda** chamada de `action: "refresh"` em fatura com `asaas_payment_id` crasha com `ReferenceError`. O botão "atualizar status" de fatura individual está **100% quebrado em produção hoje**, e `reconcileContractAfterPayment` (que dispara D4Sign no primeiro pagamento) nunca roda nesse caminho.

**Correção:** mover o bloco `invoiceReissueApplied` para dentro do branch `reissue` (parece ser copy-paste perdido), ou guardar com `if (body.action === "reissue")`.

---

### CR-4 — `/admin/adicionar-usuarios` sem guard de role
`src/routes/admin.adicionar-usuarios.tsx:16-22`

```tsx
<ProtectedRoute>          // sem roles={[...]}
```

**Impacto:** qualquer usuário autenticado (inquilino, corretor, sessão demo) abre a página. Ela chama `supabase.from('profiles').select('*').in('role', ['admin','analista'])` — vaza o roster completo de admin/analista se a RLS deixar passar. O formulário POSTa para a Edge Function `invite-user` com `role: 'analista'|'admin'`. Se a função não validar o cargo do caller, qualquer um cria admins. O catch exibe "convite foi simulado" em erro, escondendo exploração.

**Correção:** `roles={["admin","admin_master"]}` + verificar que `invite-user` exige admin internamente.

---

### CR-5 — GRANT ALL blanket para `authenticated` em schema `public`
`supabase/migrations/20260604202701_ea67b07a-1fe8-4739-89d9-255e12d73abd.sql:121-122`

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
```

**Impacto:** toda tabela atual **e futura** em `public` fica com CRUD liberado para qualquer logged-in. Só RLS protege. Se uma migration futura criar tabela e esquecer `ENABLE ROW LEVEL SECURITY` ou `REVOKE ALL`, vira exposição total. Não é falha ativa hoje porque as tabelas sensíveis têm RLS — é um "default-allow" perigoso.

**Correção:** `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated` ao final da cadeia, e exigir grants explícitos por tabela nas novas migrations.

---

## HIGH

### HI-1 — `pagamentoCakto.functions.ts`: amount vem do cliente, sem validar ownership
`src/lib/pagamentoCakto.functions.ts:76-171`

O server function aceita `amount` e `consultationId`/`contractId` direto do cliente sem validar se o valor bate com a consulta e sem checar que a consulta pertence ao usuário autenticado (defesa-em-profundidade — RLS pode cobrir, mas não deve ser único guardrail).

**Impacto:** usuário mal-intencionado submete R$ 0,01 para a própria consulta cara → webhook da Cakto marca pago e segue para ativação. Fraude direta.

**Correção:** derivar o `amount` da consulta no backend, nunca do cliente. Validar `profile_id_solicitante === userId` ou chamar `assertCanManageConsultationBilling`.

### HI-2 — `asaas-create-customer` IDOR por allowlist de role
`supabase/functions/asaas-create-customer/index.ts:25-37`

Allowlist `["admin","financeiro","corretor","imobiliaria"]` concede acesso **incondicional** a qualquer corretor/imobiliária, não só o dono da proposta. **Correção:** usar `assertCanManageConsultationBilling`.

### HI-3 — `create-cakto-payment` sem ownership check
`supabase/functions/create-cakto-payment/index.ts:298-334, 456-546`

Autentica JWT mas usa `supabaseAdmin` (service_role) para ler e mutar sem chamar `assertCanManageConsultationBilling`. Confia na RLS, que pode ter gaps.

### HI-4 — `cakto-webhook` regride status em evento duplicado
`supabase/functions/cakto-webhook/index.ts:84-193`

Sem idempotência/ordenação; evento `waiting_payment` tardio depois de `paid` reverte `payment_status` para pendente, derrubando o fluxo de ativação.

### HI-5 — `asaas-create-subscription` chave de retry baseada em `new Date()`
`supabase/functions/asaas-create-subscription/index.ts:1484-1498`

`retryKey = ${initialKey}:card-retry:${providerEventAt}` com `providerEventAt = new Date().toISOString()` — toda chamada tem key diferente, `claimBillingOperation` não serializa mais. Clique duplo → duas chamadas `payWithCreditCard`.

### HI-6 — `d4sign-create-contract` qualquer `internal_users ativo` dispara
`supabase/functions/d4sign-create-contract/index.ts:30-38`

Não checa o `role` do internal_user. SDR/suporte/SAC consegue disparar D4Sign + e-mail/WhatsApp para o inquilino de qualquer consulta.

### HI-7 — `d4sign-webhook` race no período de supersessão
`supabase/functions/d4sign-webhook/index.ts:128-153` + `_shared/d4sign.ts:493-624`

Entre `supersedePendingD4SignDocument` inserir estado `cancelling` e resetar `d4sign_document_uuid`, um `finished` tardio para o UUID antigo marca signed e trava a mudança de período com erro.

### HI-8 — `d4sign-create-contract` janela de documento órfão
`supabase/functions/_shared/d4sign.ts:1347-1364`

Se o UPDATE local falha depois do `/uploadbinary` aceito pela D4Sign, documento fica na D4Sign sem registro local. Retry faz re-upload → doc órfão + webhooks em loop 503 eterno.

### HI-9 — `update-contract-period` parcialidade em cancelamentos Asaas
`supabase/functions/update-contract-period/index.ts:141-205`

Loop de cancelamentos no Asaas sem atomicidade; falha no meio deixa parte cancelada, parte ativa, e a mudança de período travada em `55P03`.

### HI-10 — `delete-account` sem business guard
`supabase/functions/delete-account/index.ts:34`

Qualquer JWT holder apaga o próprio auth user. Não checa faturas abertas, apólices ativas, comissões, saques pendentes. Corretor pode se auto-apagar para fugir de reversão de comissão.

### HI-11 — `/admin/permissoes` aberto para "analista"
`src/routes/admin.permissoes.tsx:14-19` + `salvar()` 68-80

Analista reescreve matriz de permissões direto do cliente (`delete` + `insert` em `cargo_permissoes`). Depende da RLS para não escalar.

### HI-12 — `admin.aprovacoes` sem debounce + `adminId` null
`src/routes/admin.aprovacoes.tsx:115-147`

`aprovar()`/`reprovar()` não têm estado de loading nem disable; clique múltiplo dispara múltiplos `update` + `notificacoes.insert`. `approved_by` pode ser `null` em clique rápido (adminId ainda não carregado).

### HI-13 — `consultas.$id.finalizar` fallback hardcoded de aceites
`src/routes/consultas.$id.finalizar.lazy.tsx:1143-1196`

Fallback do server function escreve `terms_accepted: true`, `property_not_wood_confirmed: true`, `insurance_restriction_warning_acknowledged: true` **incondicionalmente**, mesmo que o usuário nunca tenha marcado. Qualquer corretor que provoque uma falha transitória no server function registra aceites forjados.

### HI-14 — `admin.aprovacoes` bucket controlado pelo uploader
`src/routes/admin.aprovacoes.tsx:167-171`

`storage.from(doc.document_subtype || "approval-documents").createSignedUrl(doc.file_url, 600)` — `document_subtype` vem do uploader. Atacante que insira `documentos_proposta` com `document_subtype` montado consegue signed URL em bucket arbitrário usando o token do admin.

### HI-15 — IDOR em telas "staff-only" por confiar só na UI
`apolices.$id.lazy.tsx:136-164`, `consultas.$id.resultado.tsx:43-48`, `consultas.$id.finalizar.lazy.tsx:351-355`, `admin.contratos.tsx:30-37`

Queries sem filtro de dono, só UUID na URL. Se RLS tiver gap em qualquer role (imobiliaria, juridico), vira IDOR direto — CPF, score, renda, contrato alheio.

---

## MEDIUM (resumo)

- **ME-1** `/consulta-rapida` SEMPRE retorna "Pré-Aprovado" sem backend (`consulta-rapida.tsx:17-28`) — risco de PROCON.
- **ME-2** `admin.verificacoes` approve path não-transacional (`admin.verificacoes.tsx:177-220`) — doc "aprovado" mas profile fica `pendente_aprovacao`, usuário trava.
- **ME-3** `asaas-get-payment` role check incompleto + fail-open em erro Asaas.
- **ME-4** `asaas-create-payment` branch credit_card morto (`index.ts:207-224, 642-687`).
- **ME-5** `asaas-create-consolidated-invoice` cron sem validar UUID; secret concede controle total de billing.
- **ME-6** `asaas-reissue-payment` aceita `requestedBy` sem validar — trilha de auditoria falsificável via Z-API secret.
- **ME-7** `asaas-import-existing-subscription` sobrescreve `payment_type` sem histórico.
- **ME-8** `d4sign-webhook` secret via query param (vaza em access logs).
- **ME-9** `broker-agency-invitation` delega role check 100% à RPC (verificar se a função SQL checa `profiles.role`).
- **ME-10** `faturas_inquilino` policy "financeiro e analista" sem `TO authenticated` — defesa-em-profundidade quebrada.
- **ME-11** `profiles.email` sem UNIQUE case-insensitive — mudar email para `vitima@..` pode liberar linhas via subquery `cakto_payments`/`imoveis`/`inquilinos`/`consultas_credito`.
- **ME-12** `admin.aprovacoes`/`admin.verificacoes` inserem direto em `notificacoes` do cliente — qualquer staff monta mensagem/link arbitrário para qualquer `user_id` se RLS deixar.
- **ME-13** `apolices.index` e `consultas.index` filtram por `profile_id_solicitante` só no cliente.
- **ME-14** `admin.financeiro.tsx:1222` `window.open("")` + `document.write` sem noopener (XSS se HTML vier de dado).
- **ME-15** `window.open` sem `noopener,noreferrer` em múltiplos lugares (ver `apolices.$id.lazy.tsx`, `faturas-inquilinos.$id.lazy.tsx`, `admin.vagas.lazy.tsx`, `indicacao.tsx`).

---

## LOW (resumo)

- `delete-nox-employee` admin check aceita `status pendente_aprovacao`.
- `d4sign-webhook` pode rebaixar consulta já `ativado` em re-entrega tardia (`index.ts:320-347`).
- `mark-withdrawal-paid` sem idempotency key — retry gera uploads órfãos.
- `account-access/signup` sem rollback de auth user em falha de `profiles` update.
- `account-access.listSignupAgencies` lista imobiliárias publicamente.
- `calcular-comissoes-contrato` permite proprietário disparar (idempotente, mas semântica errada).
- `d4sign-create-contract` regex UUID loose (`/^[0-9a-f-]{36}$/i`).
- `is_admin(uuid)` SECURITY DEFINER sem `pg_catalog` no search_path.
- `blog_post_reactions` policy legada `USING (true)` ainda existe (SELECT público).
- `configuracoes.niveis-comissao` mockup sem onClick — botão "Salvar" não faz nada.
- `admin.conta-nox` dead code com handlers de internal_users ainda no bundle.
- `authStorage` persiste role em localStorage — UI pode mostrar views indevidas até reconciliar sessão (dados ainda protegidos por RLS).
- `nox_employee_invites` CREATE duplicado — confirmar que `token_hash` está em uso e não `invite_token` plaintext.
- `get_referrer_public_name` enumeração via códigos curtos de referral.

---

## Padrões já corretos (parabéns)

- RLS hardening recente (2026-07 em diante) fechou quase todos os `USING (true)` legados.
- `prevent_self_role_escalation` BEFORE UPDATE em `profiles`.
- Withdrawals pipeline com RLS + RPCs SECURITY DEFINER + colunas sensíveis cifradas.
- `claim_asaas_webhook_event` idempotência robusta no `asaas-webhook`.
- `d4sign-webhook` dedup via `claim_contract_signature_event` + SHA-256.
- `contract-document` usando `can_view_policy` RPC — IDOR defendido corretamente.
- Loginas (`login.tsx` e `login_.*nox.tsx`) com Zod + `safeInternalRedirect`.

---

## Prioridade sugerida para correção (ordem)

1. **CR-3** (`asaas-manage-payment` refresh crash) — está quebrado hoje, 1 linha, zero risco de regressão.
2. **CR-1** (takeover por CPF no signup inquilino) — vulnerabilidade real explorável.
3. **CR-2** (`d4sign-webhook` substring "cancel") — qualquer msg ambígua cancela contrato válido.
4. **CR-4** (`/admin/adicionar-usuarios` sem guard) — 1 linha.
5. **HI-1** (`pagamentoCakto` amount do cliente) — fraude financeira direta.
6. **HI-2, HI-3, HI-6, HI-13, HI-14** — IDOR / forjamento de aceites / signed URL em bucket arbitrário.
7. **HI-7, HI-8, HI-9** — correções de janelas de inconsistência em D4Sign/Asaas.
8. **CR-5 + ME-10 + ME-11** — defesa-em-profundidade RLS.
9. Resto (MEDIUM/LOW) em sprint de hygiene.

---

## Mobile (`noxfinancaonmobile`)

Esta auditoria foi apenas no site. Os seguintes achados têm paridade esperada no app:

- CR-1 (fluxo de signup de inquilino) — provavelmente também expõe no app.
- HI-1 (`pagamentoCakto` server function) — não existe no app; app chama diretamente a Edge Function? Verificar.
- CR-2 (`d4sign-webhook`) — backend compartilhado, afeta tudo que depende dele.
- CR-5 (GRANT blanket) — backend compartilhado.
- CR-3 (`asaas-manage-payment`) — se o app chama este endpoint, mesma falha.

Antes de corrigir no site, revisar `C:\Users\sixxleo\Documents\noxfinancaonmobile\docs\MOBILE_INTEGRATION_PLAN.md` para mapear quais rotas o app consome.

---

## Fora de escopo desta rodada

Não cheguei a cobrir em profundidade:

- Automação Playwright (`automation/`) — risco de credenciais em sessão exportada.
- Scripts `scripts/` — hooks de deploy.
- `supabase/functions/_shared/d4sign.ts` (284 KB — maior arquivo do projeto) — li parcialmente.
- `supabase/functions/sync-marketing-ads` e cron functions — não auditadas.
- `supabase/functions/notificar-time-comercial`, `notify-time-clock`, `process-*` — não auditadas em profundidade.
- Testes em `tests/` — não executados.
- Verificação se as RPCs SQL que o frontend chama (`criar_lead_site_publico`, `enqueue_credit_simulation`, `materializar_comissoes_vendedor`, etc.) têm proteção interna adequada.

Posso aprofundar qualquer uma dessas áreas numa próxima rodada se quiser.
