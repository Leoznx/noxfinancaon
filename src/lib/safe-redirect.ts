const AUTH_ENTRY_PATHS = [
  "/cadastro-concluido",
  "/login",
  "/cadastro",
  "/email-verificado",
  "/acesso-inquilino",
  "/completar-acesso-inquilino",
  "/redefinir-senha",
  "/recuperar-acesso",
];

export function safeInternalRedirect(value: string | undefined | null, fallback: string) {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//"))
    return fallback;
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (value.includes("\\") || hasControlCharacter || /%2f|%5c/i.test(value)) return fallback;
  try {
    const base = new URL("https://nox.invalid");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith("/")) return fallback;
    if (
      AUTH_ENTRY_PATHS.some(
        (route) => parsed.pathname === route || parsed.pathname.startsWith(`${route}/`),
      )
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
