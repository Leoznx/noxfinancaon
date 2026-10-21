# Auditoria de performance do dashboard — 21/10/2026

## Resumo executivo

A auditoria cobriu o site em produção, o código web, o aplicativo Expo/React Native e o PostgreSQL/Supabase compartilhado. As correções foram publicadas nos dois repositórios e a migração de backend foi aplicada no projeto Supabase vinculado.

Resultados mais relevantes para o perfil de imobiliária:

- entrada do dashboard: **18,17 s → 11,68–11,76 s** até a rede ficar ociosa, redução de aproximadamente **35%**;
- Carteira de Cobranças: **10,14 s → 1,14–1,19 s**, redução de **88%**;
- Meus Corretores: **4,67 s → 0,67–0,90 s**, redução de **81–86%**;
- Sinistros: **1,52 s → 0,77–0,81 s**, redução de **47–49%**;
- retorno às abas já visitadas: **0 requisições de API** e normalmente **0,31–0,40 s** até a estabilização;
- bundle SSR da rota `/dashboard`: **192,55 kB → 19,96 kB**, redução de **89,6%**;
- erro do RPC de corretores: **HTTP 400 + três consultas de fallback → HTTP 200 + uma consulta**.

A navegação visual passou a responder normalmente em menos de 200 ms. Houve um outlier de 667 ms na primeira abertura de Consultas em uma das execuções frias; a repetição ficou em 68–72 ms visual e 367–373 ms total.

O gargalo ainda aberto é a primeira leitura de `consultas_credito`, que permanece em aproximadamente 5,2–5,5 s no Supabase. Não foi criado índice especulativo: a tabela já tem índice pelo solicitante, e as inspeções de queries/índices do banco ficaram presas por mais de dois minutos. É necessário obter `EXPLAIN (ANALYZE, BUFFERS)` em uma janela segura antes de alterar o plano físico ou a política RLS.

## 1. Arquitetura encontrada

| Camada | Implementação real |
|---|---|
| Interface web | React 19.2, TypeScript, Tailwind CSS e Radix UI |
| Roteamento web | TanStack Start/Router com rotas por arquivo e chunks lazy |
| Build/hospedagem | Vite 7, Nitro com preset Vercel; deploy ligado à `main` |
| Aplicativo | Expo SDK 57, React Native 0.86 e Expo Router |
| Estado | estado local React, `AuthProvider` e cache de recursos em memória por sessão |
| Backend | Supabase Auth, PostgREST, Edge Functions e Realtime |
| Banco | PostgreSQL com funções RPC e Row Level Security (RLS) |
| Autorização | RLS no servidor; `ProtectedRoute`/menus são apenas a camada de UX |
| Bibliotecas pesadas | Recharts, PDF.js, Framer Motion, tabelas Radix e geração/leitura de PDF |

### Autenticação e shell

- `src/components/AuthProvider.tsx` confirma a sessão Supabase, carrega perfil, papel interno e permissões.
- `src/components/ProtectedRoute.tsx` controla a renderização da rota sem substituir as verificações do servidor.
- Cada rota ainda instancia `DashboardLayout`; portanto, o shell pode remontar. O impacto foi reduzido com cache de sessão, deduplicação e prefetch seletivo, sem reescrever toda a árvore de rotas.
- `src/lib/session-resource-cache.ts` mantém recursos por chave contendo o ID do usuário e é limpo no logout. Respostas antigas não podem repor dados depois da invalidação.

### Mapa de navegação e dados

| Aba | Componente/rota | Dados principais | Comportamento após a correção |
|---|---|---|---|
| Dashboard | `dashboard.tsx` + dashboard por papel | perfil, consultas, apólices, faturas, comissões, nível | componente por papel lazy; escopo da imobiliária compartilhado; realtime filtrado e com debounce |
| Nova Consulta | `consultas.nova` | somente dados do formulário/ação | estrutura imediata; não aguarda consultas de outras abas |
| Minhas Consultas | `consultas.index.lazy.tsx` | `consultas_credito` e relações necessárias | limite de 100, cache de 45 s, deduplicação e payload reduzido |
| Contratos Ativos | `apolices.index` | `apolices` e relações | cache por usuário e prefetch sob intenção |
| Faturas Inquilinos | `faturas-inquilinos.index` | resumos de apólices/faturas | cache por usuário; não bloqueia outras abas |
| Carteira de Cobranças | `carteira-cobrancas` | faturas, pagamentos, assinaturas e lotes | cargas independentes em paralelo; mesma leitura de faturas reutilizada |
| Minhas Comissões | `minhas-comissoes` | resumo, comissões, saques, contratos e nível | chamadas independentes em paralelo e cacheadas |
| Sinistros | `sinistros.lazy.tsx` | sinistros + apólices ativas | duas consultas paralelas e cacheadas; força atualização somente após mutação |
| Meus Corretores | `corretores-admin.lazy.tsx` | escopo da agência + RPC de membros | uma RPC, cache por usuário, prefetch, realtime com debounce e sem polling de 30 s |
| Perfil/Imóveis/Documentos | rotas próprias | perfil e dados do proprietário | estrutura rápida; cache adicional de repetição ainda é uma oportunidade |

O prefetch de código continua disponível para todas as rotas visíveis, mas dados só são aquecidos para a rota atual ou quando há intenção explícita (hover/foco/toque). Isso evita que o dashboard dispare todas as abas na inicialização.

## 2. Método de medição

Foi criado `scripts/auditDashboardPerformance.ts` com Playwright/Chromium. O script usa as contas demo existentes sem gravar credenciais e registra somente papel, rota e caminho do endpoint — sem IDs, query strings, tokens, documentos ou conteúdo financeiro.

Para cada aba foram medidos:

- clique até URL e `<main>` visíveis (`visual_ms`);
- clique até 250 ms sem requisições Supabase pendentes (`data_ready_ms`);
- número, duração, status e duplicidade de requisições Auth/PostgREST/Functions;
- primeira visita e repetição na mesma sessão;
- erros de console da aplicação, separando bloqueios conhecidos de analytics.

As medições foram feitas no domínio de produção, com navegador headless e rede real. A conta demo desativa o aquecimento geral de dados, então a primeira visita isola o custo da rota. Não havia credencial para um cliente com milhares de registros nem telemetria RUM/CrUX; portanto, o tempo visual é um proxy de resposta ao clique, não uma medição oficial de INP de campo. `Content-Length` também não estava presente em todas as respostas.

## 3. Causas confirmadas e evidências

### 3.1 Identidade da imobiliária consultada repetidamente

Antes, dashboard, navegação, cobrança, níveis e corretores resolviam a mesma imobiliária por consultas próprias. Na entrada medida, `/rest/v1/imobiliarias` aparecia três vezes, cada chamada levando cerca de 6–7 s em uma execução.

Correção: um escopo compartilhado por usuário usa `current_imobiliaria_id()`, fallback legado controlado e cache de cinco minutos. Nome e perfis de corretores são carregados em paralelo.

Evidência após a correção: entrada da imobiliária caiu de 20 para 16 requisições; as três leituras longas de imobiliária foram substituídas por uma RPC curta e uma leitura direta.

### 3.2 Aquecimento de todas as abas na entrada

`navigation-warmup.ts` recebia todas as rotas também como alvos de dados. Isso criava concorrência entre chamadas invisíveis e o conteúdo que o usuário realmente escolheu.

Correção: código é pré-carregado com concorrência limitada, mas dados somente da rota atual. Hover/foco/toque promove a próxima rota na fila.

### 3.3 Realtime amplo, foco e polling causando tempestades

Os dashboards reagiam a mudanças globais de tabelas e ignoravam dados ainda frescos. “Meus Corretores” combinava realtime, foco e polling fixo de 30 s.

Correção: filtros por usuário/agência, debounce de 300 ms, cache respeitado no foco e remoção do polling. Atualizações após mutações continuam forçadas.

### 3.4 Carteira carregava faturas duas vezes

Dois componentes da Carteira buscavam `faturas_inquilino` separadamente. A linha de base registrou a duplicidade e nove requisições.

Correção: ambos reutilizam a mesma promessa/entrada de cache. A rota passou a seis requisições, sem duplicidade, e as independentes são paralelas.

### 3.5 Sinistros refazia consultas sequenciais em toda montagem

Correção: sinistros e apólices ativas passaram a carregar em paralelo e compartilhar cache de 45 s. A repetição não chama a API.

### 3.6 Bundle inicial do dashboard continha todos os papéis e gráficos

`dashboard.tsx` importava estaticamente dashboards de imobiliária, corretor, proprietário, jurídico, financeiro e marketing. Recharts entrava no caminho inicial mesmo quando o papel não o usava.

Correção: cada dashboard de papel é importado de forma lazy com estrutura visual imediata. O chunk SSR da rota caiu de 192,55 kB para 19,96 kB. Recharts continua disponível no chunk compartilhado de gráficos, mas não é mais requisito de todos os papéis na abertura da rota.

### 3.7 RPC de corretores quebrada no banco remoto

A primeira medição após instrumentar status HTTP mostrou:

- `POST /rest/v1/rpc/list_my_broker_agency_members` → HTTP 400;
- PostgreSQL `0A000`: `invalid UNION/INTERSECT/EXCEPT ORDER BY clause`;
- o cliente então executava três consultas de fallback.

O histórico remoto marcava a migração corretiva antiga como aplicada, mas a definição ativa ainda era a versão inválida. Foi criada e aplicada uma nova migração idempotente que envolve o `UNION ALL` em uma subconsulta e ordena o resultado externo. RLS, `SECURITY DEFINER`, `search_path` e grants foram preservados.

Resultado: RPC HTTP 200 em 276–390 ms, uma requisição, sem erro de console.

### 3.8 Consulta principal ainda lenta no Supabase

`supabase inspect db table-stats` mostrou:

- `consultas_credito`: aproximadamente 785 linhas;
- tabela: 3,3 MB; índices: 536 kB;
- mais de 2.071.000 varreduras sequenciais acumuladas.

A consulta de lista leva 5,2–5,5 s apesar do volume pequeno. Já existe `idx_consultas_profile_solicitante (profile_id_solicitante, created_at DESC)`, e a política RLS usa `eh_dono_ou_imobiliaria_da_consulta(...)`, que consulta corretores/imobiliárias por linha visível. Isso é evidência de custo no plano/RLS, mas ainda não prova qual novo índice ou reescrita será correto.

As inspeções remotas de outliers e índices não concluíram em mais de dois minutos e foram interrompidas para não manter carga em produção. Nenhum índice ou relaxamento de RLS foi aplicado sem plano de execução.

## 4. Comparativo de desempenho

Formato das células: **resposta visual / dados prontos**. A linha de base e a validação usam a mesma automação e o mesmo domínio. As faixas finais de imobiliária são duas execuções consecutivas depois do deploy web e da migração de banco.

### Imobiliária

| Aba | Antes | Depois | Melhoria de dados |
|---|---:|---:|---:|
| Dashboard inicial | 3,94 s / 18,17 s | 2,60–2,78 s / 11,68–11,76 s | 35–36% |
| Nova Consulta | não capturado | 91–167 ms / 389–452 ms | sem base comparável |
| Minhas Consultas | 59 ms / 11,02 s | 78–667 ms / 5,94–6,33 s | 43–46% |
| Contratos Ativos | 55 ms / 1,75 s | 71–104 ms / 717–768 ms | 56–59% |
| Faturas Inquilinos | 58 ms / 965 ms | 64–66 ms / 755–814 ms | 16–22% |
| Carteira de Cobranças | 71 ms / 10,14 s | 80–96 ms / 1,14–1,19 s | 88–89% |
| Abrir Sinistro | 57 ms / 1,52 s | 53–64 ms / 774–811 ms | 47–49% |
| Meus Corretores | 56 ms / 4,67 s | 56–67 ms / 672–899 ms | 81–86% |

Na repetição final, todas as abas acima fizeram **zero requisições** e estabilizaram entre **306 e 400 ms**. Casos com base específica:

| Aba repetida | Antes | Depois | Melhoria |
|---|---:|---:|---:|
| Sinistros | 48 ms / 2,47 s | 55–73 ms / 353–370 ms | ~85% |
| Meus Corretores | 63 ms / 5,21 s | 63–70 ms / 350–363 ms | ~93% |

### Corretor

Uma execução pós-deploy apresentou latência global de rede maior na entrada, por isso resultados negativos pequenos não são atribuídos a regressão de código. A evidência determinística é a eliminação de chamadas repetidas.

| Aba | Antes (dados) | Depois (dados) | Leitura |
|---|---:|---:|---|
| Dashboard inicial | 7,44 s | 14,29 s | inconclusivo; autenticação/rede da execução posterior mais lentas |
| Minhas Consultas | 3,39 s | 3,35 s | estável |
| Contratos Ativos | 785 ms | 1,31 s | inconclusivo por variação de rede |
| Faturas Inquilinos | 779 ms | 1,12 s | inconclusivo por variação de rede |
| Carteira | 1,64 s, 6 req. | 1,76 s, 5 req. | duplicidade eliminada; tempo de rede variou |
| Comissões | 833 ms | 1,14 s | inconclusivo por variação de rede |
| Sinistros | 1,14 s | 828 ms | 27% melhor |
| Plano de Carreira | 686 ms | 675 ms | estável |
| Perfil | 729 ms | 722 ms | estável |
| Sinistros repetido | 7,28 s | 357 ms | 95% melhor |

As demais rotas cacheadas repetidas ficaram em aproximadamente 336–374 ms e sem API.

### Proprietário

| Aba | Antes (dados) | Depois (dados) | Melhoria |
|---|---:|---:|---:|
| Dashboard inicial | 4,40 s | 3,91 s | 11% |
| Minhas Consultas | 5,53 s | 5,68 s | inconclusivo por variação de rede |
| Contratos Ativos | 1,04 s | 1,07 s | estável |
| Meus Imóveis | 684 ms | 333 ms | 51% |
| Documentos | 778 ms | 324 ms | 58% |
| Perfil | 1,13 s | 343 ms | 70% |

Imóveis, Documentos e Perfil ainda consultam novamente na revisita; são oportunidades de cache por usuário para uma próxima rodada.

## 5. Alterações implementadas

### Site

- cache seguro por usuário, deduplicação de promessas e preservação de dados durante atualização;
- escopo centralizado de imobiliária;
- warmup seletivo de código/dados;
- lazy loading dos dashboards por papel;
- consultas paralelas de sinistros e módulos financeiros;
- remoção da duplicidade de faturas na Carteira;
- realtime filtrado e com debounce;
- remoção de polling de corretores;
- cache/prefetch da equipe de corretores;
- redução do payload da lista de consultas sem retirar campos usados por status, pesquisa, valor ou apresentação;
- harness Playwright reprodutível com status HTTP e detecção de duplicidade.

Arquivos principais: `DashboardLayout.tsx`, `ImobiliariaDashboard.tsx`, `CorretorDashboard.tsx`, `dashboard.tsx`, `corretores-admin.lazy.tsx`, `sinistros.lazy.tsx`, `agency-scope.ts`, `dashboard-navigation-data.ts`, `imobiliaria-dashboard.ts`, `billing-scope.ts`, `carteira-cobrancas-data.ts`, `cobrancas-avulsas-data.ts`, `sinistros-data.ts`, `navigation-warmup.ts` e os testes associados.

### Aplicativo

- mesmas chaves de cache por usuário e escopo de agência;
- warmup de dados somente da tela atual/intenção do usuário;
- sinistros e apólices em paralelo;
- filtros e debounce de realtime;
- cache/prefetch de corretores e remoção do polling de 30 s;
- invalidação forçada após vínculo, desvínculo ou alteração de comissão;
- dependências alinhadas aos patches exatos do Expo SDK 57.

Arquivos principais: `src/app/sinistros.tsx`, `src/app/corretores-admin.tsx`, `src/components/bottom-navigation.tsx`, `src/components/imobiliaria-dashboard.tsx`, `src/lib/agency-scope.ts`, `apolices.ts`, `billing-scope.ts`, `corretores.ts`, `dashboard-navigation-data.ts`, `imobiliaria-dashboard.ts`, `navigation-warmup.ts` e testes.

### Backend compartilhado

- migração `20261021120000_reapply_broker_agency_members_union_order.sql` aplicada;
- nenhuma linha de cliente, contrato, comissão, fatura ou pagamento foi alterada;
- nenhuma política RLS foi removida ou relaxada;
- a função manteve `SECURITY DEFINER`, `search_path` restrito e execução somente para `authenticated`/`service_role`.

## 6. Testes e validações

### Site

- `npm run typecheck`: aprovado;
- `npm run lint`: 0 erros; 7 avisos preexistentes de Fast Refresh;
- `npm run build`: aprovado em Vite 7.3.7/Nitro/Vercel;
- navegação + cache: 9/9 testes;
- faturamento: 8/8 testes;
- pagamentos/contratos/faturas: 57/57 testes;
- Playwright em produção: corretor, imobiliária e proprietário; primeira visita e repetição;
- validação final da imobiliária repetida duas vezes após migração: sem erros de aplicação.

### Aplicativo

- `npm run check`: lint, TypeScript, `expo install --check` e Expo Doctor 21/21;
- navegação + cache: 9/9 testes;
- `npm run export:all`: exportações iOS, Android e Web aprovadas; 66 rotas estáticas.

### Banco

- `supabase db push --dry-run`: somente a migração esperada;
- `supabase db push --yes`: migração aplicada com sucesso;
- `supabase migration list`: versão local/remota `20261021120000` alinhada;
- teste real via PostgREST: RPC retornando HTTP 200, sem fallback e sem erro de console.

## 7. Segurança, integridade e regressões

- autenticação e autorização continuam validadas pelo Supabase/RLS;
- caches são isolados pelo ID autenticado e descartados no logout;
- dados de uma agência não são guardados em cache global sem escopo;
- nenhuma fórmula financeira, regra de comissão ou estado contratual foi modificada;
- testes de billing e pagamentos confirmaram 65 cenários, incluindo os 16 cenários obrigatórios de cobrança;
- nenhuma credencial, token, CPF/CNPJ, ID de cliente ou conteúdo financeiro foi incluído nos logs/relatório;
- atualizações de equipe continuam reativas e mutações forçam revalidação;
- falhas de atualização preservam o último conteúdo válido e exibem erro, sem trocar dados por uma lista vazia.

## 8. Pendências e riscos conhecidos

1. **Consulta de crédito no banco:** executar `EXPLAIN (ANALYZE, BUFFERS)` para a consulta PostgREST equivalente sob os papéis corretor e imobiliária, em réplica/staging ou janela controlada. Avaliar especificamente a RLS `eh_dono_ou_imobiliaria_da_consulta`, o filtro por solicitantes e a ordenação por `updated_at`.
2. **Entrada do dashboard:** ainda espera uma consulta de crédito de ~5,2 s e resolução de imobiliária de ~2,7 s. A estrutura aparece antes, mas o tempo total não atingiu a meta de 2 s.
3. **Perfis na entrada:** ainda há três leituras de `profiles` por consumidores diferentes. Elas são curtas (~0,36–0,74 s), mas podem ser consolidadas com cuidado no `AuthProvider`.
4. **Proprietário em revisitas:** Imóveis, Documentos e Perfil ainda não reutilizam cache de rota.
5. **Escala acima de 100 consultas:** a lista está limitada a 100 registros, evitando renderização de milhares, mas ainda não oferece paginação completa para acessar o histórico além desse limite. Implementar paginação exige preservar filtros/ordenação e validar o contrato de produto.
6. **INP real:** instalar/consultar RUM ou Web Vitals em produção para obter p75 real por dispositivo; os números desta auditoria são de laboratório.
7. **Dependências:** `npm audit fix` removeu o problema crítico sem breaking changes. Permanecem avisos moderados/altos em ferramentas de build Lovable/Tailwind e Expo/Metro cuja correção automática exige versões incompatíveis; `--force` não foi usado.

## 9. Commits e publicação

- Site: `94ffa52` e `7ff8bf2` (publicados na `main` e implantados pela Vercel).
- Aplicativo: `4c782ab` e `e4d3444` (publicados na `main`).
- Backend: migração `20261021120000` aplicada ao Supabase compartilhado; o arquivo da migração e este relatório acompanham o commit final da auditoria.
