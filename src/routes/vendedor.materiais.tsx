import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/vendedor/materiais")({
  component: () => <Navigate to="/vendedor" replace />,
});
