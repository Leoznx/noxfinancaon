// Parser compartilhado pro campo "colar leads em lista" e pros dois botões de
// importação (CSV e PDF) — todos os três caminhos convergem pro mesmo formato de
// texto (uma linha por lead) e passam pelo mesmo parseLeadLines, então o resultado
// é sempre previsível independente de como o lead chegou até o campo.

export interface ParsedLeadRow {
  nome: string;
  telefone?: string;
  email?: string;
  cidade?: string;
  raw: string;
}

function classificarToken(token: string): "email" | "telefone" | "outro" {
  const t = token.trim();
  if (!t) return "outro";
  if (t.includes("@")) return "email";
  const digits = t.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15 && digits.length / t.length > 0.5) return "telefone";
  return "outro";
}

function pareceLinhaDeCabecalho(linha: string): boolean {
  const normalizada = linha.toLowerCase();
  const temPalavraDeCabecalho = /\b(nome|name|telefone|phone|celular|email|e-mail|cidade|city)\b/.test(normalizada);
  const temEmailOuTelefoneReal = normalizada.includes("@") || /\d{8,}/.test(normalizada.replace(/\D/g, ""));
  return temPalavraDeCabecalho && !temEmailOuTelefoneReal;
}

/**
 * Aceita "Nome, Telefone, Email, Cidade" por linha (vírgula, ponto e vírgula ou tab
 * como separador — cobre tanto colar de uma planilha quanto um .csv de verdade),
 * mas não exige ordem fixa pros campos depois do nome: classifica cada token pelo
 * formato (tem @ → email; maioria de dígitos com 8-15 caracteres → telefone; resto
 * vira cidade). Pula a primeira linha se parecer um cabeçalho de planilha.
 */
export function parseLeadLines(texto: string): ParsedLeadRow[] {
  const linhas = texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  const semCabecalho = linhas.length > 0 && pareceLinhaDeCabecalho(linhas[0]) ? linhas.slice(1) : linhas;

  const rows: ParsedLeadRow[] = [];
  for (const linha of semCabecalho) {
    const tokens = linha
      .split(/[,;\t]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) continue;
    const nome = tokens[0];
    if (nome.length < 2) continue;

    let telefone: string | undefined;
    let email: string | undefined;
    let cidade: string | undefined;
    for (const token of tokens.slice(1)) {
      const tipo = classificarToken(token);
      if (tipo === "email" && !email) email = token;
      else if (tipo === "telefone" && !telefone) telefone = token;
      else if (!cidade) cidade = token;
    }

    rows.push({ nome, telefone, email, cidade, raw: linha });
  }
  return rows;
}

/** Lê um .csv como texto puro — é literalmente o mesmo formato "linha por lead", sem precisar de nenhuma lib. */
export async function readCsvFileAsText(file: File): Promise<string> {
  return file.text();
}

/**
 * Extrai o texto de um PDF (via pdfjs-dist, worker bundlado localmente — nunca
 * carrega nada de CDN externo) e devolve no mesmo formato "uma linha por lead"
 * pro parseLeadLines. Funciona bem pra PDFs de lista simples (nome/telefone/e-mail
 * por linha); PDFs com tabelas complexas de várias colunas podem sair fora de ordem
 * — por isso o campo de lista sempre fica editável antes de distribuir.
 */
export async function readPdfFileAsText(file: File): Promise<string> {
  const [{ getDocument, GlobalWorkerOptions }, workerUrlModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = (workerUrlModule as { default: string }).default;

  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;

  const linhas: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    // Agrupa itens de texto por linha usando a posição vertical (transform[5]) —
    // pdfjs devolve cada palavra/trecho separado, sem quebras de linha prontas.
    const porLinha = new Map<number, string[]>();
    for (const item of content.items as any[]) {
      if (typeof item.str !== "string" || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const lista = porLinha.get(y) ?? [];
      lista.push(item.str);
      porLinha.set(y, lista);
    }
    const linhasDaPagina = Array.from(porLinha.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, textos]) => textos.join(" ").replace(/\s+/g, " ").trim());
    linhas.push(...linhasDaPagina);
  }
  return linhas.join("\n");
}
