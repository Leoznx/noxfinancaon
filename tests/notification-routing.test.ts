import assert from "node:assert/strict";
import test from "node:test";

import { routeForNotification } from "../src/lib/notification-routing.ts";

const consultationId = "4ab42140-8b03-4f17-a238-945a8e710e76";
const resultRoute = `/consultas/${consultationId}/resultado`;

test("corrige o link singular legado de consulta", () => {
  assert.equal(routeForNotification(`/consulta/${consultationId}`), resultRoute);
});

test("leva o status legado diretamente ao resultado e aos planos", () => {
  assert.equal(routeForNotification(`/consultas/${consultationId}/status`), resultRoute);
});

test("mantém rotas de etapas posteriores da contratação", () => {
  assert.equal(
    routeForNotification(`/consultas/${consultationId}/finalizar`),
    `/consultas/${consultationId}/finalizar`,
  );
});

test("não interpreta a rota de nova consulta como um identificador", () => {
  assert.equal(routeForNotification("/consultas/nova"), "/consultas/nova");
});

test("mantém links de outras áreas e ignora links vazios", () => {
  assert.equal(routeForNotification("/admin/aprovacoes"), "/admin/aprovacoes");
  assert.equal(routeForNotification("   "), null);
});
