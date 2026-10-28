const DEFAULT_QUERY_TIMEOUT_MS = 15_000;

/**
 * Evita que uma rota permaneça em loading indefinidamente quando a rede ou o
 * PostgREST não encerram uma requisição. O AbortSignal também cancela o
 * trabalho no cliente, em vez de apenas abandonar a Promise na interface.
 */
export async function executeSupabaseQuery<T>(
  query:
    | { abortSignal(signal: AbortSignal): PromiseLike<T> }
    | ((signal: AbortSignal) => PromiseLike<T>),
  timeoutMs = DEFAULT_QUERY_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await (typeof query === "function"
      ? query(controller.signal)
      : query.abortSignal(controller.signal));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("A consulta demorou mais que o esperado. Tente novamente.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
