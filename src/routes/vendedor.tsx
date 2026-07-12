import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/vendedor")({
  component: () => <Outlet />,
});
