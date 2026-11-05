import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
} from "https://esm.sh/pdf-lib@1.17.1?target=deno";

type CreditAnalysisPdfParams = {
  kind: "score" | "commitment";
  tenantName: string;
  rentValue: number | null;
  score?: number | null;
  scoreBand?: string | null;
  commitmentPercentage?: number | null;
  commitmentDescription?: string | null;
  generatedAt?: Date;
};

function safePdfText(value: unknown, fallback = "Não informado") {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return text || fallback;
}

function moneyBr(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "Não informado";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = safePdfText(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildCreditAnalysisPdf(params: CreditAnalysisPdfParams) {
  const document = await PDFDocument.create();
  const page = document.addPage([595.28, 841.89]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0.07, 0.07, 0.07);
  const gray = rgb(0.37, 0.37, 0.37);
  const yellow = rgb(1, 0.82, 0.11);
  const generatedAt = params.generatedAt || new Date();

  page.drawRectangle({ x: 0, y: 766, width: 595.28, height: 75, color: black });
  page.drawRectangle({ x: 42, y: 785, width: 38, height: 38, color: yellow });
  page.drawText("NOX", { x: 47, y: 797, size: 15, font: bold, color: black });
  page.drawText("NOX Fiança", { x: 95, y: 807, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Relatório interno para avaliação documental", {
    x: 95,
    y: 788,
    size: 10,
    font: regular,
    color: rgb(0.86, 0.86, 0.86),
  });

  const title = params.kind === "score" ? "Relatório de Score" : "Compromisso de Pagamento";
  page.drawText(title, { x: 42, y: 715, size: 25, font: bold, color: black });
  page.drawText(`Inquilino: ${safePdfText(params.tenantName)}`, {
    x: 42,
    y: 680,
    size: 12,
    font: bold,
    color: black,
  });
  page.drawText(`Valor do aluguel: ${moneyBr(params.rentValue)}`, {
    x: 42,
    y: 658,
    size: 11,
    font: regular,
    color: gray,
  });

  page.drawRectangle({
    x: 42,
    y: 465,
    width: 511,
    height: 155,
    color: rgb(0.97, 0.97, 0.97),
    borderColor: rgb(0.88, 0.88, 0.88),
    borderWidth: 1,
  });

  if (params.kind === "score") {
    const score = params.score == null ? "Não informado" : String(params.score);
    page.drawText("SCORE QUOD", { x: 64, y: 584, size: 10, font: bold, color: gray });
    page.drawText(score, { x: 64, y: 530, size: 38, font: bold, color: black });
    page.drawText(`Faixa retornada: ${safePdfText(params.scoreBand)}`, {
      x: 64,
      y: 492,
      size: 12,
      font: regular,
      color: gray,
    });
  } else {
    const percentage =
      params.commitmentPercentage == null
        ? "Não informado"
        : `${Number(params.commitmentPercentage).toLocaleString("pt-BR", {
            maximumFractionDigits: 2,
          })}%`;
    page.drawText("PERCENTUAL", { x: 64, y: 584, size: 10, font: bold, color: gray });
    page.drawText(percentage, { x: 64, y: 545, size: 30, font: bold, color: black });
    page.drawText("Descrição do provedor", { x: 64, y: 513, size: 10, font: bold, color: gray });
    const lines = wrapText(safePdfText(params.commitmentDescription), regular, 10, 465).slice(0, 4);
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: 64,
        y: 492 - index * 15,
        size: 10,
        font: regular,
        color: black,
      });
    });
  }

  page.drawText("Documento confidencial. Uso exclusivo da equipe administrativa da NOX Fiança.", {
    x: 42,
    y: 83,
    size: 9,
    font: bold,
    color: gray,
  });
  page.drawText(
    `Gerado em ${generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    { x: 42, y: 65, size: 8, font: regular, color: gray },
  );

  return await document.save();
}
