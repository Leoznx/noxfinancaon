import { createClient } from "@supabase/supabase-js";
import { extrairClienteInfo } from "./credpagoParser";
import { nomeClienteValido } from "./customerIdentity";

type ConsultationRow = {
  id: string;
  tenant_name: string | null;
  raw_response: unknown;
  updated_at: string;
};

const PAGE_SIZE = 500;
const applyChanges = process.argv.includes("--apply");

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
}

function capturedText(rawResponse: unknown): string | null {
  if (typeof rawResponse === "string") {
    const trimmed = rawResponse.trim();
    if (!trimmed) return null;
    try {
      return capturedText(JSON.parse(trimmed)) ?? trimmed;
    } catch {
      return trimmed;
    }
  }

  if (!rawResponse || typeof rawResponse !== "object" || Array.isArray(rawResponse)) return null;
  const object = rawResponse as Record<string, unknown>;
  for (const key of ["textoCapturado", "texto_capturado", "bodyText", "text"]) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function main(): Promise<void> {
  const supabase = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let offset = 0;
  let scanned = 0;
  let invalid = 0;
  let normalized = 0;
  let recoverable = 0;
  let updated = 0;
  let skippedConcurrent = 0;

  while (true) {
    const { data, error } = await supabase
      .from("consultas_credito")
      .select("id, tenant_name, raw_response, updated_at")
      .eq("origem", "nox_financa")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;

    const rows = (data as ConsultationRow[] | null) ?? [];
    for (const row of rows) {
      scanned += 1;
      const storedName = row.tenant_name?.replace(/\s+/g, " ").trim() ?? "";
      const normalizedStoredName = nomeClienteValido(storedName);
      if (normalizedStoredName === storedName) continue;

      let recoveredName = normalizedStoredName;
      if (recoveredName) {
        normalized += 1;
      } else {
        invalid += 1;
        const text = capturedText(row.raw_response);
        recoveredName = text ? extrairClienteInfo(text).nome : null;
      }
      if (!recoveredName) continue;
      recoverable += 1;

      if (!applyChanges) continue;
      const { data: changed, error: updateError } = await supabase
        .from("consultas_credito")
        .update({ tenant_name: recoveredName })
        .eq("id", row.id)
        .eq("updated_at", row.updated_at)
        .select("id");
      if (updateError) throw updateError;
      if (changed?.length) updated += 1;
      else skippedConcurrent += 1;
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(
    JSON.stringify({
      mode: applyChanges ? "apply" : "dry-run",
      scanned,
      invalid,
      normalized,
      recoverable,
      updated,
      skippedConcurrent,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
