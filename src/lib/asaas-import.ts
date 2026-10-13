import { supabase } from "@/integrations/supabase/client";
import { getEdgeFunctionErrorMessage } from "@/lib/asaas-payment";

export type ExistingAsaasSubscriptionPreview = {
  ok: boolean;
  found: boolean;
  imported: boolean;
  contractReady: boolean;
  missingContractFields: string[];
  contractSent?: boolean;
  signatureStatus?: string;
  signatureError?: string;
  tenant: {
    name: string | null;
    emailMasked: string | null;
    phoneMasked: string | null;
  };
  provider: {
    customerId: string;
    subscriptionId: string;
    paymentId: string;
    billingType: string;
    cycle: string;
    status: string;
    paymentStatus: string;
    description: string;
    grossMonthlyAmount: number;
    contractualMonthlyAmount: number;
    cardFeeDifference: number;
    firstDueDate: string;
    confirmedAt: string;
    nextDueDate: string | null;
    endDate: string | null;
    installments: number;
  };
};

export async function reconcileExistingAsaasSubscription(
  proposalId: string,
  action: "preview" | "import",
) {
  const { data, error } = await supabase.functions.invoke<ExistingAsaasSubscriptionPreview>(
    "asaas-import-existing-subscription",
    { body: { proposalId, action } },
  );
  if (error) {
    throw new Error(
      await getEdgeFunctionErrorMessage(
        error,
        "Nao foi possivel consultar a assinatura existente no Asaas.",
      ),
    );
  }
  if (!data?.ok) throw new Error("A conciliacao da assinatura nao retornou um resultado valido.");
  return data;
}
