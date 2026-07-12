import { createFileRoute } from "@tanstack/react-router";
import { NoxEmployeeSignup } from "@/components/NoxEmployeeSignup";

export const Route = createFileRoute("/login_/financeironox")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  component: () => <NoxEmployeeSignup role="financeiro" />,
});
