# NOX: paridade obrigatória entre site e aplicativo

Este repositório é o site da NOX Finança:

- GitHub: `https://github.com/Leoznx/noxfinancaon.git`
- Checkout local esperado: `C:\Users\sixxleo\Documents\noxfinancaon`

O aplicativo companheiro fica em:

- GitHub: `https://github.com/Leoznx/noxfinancaonmobile.git`
- Checkout local esperado: `C:\Users\sixxleo\Documents\noxfinancaonmobile`

## Regra permanente

Toda solicitação do usuário que altere funcionalidade, regra de negócio, fluxo, texto visível, permissão, integração, contrato de API ou aparência do site deve ser analisada e implementada também no aplicativo, na mesma tarefa. O trabalho não está concluído enquanto as duas superfícies aplicáveis não estiverem em paridade e validadas.

Antes de editar:

1. Inspecione a implementação correspondente nos dois repositórios.
2. Preserve mudanças locais existentes e não relacionadas em ambos.
3. Trate o backend Supabase e seus dados como compartilhados entre site e app.
4. Leia e cumpra o `AGENTS.md` do repositório mobile antes de escrever código nele.

Ao implementar:

- Traduza componentes web para componentes Expo/React Native; não copie JSX web, CSS, Tailwind, configuração Vite ou dependências exclusivas do navegador para o app.
- Reutilize ou espelhe contratos de API, validações, textos, constantes e assets compatíveis.
- Quando o site mudar o banco, uma Edge Function ou uma regra de acesso, verifique e atualize todos os consumidores afetados no app.
- Quando o app ainda não tiver a tela equivalente, implemente a experiência nativa correspondente em vez de deixar um placeholder silencioso.
- Mudanças puramente internas e exclusivas de uma plataforma, como configuração de build, arquivos gerados ou metadados da loja, não devem ser copiadas para a outra. Registre no resumo final por que não há impacto cruzado.

Ao validar:

- Rode as verificações relevantes do site.
- Rode TypeScript, lint e uma compilação/exportação compatível no app.
- No resumo final, liste separadamente o que mudou no site, no aplicativo e no backend compartilhado.

Use `C:\Users\sixxleo\Documents\noxfinancaonmobile\docs\MOBILE_INTEGRATION_PLAN.md` como inventário de rotas e contratos já mapeados entre as duas superfícies.
