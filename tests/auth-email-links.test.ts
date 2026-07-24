import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthEmailCallbackUrl,
  hasAuthEmailCallback,
  normalizeAuthEmailCallbackType,
  parseAuthEmailCallback,
  resolveTenantAccessReturnTo,
} from "../src/lib/auth-email-links";

test("monta o link de confirmação direto para a aplicação", () => {
  const link = buildAuthEmailCallbackUrl({
    appUrl: "https://noxfianca.com/",
    path: "/email-verificado",
    tokenHash: "token+seguro/123",
    type: "signup",
  });
  const url = new URL(link);

  assert.equal(url.origin, "https://noxfianca.com");
  assert.equal(url.pathname, "/email-verificado");
  assert.equal(url.searchParams.get("token_hash"), "token+seguro/123");
  assert.equal(url.searchParams.get("type"), "signup");
});

test("lê token_hash e tipo de recuperação", () => {
  const callback = parseAuthEmailCallback(
    "https://noxfianca.com/redefinir-senha?token_hash=abc123&type=recovery",
  );

  assert.equal(callback.tokenHash, "abc123");
  assert.equal(callback.type, "recovery");
  assert.equal(hasAuthEmailCallback(callback), true);
});

test("mantém compatibilidade com links implícitos antigos", () => {
  const callback = parseAuthEmailCallback(
    "https://noxfianca.com/email-verificado#access_token=access&refresh_token=refresh&type=signup",
  );

  assert.equal(callback.accessToken, "access");
  assert.equal(callback.refreshToken, "refresh");
  assert.equal(callback.type, "signup");
});

test("lê erros tanto da query quanto do hash", () => {
  const fromQuery = parseAuthEmailCallback(
    "https://noxfianca.com/redefinir-senha?error_code=otp_expired&error_description=Expirado",
  );
  const fromHash = parseAuthEmailCallback(
    "https://noxfianca.com/#error=access_denied&error_description=Inv%C3%A1lido",
  );

  assert.equal(fromQuery.error, "otp_expired");
  assert.equal(fromQuery.errorDescription, "Expirado");
  assert.equal(fromHash.error, "access_denied");
  assert.equal(fromHash.errorDescription, "Inválido");
});

test("normaliza os dois tipos internos de troca de e-mail", () => {
  assert.equal(normalizeAuthEmailCallbackType("email_change_current"), "email_change");
  assert.equal(normalizeAuthEmailCallbackType("email_change_new"), "email_change");
  assert.equal(normalizeAuthEmailCallbackType("desconhecido"), null);
});

test("aceita somente a tela de documentos no acesso mágico do inquilino", () => {
  assert.equal(
    resolveTenantAccessReturnTo("/inquilino/documentos"),
    "/inquilino/documentos",
  );
  assert.equal(
    resolveTenantAccessReturnTo("https://site-malicioso.example"),
    "/inquilino/painel",
  );
  assert.equal(resolveTenantAccessReturnTo(null), "/inquilino/painel");
});
