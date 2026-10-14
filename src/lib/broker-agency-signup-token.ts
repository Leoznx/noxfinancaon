export const BROKER_AGENCY_SIGNUP_TOKEN_PATTERN = /^[a-f0-9]{48}$/i;

export function normalizeBrokerAgencySignupToken(value: unknown) {
  const token = String(value ?? "")
    .trim()
    .toLowerCase();
  return BROKER_AGENCY_SIGNUP_TOKEN_PATTERN.test(token) ? token : null;
}

export function buildBrokerAgencySignupUrl(token: string, origin: string) {
  const normalizedToken = normalizeBrokerAgencySignupToken(token);
  if (!normalizedToken) throw new Error("Token de cadastro inválido.");
  const baseUrl = origin.replace(/\/$/, "");
  return `${baseUrl}/cadastro-corretor?al=${encodeURIComponent(normalizedToken)}`;
}
