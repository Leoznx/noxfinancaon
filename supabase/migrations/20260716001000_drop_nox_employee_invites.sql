-- O fluxo de convites (token unico/descartavel/com validade) foi substituido
-- por 4 links fixos e permanentes por cargo (/login/<cargo>nox), sem token -
-- essa tabela nao tem mais nenhum consumidor no codigo (ver
-- src/lib/nox-employees.functions.ts), entao remove ela por completo em vez
-- de deixar uma tabela morta no schema.
DROP TABLE IF EXISTS public.nox_employee_invites;
