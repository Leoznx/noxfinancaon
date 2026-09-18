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
  const message = (error as { message?: string })?.message || "";
  if (/failed to send a request/i.test(message)) {
    return "Não foi possível acessar o serviço de desligamento. Atualize a página e tente novamente.";
  }
  return message || "Não foi possível desativar o acesso do colaborador.";
}

async function authenticatedFunctionHeaders() {
  const sessionResult = await supabase.auth.getSession();
  let data = sessionResult.data;
  const error = sessionResult.error;
  if (error) throw new Error("Não foi possível validar sua sessão administrativa.");

  const expiresAt = data.session?.expires_at ?? 0;
  if (data.session && expiresAt * 1000 <= Date.now() + 60_000) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
    data = refreshed.data;
  }

  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  return { Authorization: `Bearer ${accessToken}` };
}

export async function deleteNoxEmployee(employeeId: string) {
  const headers = await authenticatedFunctionHeaders();
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>(
    "delete-nox-employee",
    { body: { employeeId }, headers },
  );
  if (error) throw new Error(await edgeFunctionErrorMessage(error));
  if (!data?.ok)
    throw new Error(data?.error || "Não foi possível desativar o acesso do colaborador.");
}
