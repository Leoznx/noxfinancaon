import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const configuracoesSearchSchema = z.object({
  tab: z
    .enum(["perfil", "conta", "seguranca", "notificacoes", "comissoes", "pix", "financeiro"])
    .optional(),
});

export const Route = createFileRoute("/configuracoes")({
  validateSearch: (search) => configuracoesSearchSchema.parse(search),
});
