## Fase 2 — Camada interna NOX (aditiva, sem quebrar nada)

Tudo abaixo é **aditivo**. Nenhuma tabela existente é alterada destrutivamente; apenas novas colunas opcionais em `seller_commissions` (já criada na Fase 1) e novas **policies adicionais** em tabelas existentes (sem `DROP`/`ALTER` de policy atual).

---

### 1. Migração SQL (única, grande)

**Colunas adicionais em `seller_commissions`** (todas opcionais, sem quebrar dados atuais):
`reserve_amount numeric default 0`, `released_amount numeric default 0`, `reserve_release_at timestamptz`, `released_at timestamptz`, `canceled_at timestamptz`, `clawback_applied_at timestamptz`, `clawback_reason text`, `apolice_id uuid`, `mensalidade_id uuid`.

**Novo enum** `seller_commission_status`: `pendente | aguardando_primeira_parcela | elegivel | retida | liberada_parcial | liberada_total | estornada | cancelada` (cast a partir de `status text` atual; manter coluna text para compat).

**Tabela nova `internal_audit_logs`** (id, actor_user_id, actor_role, action, table_name, record_id, before jsonb, after jsonb, created_at) + GRANTs + RLS (admin_master + cargo dono lê o próprio; service_role tudo).

**Funções SQL:**
- `materializar_comissoes_vendedor(p_mes int, p_ano int)` — varre `seller_commissions` ligadas a apólices ativas com 1ª `mensalidades.status='pago'`, conta por vendedor no mês, aplica `calcular_comissao_vendedor` + `calcular_bonus_vendedor`, calcula `reserve_amount = total*0.15`, `released_amount = total*0.85`, `reserve_release_at = now()+60d`, `clawback_until = activation_date+90d`, faz upsert idempotente por `(seller_id, contract_ref, mes, ano)`. Atualiza `seller_performance`.
- `aplicar_clawback_vendedor()` — para cada `seller_commissions` cujo contrato foi cancelado antes de `clawback_until`: marca `status='estornada'`, `clawback_applied_at=now()`, zera `released_amount` futuro, registra log. Se cancelamentos > 20% no mês, marca bônus do mês seguinte como zerado (flag em `seller_performance.bonus_bloqueado`).
- `liberar_reservas_vendedor()` — onde `reserve_release_at <= now()` e `status not in ('estornada','cancelada')`: soma `reserve_amount` em `released_amount`, status → `liberada_total`, `released_at=now()`.

**Trigger** em `mensalidades` (AFTER UPDATE OF status): se virou `pago` e é a 1ª da apólice, chama `materializar_comissoes_vendedor` para o mês corrente (sem mexer no trigger `liberar_comissoes_apos_pagamento` existente — novo trigger irmão).

**Cron pg_cron diário** chamando `aplicar_clawback_vendedor()` + `liberar_reservas_vendedor()`.

**Policies adicionais (somente FOR SELECT/UPDATE adicionais, nada removido):**

| Tabela | Cargo | Acesso |
|---|---|---|
| consultas_credito | juridico | SELECT all, UPDATE em campos jurídicos |
| apolices | juridico, financeiro | SELECT all |
| documentos_proposta / documentos_contrato | juridico | SELECT all |
| faturas_inquilino, mensalidades, comissoes | financeiro | SELECT all, UPDATE status |
| solicitacoes_saque | financeiro | SELECT, UPDATE aprovação |
| leads, leads_contato | marketing | SELECT, UPDATE, INSERT |
| sales_materials | marketing | ALL |
| sales_leads | vendedor | SELECT/UPDATE só onde assigned_seller_id = uid próprio internal_users.id; marketing/admin_master ALL |
| seller_commissions | vendedor (próprio), financeiro (todos), admin_master (todos) |
| support_tickets | suporte (todos), demais (próprio) |
| profiles | suporte | SELECT campos básicos |

Helper SQL `internal_user_id(uid)` para mapear auth→internal_users.id.

---

### 2. Server functions novas (todas com `requireSupabaseAuth` + checagem `has_internal_role`)

`src/lib/`:
- `sales-leads.functions.ts` — `moveLeadStatus({leadId, fromStatus, toStatus})`, `closeLeadAsContract({leadId, apoliceId, valorMensal, fechadoEm, primeiraParcelaPaga})`.
- `seller-commissions.functions.ts` — `materializarComissoesMes({mes, ano})` (admin_master/financeiro), `liberarComissao(id)`, `estornarComissao(id, motivo)`, `listarMinhasComissoes()` (vendedor).
- `permissions.functions.ts` — `listRolePermissions()`, `updateRolePermission({role, module, action, allowed})` (admin_master; bloqueia desligar admin_master).
- `audit.functions.ts` — `logAction(...)`, `listAudit({filters})`.

---

### 3. Frontend novo / aditivo

- **Kanban real** `src/routes/vendedor.pipeline.tsx`: reescrito usando `@dnd-kit/core` + `@dnd-kit/sortable` (instalar). Cada coluna é `useDroppable`, cada card `useDraggable`. Em `onDragEnd`, otimista: atualiza estado, chama `moveLeadStatus`; em erro, reverte e `toast.error`. Coluna **Fechado** dispara `<FecharLeadModal>` (contrato, valor, data, checkbox 1ª parcela paga). Submit chama `closeLeadAsContract` que cria/vincula registro em `seller_commissions` com status `aguardando_primeira_parcela` ou `elegivel`.
- **Tela `/admin/permissoes-internas`** (`src/routes/admin.permissoes-internas.tsx`): grid cargo × módulo com switches; salva por célula; admin_master tem switches fixos ligados/disabled.
- **Componente `<RoleGuard module action>`** em `src/components/interno/RoleGuard.tsx`: checa `role_permissions` (cache via React Query) e renderiza "Você não tem permissão para acessar este módulo." quando bloqueado. Aplicado em `DashboardLayout` (filtra menu) e nas rotas internas.
- **`src/routes/vendedor.comissoes.tsx`**: já existe — ampliar para mostrar `reserve_amount`, `released_amount`, `reserve_release_at`, badge de status novo.
- **`src/routes/admin.equipe-comercial.tsx`**: botão "Materializar mês" → chama `materializarComissoesMes`.
- **`src/routes/admin.financeiro.tsx`** (verificar se existe; senão criar variante interna `/admin/comissoes-internas`): lista todas `seller_commissions`, ações liberar/estornar.

---

### 4. Auditoria

Helper `auditLog(action, table, recordId, before, after)` chamado em:
- `moveLeadStatus`, `closeLeadAsContract`
- `materializarComissoesMes`, `liberarComissao`, `estornarComissao`
- `updateRolePermission`
- aprovações jurídicas (server fn nova `aprovarConsultaJuridico` se necessário)
- encaminhamento de tickets

---

### 5. Login rápido

Manter intacto. `ensure-demo-users` já cria os 6 internos. Se algum vendedor demo não tiver linha em `internal_users`, edge function repara idempotente.

---

### 6. Garantias de não-regressão

- Zero `DROP`/`ALTER` em policies existentes.
- Trigger novo em `mensalidades` é independente do `liberar_comissoes_apos_pagamento` atual.
- Novas colunas em `seller_commissions` têm default — não quebram inserts atuais.
- Rotas atuais inalteradas; rotas novas: `/admin/permissoes-internas`.
- Login rápido antigo e novo continuam funcionando.

---

### Arquivos

**Criar:** 1 migração grande, `sales-leads.functions.ts`, `seller-commissions.functions.ts`, `permissions.functions.ts`, `audit.functions.ts`, `src/components/interno/RoleGuard.tsx`, `src/components/interno/FecharLeadModal.tsx`, `src/routes/admin.permissoes-internas.tsx`.

**Editar (aditivamente):** `src/routes/vendedor.pipeline.tsx` (DnD real), `src/routes/vendedor.comissoes.tsx` (campos novos), `src/routes/admin.equipe-comercial.tsx` (botão materializar), `src/components/DashboardLayout.tsx` (item "Permissões Internas" para admin_master), `package.json` (+ `@dnd-kit/core` `@dnd-kit/sortable`).

---

Confirma para eu rodar a migração e implementar tudo de uma vez? É grande — se preferir, posso quebrar em 2A (migração + comissões + clawback + reserva + RLS) e 2B (kanban DnD + matriz de permissões + auditoria UI).