import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  WITHDRAWAL_RECEIPT_MAX_SIZE_BYTES,
  formatPixKey,
  getPixKeyValidationError,
  isValidWithdrawalReceiptFile,
  maskPixKey,
  normalizeBankName,
  normalizeHolderName,
  normalizePixKey,
  validateBankName,
  validateCNPJ,
  validateCPF,
  validateEmail,
  validateHolderName,
  validatePhone,
  validatePixKey,
  validateRandomKey,
  validateWithdrawalPixData,
  validateWithdrawalReceiptFile,
  type WithdrawalReceiptFileLike,
} from "../src/lib/withdrawal-pix.ts";

describe("documentos usados como chave Pix", () => {
  test("normaliza e valida os dígitos verificadores de CPF", () => {
    assert.equal(normalizePixKey("cpf", " 529.982.247-25 "), "52998224725");
    assert.equal(validateCPF("529.982.247-25"), true);
    assert.equal(validatePixKey("cpf", "52998224725"), true);
    assert.equal(validateCPF("529.982.247-24"), false);
    assert.equal(validateCPF("111.111.111-11"), false);
    assert.equal(validateCPF("5299822472"), false);
  });

  test("normaliza e valida os dígitos verificadores de CNPJ", () => {
    assert.equal(normalizePixKey("cnpj", " 04.252.011/0001-10 "), "04252011000110");
    assert.equal(validateCNPJ("04.252.011/0001-10"), true);
    assert.equal(validatePixKey("cnpj", "04.252.011/0001-10"), true);
    assert.equal(validateCNPJ("04.252.011/0001-11"), false);
    assert.equal(validateCNPJ("00.000.000/0000-00"), false);
  });
});

describe("demais tipos de chave Pix", () => {
  test("normaliza e valida e-mail", () => {
    assert.equal(
      normalizePixKey("email", "  Pessoa.Teste@EXEMPLO.COM.BR  "),
      "pessoa.teste@exemplo.com.br",
    );
    assert.equal(validateEmail("  Pessoa.Teste@EXEMPLO.COM.BR  "), true);
    assert.equal(validatePixKey("email", "pessoa@exemplo.com"), true);
    assert.equal(validateEmail("pessoa @exemplo.com"), false);
    assert.equal(validateEmail("pessoa@localhost"), false);
    assert.equal(validateEmail("pessoa..teste@exemplo.com"), false);
  });

  test("normaliza telefone e exige 10 ou 11 dígitos com DDD brasileiro", () => {
    assert.equal(normalizePixKey("phone", "(11) 99999-1234"), "11999991234");
    assert.equal(validatePhone("(11) 99999-1234"), true);
    assert.equal(validatePhone("(21) 3333-4444"), true);
    assert.equal(validatePhone("99999-1234"), false);
    assert.equal(validatePhone("(00) 99999-1234"), false);
    assert.equal(validatePhone("+55 (11) 99999-1234"), false);
  });

  test("normaliza e valida chave aleatória como UUID", () => {
    const uuid = "123E4567-E89B-12D3-A456-426614174000";
    assert.equal(normalizePixKey("random", `  ${uuid}  `), uuid.toLowerCase());
    assert.equal(validateRandomKey(uuid), true);
    assert.equal(validatePixKey("random", uuid), true);
    assert.equal(validateRandomKey("123e4567e89b12d3a456426614174000"), false);
    assert.equal(validateRandomKey("00000000-0000-0000-0000-000000000000"), false);
  });

  test("informa erro específico sem lançar exceção", () => {
    assert.match(getPixKeyValidationError("cpf", "123") ?? "", /CPF/);
    assert.equal(getPixKeyValidationError("email", "pessoa@exemplo.com"), null);
  });
});

describe("formatação e mascaramento", () => {
  test("formata chaves para campos editáveis", () => {
    assert.equal(formatPixKey("cpf", "52998224725"), "529.982.247-25");
    assert.equal(formatPixKey("cnpj", "04252011000110"), "04.252.011/0001-10");
    assert.equal(formatPixKey("phone", "11999991234"), "(11) 99999-1234");
    assert.equal(formatPixKey("phone", "2133334444"), "(21) 3333-4444");
  });

  test("usa as máscaras de privacidade definidas para o fluxo de saque", () => {
    assert.equal(maskPixKey("cpf", "529.982.247-25"), "***.***.***-25");
    assert.equal(maskPixKey("cnpj", "04.252.011/0001-10"), "**.***.***/****-10");
    assert.equal(maskPixKey("email", "Gabriel@Email.com"), "g***@email.com");
    assert.equal(maskPixKey("phone", "(11) 99999-1234"), "(***) *****-1234");
    assert.equal(
      maskPixKey("random", "123e4567-e89b-12d3-a456-426614175678"),
      "123e****-****-****-****-********5678",
    );
  });
});

describe("banco, titular e dados completos", () => {
  test("remove espaços excedentes de banco e titular", () => {
    assert.equal(normalizeBankName("  Caixa   Econômica\tFederal  "), "Caixa Econômica Federal");
    assert.equal(normalizeHolderName("  Maria   da   Silva  "), "Maria da Silva");
    assert.equal(validateBankName("   "), false);
    assert.equal(validateBankName(" Inter "), true);
  });

  test("titular precisa ter ao menos dois caracteres e conter letra", () => {
    assert.equal(validateHolderName("M"), false);
    assert.equal(validateHolderName("123 456"), false);
    assert.equal(validateHolderName("--"), false);
    assert.equal(validateHolderName("Li"), true);
    assert.equal(validateHolderName("João da Silva"), true);
  });

  test("valida e devolve o conjunto de dados normalizado", () => {
    const result = validateWithdrawalPixData({
      bankName: "  Banco   Inter ",
      holderName: "  Ana   Souza ",
      pixKeyType: "email",
      pixKey: " ANA.SOUZA@EXEMPLO.COM ",
    });

    assert.deepEqual(result, {
      success: true,
      data: {
        bankName: "Banco Inter",
        holderName: "Ana Souza",
        pixKeyType: "email",
        pixKey: "ana.souza@exemplo.com",
      },
    });
  });

  test("agrega erros dos campos inválidos", () => {
    const result = validateWithdrawalPixData({
      bankName: " ",
      holderName: "7",
      pixKeyType: "cpf",
      pixKey: "111.111.111-11",
    });

    assert.equal(result.success, false);
    if (!result.success) {
      assert.deepEqual(Object.keys(result.errors).sort(), ["bankName", "holderName", "pixKey"]);
    }
  });
});

function receipt(name: string, type: string, size = 1024): WithdrawalReceiptFileLike {
  return { name, type, size };
}

describe("comprovante de pagamento", () => {
  test("aceita somente as combinações permitidas de extensão e MIME", () => {
    const accepted: WithdrawalReceiptFileLike[] = [
      receipt("comprovante.pdf", "application/pdf"),
      receipt("comprovante.JPG", "image/jpeg"),
      receipt("comprovante.jpeg", "image/jpeg"),
      receipt("comprovante.png", "image/png"),
      receipt("comprovante.webp", "image/webp"),
    ];

    for (const file of accepted) {
      assert.equal(validateWithdrawalReceiptFile(file).valid, true, file.name);
      assert.equal(isValidWithdrawalReceiptFile(file), true, file.name);
    }
  });

  test("aceita exatamente 10 MB e rejeita acima do limite", () => {
    assert.equal(
      validateWithdrawalReceiptFile(
        receipt("comprovante.pdf", "application/pdf", WITHDRAWAL_RECEIPT_MAX_SIZE_BYTES),
      ).valid,
      true,
    );

    assert.deepEqual(
      validateWithdrawalReceiptFile(
        receipt("comprovante.pdf", "application/pdf", WITHDRAWAL_RECEIPT_MAX_SIZE_BYTES + 1),
      ),
      { valid: false, code: "file_too_large", error: "O comprovante deve ter no máximo 10 MB." },
    );
  });

  test("rejeita extensão ausente, não permitida ou incompatível com o MIME", () => {
    assert.equal(
      validateWithdrawalReceiptFile(receipt("comprovante", "application/pdf")).valid,
      false,
    );
    assert.equal(
      validateWithdrawalReceiptFile(receipt("comprovante.html", "text/html")).valid,
      false,
    );
    assert.deepEqual(validateWithdrawalReceiptFile(receipt("comprovante.pdf", "image/png")), {
      valid: false,
      code: "mime_extension_mismatch",
      error: "A extensão não corresponde ao tipo do arquivo.",
    });
    assert.equal(
      validateWithdrawalReceiptFile(receipt("comprovante.png", "application/octet-stream")).valid,
      false,
    );
  });

  test("rejeita arquivo vazio ou com tamanho inválido", () => {
    assert.equal(
      validateWithdrawalReceiptFile(receipt("comprovante.pdf", "application/pdf", 0)).valid,
      false,
    );
    assert.equal(
      validateWithdrawalReceiptFile(receipt("comprovante.pdf", "application/pdf", 1.5)).valid,
      false,
    );
  });

  test("rejeita nomes maliciosos e mantém nomes comuns", () => {
    const unsafeNames = [
      "../comprovante.pdf",
      "pasta\\comprovante.pdf",
      "comprovante.exe.pdf",
      "comprovante.html.png",
      ".comprovante.pdf",
      "comprovante..pdf",
      "CON.pdf",
      "comprovante?.pdf",
    ];

    for (const name of unsafeNames) {
      const result = validateWithdrawalReceiptFile(receipt(name, "application/pdf"));
      assert.equal(result.valid, false, name);
    }

    assert.equal(
      validateWithdrawalReceiptFile(receipt("Comprovante Pix - João (1).pdf", "application/pdf"))
        .valid,
      true,
    );
  });

  test("exige o comprovante", () => {
    assert.deepEqual(validateWithdrawalReceiptFile(null), {
      valid: false,
      code: "missing_file",
      error: "Anexe o comprovante de pagamento.",
    });
  });
});
