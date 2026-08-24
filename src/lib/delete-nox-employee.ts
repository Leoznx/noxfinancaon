import { supabase } from "@/integrations/supabase/client";

export async function deleteNoxEmployee(employeeId: string) {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>(
    "delete-nox-employee",
    { body: { employeeId } },
  );
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || "Não foi possível excluir o colaborador.");
}
