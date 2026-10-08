# Cancelamento programado de propostas Loft

O worker de crédito pode programar o cancelamento de uma proposta 30 minutos após o clique que envia a simulação. A execução usa a API oficial da parceria e uma fila persistente no Supabase; ela não depende de manter uma aba do navegador aberta.

## Garantias operacionais

- O horário é gravado no momento do envio e preservado quando o identificador da proposta chega na tela de resultado.
- A fila usa lease para impedir que dois workers cancelem a mesma proposta.
- Uma resposta só é aceita como sucesso quando a Loft devolve o mesmo identificador e um estado cancelado.
- Falhas de rede ou `5xx` voltam para a fila com espera progressiva; após 12 tentativas o item fica como `failed` e gera incidente no centro de automação.
- A fila não guarda CPF, CNPJ, endereço nem credenciais.
- O CEP real da consulta continua sendo enviado à Loft. Endereço não é substituído por outro município.
- O motivo não é sorteado. Configure apenas um motivo verdadeiro, aprovado para esse fluxo; ele fica registrado no item cancelado para auditoria.

## Ativação

1. Aplique `supabase/migrations/20261008203000_loft_proposal_cancellation_queue.sql`.
2. Solicite à Loft credenciais OAuth Client Credentials com o escopo `loft-aluguel` e permissão para cancelar propostas.
3. Configure na VPS, nunca no frontend:

   ```dotenv
   LOFT_OAUTH_CLIENT_ID="..."
   LOFT_OAUTH_CLIENT_SECRET="..."
   LOFT_OAUTH_SCOPE="loft-aluguel"
   LOFT_CANCELLATION_REASON="Inquilino desistiu do aluguel"
   LOFT_CANCELLATION_DELAY_MS=1800000
   ```

4. Quando a Loft exigir delegação da imobiliária, configure também `LOFT_OAUTH_AUTHORIZATION_DETAILS` com o `grant_id` fornecido pela parceira.
5. Reinicie o worker e confirme em `/health` que `cancellationEnabled` está `true`.

Sem as duas credenciais e um motivo oficial válido, o recurso permanece desativado por segurança e o fluxo atual de simulação continua funcionando.

## Estados da fila

- `scheduled`: aguardando o horário e o identificador da proposta.
- `processing`: um worker possui o lease temporário.
- `retry`: nova tentativa programada.
- `cancelled`: a API confirmou o cancelamento.
- `failed`: tentativas esgotadas; exige investigação.

Consultas e diagnósticos administrativos podem ler a tabela `loft_proposal_cancellations`; clientes comuns não têm acesso por causa do RLS.
