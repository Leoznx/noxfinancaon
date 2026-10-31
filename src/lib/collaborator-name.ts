export function collaboratorDisplayName(
  name: string | null | undefined,
  fallback = "Colaborador",
): string {
  const normalized = name?.trim().replace(/\s+/g, " ") ?? "";
  if (!normalized) return fallback;
  return normalized.split(" ").slice(0, 2).join(" ");
}
