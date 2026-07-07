import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/carreiras")({
  beforeLoad: () => {
    throw redirect({ to: "/trabalhe-conosco" });
  },
});
