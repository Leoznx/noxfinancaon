/**
 * Para onde cada papel de usuário deve ir ao acessar a área logada — usado tanto pelo
 * pós-login (src/routes/login.tsx) quanto pelo botão "Dashboard" no header público
 * (src/components/landing/InstitutionalHeader.tsx), pra não ter duas fontes de verdade.
 */
export function redirectPathForRole(role: string | null | undefined): string {
  switch (role) {
    case "inquilino":
      return "/inquilino/documentos";
    case "juridico":
      return "/admin/aprovacoes";
    case "financeiro":
      return "/admin/financeiro";
    case "marketing":
      return "/admin/leads";
    case "suporte":
      return "/suporte";
    case "vendedor":
      return "/vendedor";
    case "admin":
    case "admin_master":
    case "imobiliaria":
    case "corretor":
    case "proprietario":
    default:
      return "/dashboard";
  }
}
