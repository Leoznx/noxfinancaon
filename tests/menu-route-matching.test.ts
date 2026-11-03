import assert from "node:assert/strict";
import test from "node:test";

import {
  menuRouteKey,
  resolveActiveMenuRouteKey,
  type MenuRouteCandidate,
} from "../src/lib/menu-route-matching";

const items: MenuRouteCandidate[] = [
  { href: "/dashboard" },
  { href: "/consultas/nova" },
  { href: "/consultas" },
  { href: "/apolices" },
  { href: "/faturas-inquilinos" },
  { href: "/admin/contratos" },
  { href: "/configuracoes" },
];

test("mantem a secao da fatura ativa em paginas de detalhe", () => {
  assert.equal(
    resolveActiveMenuRouteKey(items, "/faturas-inquilinos/fatura-123"),
    menuRouteKey({ href: "/faturas-inquilinos" }),
  );
});

test("escolhe a rota mais especifica sem ativar dois itens", () => {
  assert.equal(
    resolveActiveMenuRouteKey(items, "/consultas/nova"),
    menuRouteKey({ href: "/consultas/nova" }),
  );
  assert.equal(
    resolveActiveMenuRouteKey(items, "/consultas/consulta-123/finalizar"),
    menuRouteKey({ href: "/consultas" }),
  );
});

test("reconhece detalhes de contratos e configuracoes", () => {
  assert.equal(
    resolveActiveMenuRouteKey(items, "/admin/contratos/contrato-123"),
    menuRouteKey({ href: "/admin/contratos" }),
  );
  assert.equal(
    resolveActiveMenuRouteKey(items, "/configuracoes/niveis-comissao"),
    menuRouteKey({ href: "/configuracoes" }),
  );
});

test("nao confunde rotas apenas com prefixo textual parecido", () => {
  assert.equal(resolveActiveMenuRouteKey(items, "/faturas-inquilinos-legado"), null);
});

test("prioriza a subaba que corresponde aos parametros atuais", () => {
  const tabItems: MenuRouteCandidate[] = [
    { href: "/admin/equipe-nox" },
    {
      href: "/admin/equipe-nox?tab=permissoes",
      parentLabel: "Equipe NOX",
    },
  ];

  assert.equal(
    resolveActiveMenuRouteKey(tabItems, "/admin/equipe-nox", "?tab=permissoes"),
    menuRouteKey(tabItems[1]),
  );
});
