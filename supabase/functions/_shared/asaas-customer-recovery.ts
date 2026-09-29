type AsaasCustomer = {
  id?: unknown;
  deleted?: unknown;
};

export type AsaasCustomerFetcher = (path: string, init?: RequestInit) => Promise<unknown>;

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : null;
}

function customerId(customer: AsaasCustomer | null, fallback: string) {
  return typeof customer?.id === "string" && customer.id ? customer.id : fallback;
}

async function fetchCustomer(
  encodedCustomerId: string,
  fetcher: AsaasCustomerFetcher,
): Promise<AsaasCustomer | null> {
  try {
    return (await fetcher(`/customers/${encodedCustomerId}`)) as AsaasCustomer;
  } catch (error) {
    if (errorStatus(error) === 404) return null;
    throw error;
  }
}

/**
 * Confirma que um ID salvo ainda representa um cliente ativo no Asaas.
 * Clientes removidos sao restaurados com o mesmo ID, evitando duplicidade.
 * `null` indica que o ID deixou de existir e o chamador deve localizar pelo
 * CPF/CNPJ ou criar um novo cadastro.
 */
export async function recoverStoredAsaasCustomer(
  storedCustomerId: string,
  fetcher: AsaasCustomerFetcher,
): Promise<string | null> {
  const encodedCustomerId = encodeURIComponent(storedCustomerId);
  const current = await fetchCustomer(encodedCustomerId, fetcher);

  if (current && current.deleted !== true) return customerId(current, storedCustomerId);

  try {
    const restored = (await fetcher(`/customers/${encodedCustomerId}/restore`, {
      method: "POST",
    })) as AsaasCustomer;
    if (restored?.deleted !== true) return customerId(restored, storedCustomerId);
  } catch (error) {
    // 400 pode ocorrer numa corrida em que outra requisicao ja restaurou o
    // cliente; 404 significa que o ID realmente nao esta mais disponivel.
    if (![400, 404].includes(errorStatus(error) ?? 0)) throw error;
  }

  const afterRestore = await fetchCustomer(encodedCustomerId, fetcher);
  if (afterRestore && afterRestore.deleted !== true) {
    return customerId(afterRestore, storedCustomerId);
  }

  return null;
}
