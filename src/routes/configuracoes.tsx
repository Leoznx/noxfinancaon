import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const configuracoesSearchSchema = z.object({
  tab: z
    .enum(["perfil", "conta", "seguranca", "notificacoes", "comissoes"])
    .catch("perfil")
    .optional(),
});

export const Route = createFileRoute("/configuracoes")({
  validateSearch: (search) => configuracoesSearchSchema.parse(search),
});
