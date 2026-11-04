// Synthetic, local-only ledger. No input accepts personal or financial data.
export const demoCommissionRoles = ["corretor", "imobiliaria", "proprietario"] as const;
export const demoWithdrawalFields = {
  pix: "pix-demo@example.invalid",
  holder: "Pessoa Demonstrativa",
  bank: "Banco Exemplo (fictício)",
} as const;
export const demoCommissionContracts = Array.from({ length: 15 }, (_, index) => ({
  number: `DEMO-2026-${String(101 + index).padStart(6, "0")}`,
  property: `Imóvel Exemplo ${String(index + 1).padStart(2, "0")}`,
  commissionCents: 8500 + (index % 3) * 1500,
}));
export const demoCommissionTotal = demoCommissionContracts.reduce(
  (total, item) => total + item.commissionCents,
  0,
);
export type DemoWithdrawalState = {
  completed: boolean;
  availableCents: number;
  withdrawnCents: number;
};
export type DemoWithdrawalSelection = { pix: string; holder: string; bank: string };
export const emptyDemoWithdrawalSelection = (): DemoWithdrawalSelection => ({
  pix: "",
  holder: "",
  bank: "",
});
export const startDemoWithdrawal = (): DemoWithdrawalState => ({
  completed: false,
  availableCents: demoCommissionTotal,
  withdrawnCents: 0,
});
export function confirmDemoWithdrawal(
  state: DemoWithdrawalState,
  selection: DemoWithdrawalSelection,
): DemoWithdrawalState {
  if (state.completed) return state;
  if (
    Object.keys(demoWithdrawalFields).some(
      (key) =>
        selection[key as keyof DemoWithdrawalSelection] !==
        demoWithdrawalFields[key as keyof DemoWithdrawalSelection],
    )
  )
    throw new Error("Selecione somente os três dados fictícios fornecidos.");
  return { completed: true, availableCents: 0, withdrawnCents: demoCommissionTotal };
}
export const formatDemoCommissionMoney = (cents: number) =>
  `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
