import { supabase } from "@/integrations/supabase/client";

export type JuridicoConsulta = {
  id: string;
  status: string;
  substatus: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  tenant_name: string | null;
  tenant_document: string | null;
  role_solicitante: string | null;
  solicitante: {
    nome: string | null;
    email: string | null;
    role: string | null;
  } | null;
};

export type JuridicoDocumento = {
  id: string;
  user_id: string;
  verification_status: string;
  document_type: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JuridicoOrigem = {
  id: string;
  nome: string | null;
  email: string | null;
  role: string | null;
};

export type JuridicoContrato = {
  id: string;
  numero: string;
  status: string;
  vigencia_fim: string;
  created_at: string;
  consulta: {
    tenant_name: string | null;
    tenant_document: string | null;
  } | null;
};

export type JuridicoSinistro = {
  id: string;
  status: string;
  motivo: string | null;
  created_at: string;
  updated_at: string;
  apolice: {
    numero: string | null;
    consulta: {
      tenant_name: string | null;
    } | null;
  } | null;
};

export type JuridicoDashboardData = {
  consultas: JuridicoConsulta[];
  documentos: JuridicoDocumento[];
  origens: JuridicoOrigem[];
  contratos: JuridicoContrato[];
  sinistros: JuridicoSinistro[];
};

export const EMPTY_JURIDICO_DASHBOARD: JuridicoDashboardData = {
  consultas: [],
  documentos: [],
  origens: [],
  contratos: [],
  sinistros: [],
};

/**
 * Mantém o painel em cinco leituras paralelas e reaproveita exclusivamente as
 * tabelas operacionais existentes. O limite é uma proteção para o cliente; as
 * telas atuais do jurídico também trabalham com leituras paginadas/limitadas.
 */
export async function fetchJuridicoDashboardData(): Promise<{
  data: JuridicoDashboardData;
  error: string | null;
}> {
  const [consultasRes, documentosRes, origensRes, contratosRes, sinistrosRes] = await Promise.all([
    supabase
      .from("consultas_credito")
      .select(
        "id, status, substatus, created_at, updated_at, approved_at, rejected_at, tenant_name, tenant_document, role_solicitante, solicitante:profiles!consultas_credito_profile_id_solicitante_fkey(nome, email, role)",
      )
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("verificacoes_documento")
      .select("id, user_id, verification_status, document_type, submitted_at, reviewed_at, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("profiles")
      .select("id, nome, email, role")
      .in("role", ["corretor", "imobiliaria", "proprietario"])
      .limit(5000),
    supabase
      .from("apolices")
      .select("id, numero, status, vigencia_fim, created_at, consulta:consultas_credito(tenant_name, tenant_document)")
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("sinistros")
      .select("id, status, motivo, created_at, updated_at, apolice:apolices(numero, consulta:consultas_credito(tenant_name))")
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);

  const firstError = [consultasRes.error, documentosRes.error, origensRes.error, contratosRes.error, sinistrosRes.error].find(Boolean);

  return {
    data: {
      consultas: (consultasRes.data as unknown as JuridicoConsulta[] | null) ?? [],
      documentos: (documentosRes.data as unknown as JuridicoDocumento[] | null) ?? [],
      origens: (origensRes.data as unknown as JuridicoOrigem[] | null) ?? [],
      contratos: (contratosRes.data as unknown as JuridicoContrato[] | null) ?? [],
      sinistros: (sinistrosRes.data as unknown as JuridicoSinistro[] | null) ?? [],
    },
    error: firstError?.message ?? null,
  };
}
