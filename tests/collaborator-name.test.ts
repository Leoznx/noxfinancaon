import assert from "node:assert/strict";
import test from "node:test";
import { collaboratorDisplayName } from "../src/lib/collaborator-name";

test("exibe somente o primeiro e o segundo nome do colaborador", () => {
  assert.equal(
    collaboratorDisplayName("Carlos Henrique Menezes dos Santos Júnior"),
    "Carlos Henrique",
  );
  assert.equal(collaboratorDisplayName("Lucas Rodrigues da Silva"), "Lucas Rodrigues");
});

test("normaliza espaços e preserva nomes curtos", () => {
  assert.equal(collaboratorDisplayName("  Simone   Bitencourte Soares "), "Simone Bitencourte");
  assert.equal(collaboratorDisplayName("Madonna"), "Madonna");
  assert.equal(collaboratorDisplayName(null, "Vendedor"), "Vendedor");
});
