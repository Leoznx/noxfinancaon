import { createFileRoute } from "@tanstack/react-router";
import { NoxEmployeeSignup } from "@/components/NoxEmployeeSignup";

export const Route = createFileRoute("/login_/juridiconox")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  component: () => <NoxEmployeeSignup role="juridico" />,
});
