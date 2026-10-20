type ResourceEntry<T> = {
  value?: T;
  updatedAt: number;
  promise?: Promise<T>;
};

const resources = new Map<string, ResourceEntry<unknown>>();

export function peekSessionResource<T>(key: string): T | undefined {
  return (resources.get(key)?.value as T | undefined) ?? undefined;
}

export function hasFreshSessionResource(key: string, maxAgeMs: number): boolean {
  const entry = resources.get(key);
  return Boolean(entry?.value !== undefined && Date.now() - entry.updatedAt < maxAgeMs);
}

export function loadSessionResource<T>(
  key: string,
  loader: () => Promise<T>,
  options: { force?: boolean; maxAgeMs?: number } = {},
): Promise<T> {
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  const existing = resources.get(key) as ResourceEntry<T> | undefined;

  if (existing?.promise) return existing.promise;
  if (
    !options.force &&
    existing?.value !== undefined &&
    Date.now() - existing.updatedAt < maxAgeMs
  ) {
    return Promise.resolve(existing.value);
  }

  const promise = loader()
    .then((value) => {
      resources.set(key, { value, updatedAt: Date.now() });
      return value;
    })
    .catch((error) => {
      if (existing?.value !== undefined) {
        resources.set(key, { value: existing.value, updatedAt: existing.updatedAt });
      } else {
        resources.delete(key);
      }
      throw error;
    });

  resources.set(key, {
    value: existing?.value,
    updatedAt: existing?.updatedAt ?? 0,
    promise,
  });
  return promise;
}

export function invalidateSessionResource(keyOrPrefix: string): void {
  for (const key of resources.keys()) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) resources.delete(key);
  }
}

export function clearSessionResources(): void {
  resources.clear();
}
