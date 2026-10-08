import assert from "node:assert/strict";
import { test } from "node:test";
import { extractLoftProposalId, LoftApiError, LoftCancellationClient } from "./loftCancellation";

const config = {
  apiBaseUrl: "https://api.loft.com.br",
  tokenUrl: "https://auth.loft.com.br/v2/oauth/token",
  clientId: "client-id",
  clientSecret: "client-secret",
  scope: "loft-aluguel",
  requestTimeoutMs: 1_000,
};

test("extrai o identificador da proposta sem confundir CPF com proposta", () => {
  assert.equal(extractLoftProposalId("4775289"), "4775289");
  assert.equal(
    extractLoftProposalId("https://app.loft.com.br/fianca-aluguel/imobiliaria/proposta/4775289"),
    "4775289",
  );
  assert.equal(
    extractLoftProposalId("https://app.loft.com.br/resultado?proposalId=4775289"),
    "4775289",
  );
  assert.equal(extractLoftProposalId("Proposta nº 4775289 — crédito aprovado"), "4775289");
  assert.equal(extractLoftProposalId("Cliente CPF: 448.303.078-70"), null);
});

test("cancela pela API oficial com token técnico e motivo verdadeiro configurado", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });

    if (url === config.tokenUrl) {
      return Response.json({ access_token: "access-token", expires_in: 300 });
    }

    if (init?.method === "GET") {
      return Response.json({ data: { id: "4775289", status: { name: "Rascunho" } } });
    }
    return Response.json({ data: { id: "4775289", status: { name: "Cancelado" } } });
  };
  const client = new LoftCancellationClient(config, fakeFetch);

  const result = await client.cancelProposal(
    "4775289",
    "Inquilino desistiu do aluguel",
    "Solicitação confirmada pelo atendimento.",
  );

  assert.deepEqual(result, { proposalId: "4775289", status: "Cancelado" });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, config.tokenUrl);
  assert.match(String(requests[0].init?.body), /grant_type=client_credentials/);
  assert.equal(
    requests[2].url,
    "https://api.loft.com.br/rental-guarantee/v1/proposal/4775289/cancel",
  );
  assert.equal(new Headers(requests[2].init?.headers).get("Authorization"), "Bearer access-token");
  assert.deepEqual(JSON.parse(String(requests[2].init?.body)), {
    reason: "Inquilino desistiu do aluguel",
    comment: "Solicitação confirmada pelo atendimento.",
  });
});

test("renova o token uma vez quando a API devolve 401", async () => {
  let tokenRequests = 0;
  let cancellationRequests = 0;
  const fakeFetch: typeof fetch = async (input) => {
    if (String(input) === config.tokenUrl) {
      tokenRequests += 1;
      return Response.json({ access_token: `token-${tokenRequests}`, expires_in: 300 });
    }

    cancellationRequests += 1;
    if (cancellationRequests === 1) return new Response(null, { status: 401 });
    return Response.json({ data: { id: "4775289", status: { name: "Cancelada" } } });
  };
  const client = new LoftCancellationClient(config, fakeFetch);

  await client.cancelProposal("4775289", "Imóvel não está mais disponível");

  assert.equal(tokenRequests, 2);
  assert.equal(cancellationRequests, 2);
});

test("não repete o POST quando a proposta já está cancelada", async () => {
  let postRequests = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    if (String(input) === config.tokenUrl) {
      return Response.json({ access_token: "access-token", expires_in: 300 });
    }
    if (init?.method === "POST") postRequests += 1;
    return Response.json({ data: { id: "4775289", status: { name: "Cancelado" } } });
  };
  const client = new LoftCancellationClient(config, fakeFetch);

  const result = await client.cancelProposal(
    "4775289",
    "Inquilino vai usar outro tipo de garantia",
  );

  assert.equal(result.status, "Cancelado");
  assert.equal(postRequests, 0);
});

test("não marca a fila como concluída diante de uma resposta ambígua", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    if (String(input) === config.tokenUrl) {
      return Response.json({ access_token: "access-token", expires_in: 300 });
    }
    return Response.json({ data: {} });
  };
  const client = new LoftCancellationClient(config, fakeFetch);

  await assert.rejects(
    () => client.cancelProposal("4775289", "Inquilino vai contratar outra fiança"),
    (error: unknown) =>
      error instanceof LoftApiError && /identificador inesperado/i.test(error.message),
  );
});
