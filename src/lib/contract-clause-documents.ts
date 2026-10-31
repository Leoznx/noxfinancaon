export type ContractClauseDocument = {
  title: string;
  fileName: string;
};

export type ContractClauseCategory = {
  id: string;
  title: string;
  documents: readonly ContractClauseDocument[];
};

export const CONTRACT_CLAUSE_DOCUMENT_BASE_PATH = "/documentos/clausulas-contrato";

export const CONTRACT_CLAUSE_CATEGORIES: readonly ContractClauseCategory[] = [
  {
    id: "jurisprudencias",
    title: "Coletânea jurisprudencial",
    documents: [
      { title: "Jurisprudência TJ RJ", fileName: "04-jurisprudencia-tjrj.pdf" },
      { title: "Jurisprudência TJ PR", fileName: "05-jurisprudencia-tjpr.pdf" },
      { title: "Jurisprudência TJ RS", fileName: "06-jurisprudencia-tjrs.pdf" },
      { title: "Jurisprudência TJ MG", fileName: "07-jurisprudencia-tjmg.pdf" },
      { title: "Jurisprudência TJ SP", fileName: "08-jurisprudencia-tjsp.pdf" },
      { title: "Jurisprudência TJ SC", fileName: "09-jurisprudencia-tjsc.pdf" },
    ],
  },
  {
    id: "peticoes-despejo",
    title: "Petições e modelos de despejo",
    documents: [
      { title: "Petição de juntada de apólice", fileName: "01-modelo-peticao-juntada.pdf" },
      {
        title: "Petição inicial de despejo - NOX Fiança",
        fileName: "02-peticao-inicial-despejo-nox-fianca.pdf",
      },
      {
        title: "Modelo de ação de despejo - NOX Fiança",
        fileName: "03-modelo-acao-despejo-nox-fianca.pdf",
      },
    ],
  },
  {
    id: "notificacao-caucao",
    title: "Modelo de notificação e caução",
    documents: [
      {
        title: "Declaração de adiantamento de caução",
        fileName: "10-declaracao-adiantamento-caucao.pdf",
      },
      { title: "Notificação de despejo", fileName: "11-modelo-notificacao-despejo.pdf" },
    ],
  },
  {
    id: "termos-clausulas",
    title: "Termos e cláusulas",
    documents: [
      {
        title: "Aditamento de majoração FIT e SMART",
        fileName: "13-aditamento-majoracao-fit-smart.pdf",
      },
      {
        title: "Cláusula padrão de fiança aluguel",
        fileName: "14-clausula-padrao-fianca-aluguel.pdf",
      },
      {
        title: "Termos e condições gerais do inquilino",
        fileName: "15-termos-condicoes-gerais-inquilino.pdf",
      },
    ],
  },
  {
    id: "garantia-investe",
    title: "Cláusula de contrato Garantia Investe",
    documents: [
      {
        title: "Cláusula NOX Fiança - Garantia Investe",
        fileName: "16-clausula-nox-fianca-garantia-investe.pdf",
      },
    ],
  },
  {
    id: "outros-modelos",
    title: "Outros modelos",
    documents: [
      { title: "Declaração de imissão de posse", fileName: "12-declaracao-imissao-posse.pdf" },
    ],
  },
] as const;

export function contractClauseDocumentPath(fileName: string) {
  return `${CONTRACT_CLAUSE_DOCUMENT_BASE_PATH}/${fileName}`;
}
