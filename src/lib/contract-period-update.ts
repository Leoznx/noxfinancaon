import { supabase } from "@/integrations/supabase/client";
import { getEdgeFunctionErrorMessage } from "@/lib/asaas-payment";
import { normalizeContractPeriodMonths } from "@/lib/contract-period";

type ContractPeriodUpdateResponse = {
  ok?: boolean;
  error?: string;
  changed?: boolean;
  contractPeriodMonths?: number;
  contractPeriodRevision?: number;
};

/**
 * A troca de prazo pode exigir cancelar cronogramas ou documentos ainda
 * pendentes. Essa operacao fica no backend para site e aplicativo seguirem a
 * mesma regra sem expor credenciais dos provedores.
 */
export async function updateContractPeriodSafely(
  consultationId: string,
  contractPeriodMonths: number,
) {
  const normalized = normalizeContractPeriodMonths(contractPeriodMonths);
  if (normalized == null) throw new Error("Selecione um período de contrato válido.");

  const { data, error } = await supabase.functions.invoke<ContractPeriodUpdateResponse>(
    "update-contract-period",
    {
      body: {
        proposalId: consultationId,
        contractPeriodMonths: normalized,
      },
    },
  );
  if (error) {
    throw new Error(
      await getEdgeFunctionErrorMessage(
        error,
        "Não foi possível alterar o período agora. Nenhum dado da proposta foi apagado.",
      ),
    );
  }
  if (!data?.ok) {
    throw new Error(
      data?.error || "Não foi possível alterar o período agora. Nenhum dado da proposta foi apagado.",
    );
  }
  return data;
}
