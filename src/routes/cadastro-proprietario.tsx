import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CadastroPage } from "@/routes/cadastro";

const searchSchema = z.object({
  returnTo: z.string().optional(),
  ref: z.string().optional(),
  sr: z
    .string()
    .regex(/^[a-f0-9]{48}$/i)
    .optional(),
  sl: z
    .string()
    .regex(/^[a-f0-9]{48}$/i)
    .optional(),
  sl_proprietario: z
    .string()
    .regex(/^[a-f0-9]{48}$/i)
    .optional(),
  sl_imobiliaria: z
    .string()
    .regex(/^[a-f0-9]{48}$/i)
    .optional(),
  sl_corretor: z
    .string()
    .regex(/^[a-f0-9]{48}$/i)
    .optional(),
  ma: z.string().uuid().optional(),
});

export const Route = createFileRoute("/cadastro-proprietario")({
  validateSearch: (search) => searchSchema.parse(search),
  component: () => <CadastroPage perfilInicial="proprietario" />,
});
