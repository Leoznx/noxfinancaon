/**
 * Server-only. Compartilhado entre os fluxos de cadastro (auth-signup.functions.ts,
 * inquilino-signup.functions.ts) para diferenciar, a partir de um e-mail:
 *  - "livre": ninguém cadastrado com esse e-mail — pode seguir com o cadastro.
 *  - "pendente": já existe profile + usuário no Supabase Auth, mas o e-mail
 *    ainda não foi confirmado (cadastro anterior abandonado antes de clicar
 *    no link). Nesse caso os fluxos de cadastro reenviam o e-mail de
 *    confirmação em vez de barrar a pessoa com "conta já existe".
 *  - "confirmado": conta já ativa — deve fazer login normalmente.
 *
 * Fica num módulo próprio (em vez de dentro de auth-signup.functions.ts) porque
 * auth-signup.functions.ts já importa de inquilino-signup.functions.ts
 * (linkTenantRecordsByCpf); importar na direção contrária criaria um ciclo.
 */
export type EmailRegistrationStatus = "livre" | "pendente" | "confirmado";

export async function checkEmailRegistration(
  supabaseAdmin: any,
  email: string,
): Promise<{ status: EmailRegistrationStatus; profileId?: string; nome?: string }> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, nome")
    .ilike("email", email)
    .maybeSingle();
  if (!profile) return { status: "livre" };

  const profileId = (profile as any).id as string;
  const nome = (profile as any).nome as string | undefined;

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profileId);
  // Profile órfão (sem usuário correspondente em auth.users) não deveria
  // acontecer, mas não é motivo pra travar um novo cadastro nesse e-mail.
  if (!authUser?.user) return { status: "livre" };

  return {
    status: authUser.user.email_confirmed_at ? "confirmado" : "pendente",
    profileId,
    nome,
  };
}
