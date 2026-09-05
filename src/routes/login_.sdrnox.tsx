import { createFileRoute } from "@tanstack/react-router";
import { NoxEmployeeSignup } from "@/components/NoxEmployeeSignup";

export const Route = createFileRoute("/login_/sdrnox")({
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  component: Page,
});

function Page() {
  const { invite } = Route.useSearch();
  return <NoxEmployeeSignup accountType="sdr" inviteToken={invite} />;
}
