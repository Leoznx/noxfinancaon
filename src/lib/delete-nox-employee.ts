import { supabase } from "@/integrations/supabase/client";

async function edgeFunctionErrorMessage(error: unknown) {
  const context = (error as { context?: { json?: () => Promise<unknown> } })?.context;
  if (context?.json) {
    try {
      const payload = (await context.json()) as { error?: string };
      if (payload?.error) return payload.error;
    } catch {
      // Mantém a mensagem original quando a resposta não contém JSON.
    }
  }
  return (error as { message?: string })?.message || "Não foi possível excluir o colaborador.";
}

export async function deleteNoxEmployee(employeeId: string) {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>(
    "delete-nox-employee",
    { body: { employeeId } },
  );
  if (error) throw new Error(await edgeFunctionErrorMessage(error));
  if (!data?.ok) throw new Error(data?.error || "Não foi possível excluir o colaborador.");
}
