import { supabase } from "@/integrations/supabase/client";
import { normalizeDocumento } from "@/utils/documento";
import type { DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";

interface UpsertParams {
  dados: DadosSimulacao;
  userEmail: string;
  userRole?: string | null;
}

/**
 * Salva ou atualiza uma consulta de crédito a partir dos dados de simulação.
 * Garante deduplicação por (profile_id_solicitante + tenant_document).
 * Retorna o id da consulta.
 */
export async function upsertConsultaCredito({ dados, userEmail, userRole }: UpsertParams): Promise<string> {
  // 1. Profile do usuário logado
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("email", userEmail)
    .maybeSingle();

  const profileId = profile?.id || null;
  const role = profile?.role || userRole || null;

  // 2. Normalizar dados do inquilino
  const tenantType = dados.tipoInquilino;
  const tenantName =
    tenantType === "PF" ? (dados.inquilinos[0]?.nome || "").trim() : (dados.razaoSocial || "").trim();
  const rawDoc = tenantType === "PF" ? dados.inquilinos[0]?.cpf || "" : dados.cnpj || "";
  const tenantDocument = normalizeDocumento(rawDoc);

  if (!tenantDocument) {
    throw new Error("Informe um CPF ou CNPJ válido para salvar a consulta.");
  }
  const tenantNameSafe = tenantName || tenantDocument;

  const propertyAddress = [dados.endereco?.cidade, dados.endereco?.uf]
    .filter(Boolean)
    .join(", ") || `CEP ${dados.cep}`;

  // 3. Verificar consulta existente (mesmo usuário + mesmo documento)
  let consultaId: string | null = null;
  let inquilinoId: string | null = null;
  let imovelId: string | null = null;

  if (profileId) {
    const { data: existente } = await supabase
      .from("consultas_credito")
      .select("id, inquilino_id, imovel_id")
      .eq("profile_id_solicitante", profileId)
      .eq("tenant_document", tenantDocument)
      .maybeSingle();
    if (existente) {
      consultaId = existente.id;
      inquilinoId = existente.inquilino_id;
      imovelId = existente.imovel_id;
    }
  }

  // 4. Upsert inquilino (por CPF/CNPJ formatado original — a tabela tem UNIQUE em cpf)
  if (!inquilinoId) {
    const inqPayload: any =
      tenantType === "PF"
        ? { nome: tenantNameSafe, cpf: tenantDocument, tipo: "PF" }
        : { nome: tenantNameSafe, razao_social: tenantNameSafe, cnpj: tenantDocument, cpf: tenantDocument, tipo: "PJ" };
    // tentar achar inquilino existente por cpf normalizado
    const { data: inqExist } = await supabase
      .from("inquilinos")
      .select("id")
      .eq("cpf", tenantDocument)
      .maybeSingle();
    if (inqExist) {
      inquilinoId = inqExist.id;
      await supabase.from("inquilinos").update({ nome: tenantNameSafe } as any).eq("id", inqExist.id);
    } else {
      const { data: inqNova, error: inqErr } = await supabase
        .from("inquilinos")
        .insert(inqPayload)
        .select("id")
        .single();
      if (inqErr) throw inqErr;
      inquilinoId = inqNova.id;
    }
  } else {
    await supabase.from("inquilinos").update({ nome: tenantNameSafe } as any).eq("id", inquilinoId);
  }

  // 5. Upsert imóvel
  const imovelPayload: any = {
    cep: dados.cep,
    cidade: dados.endereco?.cidade || "",
    estado: dados.endereco?.uf || "",
    valor_aluguel: dados.valores.aluguel,
    valor_condominio: dados.valores.condominio,
    valor_taxas: dados.valores.taxas,
    tipo: dados.tipoImovel,
  };
  if (imovelId) {
    await supabase.from("imoveis").update(imovelPayload).eq("id", imovelId);
  } else {
    const { data: imovNovo, error: imovErr } = await supabase
      .from("imoveis")
      .insert(imovelPayload)
      .select("id")
      .single();
    if (imovErr) throw imovErr;
    imovelId = imovNovo.id;
  }

  // 6. Upsert consulta
  const consultaPayload: any = {
    inquilino_id: inquilinoId,
    imovel_id: imovelId,
    profile_id_solicitante: profileId,
    role_solicitante: role,
    tenant_name: tenantName,
    tenant_document: tenantDocument,
    tenant_type: tenantType,
    property_address: propertyAddress,
    rent_value: dados.valores.aluguel,
    status: "pendente",
  };

  if (consultaId) {
    const { error } = await supabase.from("consultas_credito").update(consultaPayload).eq("id", consultaId);
    if (error) throw error;
    return consultaId;
  }

  const { data: nova, error: novaErr } = await supabase
    .from("consultas_credito")
    .insert(consultaPayload)
    .select("id")
    .single();
  if (novaErr) throw novaErr;
  return nova.id;
}
