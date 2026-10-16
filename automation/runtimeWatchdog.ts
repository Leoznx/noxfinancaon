export class RuntimeWatchdogTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeWatchdogTimeoutError";
  }
}

interface RuntimeWatchdogOptions {
  timeoutMs: number;
  message: string;
  abort?: () => void | Promise<void>;
}

/**
 * Impõe um prazo total externo às operações do Playwright. Isso cobre chamadas
 * que ignoram ou reiniciam timeouts internos e garante que o recurso possa ser
 * encerrado antes que o loop operacional fique bloqueado indefinidamente.
 */
export async function runWithRuntimeWatchdog<T>(
  task: Promise<T>,
  options: RuntimeWatchdogOptions,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (options.abort) void Promise.resolve(options.abort()).catch(() => {});
      reject(new RuntimeWatchdogTimeoutError(options.message));
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([task, watchdog]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
