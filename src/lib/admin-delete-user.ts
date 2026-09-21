import { supabase } from "@/integrations/supabase/client";

async function functionErrorMessage(error: unknown) {
  const context = (error as { context?: { json?: () => Promise<unknown> } })?.context;
  if (context?.json) {
    try {
      const payload = (await context.json()) as { error?: string };
      if (payload?.error) return payload.error;
    } catch {
      // Usa a mensagem original quando a resposta nao contem JSON.
    }
  }
  const message = (error as { message?: string })?.message || "";
  if (/failed to send a request/i.test(message)) {
    return "Não foi possível acessar o serviço de exclusão. Atualize a página e tente novamente.";
  }
  return message || "Não foi possível excluir o usuário.";
}

async function authenticatedHeaders() {
  const current = await supabase.auth.getSession();
  if (current.error) throw new Error("Não foi possível validar sua sessão administrativa.");
  let session = current.data.session;
  if (session && (session.expires_at ?? 0) * 1000 <= Date.now() + 60_000) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
    session = refreshed.data.session;
  }
  if (!session?.access_token)
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function deleteUserCompletely(targetUserId: string) {
  const headers = await authenticatedHeaders();
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>(
    "admin-delete-user",
    { body: { targetUserId }, headers },
  );
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data?.ok) throw new Error(data?.error || "Não foi possível excluir o usuário.");
}
