import { supabase } from "@/integrations/supabase/client";

export type BrokerCommissionAllocationMode = "broker_full" | "split_50" | "agency_full";

export const BROKER_COMMISSION_OPTIONS: Array<{
  value: BrokerCommissionAllocationMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: "broker_full",
    label: "Repassar ao corretor",
    shortLabel: "100% corretor",
    description: "O corretor recebe 100% da comissão e a imobiliária não recebe parte desse contrato.",
  },
  {
    value: "split_50",
    label: "Dividir igualmente",
    shortLabel: "50% / 50%",
    description: "A comissão do contrato é dividida em partes iguais entre corretor e imobiliária.",
  },
  {
    value: "agency_full",
    label: "Não repassar",
    shortLabel: "100% imobiliária",
    description: "A imobiliária recebe 100%. As áreas financeiras ficam indisponíveis para o corretor.",
  },
];

export function getBrokerCommissionOption(mode?: string | null) {
  return BROKER_COMMISSION_OPTIONS.find((option) => option.value === mode) ?? BROKER_COMMISSION_OPTIONS[0];
}

export type BrokerCommissionAccess = {
  commissionAllocationMode: BrokerCommissionAllocationMode;
  canAccessFinancialModules: boolean;
  agencyProfileId: string | null;
};

const accessCache = new Map<string, Promise<BrokerCommissionAccess>>();

export function clearBrokerCommissionAccessCache(userId?: string) {
  if (userId) accessCache.delete(userId);
  else accessCache.clear();
}

export function loadBrokerCommissionAccess(
  userId: string,
  forceRefresh = false,
): Promise<BrokerCommissionAccess> {
  if (forceRefresh) accessCache.delete(userId);
  const cached = accessCache.get(userId);
  if (cached) return cached;

  const request = (async () => {
    const { data, error } = await supabase.rpc("get_my_broker_commission_access");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      commissionAllocationMode: (row?.commission_allocation_mode || "broker_full") as BrokerCommissionAllocationMode,
      canAccessFinancialModules: row?.can_access_financial_modules !== false,
      agencyProfileId: row?.agency_profile_id || null,
    };
  })();

  accessCache.set(userId, request);
  request.catch(() => accessCache.delete(userId));
  return request;
}
