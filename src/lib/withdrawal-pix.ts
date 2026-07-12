export const PIX_KEY_TYPES = ["cpf", "cnpj", "email", "phone", "random"] as const;

export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export interface WithdrawalPixDataInput {
  bankName: string;
  holderName: string;
  pixKeyType: PixKeyType;
  pixKey: string;
}

export type NormalizedWithdrawalPixData = WithdrawalPixDataInput;

export type WithdrawalPixField = keyof WithdrawalPixDataInput;

export type WithdrawalPixDataValidationResult =
  | { success: true; data: NormalizedWithdrawalPixData }
  | { success: false; errors: Partial<Record<WithdrawalPixField, string>> };

const VALID_BRAZILIAN_AREA_CODES = new Set([
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "21",
  "22",
  "24",
  "27",
  "28",
  "31",
  "32",
  "33",
  "34",
  "35",
  "37",
  "38",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "53",
  "54",
  "55",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "67",
  "68",
  "69",
  "71",
  "73",
  "74",
  "75",
  "77",
  "79",
  "81",
  "82",
  "83",
  "84",
  "85",
  "86",
  "87",
  "88",
  "89",
  "91",
  "92",
  "93",
  "94",
  "95",
  "96",
  "97",
  "98",
  "99",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_LOCAL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const EMAIL_DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeCPF(value: string): string {
  return onlyDigits(value);
}

export function normalizeCNPJ(value: string): string {
  return onlyDigits(value);
}

export function validateCPF(value: string): boolean {
  const cpf = normalizeCPF(value);

  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(9) === Number(cpf[9]) && calculateDigit(10) === Number(cpf[10]);
}

export function validateCNPJ(value: string): boolean {
  const cnpj = normalizeCNPJ(value);

  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calculateDigit = (base: string): number => {
    let factor = base.length - 7;
    let sum = 0;

    for (const digit of base) {
      sum += Number(digit) * factor;
      factor -= 1;
      if (factor < 2) factor = 9;
    }

    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(cnpj.slice(0, 12));
  const secondDigit = calculateDigit(`${cnpj.slice(0, 12)}${firstDigit}`);

  return firstDigit === Number(cnpj[12]) && secondDigit === Number(cnpj[13]);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): boolean {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || /\s/.test(email)) return false;

  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex !== email.indexOf("@")) return false;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !EMAIL_LOCAL_PATTERN.test(local)
  ) {
    return false;
  }

  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => EMAIL_DOMAIN_LABEL_PATTERN.test(label));
}

export function normalizePhone(value: string): string {
  return onlyDigits(value);
}

export function validatePhone(value: string): boolean {
  const phone = normalizePhone(value);
  return (
    (phone.length === 10 || phone.length === 11) &&
    VALID_BRAZILIAN_AREA_CODES.has(phone.slice(0, 2))
  );
}

export function normalizeRandomKey(value: string): string {
  return value.trim().toLowerCase();
}

export function validateRandomKey(value: string): boolean {
  const key = normalizeRandomKey(value);
  return UUID_PATTERN.test(key) && key !== "00000000-0000-0000-0000-000000000000";
}

export function normalizePixKey(type: PixKeyType, value: string): string {
  switch (type) {
    case "cpf":
      return normalizeCPF(value);
    case "cnpj":
      return normalizeCNPJ(value);
    case "email":
      return normalizeEmail(value);
    case "phone":
      return normalizePhone(value);
    case "random":
      return normalizeRandomKey(value);
  }
}

export function getPixKeyValidationError(type: PixKeyType, value: string): string | null {
  const normalized = normalizePixKey(type, value);
  if (!normalized) return "Informe a chave Pix.";

  switch (type) {
    case "cpf":
      return validateCPF(normalized) ? null : "Informe um CPF válido com 11 dígitos.";
    case "cnpj":
      return validateCNPJ(normalized) ? null : "Informe um CNPJ válido com 14 dígitos.";
    case "email":
      return validateEmail(normalized) ? null : "Informe um e-mail válido.";
    case "phone":
      return validatePhone(normalized)
        ? null
        : "Informe um telefone válido, com DDD e 10 ou 11 dígitos.";
    case "random":
      return validateRandomKey(normalized)
        ? null
        : "Informe uma chave aleatória Pix no formato UUID.";
  }
}

export function validatePixKey(type: PixKeyType, value: string): boolean {
  return getPixKeyValidationError(type, value) === null;
}

/** Formats a Pix key for editable fields. It does not hide any part of the key. */
export function formatPixKey(type: PixKeyType, value: string): string {
  const normalized = normalizePixKey(type, value);

  if (type === "cpf") {
    return normalized
      .slice(0, 11)
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }

  if (type === "cnpj") {
    return normalized
      .slice(0, 14)
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }

  if (type === "phone") {
    const phone = normalized.slice(0, 11);
    if (phone.length <= 10) {
      return phone.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
    }
    return phone.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
  }

  return normalized;
}

/** Masks a normalized Pix key for confirmations, lists and other non-privileged views. */
export function maskPixKey(type: PixKeyType, value: string): string {
  const normalized = normalizePixKey(type, value);
  if (!normalized) return "";

  switch (type) {
    case "cpf":
      return normalized.length >= 2 ? `***.***.***-${normalized.slice(-2)}` : "***.***.***-**";
    case "cnpj":
      return normalized.length >= 2
        ? `**.***.***/****-${normalized.slice(-2)}`
        : "**.***.***/****-**";
    case "email": {
      const atIndex = normalized.lastIndexOf("@");
      if (atIndex <= 0) return "***";
      return `${normalized[0]}***@${normalized.slice(atIndex + 1)}`;
    }
    case "phone":
      if (normalized.length < 4) return "(***) *****-****";
      return normalized.length === 10
        ? `(***) ****-${normalized.slice(-4)}`
        : `(***) *****-${normalized.slice(-4)}`;
    case "random":
      if (normalized.length < 8) return "********-****-****-****-************";
      return `${normalized.slice(0, 4)}****-****-****-****-********${normalized.slice(-4)}`;
  }
}

export function normalizeBankName(value: string): string {
  return collapseWhitespace(value);
}

export function validateBankName(value: string): boolean {
  return normalizeBankName(value).length > 0;
}

export function normalizeHolderName(value: string): string {
  return collapseWhitespace(value);
}

export function validateHolderName(value: string): boolean {
  const holderName = normalizeHolderName(value);
  return holderName.length >= 2 && /\p{L}/u.test(holderName);
}

export function validateWithdrawalPixData(
  input: WithdrawalPixDataInput,
): WithdrawalPixDataValidationResult {
  const data: NormalizedWithdrawalPixData = {
    bankName: normalizeBankName(input.bankName),
    holderName: normalizeHolderName(input.holderName),
    pixKeyType: input.pixKeyType,
    pixKey: normalizePixKey(input.pixKeyType, input.pixKey),
  };
  const errors: Partial<Record<WithdrawalPixField, string>> = {};

  if (!validateBankName(data.bankName)) errors.bankName = "Informe o nome do banco.";
  if (!validateHolderName(data.holderName))
    errors.holderName = "Informe um nome válido para o titular.";

  const pixKeyError = getPixKeyValidationError(data.pixKeyType, data.pixKey);
  if (pixKeyError) errors.pixKey = pixKeyError;

  return Object.keys(errors).length > 0 ? { success: false, errors } : { success: true, data };
}

export const WITHDRAWAL_RECEIPT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

export const WITHDRAWAL_RECEIPT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type WithdrawalReceiptMimeType = (typeof WITHDRAWAL_RECEIPT_MIME_TYPES)[number];
export type WithdrawalReceiptExtension = "pdf" | "jpg" | "jpeg" | "png" | "webp";

export interface WithdrawalReceiptFileLike {
  name: string;
  type: string;
  size: number;
}

export type WithdrawalReceiptValidationErrorCode =
  | "missing_file"
  | "unsafe_file_name"
  | "unsupported_extension"
  | "unsupported_mime_type"
  | "mime_extension_mismatch"
  | "empty_file"
  | "file_too_large";

export type WithdrawalReceiptValidationResult =
  | {
      valid: true;
      fileName: string;
      extension: WithdrawalReceiptExtension;
      mimeType: WithdrawalReceiptMimeType;
      sizeBytes: number;
    }
  | { valid: false; code: WithdrawalReceiptValidationErrorCode; error: string };

const RECEIPT_MIME_BY_EXTENSION: Record<WithdrawalReceiptExtension, WithdrawalReceiptMimeType> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const DANGEROUS_FILE_EXTENSIONS = new Set([
  "app",
  "apk",
  "bat",
  "bin",
  "cjs",
  "cmd",
  "com",
  "dll",
  "exe",
  "htm",
  "html",
  "jar",
  "js",
  "mjs",
  "msi",
  "msp",
  "php",
  "pif",
  "ps1",
  "scr",
  "sh",
  "so",
  "svg",
  "vbe",
  "vbs",
  "wsf",
]);

const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const UNSAFE_FILE_NAME_CHARACTERS = /[/\\<>:"|?*\u202a-\u202e\u2066-\u2069]/u;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function receiptError(
  code: WithdrawalReceiptValidationErrorCode,
  error: string,
): WithdrawalReceiptValidationResult {
  return { valid: false, code, error };
}

export function validateWithdrawalReceiptFile(
  file: WithdrawalReceiptFileLike | null | undefined,
): WithdrawalReceiptValidationResult {
  if (!file) return receiptError("missing_file", "Anexe o comprovante de pagamento.");

  if (typeof file.name !== "string") {
    return receiptError("unsafe_file_name", "O nome do arquivo não é seguro.");
  }

  const fileName = file.name.normalize("NFC");
  if (
    !fileName ||
    fileName.length > 255 ||
    fileName !== fileName.trim() ||
    fileName.startsWith(".") ||
    fileName.endsWith(".") ||
    fileName.includes("..") ||
    hasControlCharacter(fileName) ||
    UNSAFE_FILE_NAME_CHARACTERS.test(fileName) ||
    WINDOWS_RESERVED_FILE_NAME.test(fileName)
  ) {
    return receiptError("unsafe_file_name", "O nome do arquivo não é seguro.");
  }

  const nameParts = fileName.split(".");
  if (nameParts.length < 2 || !nameParts.at(-1)) {
    return receiptError(
      "unsupported_extension",
      "O comprovante precisa ter uma extensão permitida.",
    );
  }

  const extension = nameParts.at(-1)!.toLowerCase();
  if (!(extension in RECEIPT_MIME_BY_EXTENSION)) {
    return receiptError("unsupported_extension", "Envie um arquivo PDF, JPG, JPEG, PNG ou WEBP.");
  }

  if (nameParts.slice(1, -1).some((part) => DANGEROUS_FILE_EXTENSIONS.has(part.toLowerCase()))) {
    return receiptError("unsafe_file_name", "O nome do arquivo contém uma extensão insegura.");
  }

  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return receiptError("empty_file", "O comprovante está vazio ou possui tamanho inválido.");
  }

  if (file.size > WITHDRAWAL_RECEIPT_MAX_SIZE_BYTES) {
    return receiptError("file_too_large", "O comprovante deve ter no máximo 10 MB.");
  }

  const mimeType = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
  if (!(WITHDRAWAL_RECEIPT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return receiptError("unsupported_mime_type", "O tipo do arquivo não é permitido.");
  }

  const typedExtension = extension as WithdrawalReceiptExtension;
  if (RECEIPT_MIME_BY_EXTENSION[typedExtension] !== mimeType) {
    return receiptError(
      "mime_extension_mismatch",
      "A extensão não corresponde ao tipo do arquivo.",
    );
  }

  return {
    valid: true,
    fileName,
    extension: typedExtension,
    mimeType: mimeType as WithdrawalReceiptMimeType,
    sizeBytes: file.size,
  };
}

export function isValidWithdrawalReceiptFile(
  file: WithdrawalReceiptFileLike | null | undefined,
): boolean {
  return validateWithdrawalReceiptFile(file).valid;
}
