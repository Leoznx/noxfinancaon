# Simulador demonstrativo isolado — entrega parcial, não publicar

## Escopo seguro implementado

As contas autenticadas com os quatro e-mails demo conhecidos e perfil correspondente recebem um simulador local nas entradas Nova consulta, Contratos ativos e Faturas. A identidade é revalidada com `auth.getUser()` e leitura do perfil pelo mesmo ID; marcadores de storage não autorizam o simulador. Falhas de autenticação/perfil mantêm a experiência bloqueada, sem montar os componentes operacionais dessas páginas.

O simulador tem cenários aprovado, recusado e em análise. O aprovado percorre análise, conferência fictícia, resumo de contrato, fatura e recibo demonstrativo. Não assina documentos. Dados e histórico existem somente no estado do componente; sair/reiniciar descarta o cenário. Não usa documentos existentes, upload, contato, Pix, boleto, checkout, envio, criação de usuários ou integração de contrato. Os dois acessos de verificação de identidade são leituras; as etapas seguintes não têm adaptadores de I/O.

As antigas funções `criarConsultaDemonstrativa` agora falham antes de qualquer acesso ao backend. No app, a entrada `demoDecision` da função genérica também é bloqueada. O site deixa de vincular CPF automaticamente no sign-in de demo; o app não registra push nem assina o store de notificações para esses e-mails.

## Limites e impedimentos para publicação

Esta é a parte segura permitida pela solicitação, não a conclusão do pedido de tornar todo o produto demonstrável. O simulador substitui o conteúdo dessas quatro entradas demo; ainda não reproduz os detalhes individuais das listas existentes. Outras rotas, links profundos, aquecimento de navegação, contextos globais e funções de servidor legados não estão cobertos por uma barreira universal contra escrita. O marcador demo residual ainda pode afetar leitores legados fora deste simulador. O teste de conta real garante apenas que a nova barreira não a converte em demo.

Não há garantia de isolamento global nem proteção nova no servidor contra clientes que ignorem a UI. Por isso, manter ambos os PRs em rascunho; não fazer merge/deploy. Antes de publicar, auditar todas as integrações e links profundos, implementar bloqueio central compatível com autenticação e cache e executar testes de aplicação inteira/nativos com rede interceptada. Não habilitar os antigos botões de detalhes reais. Nenhuma migration ou limpeza de registros existentes foi executada.

## Coordenação

Branch independente `codex/isolated-demo-simulations`, baseada em main. Nenhum arquivo dos PRs de carreira web #42 e mobile #19 foi editado. Rever integração funcional depois do merge desses trabalhos, especialmente cache e identificação demo. Sem alteração de comissão/carreira.

## Verificação reproduzível

- Node 24: `node --test tests/demo-simulation.test.mjs` (quatro perfis, conta real residual, identidade divergente, recusa/pendência e ausência de I/O no domínio).
- Site: `node scripts/test-demo-simulation-browser.mjs`. Usa Chromium em `/usr/bin/chromium` ou `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Monta o componente real com Auth/perfil e contêineres simulados; bloqueia requisições externas. Não é um teste de toda a aplicação.
- Site: `npm run typecheck`, `npm run lint`, `npm run build` com URL/chave fictícias.
- App: `npm run typecheck`, `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 npm run lint` e exportação Android/iOS/web com configuração fictícia. Exportação não substitui execução em aparelho.

Para repetir a interação do componente nativo: mantenha os checkouts lado a lado e, no checkout web, execute `NOX_DEMO_SURFACE=mobile node scripts/test-demo-simulation-browser.mjs`. O script usa o componente e hook reais do app, com primitivas React Native adaptadas para DOM; Auth/perfil são simulados. São seis cenários por superfície (quatro perfis, conta real com marcador residual, verificação recusada). Não testa a aplicação Expo inteira nem o sistema operacional.

Resultados desta entrega: 10 testes de domínio/regressão por repositório e 6 interações por superfície aprovados; TypeScript de ambos aprovado; lint web sem erros e com sete avisos preexistentes de Fast Refresh; lint mobile sem erros. Build web e verificação TV (264 arquivos) aprovados. Exportação Android/iOS/web aprovada com dados de configuração fictícios. Nenhuma conta real foi acessada nos testes.
