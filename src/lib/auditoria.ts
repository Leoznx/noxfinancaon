import { supabase } from "@/integrations/supabase/client";

/**
 * internal_audit_logs já existia e já era lida pela aba Auditoria em
 * /admin/equipe-permissoes, mas nada no app fazia INSERT nela — toda ação
 * de colaborador/permissão ficava sem rastro. Chamar isso nos pontos reais
 * de mutação (trocar cargo, bloquear, editar permissão, promover a Admin).
 */
export async function registrarAuditoria(params: {
  actorUserId: string | null | undefined;
  actorRole: string | null | undefined;
  action: string;
  tableName: string;
  recordId?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  const { error } = await supabase.from("internal_audit_logs" as any).insert({
    actor_user_id: params.actorUserId ?? null,
    actor_role: params.actorRole ?? null,
    action: params.action,
    table_name: params.tableName,
    record_id: params.recordId ?? null,
    before: params.before ?? null,
    after: params.after ?? null,
  } as any);
  if (error) console.error("[auditoria] falha ao registrar:", error.message);
}
