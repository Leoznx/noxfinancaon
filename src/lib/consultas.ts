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
  // 1. Profile do usuário logado — busca pelo id da sessão real (auth.uid()), não pelo
  // e-mail: a policy de INSERT exige profile_id_solicitante = auth.uid(), e o e-mail
  // vindo do estado em cache do AuthProvider pode divergir da sessão ativa (ex.: sessão
  // trocada/expirada em outra aba), o que fazia o profile não ser encontrado, gravar
  // profile_id_solicitante = null e violar a RLS de consultas_credito.
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    throw new Error("Sessão expirada. Faça login novamente para simular o crédito.");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", authUser.id)
    .maybeSingle();

  const profileId = authUser.id;
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
      if (inqErr) {
        // 23505 = unique_violation: outra simulação concorrente pro MESMO CPF/CNPJ
        // (dois corretores atendendo o mesmo inquilino, duplo clique, nova aba) inseriu
        // entre o SELECT acima e este INSERT. Com muita gente simulando ao mesmo tempo
        // isso deixou de ser raro — em vez de propagar o erro pro corretor, busca de
        // novo e reaproveita a linha que a outra requisição acabou de gravar.
        if (inqErr.code === "23505") {
          const { data: inqRetry, error: retryErr } = await supabase
            .from("inquilinos")
            .select("id")
            .eq("cpf", tenantDocument)
            .single();
          if (retryErr || !inqRetry) throw retryErr || inqErr;
          inquilinoId = inqRetry.id;
        } else {
          throw inqErr;
        }
      } else {
        inquilinoId = inqNova.id;
      }
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
  if (novaErr) {
    // 23505 = unique_violation em uniq_consulta_user_document (profile_id_solicitante +
    // tenant_document): outra requisição do MESMO usuário (duplo clique, nova aba, retry
    // de rede sob alta concorrência) criou a consulta pro mesmo documento entre o SELECT
    // do passo 3 e este INSERT. Busca de novo e atualiza a linha existente em vez de
    // falhar a simulação.
    if (novaErr.code === "23505") {
      const { data: consultaRetry, error: retryErr } = await supabase
        .from("consultas_credito")
        .select("id")
        .eq("profile_id_solicitante", profileId)
        .eq("tenant_document", tenantDocument)
        .single();
      if (retryErr || !consultaRetry) throw retryErr || novaErr;
      const { error: updateErr } = await supabase
        .from("consultas_credito")
        .update(consultaPayload)
        .eq("id", consultaRetry.id);
      if (updateErr) throw updateErr;
      return consultaRetry.id;
    }
    throw novaErr;
  }
  return nova.id;
}
