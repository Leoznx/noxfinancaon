import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CadastroPage } from "@/routes/cadastro";

const searchSchema = z.object({ returnTo: z.string().optional(), ref: z.string().optional() });

export const Route = createFileRoute("/cadastro-corretor")({
  validateSearch: (search) => searchSchema.parse(search),
  component: () => <CadastroPage perfilInicial="corretor" />,
});
