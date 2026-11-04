# Simulador demonstrativo isolado — entrega parcial, não publicar

## Escopo seguro implementado

As contas autenticadas com os quatro e-mails demo conhecidos e perfil correspondente recebem um simulador local nas entradas Nova consulta, Contratos ativos e Faturas. A identidade é revalidada com `auth.getUser()` e leitura do perfil pelo mesmo ID; marcadores de storage não autorizam o simulador. Falhas de autenticação/perfil mantêm a experiência bloqueada, sem montar os componentes operacionais dessas páginas.

O simulador tem cenários aprovado, recusado e em análise. O aprovado percorre análise, conferência fictícia, resumo de contrato, fatura e recibo demonstrativo. Não assina documentos. Dados e histórico existem somente no estado do componente; sair/reiniciar descarta o cenário. Não usa documentos existentes, upload, contato, Pix, boleto, checkout, envio, criação de usuários ou integração de contrato. Os dois acessos de verificação de identidade são leituras; as etapas seguintes não têm adaptadores de I/O.

As antigas funções `criarConsultaDemonstrativa` agora falham antes de qualquer acesso ao backend. No app, a entrada `demoDecision` da função genérica também é bloqueada. O site deixa de vincular CPF automaticamente no sign-in de demo; o app não registra push nem assina o store de notificações para esses e-mails.

## Limites e impedimentos para publicação

Esta é a parte segura permitida pela solicitação, não a conclusão do pedido de tornar todo o produto demonstrável. O simulador substitui o conteúdo dessas quatro entradas demo; ainda não reproduz os detalhes individuais das listas existentes. Outras rotas, links profundos, aquecimento de navegação, contextos globais e funções de servidor legados não estão cobertos por uma barreira universal contra escrita. O marcador demo residual ainda pode afetar leitores legados fora deste simulador. O teste de conta real garante apenas que a nova barreira não a converte em demo.

Não há garantia de isolamento global nem proteção nova no servidor contra clientes que ignorem a UI. Por isso, manter ambos os PRs em rascunho; não fazer merge/deploy. Antes de publicar, auditar todas as integrações e links profundos, implementar bloqueio central compatível com autenticação e cache e executar testes de aplicação inteira/nativos com rede interceptada. Não habilitar os antigos botões de detalhes reais. Nenhuma migration ou limpeza de registros existentes foi executada.

## Coordenação

Branch independente `codex/isolated-demo-simulations`, baseada em main. A revisão de boletos toca também `dashboard-navigation-data.ts` no app, somente nas funções de faturas/lotes; o PR de carreira #19 altera outra região do mesmo arquivo. A integração é verificada em checkout separado, sem alterar o PR de carreira. Rever integração funcional depois do merge desses trabalhos, especialmente cache e identificação demo. Sem alteração de comissão/carreira.

## Verificação reproduzível

- Node 24: `node --test tests/demo-simulation.test.mjs` (quatro perfis, conta real residual, identidade divergente, recusa/pendência e ausência de I/O no domínio).
- Site: `node scripts/test-demo-simulation-browser.mjs`. Usa Chromium em `/usr/bin/chromium` ou `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Monta o componente real com Auth/perfil e contêineres simulados; bloqueia requisições externas. Não é um teste de toda a aplicação.
- Site: `npm run typecheck`, `npm run lint`, `npm run build` com URL/chave fictícias.
- App: `npm run typecheck`, `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 npm run lint` e exportação Android/iOS/web com configuração fictícia. Exportação não substitui execução em aparelho.

Para repetir a interação do componente nativo: mantenha os checkouts lado a lado e, no checkout web, execute `NOX_DEMO_SURFACE=mobile node scripts/test-demo-simulation-browser.mjs`. O script usa o componente e hook reais do app, com primitivas React Native adaptadas para DOM; Auth/perfil são simulados. São seis cenários por superfície (quatro perfis, conta real com marcador residual, verificação recusada). Não testa a aplicação Expo inteira nem o sistema operacional.

Resultados desta entrega: 10 testes de domínio/regressão por repositório e 6 interações por superfície aprovados; TypeScript de ambos aprovado; lint web sem erros e com sete avisos preexistentes de Fast Refresh; lint mobile sem erros. Build web e verificação TV (264 arquivos) aprovados. Exportação Android/iOS/web aprovada com dados de configuração fictícios. Nenhuma conta real foi acessada nos testes.

## Segunda revisão: caminhos legados e transporte

As entradas diretas de resultado/status, documentos, dados complementares, finalização, contrato realizado, detalhe de apólice/faturas e configurações agora também passam pela barreira local antes de montar os componentes operacionais. O SDK Supabase dos dois clientes bloqueia escrita em tabelas, RPC (inclusive GET), Edge Functions, storage e alterações/criação de conta para sessões demo. A detecção usa a sessão do SDK e, defensivamente, o e-mail do bearer; decodificar esse bearer serve somente para negar, nunca para autenticar/autorizar. Não usa marcadores de storage. Leituras de tabelas e ciclo de autenticação continuam disponíveis. No web, middleware de cliente impede server functions antes do envio. O sino web não monta o componente de notificações em demo. No app, Auth é a fonte do e-mail da identidade e perder foco descarta o estado da simulação mesmo quando o Stack preserva a tela.

Testes adicionais usam as versões reais do SDK de cada repositório com fetch simulado. Exercitam quatro perfis, inserção/update/delete, notificações/preferências, RPC, contract-document, D4Sign, Asaas, account-access, upload, URL assinada, cadastro, senha/e-mail, recuperação e reenvio. Contam zero requisições ao backend para operações bloqueadas e preservam o comportamento de conta real/troca de identidade. Os scripts `test-demo-deep-links-browser.mjs` e `test-demo-mobile-app-browser.mjs` (no web) testam as aplicações completas locais, com roteador, Auth e SDK reais, backend fictício interceptado: 16 casos web e 13 Expo web. O teste mobile também confronta Auth com profiles.email divergente. A execução em Expo web não substitui validação Android/iOS em aparelho; o teste de blur com primitivas adaptadas não prova o comportamento nativo de freezeOnBlur.

**Limite que permanece:** isto é defesa do cliente. `billing-auth`, `d4sign-create-contract`, `contract-document`, RLS e autorização de servidor não receberam veto novo para demo. Tokens antigos NÃO foram revogados; versões antigas e clientes que ignorem estas barreiras ainda podem alcançar integrações autorizadas pelo backend. Não aplicar alterações críticas de autorização ou migrações implicitamente. Não publicar/mesclar antes de uma decisão específica sobre enforcement de servidor e validação nativa. Outras leituras legadas podem continuar mostrando dados do backend; não afirmar isolamento global/sintético de todo o produto.

Para testes web completos, iniciar Vite na porta 4173 com `VITE_SUPABASE_URL=https://nox-demo-test.supabase.co`, `VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key` e equivalentes `SUPABASE_*`; executar `node scripts/test-demo-deep-links-browser.mjs`. Para Expo web, iniciar o app na porta 4174 com `EXPO_PUBLIC_SUPABASE_URL=https://nox-demo-test.supabase.co`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-public-key`, `EXPO_NO_TELEMETRY=1`, `EXPO_OFFLINE=1`; executar no web `node scripts/test-demo-mobile-app-browser.mjs`. `NOX_TEST_ORIGIN` permite portas diferentes. Testes de transporte: `tsx --test tests/demo-request-guard.test.mjs` (no mobile sem #19, usar o executável tsx do checkout web companheiro).

## Terceira revisão: dashboard do inquilino e carteira de cobranças

As URLs diretas `/inquilino/dashboard` e `/carteira-cobrancas` passam pela verificação Auth/perfil antes de montar consultas, controles operacionais ou links de boleto. Os quatro perfis demo recebem a simulação local com ou sem marcador de storage. A identidade recusada não monta o conteúdo operacional. Os loaders de dashboard/carteira negam e-mails demo antes das leituras; os leitores de faturas/lotes deixam de escolher dados sintéticos pelo marcador residual. Contas reais mantêm seus controles de acesso existentes.

Regressão: `node --test tests/collection-demo-isolation.test.mjs` executa os módulos reais de dados/cache com backend fictício (5 casos por superfície). No checkout web, `node scripts/test-demo-boleto-isolation-browser.mjs` e `NOX_DEMO_SURFACE=mobile NOX_TEST_ORIGIN=http://localhost:4374 node scripts/test-demo-boleto-isolation-browser.mjs` exercitam as aplicações completas locais: 20 casos por superfície, quatro perfis com/sem marcador, duas contas reais com marcador e identidade recusada nas duas URLs. Todas as chamadas externas são interceptadas; qualquer leitura de cobrança demo ou abertura de janela causa falha. O app é executado em Expo web, sem evidência adicional em aparelho nativo.

Permanecem os limites de servidor, tokens antigos e outras leituras legadas descritos acima. Não publicar estes rascunhos.
