import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBrokerAgencySignupUrl,
  normalizeBrokerAgencySignupToken,
} from "../src/lib/broker-agency-signup-token";

const TOKEN = "a".repeat(48);

test("normaliza apenas tokens hexadecimais de 48 caracteres", () => {
  assert.equal(normalizeBrokerAgencySignupToken(`  ${TOKEN.toUpperCase()}  `), TOKEN);
  assert.equal(normalizeBrokerAgencySignupToken("a".repeat(47)), null);
  assert.equal(normalizeBrokerAgencySignupToken("z".repeat(48)), null);
});

test("monta o link permanente de cadastro do corretor", () => {
  assert.equal(
    buildBrokerAgencySignupUrl(TOKEN, "https://noxfianca.com/"),
    `https://noxfianca.com/cadastro-corretor?al=${TOKEN}`,
  );
});

test("recusa construir URL com token inválido", () => {
  assert.throws(
    () => buildBrokerAgencySignupUrl("invalido", "https://noxfianca.com"),
    /Token de cadastro inválido/,
  );
});
