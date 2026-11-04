import { useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useVerifiedSimulation } from "@/hooks/use-verified-simulation";
import { isDemoSimulationEmail, type DemoIdentity } from "@/lib/demo-simulation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  confirmDemoWithdrawal,
  demoCommissionContracts,
  demoCommissionRoles,
  demoWithdrawalFields,
  emptyDemoWithdrawalSelection,
  formatDemoCommissionMoney,
  startDemoWithdrawal,
} from "@/lib/demo-commissions";
export function DemoCommissionBoundary({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p role="status">Verificando sessão…</p>;
  if (!user || !isDemoSimulationEmail(user.email)) return <>{children}</>;
  return <DemoCommissions key={`${user.id}:${user.email}:${user.role}`} user={user} />;
}
function DemoCommissions({ user }: { user: DemoIdentity }) {
  const verified = useVerifiedSimulation(user);
  const [state, setState] = useState(startDemoWithdrawal);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState(emptyDemoWithdrawalSelection);
  if (verified !== "verified")
    return (
      <p role="status">
        {verified === "checking"
          ? "Verificando identidade demo…"
          : "Não foi possível verificar esta identidade demo. Nenhuma operação foi liberada."}
      </p>
    );
  if (!demoCommissionRoles.some((role) => role === user.role))
    return <p>Comissões não disponíveis para este perfil demonstrativo.</p>;
  const close = () => {
    setOpen(false);
    setSelection(emptyDemoWithdrawalSelection());
  };
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="rounded-xl bg-yellow-100 p-4">
        <strong>Demonstração local · {user.role}</strong>
        <p>
          Contratos, saldos e dados bancários inteiramente fictícios. Nenhum pagamento ou envio. Não
          informe dados reais.
        </p>
      </div>
      <h1 className="text-2xl font-bold">Comissões demonstrativas</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          Contratos de exemplo<strong className="block text-2xl">15</strong>
        </div>
        <div>
          Saldo disponível fictício
          <strong className="block text-2xl">
            {formatDemoCommissionMoney(state.availableCents)}
          </strong>
        </div>
        <div>
          Saques simulados
          <strong className="block text-2xl">
            {formatDemoCommissionMoney(state.withdrawnCents)}
          </strong>
        </div>
      </div>
      <Button disabled={state.completed} onClick={() => setOpen(true)}>
        Sacar (simulação)
      </Button>
      {state.completed && (
        <p role="status">
          Saque simulado concluído · DEMO-SQ-2026-001 ·{" "}
          {formatDemoCommissionMoney(state.withdrawnCents)}. Nenhum valor transferido.
        </p>
      )}
      <table className="w-full text-left">
        <caption>Contratos fictícios · sem validade financeira</caption>
        <thead>
          <tr>
            <th>Número demonstrativo</th>
            <th>Imóvel fictício</th>
            <th>Comissão fictícia</th>
          </tr>
        </thead>
        <tbody>
          {demoCommissionContracts.map((item) => (
            <tr key={item.number}>
              <td>{item.number}</td>
              <td>{item.property}</td>
              <td>{formatDemoCommissionMoney(item.commissionCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        variant="outline"
        onClick={() => {
          close();
          setState(startDemoWithdrawal());
        }}
      >
        Reiniciar demonstração
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Saque fictício</DialogTitle>
          </DialogHeader>
          <p>
            Selecione os exemplos fornecidos. Não há campos para dados reais. Valor simulado:{" "}
            {formatDemoCommissionMoney(state.availableCents)}.
          </p>
          {(
            [
              ["pix", "Chave Pix fictícia"],
              ["holder", "Titular fictício"],
              ["bank", "Banco fictício"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="grid gap-2">
              {label}
              <select
                aria-label={label}
                value={selection[key]}
                onChange={(event) => setSelection({ ...selection, [key]: event.target.value })}
                className="rounded border p-2"
              >
                <option value="">Selecione o exemplo</option>
                <option value={demoWithdrawalFields[key]}>{demoWithdrawalFields[key]}</option>
              </select>
            </label>
          ))}
          <Button
            disabled={Object.values(selection).some((value) => !value)}
            onClick={() => {
              setState(confirmDemoWithdrawal(state, selection));
              close();
            }}
          >
            Confirmar saque fictício
          </Button>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
