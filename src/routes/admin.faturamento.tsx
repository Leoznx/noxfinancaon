import { createFileRoute } from "@tanstack/react-router";

const BILLING_TABS = ["receber", "vencidos", "pagos"] as const;

export const Route = createFileRoute("/admin/faturamento")({
  validateSearch: (search): { tab?: (typeof BILLING_TABS)[number] } =>
    BILLING_TABS.includes(search.tab as (typeof BILLING_TABS)[number])
      ? { tab: search.tab as (typeof BILLING_TABS)[number] }
      : {},
});
