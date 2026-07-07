# simulate-credpago

Edge Function que registra o resultado de uma consulta de crédito CredPago para uma
linha de `consultas_credito`.

## Por que não é 100% automática

Os endpoints `POST /imobiliaria/api/solicitacao/simulacao` e `POST /imobiliaria/api/pessoa`
descobertos via inspeção de tráfego **não são uma API pública de parceiros** da CredPago.
Automatizar login + manutenção de sessão contra eles (ex.: Playwright com contexto
persistente, cookies coletados manualmente) violaria os Termos de Uso da CredPago, coloca
em risco a conta de imobiliária e processa dados pessoais de inquilinos por um canal não
homologado (risco LGPD). Por isso esta função não faz nenhuma chamada HTTP para a CredPago.

## Como funciona hoje (fluxo "manual assistido")

1. `action: "iniciar"` — recebe os dados da simulação, salva os campos complementares na
   consulta e devolve a URL do portal da CredPago para o corretor abrir em outra aba,
   com o próprio login da imobiliária.
2. O corretor roda a simulação manualmente no portal da CredPago.
3. `action: "registrar-resultado"` — recebe o que o corretor colou (o JSON de resposta que
   ele já vê, autenticado, na aba Network do navegador — ou os campos preenchidos à mão),
   valida contra o formato esperado (`provider.ts`), normaliza e grava em
   `consultas_credito` (`automacao_credpago_status`, `automacao_credpago_resultado`,
   `external_response` etc.) + um registro em `audit_logs`.
4. `action: "mock"` — atalho **só para desenvolvimento**, devolve um resultado fake sem
   precisar do portal. Não expor isso para usuários finais em produção (o frontend já
   esconde o botão de mock atrás de `import.meta.env.DEV`).

## Configuração necessária

Nenhuma credencial da CredPago é armazenada — não existe login automático, então não há
senha/cookie de CredPago para guardar em `supabase secrets`.

Variáveis usadas pela function (todas já padrão de qualquer Edge Function Supabase, exceto
a última):

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SUPABASE_URL` | sim (automática) | Já injetada pelo runtime da Supabase. |
| `SUPABASE_ANON_KEY` | sim (automática) | Já injetada pelo runtime da Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | sim (automática) | Já injetada pelo runtime da Supabase. |
| `CREDPAGO_PORTAL_URL` | não | URL do portal de imobiliárias da CredPago aberto no passo 1. Default: `https://credpago.com/imobiliaria`. Só precisa configurar se a URL for outra. |

Para configurar (opcional):

```bash
supabase secrets set CREDPAGO_PORTAL_URL="https://credpago.com/imobiliaria"
```

No frontend, o mesmo link pode ser sobrescrito com `VITE_CREDPAGO_PORTAL_URL` no `.env`
(usado só como fallback de exibição; a URL efetiva devolvida ao clicar em "Abrir CredPago"
vem sempre da resposta desta function).

## Deploy

```bash
supabase functions deploy simulate-credpago
```

## Quando a imobiliária tiver acesso oficial de parceiro à API da CredPago

Não mexa no frontend nem na persistência. Só:

1. Implemente a chamada HTTP real dentro de `OfficialApiCredPagoProvider` em `provider.ts`
   (métodos `iniciar` e `registrarResultado`), usando a API key/OAuth fornecida pelo time
   comercial da CredPago — configure-a com `supabase secrets set CREDPAGO_API_KEY=...`.
2. Troque o retorno de `resolveProvider()` em `provider.ts` para
   `new OfficialApiCredPagoProvider()`.
3. Se a API oficial responder simulação síncrona (sem precisar de "colar resultado"), o
   endpoint `registrar-resultado` deixa de ser necessário no frontend — mas pode manter
   como fallback manual para os casos em que a API estiver fora do ar.
