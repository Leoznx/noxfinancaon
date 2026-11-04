import type { UserWithdrawal } from "@/lib/withdrawals";

export function inferDemoPixKeyType(pixKey: string): UserWithdrawal["pix_key_type"] {
  const value = pixKey.trim();
  const digits = value.replace(/\D/g, "");
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "EMAIL";
  if (digits.length === 11 && !value.startsWith("+")) return "CPF";
  if (digits.length === 14) return "CNPJ";
  if (value.startsWith("+") && digits.length >= 10) return "PHONE";
  return "RANDOM";
}

export function maskDemoPixKey(pixKey: string) {
  const value = pixKey.trim();
  if (value.length <= 6) return "••••••";
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}
