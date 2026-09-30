import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
  StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1?target=deno";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BLACK = rgb(0.035, 0.035, 0.035);
const DARK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.43, 0.43, 0.43);
const LIGHT = rgb(0.965, 0.965, 0.965);
const BORDER = rgb(0.86, 0.86, 0.86);
const YELLOW = rgb(1, 0.8, 0);

export const CONTRACT_PDF_LAYOUT_VERSION = "nox-contract-2026-v4";
export const CONTRACT_PDF_INCLUDES_ADMINISTRATOR_SECTION = false;
export const CONTRACT_PDF_INCLUDES_ACCOUNT_SECTION = false;
export const CONTRACT_PDF_INCLUDES_PROPERTY_OWNER_SECTION = true;
export const CONTRACT_PDF_INCLUDES_STATUS_SECTION = false;
export const CONTRACT_PDF_SIGNATURE_ROLES = ["tenant"] as const;

type ContractPdfInput = {
  consulta: any;
  contractNumber: string;
  planName: string;
  legalParagraphs: string[];
};

type GridCell = { label: string; value: string };

function normalizeDocument(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function formatCpfCnpj(value: unknown) {
  const digits = normalizeDocument(value);
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5",
    );
  }
  return digits || "Não informado no cadastro";
}

function formatPhone(value: unknown) {
  const digits = normalizeDocument(value);
  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }
  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }
  return String(value || "Não informado no cadastro");
}

function formatCep(value: unknown) {
  const digits = normalizeDocument(value);
  return digits.length === 8
    ? digits.replace(/(\d{5})(\d{3})/, "$1-$2")
    : String(value || "Não informado no cadastro");
}

function formatDate(value: unknown) {
  if (!value) return "Não informada no cadastro";
  const raw = String(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? raw
    : parsed.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatCurrency(value: unknown) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function safeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/✦/g, "")
    .replace(/telefone\s+X{5,}/gi, "telefone não informado")
    .replace(/e-mail\s+x{5,}/gi, "e-mail contato@noxfianca.com.br")
    .replace(/[^\u0009\u000A\u000D\u0020-\u00FF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculatePackageValue(consulta: any) {
  const imovel = consulta?.imoveis || {};
  return (
    Number(
      imovel.valor_aluguel ??
        consulta?.valor_aluguel ??
        consulta?.rent_value ??
        0,
    ) +
    Number(imovel.valor_condominio ?? consulta?.valor_condominio ?? 0) +
    Number(imovel.valor_taxas ?? consulta?.valor_taxas ?? 0)
  );
}

function splitLongWord(
  font: PDFFont,
  word: string,
  size: number,
  width: number,
) {
  const parts: string[] = [];
  let current = "";
  for (const char of word) {
    const candidate = current + char;
    if (current && font.widthOfTextAtSize(candidate, size) > width) {
      parts.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrapText(font: PDFFont, raw: string, size: number, width: number) {
  const text = safeText(raw);
  if (!text) return [""];
  const words = text.split(/\s+/).flatMap((word) =>
    font.widthOfTextAtSize(word, size) > width
      ? splitLongWord(font, word, size, width)
      : [word]
  );
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawLines(
  page: PDFPage,
  lines: string[],
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  lineHeight: number,
  color = DARK,
) {
  let nextY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: nextY, font, size, color });
    nextY -= lineHeight;
  }
  return nextY;
}

function drawGrid(
  page: PDFPage,
  rows: GridCell[][],
  topY: number,
  regular: PDFFont,
  bold: PDFFont,
) {
  const columns = 2;
  const cellWidth = CONTENT_WIDTH / columns;
  const rowHeight = 31;
  let y = topY;
  rows.forEach((row) => {
    const bottom = y - rowHeight;
    row.forEach((cell, index) => {
      const x = MARGIN + index * cellWidth;
      page.drawRectangle({
        x,
        y: bottom,
        width: cellWidth,
        height: rowHeight,
        color: LIGHT,
        borderColor: BORDER,
        borderWidth: 0.45,
      });
      page.drawText(safeText(cell.label).toUpperCase(), {
        x: x + 10,
        y: y - 10,
        font: bold,
        size: 6.2,
        color: MUTED,
      });
      let valueSize = 8.2;
      const value = safeText(cell.value || "Não informado no cadastro");
      while (
        valueSize > 6.4 &&
        bold.widthOfTextAtSize(value, valueSize) > cellWidth - 20
      ) {
        valueSize -= 0.25;
      }
      const valueLines = wrapText(bold, value, valueSize, cellWidth - 20).slice(
        0,
        2,
      );
      drawLines(page, valueLines, x + 10, y - 22, bold, valueSize, 8.2, DARK);
    });
    y = bottom;
  });
  return y;
}

function drawSectionTitle(
  page: PDFPage,
  title: string,
  y: number,
  bold: PDFFont,
) {
  page.drawText(safeText(title), {
    x: MARGIN,
    y,
    font: bold,
    size: 10,
    color: DARK,
  });
  return y - 13;
}

export async function buildStyledContractPdf(input: ContractPdfInput) {
  const { consulta, contractNumber, planName, legalParagraphs } = input;
  const inquilino = consulta?.inquilinos || {};
  const imovel = consulta?.imoveis || {};
  const proprietario = consulta?.proprietario_locacao || {};
  const plan = consulta?.planos || {};
  const calculated = consulta?.documentos?.plano_calculado || {};
  const extras = consulta?.documentos?.extras || {};
  const packageValue = calculatePackageValue(consulta);
  const multiplier = Number(
    calculated.cobertura_multiplicador ?? plan.cobertura_multiplicador ?? 0,
  );
  const exitMultiplier = Number(
    plan.custo_saida ?? calculated.custo_saida ?? 0,
  );
  const coverageValue = packageValue * multiplier;
  const exitValue = packageValue * exitMultiplier;
  const monthlyValue = Number(
    consulta?.valor_premio_mensal || calculated.mensal || 0,
  );
  const annualValue = Number(
    consulta?.valor_anual || calculated.totalAnual || monthlyValue * 12,
  );
  const activationEnabled = Boolean(
    consulta?.activation_fee_enabled ?? extras?.activation_fee_enabled,
  );
  const activationValue = activationEnabled
    ? Number(
      consulta?.activation_fee_amount ?? extras?.activation_fee_amount ?? 0,
    )
    : 0;
  const coverages = Array.isArray(consulta?.insurance_coverages)
    ? consulta.insurance_coverages.map((item: unknown) => safeText(item))
      .filter(Boolean)
    : [];
  const assistance = safeText(consulta?.insurance_assistance || "");
  const issuedAt = new Date();
  const issueDate = issuedAt.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const issueTime = issuedAt.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`Contrato ${planName} - ${contractNumber}`);
  pdf.setAuthor("NOX Fiança");
  pdf.setSubject("Contrato de Garantia Locatícia - documento não assinado");
  pdf.setCreator("NOX Fiança - automação contratual");
  pdf.setProducer("NOX Fiança");

  const summary = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const bannerHeight = 92;
  summary.drawRectangle({
    x: MARGIN,
    y: y - bannerHeight,
    width: CONTENT_WIDTH,
    height: bannerHeight,
    color: BLACK,
  });
  const markSize = 34;
  summary.drawRectangle({
    x: PAGE_WIDTH / 2 - 86,
    y: y - 63,
    width: markSize,
    height: markSize,
    color: YELLOW,
  });
  summary.drawCircle({
    x: PAGE_WIDTH / 2 - 69,
    y: y - 46,
    size: 10.5,
    color: BLACK,
  });
  summary.drawCircle({
    x: PAGE_WIDTH / 2 - 73,
    y: y - 43.5,
    size: 8.7,
    color: YELLOW,
  });
  summary.drawCircle({
    x: PAGE_WIDTH / 2 - 60.8,
    y: y - 35.2,
    size: 1.4,
    color: BLACK,
  });
  summary.drawText("NOX", {
    x: PAGE_WIDTH / 2 - 42,
    y: y - 48,
    font: bold,
    size: 26,
    color: rgb(1, 1, 1),
  });
  summary.drawText("FIANÇA", {
    x: PAGE_WIDTH / 2 - 41,
    y: y - 61,
    font: bold,
    size: 7.4,
    color: YELLOW,
  });
  y -= bannerHeight + 22;
  summary.drawText("CONTRATO DE GARANTIA LOCATÍCIA", {
    x: MARGIN,
    y,
    font: bold,
    size: 8,
    color: rgb(0.55, 0.41, 0),
  });
  y -= 27;
  summary.drawText(safeText(`Plano ${planName}`), {
    x: MARGIN,
    y,
    font: bold,
    size: 22,
    color: DARK,
  });
  y -= 18;
  const subtitle = safeText(
    `Contrato nº ${contractNumber} | Emitido em ${issueDate} às ${issueTime} | Documento para conferência e assinatura eletrônica`,
  );
  y = drawLines(
    summary,
    wrapText(regular, subtitle, 8, CONTENT_WIDTH),
    MARGIN,
    y,
    regular,
    8,
    10,
    rgb(0.3, 0.3, 0.3),
  ) - 7;

  y -= 8;

  y = drawSectionTitle(summary, "DADOS DA LOCATÁRIA", y, bold);
  y = drawGrid(
    summary,
    [
      [
        {
          label: "Nome completo",
          value: consulta?.tenant_name || inquilino.nome,
        },
        {
          label: "CPF/CNPJ",
          value: formatCpfCnpj(
            consulta?.tenant_document || inquilino.cpf || inquilino.cnpj,
          ),
        },
      ],
      [
        {
          label: "Nascimento",
          value: formatDate(
            consulta?.tenant_data_nascimento || inquilino.data_nascimento,
          ),
        },
        {
          label: "Telefone",
          value: formatPhone(consulta?.tenant_telefone || inquilino.telefone),
        },
      ],
      [
        {
          label: "E-mail",
          value: consulta?.tenant_email || "Não informado no cadastro",
        },
        {
          label: "Perfil",
          value: String(consulta?.tenant_type || inquilino.tipo || "PF")
              .toUpperCase() === "PJ"
            ? "Inquilina - pessoa jurídica"
            : "Inquilina - pessoa física",
        },
      ],
      [
        {
          label: "Cidade/UF",
          value: [
            consulta?.tenant_cidade || consulta?.cidade,
            consulta?.tenant_estado || consulta?.estado,
          ].filter(Boolean).join("/") || "Não informado no cadastro",
        },
        {
          label: "CEP",
          value: formatCep(consulta?.tenant_cep || consulta?.cep),
        },
      ],
    ],
    y,
    regular,
    bold,
  ) - 12;

  const ownerAddress = [
    proprietario.endereco || proprietario.logradouro,
    proprietario.numero ? `nº ${proprietario.numero}` : null,
  ].filter(Boolean).join(", ");
  y = drawSectionTitle(summary, "DADOS DO PROPRIETÁRIO", y, bold);
  y = drawGrid(
    summary,
    [
      [
        {
          label: "Nome completo",
          value: proprietario.nome || "Não informado no cadastro",
        },
        {
          label: "CPF/CNPJ",
          value: formatCpfCnpj(proprietario.documento),
        },
      ],
      [
        {
          label: "Endereço",
          value: ownerAddress || "Não informado no cadastro",
        },
        {
          label: "Complemento",
          value: proprietario.complemento || "Sem complemento",
        },
      ],
      [
        {
          label: "Bairro",
          value: proprietario.bairro || "Não informado no cadastro",
        },
        {
          label: "Cidade/UF e CEP",
          value: [
            [proprietario.cidade, proprietario.estado].filter(Boolean).join(
              "/",
            ),
            proprietario.cep ? `CEP ${formatCep(proprietario.cep)}` : null,
          ].filter(Boolean).join(" - ") || "Não informado no cadastro",
        },
      ],
    ],
    y,
    regular,
    bold,
  ) - 12;

  const address = [
    consulta?.imovel_endereco || imovel.endereco || imovel.logradouro,
    consulta?.imovel_numero || imovel.numero || "S/N",
  ].filter(Boolean).join(", ");
  y = drawSectionTitle(summary, "IMÓVEL DA LOCAÇÃO", y, bold);
  y = drawGrid(
    summary,
    [
      [
        {
          label: "Tipo",
          value: consulta?.imovel_subtipo || imovel.tipo ||
            consulta?.tipo_imovel || "Não informado",
        },
        {
          label: "CEP",
          value: formatCep(consulta?.imovel_cep || imovel.cep || consulta?.cep),
        },
      ],
      [
        {
          label: "Endereço",
          value: address || consulta?.property_address ||
            "Não informado no cadastro",
        },
        {
          label: "Complemento",
          value: consulta?.imovel_complemento || imovel.complemento ||
            "Sem complemento",
        },
      ],
      [
        {
          label: "Bairro",
          value: consulta?.imovel_bairro || imovel.bairro || "Não informado",
        },
        {
          label: "Cidade/UF",
          value: [
            consulta?.imovel_cidade || imovel.cidade,
            consulta?.imovel_estado || imovel.estado,
          ].filter(Boolean).join("/") || "Não informado",
        },
      ],
    ],
    y,
    regular,
    bold,
  );

  const summaryDetails = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let summaryY = PAGE_HEIGHT - 57;
  summaryY = drawSectionTitle(
    summaryDetails,
    "RESUMO DA CONTRATAÇÃO",
    summaryY,
    bold,
  );
  summaryY = drawGrid(
    summaryDetails,
    [
      [
        { label: "Plano", value: planName },
        { label: "Pacote locatício", value: formatCurrency(packageValue) },
      ],
      [
        {
          label: `Cobertura - ${multiplier || 0} vezes`,
          value: formatCurrency(coverageValue),
        },
        {
          label: `Custos de saída - ${exitMultiplier || 0} vezes`,
          value: formatCurrency(exitValue),
        },
      ],
      [
        { label: "Prêmio mensal", value: formatCurrency(monthlyValue) },
        { label: "Total anual", value: formatCurrency(annualValue) },
      ],
      [
        {
          label: "Taxa de adesão",
          value: activationEnabled
            ? formatCurrency(activationValue)
            : "Não contratada",
        },
        {
          label: "Cobertura adicional",
          value: coverages.length ? coverages.join(", ") : "Nenhuma",
        },
      ],
      [
        {
          label: "Forma de pagamento",
          value: consulta?.insurance_payment_method_label ||
            consulta?.insurance_payment_method || "Não informada",
        },
        {
          label: "Assistência adicional",
          value: !assistance || assistance === "none" ? "Nenhuma" : assistance,
        },
      ],
    ],
    summaryY,
    regular,
    bold,
  );

  summaryY -= 12;
  const summaryNote = safeText(
    `Os valores acima foram preenchidos a partir do cadastro aprovado no sistema NOX. A cobertura total considera o pacote locatício de ${
      formatCurrency(packageValue)
    } multiplicado por ${multiplier || 0}, conforme o plano ${planName}.`,
  );
  drawLines(
    summaryDetails,
    wrapText(regular, summaryNote, 7.4, CONTENT_WIDTH),
    MARGIN,
    summaryY,
    regular,
    7.4,
    9.2,
    MUTED,
  );

  const pages: PDFPage[] = [summary, summaryDetails];
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  let pageY = PAGE_HEIGHT - 57;

  const addLegalPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    pageY = PAGE_HEIGHT - 57;
  };

  const ensureSpace = (height: number) => {
    if (pageY - height < 40) addLegalPage();
  };

  const legalStart = legalParagraphs.findIndex((paragraph) =>
    safeText(paragraph).startsWith("TERMOS E CONDIÇÕES")
  );
  const normalizedLegal = legalParagraphs
    .slice(Math.max(0, legalStart))
    .map(safeText)
    .filter(Boolean);

  for (let text of normalizedLegal) {
    if (
      text === "DAQUI PARA BAIXO SÃO TODOS IGUAIS" ||
      text.startsWith("CONTRATO ATIVADO PELA NOX FIANÇA LTDA EM")
    ) {
      continue;
    }
    if (text === "ASSINATURA DIGITAL:") break;
    if (text.startsWith("TERMOS E CONDIÇÕES")) {
      text =
        `TERMOS E CONDIÇÕES GERAIS DE USO DO INQUILINO ${planName.toUpperCase()} / FIANÇA ALUGUEL`;
    }
    const isHeading = text.startsWith("CLÁUSULA ") ||
      text.startsWith("ANEXO I") ||
      text === "DEFINIÇÕES" ||
      text.startsWith("CLÁUSULA OBRIGATÓRIA PARA INSERÇÃO");
    const paragraphFont = isHeading ? bold : regular;
    const size = isHeading ? 9.7 : 8.1;
    const lineHeight = isHeading ? 12.2 : 10.8;
    const lines = wrapText(paragraphFont, text, size, CONTENT_WIDTH);
    const required = lines.length * lineHeight + (isHeading ? 9 : 4);
    ensureSpace(required);
    if (isHeading) pageY -= 4;
    pageY = drawLines(
      page,
      lines,
      MARGIN,
      pageY,
      paragraphFont,
      size,
      lineHeight,
      DARK,
    );
    pageY -= isHeading ? 5 : 3.2;
  }

  ensureSpace(105);
  pageY -= 9;
  page.drawText("ASSINATURA DIGITAL", {
    x: MARGIN,
    y: pageY,
    font: bold,
    size: 10.5,
    color: DARK,
  });
  pageY -= 46;
  const tenantName = safeText(
    consulta?.tenant_name || inquilino.nome || "LOCATÁRIA",
  );
  const lineWidth = 230;
  const lineX = MARGIN;
  page.drawLine({
    start: { x: lineX, y: pageY },
    end: { x: lineX + lineWidth, y: pageY },
    thickness: 0.7,
    color: DARK,
  });
  const tenantNameSize = tenantName.length > 38 ? 6.4 : 7.2;
  const nameWidth = bold.widthOfTextAtSize(tenantName, tenantNameSize);
  page.drawText(tenantName, {
    x: lineX + Math.max(0, (lineWidth - nameWidth) / 2),
    y: pageY - 18,
    font: bold,
    size: tenantNameSize,
    color: DARK,
  });
  const role = "Locatária";
  page.drawText(role, {
    x: lineX + (lineWidth - regular.widthOfTextAtSize(role, 7)) / 2,
    y: pageY - 35,
    font: regular,
    size: 7,
    color: MUTED,
  });
  pageY -= 58;
  const warning =
    "Documento ainda não assinado. A validade e a ativação da garantia dependem da assinatura eletrônica da locatária e da confirmação do pagamento.";
  drawLines(
    page,
    wrapText(regular, warning, 7.4, CONTENT_WIDTH),
    MARGIN,
    pageY,
    regular,
    7.4,
    9.2,
    MUTED,
  );

  pages.forEach((currentPage, index) => {
    if (index > 0) {
      currentPage.drawRectangle({
        x: 0,
        y: PAGE_HEIGHT - 36,
        width: PAGE_WIDTH,
        height: 36,
        color: BLACK,
      });
      currentPage.drawText("NOX FIANÇA", {
        x: MARGIN,
        y: PAGE_HEIGHT - 23,
        font: bold,
        size: 7.5,
        color: YELLOW,
      });
      const header = safeText(`Contrato ${contractNumber} - Plano ${planName}`);
      currentPage.drawText(header, {
        x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(header, 6.8),
        y: PAGE_HEIGHT - 23,
        font: regular,
        size: 6.8,
        color: rgb(1, 1, 1),
      });
    }
    currentPage.drawLine({
      start: { x: MARGIN, y: 26 },
      end: { x: PAGE_WIDTH - MARGIN, y: 26 },
      thickness: 0.45,
      color: BORDER,
    });
    currentPage.drawText("NOX FIANÇA LTDA. - CNPJ 67.579.012/0001-93", {
      x: MARGIN,
      y: 14,
      font: regular,
      size: 6.2,
      color: MUTED,
    });
    const number = `Página ${index + 1}`;
    currentPage.drawText(number, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(number, 6.2),
      y: 14,
      font: regular,
      size: 6.2,
      color: MUTED,
    });
  });

  return {
    bytes: await pdf.save({ useObjectStreams: false }),
    fileName: `${contractNumber} - ${safeText(planName)}.pdf`,
    mimeType: "application/pdf" as const,
  };
}
