export type BlogPost = {
  slug: string;
  titulo: string;
  resumo: string;
  categoria: string;
  data: string; // dd/mm/aaaa
  leitura: string;
  autor: string;
  tags: string[];
  destaque?: boolean;
  imageUrl?: string;
  conteudo: Array<
    | { tipo: "p"; texto: string }
    | { tipo: "h2"; texto: string }
    | { tipo: "h3"; texto: string }
    | { tipo: "lista"; itens: string[] }
    | { tipo: "cta"; titulo: string; texto: string; botao: string; link: string }
    | { tipo: "tabela"; cabecalho: string[]; linhas: string[][] }
    | { tipo: "aviso"; texto: string }
  >;
};

export const CATEGORIAS = [
  "Todas",
  "Garantia Locatícia",
  "Seguro Fiança",
  "Aluguel sem Fiador",
  "Caução",
  "Fiador",
  "Dicas para Inquilinos",
  "Dicas para Proprietários",
  "Corretores",
  "Imobiliárias",
  "Mercado Imobiliário",
  "Contratos de Aluguel",
  "Inadimplência",
  "Tecnologia Imobiliária",
  "NOX Fiança",
];

const ctaAnalise = {
  tipo: "cta" as const,
  titulo: "Quer alugar sem fiador?",
  texto: "Faça sua simulação com a NOX Fiança em poucos minutos, 100% online.",
  botao: "Solicitar análise",
  link: "/cadastro",
};

const ctaParceiro = {
  tipo: "cta" as const,
  titulo: "É corretor ou imobiliária?",
  texto: "Seja parceiro da NOX e ganhe comissões recorrentes em cada contrato fechado.",
  botao: "Seja parceiro",
  link: "/seja-parceiro",
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "o-que-e-garantia-locaticia",
    titulo: "O que é garantia locatícia e como funciona?",
    resumo: "Entenda como a garantia locatícia substitui fiador e caução, facilitando o aluguel para inquilinos, proprietários e imobiliárias.",
    categoria: "Garantia Locatícia",
    data: "10/06/2026",
    leitura: "7 min",
    autor: "NOX Fiança",
    tags: ["garantia locatícia", "aluguel", "fiança", "locação"],
    destaque: true,
    conteudo: [
      { tipo: "p", texto: "A garantia locatícia é um instrumento contratual que protege o proprietário contra inadimplência e danos ao imóvel, substituindo o tradicional fiador ou o depósito caução. É a forma moderna, digital e burocrática-zero de viabilizar uma locação." },
      { tipo: "h2", texto: "Para que serve a garantia locatícia" },
      { tipo: "p", texto: "Ela serve para dar segurança jurídica e financeira a quem aluga. Em caso de atraso, inadimplência ou danos cobertos, o proprietário é ressarcido conforme o contrato firmado." },
      { tipo: "h2", texto: "Quem pode usar" },
      { tipo: "lista", itens: ["Inquilinos pessoa física e pessoa jurídica", "Proprietários que querem proteger o aluguel", "Imobiliárias que buscam escalar contratos", "Corretores autônomos credenciados"] },
      { tipo: "h2", texto: "Como funciona na prática" },
      { tipo: "p", texto: "O inquilino passa por uma análise de crédito automatizada. Aprovada a análise, a garantia é emitida e anexada ao contrato. O proprietário recebe o aluguel mesmo em caso de inadimplência, dentro das coberturas contratadas." },
      { tipo: "h2", texto: "Diferença entre garantia locatícia, fiador e caução" },
      { tipo: "tabela", cabecalho: ["Modalidade", "Burocracia", "Custo", "Segurança"], linhas: [["Garantia locatícia digital", "Baixa", "Mensal acessível", "Alta"], ["Fiador", "Alta", "Sem custo direto", "Variável"], ["Caução", "Média", "3 aluguéis de uma vez", "Limitada"]] },
      { tipo: "h2", texto: "Vantagens para cada parte" },
      { tipo: "h3", texto: "Para o inquilino" },
      { tipo: "lista", itens: ["Não precisa de fiador", "Sem depósito alto", "Aprovação em minutos", "Processo 100% digital"] },
      { tipo: "h3", texto: "Para o proprietário" },
      { tipo: "lista", itens: ["Aluguel garantido", "Menos risco de inadimplência", "Mais profissionalismo no contrato", "Acompanhamento digital"] },
      { tipo: "h3", texto: "Para a imobiliária" },
      { tipo: "lista", itens: ["Fechamento mais rápido", "Menos contratos travados", "Carteira protegida", "Painel completo de gestão"] },
      ctaAnalise,
      { tipo: "h2", texto: "Como a NOX Fiança simplifica esse processo" },
      { tipo: "p", texto: "A NOX integra análise de crédito, contrato digital, gestão financeira e acompanhamento em uma única plataforma. Tudo em minutos, sem fiador, sem burocracia." },
      { tipo: "aviso", texto: "Este conteúdo é informativo e não substitui orientação jurídica especializada." },
    ],
  },
  {
    slug: "como-alugar-sem-fiador",
    titulo: "Como alugar sem fiador de forma segura",
    resumo: "Veja o passo a passo para alugar um imóvel sem precisar de fiador, com agilidade, segurança e processo 100% digital.",
    categoria: "Aluguel sem Fiador",
    data: "08/06/2026",
    leitura: "6 min",
    autor: "NOX Fiança",
    tags: ["aluguel sem fiador", "garantia", "inquilino"],
    conteudo: [
      { tipo: "p", texto: "Encontrar um fiador é uma das principais barreiras para alugar um imóvel no Brasil. A boa notícia é que hoje existem alternativas modernas, rápidas e seguras." },
      { tipo: "h2", texto: "Por que tantos inquilinos não têm fiador" },
      { tipo: "p", texto: "Exigências como imóvel quitado na mesma cidade, comprovação de renda do fiador e disponibilidade do parente para assumir uma dívida tornam o fiador uma figura cada vez mais rara." },
      { tipo: "h2", texto: "Alternativas ao fiador" },
      { tipo: "lista", itens: ["Garantia locatícia digital", "Seguro fiança", "Título de capitalização", "Caução em dinheiro"] },
      { tipo: "h2", texto: "Como funciona a análise" },
      { tipo: "p", texto: "Você envia CPF, comprovante de renda e documentos básicos. O sistema cruza dados de crédito e responde em minutos." },
      { tipo: "h2", texto: "Documentos necessários" },
      { tipo: "lista", itens: ["RG e CPF", "Comprovante de renda", "Comprovante de residência atual", "Dados do imóvel pretendido"] },
      ctaAnalise,
      { tipo: "h2", texto: "Cuidados antes de fechar contrato" },
      { tipo: "lista", itens: ["Confira a vistoria", "Leia o contrato com calma", "Confirme reajuste e índice", "Guarde recibos e comprovantes"] },
      { tipo: "aviso", texto: "Este conteúdo é informativo e não substitui orientação jurídica especializada." },
    ],
  },
  {
    slug: "seguro-fianca-caucao-ou-fiador",
    titulo: "Seguro fiança, caução ou fiador: qual a melhor opção?",
    resumo: "Compare seguro fiança, caução e fiador e descubra qual modalidade faz mais sentido para inquilinos, proprietários e imobiliárias.",
    categoria: "Seguro Fiança",
    data: "05/06/2026",
    leitura: "8 min",
    autor: "NOX Fiança",
    tags: ["seguro fiança", "caução", "fiador", "comparativo"],
    conteudo: [
      { tipo: "p", texto: "Antes de fechar um aluguel, é preciso escolher a modalidade de garantia. Cada uma tem prós e contras importantes." },
      { tipo: "h2", texto: "Comparativo direto" },
      { tipo: "tabela", cabecalho: ["Critério", "Seguro fiança", "Caução", "Fiador"], linhas: [["Custo inicial", "Mensal", "3 aluguéis", "Zero"], ["Burocracia", "Baixa", "Média", "Alta"], ["Tempo de aprovação", "Minutos", "Dias", "Dias/Semanas"], ["Segurança ao proprietário", "Alta", "Média", "Variável"]] },
      { tipo: "h2", texto: "Qual é a mais rápida" },
      { tipo: "p", texto: "O seguro fiança e a garantia locatícia digital são as opções mais rápidas — geralmente aprovadas no mesmo dia." },
      { tipo: "h2", texto: "Qual dá mais segurança ao proprietário" },
      { tipo: "p", texto: "Modalidades com cobertura contratual (seguro fiança e garantia locatícia) protegem contra inadimplência e cobrem danos, multas e encargos." },
      { tipo: "h2", texto: "Qual facilita a vida da imobiliária" },
      { tipo: "p", texto: "Garantias digitais reduzem o ciclo de fechamento e padronizam o processo, evitando perdas por contratos parados." },
      ctaParceiro,
      { tipo: "aviso", texto: "Coberturas variam por plano. Consulte sempre as condições gerais." },
    ],
  },
  {
    slug: "proprietarios-garantia-locaticia",
    titulo: "Por que proprietários devem usar garantia locatícia?",
    resumo: "Proteja seu aluguel da inadimplência e profissionalize sua locação com uma garantia digital moderna.",
    categoria: "Dicas para Proprietários",
    data: "01/06/2026",
    leitura: "5 min",
    autor: "NOX Fiança",
    tags: ["proprietários", "inadimplência", "proteção"],
    conteudo: [
      { tipo: "p", texto: "Aluguel é um ativo que precisa de proteção. A garantia locatícia transforma sua locação em uma operação previsível e segura." },
      { tipo: "h2", texto: "Proteção contra inadimplência" },
      { tipo: "p", texto: "Mesmo que o inquilino atrase, você recebe o aluguel dentro das condições contratadas — sem desgaste de cobrança." },
      { tipo: "h2", texto: "Mais segurança no contrato" },
      { tipo: "lista", itens: ["Cobertura para encargos e multas", "Cobertura para danos ao imóvel", "Processo de cobrança especializado", "Suporte jurídico"] },
      { tipo: "h2", texto: "Como acompanhar contratos" },
      { tipo: "p", texto: "Pelo painel NOX você vê status de pagamento, vencimentos, sinistros e histórico financeiro em tempo real." },
      ctaAnalise,
    ],
  },
  {
    slug: "corretores-vender-mais-garantia-locaticia",
    titulo: "Como corretores podem vender mais com garantia locatícia",
    resumo: "Estratégias práticas para corretores fecharem mais contratos usando a garantia locatícia como diferencial competitivo.",
    categoria: "Corretores",
    data: "28/05/2026",
    leitura: "6 min",
    autor: "NOX Fiança",
    tags: ["corretores", "vendas", "comissão"],
    conteudo: [
      { tipo: "p", texto: "Corretores que dominam o discurso da garantia locatícia destravam contratos que pareciam impossíveis e ganham mais por isso." },
      { tipo: "h2", texto: "Como acelerar o fechamento" },
      { tipo: "lista", itens: ["Apresente a garantia logo no início da conversa", "Mostre comparativo com fiador", "Faça a simulação ao vivo com o cliente", "Use o painel para enviar contrato no mesmo dia"] },
      { tipo: "h2", texto: "Como reduzir objeções" },
      { tipo: "p", texto: "Explique que não há fiador, depósito alto nem espera. A simplicidade do processo já é argumento de venda." },
      { tipo: "h2", texto: "Como ganhar mais comissão" },
      { tipo: "p", texto: "Corretores NOX participam de plano de carreira com níveis Bronze, Prata, Ouro e Diamante — comissão recorrente em cada contrato ativo." },
      ctaParceiro,
    ],
  },
  {
    slug: "imobiliarias-garantia-digital",
    titulo: "Vantagens da garantia digital para imobiliárias",
    resumo: "Reduza inadimplência, acelere fechamentos e escale sua carteira de locação com a tecnologia da NOX Fiança.",
    categoria: "Imobiliárias",
    data: "25/05/2026",
    leitura: "6 min",
    autor: "NOX Fiança",
    tags: ["imobiliárias", "gestão", "tecnologia"],
    conteudo: [
      { tipo: "p", texto: "Imobiliárias que adotam garantia digital reduzem prazo médio de fechamento, aumentam taxa de aprovação e blindam a carteira contra inadimplência." },
      { tipo: "h2", texto: "Principais ganhos" },
      { tipo: "lista", itens: ["Menos burocracia para o time", "Mais contratos aprovados", "Controle centralizado de corretores", "Gestão de contratos ativos", "Faturamento organizado por competência"] },
      { tipo: "h2", texto: "Painel completo" },
      { tipo: "p", texto: "Acompanhe todos os corretores, contratos, comissões e indicadores em um único lugar." },
      ctaParceiro,
    ],
  },
  {
    slug: "documentos-para-alugar-imovel",
    titulo: "O que o inquilino precisa saber antes de alugar um imóvel",
    resumo: "Documentos, renda, vistoria e contrato: o guia essencial para alugar com segurança e evitar dores de cabeça.",
    categoria: "Dicas para Inquilinos",
    data: "22/05/2026",
    leitura: "5 min",
    autor: "NOX Fiança",
    tags: ["inquilinos", "documentos", "aluguel"],
    conteudo: [
      { tipo: "h2", texto: "Documentos necessários" },
      { tipo: "lista", itens: ["RG e CPF", "Comprovante de renda dos últimos 3 meses", "Comprovante de residência atual", "Carteira de trabalho ou contracheque"] },
      { tipo: "h2", texto: "Cuidados com renda" },
      { tipo: "p", texto: "A maioria dos imóveis exige renda entre 2,5 e 3 vezes o valor do aluguel. Considere encargos e condomínio na conta." },
      { tipo: "h2", texto: "Vistoria" },
      { tipo: "p", texto: "Faça vistoria detalhada antes de receber as chaves. Tire fotos e exija laudo assinado." },
      { tipo: "h2", texto: "Cuidados com golpe" },
      { tipo: "lista", itens: ["Nunca pague antes de visitar", "Desconfie de preços muito abaixo do mercado", "Confirme a propriedade no cartório", "Pague apenas para a imobiliária ou proprietário oficial"] },
      ctaAnalise,
    ],
  },
  {
    slug: "contrato-de-aluguel-cuidados",
    titulo: "Contrato de aluguel: pontos que merecem atenção",
    resumo: "Prazo, reajuste, multa, garantia e responsabilidades — saiba o que conferir antes de assinar.",
    categoria: "Contratos de Aluguel",
    data: "18/05/2026",
    leitura: "7 min",
    autor: "NOX Fiança",
    tags: ["contrato", "aluguel", "jurídico"],
    conteudo: [
      { tipo: "h2", texto: "Itens essenciais do contrato" },
      { tipo: "lista", itens: ["Prazo de vigência", "Valor do aluguel e encargos", "Índice e periodicidade de reajuste", "Modalidade de garantia", "Multa por rescisão", "Responsabilidades do inquilino e do proprietário", "Vistoria de entrada e saída"] },
      { tipo: "h2", texto: "Reajuste anual" },
      { tipo: "p", texto: "O reajuste mais comum é anual, atrelado ao IGP-M ou IPCA. Confirme o índice e a data-base." },
      { tipo: "h2", texto: "Multa por rescisão antecipada" },
      { tipo: "p", texto: "Em geral, equivale a três aluguéis proporcionais ao tempo restante de contrato." },
      { tipo: "aviso", texto: "Este conteúdo é informativo e não substitui orientação jurídica especializada." },
    ],
  },
  {
    slug: "inadimplencia-aluguel",
    titulo: "Inadimplência no aluguel: como reduzir riscos",
    resumo: "Boas práticas de análise de crédito, garantia e cobrança para proteger sua renda de aluguel.",
    categoria: "Inadimplência",
    data: "15/05/2026",
    leitura: "6 min",
    autor: "NOX Fiança",
    tags: ["inadimplência", "cobrança", "risco"],
    conteudo: [
      { tipo: "h2", texto: "O que causa inadimplência" },
      { tipo: "lista", itens: ["Análise de crédito frágil", "Falta de garantia adequada", "Ausência de processo de cobrança", "Desemprego e mudanças de renda do inquilino"] },
      { tipo: "h2", texto: "Como prevenir" },
      { tipo: "lista", itens: ["Use análise automatizada", "Exija garantia robusta", "Tenha régua de cobrança ativa", "Acompanhe pagamentos em tempo real"] },
      { tipo: "h2", texto: "Como a NOX ajuda" },
      { tipo: "p", texto: "A NOX combina análise, garantia, cobrança e suporte em uma única plataforma, blindando seu aluguel da inadimplência." },
      ctaAnalise,
    ],
  },
  {
    slug: "analise-de-credito-aluguel",
    titulo: "Como funciona a análise de crédito para aluguel",
    resumo: "Entenda os critérios usados na análise de crédito locatícia e como aumentar suas chances de aprovação.",
    categoria: "Garantia Locatícia",
    data: "10/05/2026",
    leitura: "5 min",
    autor: "NOX Fiança",
    tags: ["análise de crédito", "aprovação", "score"],
    conteudo: [
      { tipo: "h2", texto: "O que é avaliado" },
      { tipo: "lista", itens: ["Histórico de crédito (score)", "Renda comprovada", "Restrições e protestos", "Compatibilidade com o valor do aluguel"] },
      { tipo: "h2", texto: "Quanto tempo leva" },
      { tipo: "p", texto: "Em plataformas digitais como a NOX, a resposta é em minutos." },
      { tipo: "h2", texto: "Como aumentar chances de aprovação" },
      { tipo: "lista", itens: ["Mantenha seu CPF regular", "Pague contas em dia", "Tenha renda compatível", "Apresente documentos completos"] },
      ctaAnalise,
    ],
  },
  {
    slug: "tecnologia-no-mercado-imobiliario",
    titulo: "Por que o mercado imobiliário está migrando para garantias digitais",
    resumo: "Da assinatura eletrônica à análise automatizada — entenda a digitalização da locação no Brasil.",
    categoria: "Tecnologia Imobiliária",
    data: "05/05/2026",
    leitura: "6 min",
    autor: "NOX Fiança",
    tags: ["tecnologia", "proptech", "digitalização"],
    conteudo: [
      { tipo: "p", texto: "O setor imobiliário vive sua maior transformação digital. Garantias, contratos e cobrança migraram para o online — e quem não acompanha, perde negócios." },
      { tipo: "h2", texto: "Principais mudanças" },
      { tipo: "lista", itens: ["Análise de crédito automatizada", "Assinatura eletrônica", "Contratos digitais", "Pagamentos integrados", "Atendimento omnichannel"] },
      { tipo: "h2", texto: "Como a NOX se posiciona" },
      { tipo: "p", texto: "A NOX é uma proptech focada em garantia locatícia digital, combinando tecnologia, dados e experiência do usuário." },
      ctaParceiro,
    ],
  },
  {
    slug: "guia-completo-locacao-segura",
    titulo: "Guia completo da locação segura",
    resumo: "Cadastro, análise, garantia, contrato, vistoria e acompanhamento: o roteiro completo de uma locação sem dor de cabeça.",
    categoria: "Mercado Imobiliário",
    data: "01/05/2026",
    leitura: "10 min",
    autor: "NOX Fiança",
    tags: ["guia", "locação", "passo a passo"],
    conteudo: [
      { tipo: "h2", texto: "1. Cadastro" },
      { tipo: "p", texto: "Faça seu cadastro completo na plataforma com dados pessoais e documentos." },
      { tipo: "h2", texto: "2. Análise de crédito" },
      { tipo: "p", texto: "Em minutos, o sistema confirma sua aprovação." },
      { tipo: "h2", texto: "3. Garantia" },
      { tipo: "p", texto: "A garantia digital é emitida e anexada ao contrato." },
      { tipo: "h2", texto: "4. Contrato" },
      { tipo: "p", texto: "Contrato eletrônico, assinado online com validade jurídica." },
      { tipo: "h2", texto: "5. Vistoria" },
      { tipo: "p", texto: "Vistoria de entrada com laudo digital." },
      { tipo: "h2", texto: "6. Pagamento" },
      { tipo: "p", texto: "Boleto, Pix ou cartão — pagamento mensal automatizado." },
      { tipo: "h2", texto: "7. Acompanhamento" },
      { tipo: "p", texto: "Painel completo para acompanhar contrato, pagamentos e sinistros." },
      ctaAnalise,
      { tipo: "aviso", texto: "Este conteúdo é informativo e não substitui orientação jurídica especializada." },
    ],
  },
];

/* ──────────────── IMAGENS DE CAPA POR SLUG ──────────────── */
const FALLBACK_IMG = "https://images.unsplash.com/photo-1560518883-ce09059eeffa?q=80&w=1400&auto=format&fit=crop";

export const POST_IMAGES: Record<string, string> = {
  "o-que-e-garantia-locaticia": "https://images.unsplash.com/photo-1560518883-ce09059eeffa?q=80&w=1400&auto=format&fit=crop",
  "como-alugar-sem-fiador": "https://images.unsplash.com/photo-1568605114967-8130f3a36994?q=80&w=1400&auto=format&fit=crop",
  "seguro-fianca-caucao-ou-fiador": "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?q=80&w=1400&auto=format&fit=crop",
  "proprietarios-garantia-locaticia": "https://images.unsplash.com/photo-1582407947304-fd86f028f716?q=80&w=1400&auto=format&fit=crop",
  "corretores-vender-mais-garantia-locaticia": "https://images.unsplash.com/photo-1521791136064-7986c2920216?q=80&w=1400&auto=format&fit=crop",
  "imobiliarias-garantia-digital": "https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=1400&auto=format&fit=crop",
  "documentos-para-alugar-imovel": "https://images.unsplash.com/photo-1554224155-6726b3ff858f?q=80&w=1400&auto=format&fit=crop",
  "contrato-de-aluguel-cuidados": "https://images.unsplash.com/photo-1554224154-26032ffc0d07?q=80&w=1400&auto=format&fit=crop",
  "inadimplencia-aluguel": "https://images.unsplash.com/photo-1554224155-1696413565d3?q=80&w=1400&auto=format&fit=crop",
  "analise-de-credito-aluguel": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=1400&auto=format&fit=crop",
  "tecnologia-no-mercado-imobiliario": "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1400&auto=format&fit=crop",
  "guia-completo-locacao-segura": "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=1400&auto=format&fit=crop",
};

export function getPostImage(slug: string): string {
  return POST_IMAGES[slug] ?? FALLBACK_IMG;
}

for (const p of BLOG_POSTS) {
  if (!p.imageUrl) p.imageUrl = getPostImage(p.slug);
}

/* ──────────────── PUBLICAÇÕES SEMANAIS — TUDO SOBRE ALUGUEL ──────────────── */
const ALUGUEL_IMGS = [
  "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1400&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?q=80&w=1400&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1505873242700-f289a29e1e0f?q=80&w=1400&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1493809842364-78817add7ffb?q=80&w=1400&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1484154218962-a197022b5858?q=80&w=1400&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?q=80&w=1400&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1416331108676-a22ccb276e35?q=80&w=1400&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?q=80&w=1400&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1560185007-cde436f6a4d0?q=80&w=1400&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?q=80&w=1400&auto=format&fit=crop",
];

const SEMANAS: Array<{ slug: string; titulo: string; resumo: string; categoria: string; data: string; tags: string[]; conteudo: BlogPost["conteudo"] }> = [
  { slug: "tudo-sobre-aluguel-como-alugar-sem-fiador", titulo: "Tudo sobre aluguel: como alugar sem fiador", resumo: "O passo a passo digital para conseguir o imóvel dos sonhos sem depender de fiador.", categoria: "Aluguel sem Fiador", data: "06/05/2026", tags: ["aluguel", "sem fiador", "garantia"], conteudo: [
    { tipo: "p", texto: "Encontrar fiador atrasa locações e gera constrangimento. Com a garantia locatícia da NOX, todo o processo acontece online, em minutos." },
    { tipo: "h2", texto: "Como funciona" }, { tipo: "lista", itens: ["Cadastro digital", "Análise automatizada", "Emissão da garantia", "Assinatura do contrato"] },
    { tipo: "h2", texto: "Por que faz diferença" }, { tipo: "p", texto: "Sem depender de terceiros, você fecha contratos mais rápido e ainda preserva a relação com familiares e amigos." },
  ] },
  { slug: "tudo-sobre-aluguel-principais-clausulas-do-contrato", titulo: "Tudo sobre aluguel: principais cláusulas do contrato", resumo: "Quais cláusulas merecem atenção antes de assinar seu contrato de aluguel.", categoria: "Contratos de Aluguel", data: "13/05/2026", tags: ["contrato", "aluguel", "clausulas"], conteudo: [
    { tipo: "p", texto: "Um bom contrato evita brigas no futuro. Confira os pontos que merecem leitura cuidadosa." },
    { tipo: "h2", texto: "Cláusulas principais" }, { tipo: "lista", itens: ["Prazo e renovação", "Reajuste anual", "Multa por rescisão", "Garantia escolhida", "Vistoria de entrada e saída"] },
  ] },
  { slug: "tudo-sobre-aluguel-caucao-fiador-ou-seguro", titulo: "Tudo sobre aluguel: caução, fiador ou seguro fiança?", resumo: "Compare as três principais modalidades de garantia para locação.", categoria: "Garantia Locatícia", data: "20/05/2026", tags: ["caução", "fiador", "seguro"], conteudo: [
    { tipo: "p", texto: "Cada modalidade tem prós e contras. Veja qual faz mais sentido para o seu momento." },
    { tipo: "h2", texto: "Comparativo" }, { tipo: "tabela", cabecalho: ["Modalidade", "Custo", "Burocracia"], linhas: [["Caução", "3 aluguéis adiantados", "Média"], ["Fiador", "Sem custo direto", "Alta"], ["Seguro fiança / Garantia", "Mensalidade", "Baixa"]] },
  ] },
  { slug: "tudo-sobre-aluguel-o-que-observar-antes-de-alugar", titulo: "Tudo sobre aluguel: o que observar antes de alugar um imóvel", resumo: "Checklist completo para evitar surpresas antes de fechar a locação.", categoria: "Dicas para Inquilinos", data: "27/05/2026", tags: ["dicas", "inquilino", "vistoria"], conteudo: [
    { tipo: "p", texto: "Antes de assinar, vá além da fachada. Uma visita atenta evita dor de cabeça depois." },
    { tipo: "h2", texto: "Checklist" }, { tipo: "lista", itens: ["Estado de portas, janelas e pisos", "Funcionamento elétrico e hidráulico", "Infiltrações e mofo", "Condições de vizinhança", "Custos de condomínio e IPTU"] },
  ] },
  { slug: "tudo-sobre-aluguel-direitos-e-deveres-do-inquilino", titulo: "Tudo sobre aluguel: direitos e deveres do inquilino", resumo: "O que a Lei do Inquilinato garante e exige de quem aluga.", categoria: "Dicas para Inquilinos", data: "03/06/2026", tags: ["lei do inquilinato", "direitos", "deveres"], conteudo: [
    { tipo: "p", texto: "A Lei nº 8.245/91 protege as duas partes. Conheça o que ela diz sobre seu papel como locatário." },
    { tipo: "h2", texto: "Direitos" }, { tipo: "lista", itens: ["Receber o imóvel em condições de uso", "Recibo de pagamento", "Preferência na renovação"] },
    { tipo: "h2", texto: "Deveres" }, { tipo: "lista", itens: ["Pagar pontualmente", "Conservar o imóvel", "Comunicar reparos necessários"] },
  ] },
  { slug: "tudo-sobre-aluguel-documentacao-para-locacao", titulo: "Tudo sobre aluguel: documentação completa para locação", resumo: "A lista atualizada de documentos para acelerar sua aprovação.", categoria: "Dicas para Inquilinos", data: "10/06/2026", tags: ["documentos", "aprovação", "análise"], conteudo: [
    { tipo: "p", texto: "Ter os documentos prontos faz toda a diferença na velocidade da aprovação." },
    { tipo: "h2", texto: "Documentos básicos" }, { tipo: "lista", itens: ["RG ou CNH", "CPF", "Comprovante de renda", "Comprovante de residência", "Contrato preliminar"] },
  ] },
  { slug: "tudo-sobre-aluguel-inadimplencia-no-aluguel", titulo: "Tudo sobre aluguel: inadimplência e como evitar", resumo: "Como inquilino e proprietário podem reduzir riscos de atraso.", categoria: "Inadimplência", data: "17/06/2026", tags: ["inadimplência", "atrasos", "cobrança"], conteudo: [
    { tipo: "p", texto: "A inadimplência é o medo de qualquer proprietário — e o pesadelo de qualquer inquilino com dificuldades." },
    { tipo: "h2", texto: "Como evitar" }, { tipo: "lista", itens: ["Planejamento financeiro", "Aluguel até 30% da renda", "Garantia locatícia ativa", "Comunicação aberta com a imobiliária"] },
  ] },
  { slug: "tudo-sobre-aluguel-residencial-x-comercial", titulo: "Tudo sobre aluguel: residencial x comercial", resumo: "As diferenças jurídicas e práticas entre os dois tipos de locação.", categoria: "Mercado Imobiliário", data: "24/06/2026", tags: ["residencial", "comercial", "diferenças"], conteudo: [
    { tipo: "p", texto: "Embora pareçam parecidos, contrato residencial e comercial seguem regras bem diferentes." },
    { tipo: "h2", texto: "Diferenças" }, { tipo: "lista", itens: ["Prazo mínimo", "Reajustes", "Renovação compulsória", "Garantias aceitas"] },
  ] },
  { slug: "tudo-sobre-aluguel-como-funciona-a-analise", titulo: "Tudo sobre aluguel: como funciona a análise para aluguel", resumo: "Entenda o que é avaliado e como aumentar suas chances de aprovação.", categoria: "Aluguel sem Fiador", data: "01/07/2026", tags: ["análise", "crédito", "aprovação"], conteudo: [
    { tipo: "p", texto: "A análise considera renda, histórico financeiro e perfil. Veja o que mais pesa." },
    { tipo: "h2", texto: "O que é avaliado" }, { tipo: "lista", itens: ["Renda comprovada", "Score de crédito", "Histórico de pagamentos", "Tempo no emprego atual"] },
  ] },
  { slug: "tudo-sobre-aluguel-dicas-para-aprovacao", titulo: "Tudo sobre aluguel: dicas para conseguir aprovação", resumo: "Pequenos ajustes que aumentam muito sua chance de fechar o contrato.", categoria: "Dicas para Inquilinos", data: "08/07/2026", tags: ["aprovação", "dicas", "score"], conteudo: [
    { tipo: "p", texto: "Antes da análise, organize sua vida financeira e prepare a documentação." },
    { tipo: "h2", texto: "Checklist da aprovação" }, { tipo: "lista", itens: ["CPF regularizado", "Sem pendências em aberto", "Renda compatível", "Documentos atualizados"] },
  ] },
];

const WEEKLY_ALUGUEL_POSTS: BlogPost[] = SEMANAS.map((s, i) => ({
  slug: s.slug,
  titulo: s.titulo,
  resumo: s.resumo,
  categoria: s.categoria,
  data: s.data,
  leitura: "5 min",
  autor: "NOX Fiança",
  tags: s.tags,
  imageUrl: ALUGUEL_IMGS[i % ALUGUEL_IMGS.length],
  conteudo: [...s.conteudo, ctaAnalise],
}));

/* ──────────────── HELPERS ──────────────── */
function parseBrDate(d: string): number {
  const [dd, mm, yyyy] = d.split("/").map(Number);
  return new Date(yyyy, (mm ?? 1) - 1, dd ?? 1).getTime();
}

/** Todos os posts visíveis (originais + semanais já publicados), ordenados por data desc. */
export function getAllPosts(): BlogPost[] {
  const now = Date.now();
  return [...BLOG_POSTS, ...WEEKLY_ALUGUEL_POSTS]
    .filter((p) => parseBrDate(p.data) <= now)
    .sort((a, b) => parseBrDate(b.data) - parseBrDate(a.data));
}

export function getPostBySlug(slug: string) {
  return [...BLOG_POSTS, ...WEEKLY_ALUGUEL_POSTS].find((p) => p.slug === slug);
}

export function getRelatedPosts(slug: string, categoria: string, limit = 3) {
  return getAllPosts().filter((p) => p.slug !== slug && p.categoria === categoria).slice(0, limit);
}
