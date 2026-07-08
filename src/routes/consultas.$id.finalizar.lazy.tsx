import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, Lock, ShieldCheck, FileText, MapPin, User, Building2, CreditCard,
  QrCode, Receipt as ReceiptIcon, Info, AlertTriangle, ArrowLeft, ArrowRight, Send,
  Mail, MessageSquare, Sparkles, Clock, Home, FileCheck2, Flame, Zap, Wind,
} from "lucide-react";
import {
  salvarConfiguracaoSeguro,
  salvarFormaPagamento,
  enviarProposta,
  listarHistoricoProposta,
} from "@/lib/finalizacao.functions";

export const Route = createLazyFileRoute("/consultas/$id/finalizar")({
  component: () => (
    <ProtectedRoute>
      <FinalizarPage />
    </ProtectedRoute>
  ),
});

type EtapaKey = "resumo" | "pagamento" | "revisao" | "enviada";

const ETAPAS: { key: EtapaKey; label: string }[] = [
  { key: "resumo", label: "Resumo da proposta" },
  { key: "pagamento", label: "Forma de pagamento" },
  { key: "revisao", label: "Revisão final" },
  { key: "enviada", label: "Proposta enviada" },
];

const COBERTURAS = [
  { id: "incendio", nome: "Incêndio, explosão, queda de raio, fumaça e queda de aeronave", obrigatoria: true, desc: "Cobertura básica obrigatória contra sinistros estruturais graves." },
  { id: "danos_eletricos", nome: "Danos elétricos", obrigatoria: false, desc: "Cobertura para danos em equipamentos por curto-circuito ou variação de energia." },
  { id: "vendaval", nome: "Vendaval, furacão, ciclone, tornado e granizo", obrigatoria: false, desc: "Cobertura para fenômenos climáticos severos." },
  { id: "rc_familiar", nome: "Responsabilidade civil familiar", obrigatoria: false, desc: "Cobre danos involuntários causados a terceiros pelo segurado ou seus familiares." },
  { id: "perda_aluguel", nome: "Perda ou pagamento de aluguel", obrigatoria: false, desc: "Garante o aluguel em caso de sinistro que impeça o uso do imóvel." },
];

const ASSISTENCIAS = [
  { id: "none", nome: "Sem assistência", desc: "Apólice sem serviços emergenciais inclusos." },
  { id: "basic", nome: "Emergencial Básico", desc: "Chaveiro, vidraceiro e encanador em emergências." },
  { id: "essential", nome: "Emergencial Essencial", desc: "Inclui o básico + elétrica, hidráulica e desentupimento." },
  { id: "complete", nome: "Emergencial Completo", desc: "Cobertura completa de manutenção emergencial." },
  { id: "complete_pet", nome: "Emergencial Completo + PET", desc: "Cobertura completa com assistência veterinária para PETs." },
];

const PAGAMENTOS = [
  { id: "credit_card" as const, label: "Cartão de crédito", icon: CreditCard, desc: "Pagamento em até 12x no cartão de crédito." },
  { id: "pix" as const, label: "Pix", icon: QrCode, desc: "Pagamento à vista com confirmação imediata." },
  { id: "boleto" as const, label: "Boleto", icon: ReceiptIcon, desc: "Pagamento à vista via boleto bancário." },
];

const COMISSAO_OPCOES = [0, 5, 8, 10, 12, 15, 18, 20];
const RESIDENCIAL_OPCOES = ["Casa", "Apartamento"];
const COMERCIAL_OPCOES = ["Consultório ou Clínica", "Indústria", "Serviço", "Comércio", "Armazém"];
const COBERTURA_VALORES: Record<string, number> = {
  incendio: 104.96,
  danos_eletricos: 11.9,
  vendaval: 8.7,
  rc_familiar: 6.4,
  perda_aluguel: 14.8,
};
const ASSISTENCIA_VALORES: Record<string, number> = {
  none: 0,
  basic: 9.9,
  essential: 15.9,
  complete: 24.9,
  complete_pet: 34.9,
};

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Alíquota do seguro incêndio (obrigatório) sobre o valor do aluguel, por tipo de imóvel.
function calcularPercentualIncendio(tipo: "residencial" | "comercial", aluguelValor: number): number {
  if (tipo === "comercial") {
    if (aluguelValor <= 3000) return 5;
    if (aluguelValor <= 8000) return 8;
    return 10;
  }
  if (aluguelValor > 12000) return 10;
  if (aluguelValor > 5000) return 5;
  return 3;
}

function FinalizarPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [consulta, setConsulta] = useState<any>(null);
  const [documentos, setDocumentos] = useState<any[]>([]);
  const [historico, setHistorico] = useState<any[]>([]);
  const [etapa, setEtapa] = useState<EtapaKey>("resumo");
  const [enviando, setEnviando] = useState(false);
  const [termosOpen, setTermosOpen] = useState(false);

  // Configuração seguro
  const [coberturas, setCoberturas] = useState<string[]>(["incendio"]);
  const [assistencia, setAssistencia] = useState<string>("none");
  const [comissaoPct, setComissaoPct] = useState<number>(10);

  // Pagamento
  const [pagamento, setPagamento] = useState<"credit_card" | "pix" | "boleto" | "">("");
  const [naoMadeira, setNaoMadeira] = useState(false);
  const [aceiteTermos, setAceiteTermos] = useState(false);
  const [tipoSeguroImovel, setTipoSeguroImovel] = useState<"residencial" | "comercial">("residencial");
  const [residencialSubtipo, setResidencialSubtipo] = useState("Apartamento");
  const [comercialSubtipo, setComercialSubtipo] = useState("");
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const fnSalvarConfig = useServerFn(salvarConfiguracaoSeguro);
  const fnSalvarPagamento = useServerFn(salvarFormaPagamento);
  const fnEnviar = useServerFn(enviarProposta);
  const fnHist = useServerFn(listarHistoricoProposta);

  useEffect(() => {
    (async () => {
      try {
        // consulta/documentos/histórico não dependem uns dos outros — buscar em paralelo
        // em vez de em sequência corta o tempo de carregamento da página praticamente ao
        // tempo da requisição mais lenta, em vez da soma das três.
        const [consultaRes, docsRes, histRes] = await Promise.all([
          supabase.from("consultas_credito").select(`*, inquilinos(*), imoveis(*), planos(*)`).eq("id", id).single(),
          supabase.from("documentos_proposta").select("id, file_name, document_type, document_subtype").eq("consulta_id", id),
          fnHist({ data: { consultaId: id } }).catch(() => null),
        ]);

        if (consultaRes.error) throw consultaRes.error;
        const data = consultaRes.data;
        setConsulta(data);

        if ((data as any).insurance_coverages?.length) setCoberturas((data as any).insurance_coverages);
        if ((data as any).insurance_assistance) setAssistencia((data as any).insurance_assistance);
        if ((data as any).insurance_commission_pct != null) setComissaoPct(Number((data as any).insurance_commission_pct));
        if ((data as any).insurance_payment_method) setPagamento((data as any).insurance_payment_method);
        if ((data as any).property_not_wood_confirmed) setNaoMadeira(true);
        if ((data as any).terms_accepted) setAceiteTermos(true);
        if ((data as any).substatus === "aguardando_assinatura") setEtapa("enviada");

        setDocumentos(docsRes.data ?? []);
        if (histRes) setHistorico(histRes.historico);
      } catch (e: any) {
        toast.error("Erro ao carregar: " + e.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const imovel = consulta?.imoveis ?? {};
  const inquilino = consulta?.inquilinos ?? {};
  const plano = consulta?.planos ?? {};

  const aluguel = Number(imovel.valor_aluguel) || 0;
  const condominio = Number(imovel.valor_condominio) || 0;
  const taxas = Number(imovel.valor_taxas) || 0;
  const totalLoc = aluguel + condominio + taxas;
  const premioMensal = Number(consulta?.valor_premio_mensal) || 0;
  const premioAnual = Number(consulta?.valor_anual) || premioMensal * 12;
  const cobertura = totalLoc * (Number(plano?.cobertura_multiplicador) || 12);
  const documentosMeta = consulta?.documentos && typeof consulta.documentos === "object" ? consulta.documentos : {};
  const extrasSummary = (documentosMeta as any).extras ?? {};
  const dadosComplementaresSummary = (documentosMeta as any).dados_complementares ?? {};

  const taxaAtivacao = (consulta?.activation_fee_enabled ?? extrasSummary?.activation_fee_enabled)
    ? Number(consulta?.activation_fee_amount ?? extrasSummary?.activation_fee_amount) || 0
    : 0;
  const pinturaTotal = (consulta?.external_painting_enabled ?? extrasSummary?.external_painting_enabled)
    ? Number(consulta?.external_painting_total ?? extrasSummary?.external_painting_total) || 0
    : 0;
  const contratoAssinadoPendente = !!dadosComplementaresSummary?.contrato_locacao_pendencia;
  const custoSaida = Number(plano?.custo_saida) || 0;

  const valorComissao = useMemo(() => premioAnual * (comissaoPct / 100), [premioAnual, comissaoPct]);
  const totalFinal = useMemo(() => premioAnual + taxaAtivacao + pinturaTotal, [premioAnual, taxaAtivacao, pinturaTotal]);
  const percentualIncendio = useMemo(
    () => calcularPercentualIncendio(tipoSeguroImovel, aluguel),
    [tipoSeguroImovel, aluguel],
  );
  const premioIncendioMensal = useMemo(() => aluguel * (percentualIncendio / 100), [aluguel, percentualIncendio]);
  const premioIncendioAnual = useMemo(() => premioIncendioMensal * 12, [premioIncendioMensal]);
  const totalSeguroImobiliario = useMemo(() => {
    return premioIncendioMensal + (ASSISTENCIA_VALORES[assistencia] ?? 0);
  }, [premioIncendioMensal, assistencia]);
  const parcelaSeguro = useMemo(() => totalSeguroImobiliario / 12, [totalSeguroImobiliario]);

  function toggleCobertura(cid: string) {
    const c = COBERTURAS.find((x) => x.id === cid);
    if (c?.obrigatoria) return;
    setCoberturas((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));
  }

  async function avancarParaPagamento() {
    try {
      await fnSalvarConfig({
        data: {
          consultaId: id,
          insurance_coverages: coberturas,
          insurance_assistance: assistencia,
          insurance_commission_pct: comissaoPct,
        },
      });
      setEtapa("pagamento");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function avancarParaRevisao() {
    if (!pagamento) return toast.error("Selecione uma forma de pagamento.");
    if (!naoMadeira) return toast.error("Confirme que o imóvel não é de madeira para continuar.");
    if (!aceiteTermos) return toast.error("Aceite os Termos e Condições para continuar.");
    try {
      const label = PAGAMENTOS.find((p) => p.id === pagamento)?.label ?? "";
      await fnSalvarPagamento({
        data: {
          consultaId: id,
          insurance_payment_method: pagamento as any,
          insurance_payment_method_label: label,
          property_not_wood_confirmed: naoMadeira,
          terms_accepted: aceiteTermos,
        },
      });
      setEtapa("revisao");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleEnviar() {
    setEnviando(true);
    try {
      await fnSalvarConfig({
        data: {
          consultaId: id,
          insurance_coverages: coberturas,
          insurance_assistance: assistencia,
          insurance_commission_pct: comissaoPct,
        },
      });
      await fnSalvarPagamento({
        data: {
          consultaId: id,
          insurance_payment_method: (pagamento || "credit_card") as any,
          insurance_payment_method_label: PAGAMENTOS.find((p) => p.id === pagamento)?.label ?? "Cartão de crédito",
          property_not_wood_confirmed: naoMadeira,
          terms_accepted: aceiteTermos,
        },
      });
      const r = await fnEnviar({ data: { consultaId: id } });
      const h = await fnHist({ data: { consultaId: id } });
      setHistorico(h.historico);
      setConsulta((c: any) => ({ ...c, proposta_enviada_em: r.enviadoEm, substatus: "aguardando_assinatura", status: "aprovado" }));
      setEtapa("enviada");
      toast.success("Proposta enviada com sucesso!");
    } catch (e: any) {
      toast.error("Erro ao enviar: " + e.message);
    } finally {
      setEnviando(false);
    }
  }

  if (loading || !consulta) {
    return <DashboardLayout><div className="p-10 text-sm text-neutral-500">Carregando...</div></DashboardLayout>;
  }

  const numeroProposta = `NOX-${String(id).slice(0, 8).toUpperCase()}`;

  const seguroConcluido = !!(pagamento && naoMadeira && aceiteTermos);

  return (
    <DashboardLayout>
      <ResumoPropostaLoft
        id={id}
        numeroProposta={numeroProposta}
        consulta={consulta}
        inquilino={inquilino}
        imovel={imovel}
        plano={plano}
        documentos={documentos}
        historico={historico}
        historicoAberto={historicoAberto}
        setHistoricoAberto={setHistoricoAberto}
        tipoSeguroImovel={tipoSeguroImovel}
        setTipoSeguroImovel={setTipoSeguroImovel}
        residencialSubtipo={residencialSubtipo}
        setResidencialSubtipo={setResidencialSubtipo}
        comercialSubtipo={comercialSubtipo}
        setComercialSubtipo={setComercialSubtipo}
        coberturas={coberturas}
        toggleCobertura={toggleCobertura}
        assistencia={assistencia}
        setAssistencia={setAssistencia}
        comissaoPct={comissaoPct}
        setComissaoPct={setComissaoPct}
        valorComissao={valorComissao}
        totalSeguroImobiliario={totalSeguroImobiliario}
        parcelaSeguro={parcelaSeguro}
        percentualIncendio={percentualIncendio}
        premioIncendioMensal={premioIncendioMensal}
        premioIncendioAnual={premioIncendioAnual}
        aluguel={aluguel}
        condominio={condominio}
        taxas={taxas}
        totalLoc={totalLoc}
        premioMensal={premioMensal}
        taxaAtivacao={taxaAtivacao}
        custoSaida={custoSaida}
        contratoAssinadoPendente={contratoAssinadoPendente}
        enviando={enviando}
        pagamento={pagamento}
        setPagamento={setPagamento}
        naoMadeira={naoMadeira}
        setNaoMadeira={setNaoMadeira}
        aceiteTermos={aceiteTermos}
        setAceiteTermos={setAceiteTermos}
        abrirTermos={() => setTermosOpen(true)}
        seguroConcluido={seguroConcluido}
        onEditarDados={() => navigate({ to: `/consultas/${id}/dados-complementares` as any })}
        onCancelar={() => navigate({ to: `/consultas/${id}/resultado` as any })}
        onEnviar={handleEnviar}
      />

      <Dialog open={termosOpen} onOpenChange={setTermosOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Termos e Condições do Seguro</DialogTitle>
            <DialogDescription>NOX Fiança — Contrato de seguro imobiliário (180 Seguros)</DialogDescription>
          </DialogHeader>
          <div className="text-sm text-neutral-700 space-y-3 leading-relaxed">
            <p><strong>1. Objeto.</strong> O presente seguro tem por objeto garantir, dentro dos limites contratados, prejuízos diretos causados aos bens segurados em decorrência de riscos cobertos.</p>
            <p><strong>2. Coberturas.</strong> As coberturas selecionadas durante a contratação compõem a apólice. Coberturas obrigatórias não podem ser removidas.</p>
            <p><strong>3. Imóveis aceitos.</strong> A apólice cobre imóveis em alvenaria. Imóveis de madeira ou com estrutura predominantemente madeireira não são aceitos.</p>
            <p><strong>4. Pagamento.</strong> O pagamento é realizado conforme a forma escolhida (cartão de crédito, Pix ou boleto). Alterações posteriores podem exigir nova cotação.</p>
            <p><strong>5. Restrições.</strong> Caso seja identificada característica impeditiva para emissão do seguro, a apólice poderá não ser emitida e a proposta poderá ser cancelada.</p>
            <p><strong>6. Vigência.</strong> A apólice vigora por 12 meses a contar da data de ativação pelo inquilino.</p>
            <p><strong>7. Sinistros.</strong> Sinistros devem ser comunicados em até 5 dias úteis pelos canais oficiais da NOX.</p>
          </div>
          <DialogFooter>
            <Button onClick={() => { setAceiteTermos(true); setTermosOpen(false); }} className="bg-yellow-400 text-neutral-900 hover:bg-yellow-300">
              Li e aceito os termos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="flex-1 flex flex-col bg-neutral-50">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-neutral-900">Finalização do seguro</h1>
              <p className="text-sm text-neutral-500 mt-1">Proposta {numeroProposta}</p>
            </div>
            <StatusBadge status={consulta.status} substatus={consulta.substatus} />
          </div>

          {/* Stepper */}
          {etapa !== "enviada" && <Stepper etapa={etapa} />}

          {/* Conteúdo etapa */}
          {etapa === "resumo" && (
            <EtapaResumo
              consulta={consulta} inquilino={inquilino} imovel={imovel} plano={plano}
              documentos={documentos}
              contratoAssinadoPendente={contratoAssinadoPendente}
              totalLoc={totalLoc} cobertura={cobertura}
              premioMensal={premioMensal} taxaAtivacao={taxaAtivacao} custoSaida={custoSaida}
              onVoltar={() => navigate({ to: `/consultas/${id}/dados-complementares` as any })}
              onAvancar={avancarParaPagamento}
            />
          )}

          {etapa === "pagamento" && (
            <EtapaPagamento
              pagamento={pagamento} setPagamento={setPagamento}
              naoMadeira={naoMadeira} setNaoMadeira={setNaoMadeira}
              aceiteTermos={aceiteTermos} setAceiteTermos={setAceiteTermos}
              abrirTermos={() => setTermosOpen(true)}
              premioMensal={premioMensal} premioAnual={premioAnual} totalFinal={totalFinal}
              coberturas={coberturas} assistencia={assistencia} comissaoPct={comissaoPct}
              taxaAtivacao={taxaAtivacao} pinturaTotal={pinturaTotal}
              imovel={imovel}
              onVoltar={() => setEtapa("resumo")}
              onAvancar={avancarParaRevisao}
            />
          )}

          {etapa === "revisao" && (
            <EtapaRevisao
              numeroProposta={numeroProposta}
              consulta={consulta} inquilino={inquilino} imovel={imovel} plano={plano}
              documentos={documentos} historico={historico}
              contratoAssinadoPendente={contratoAssinadoPendente}
              coberturas={coberturas} assistencia={assistencia} comissaoPct={comissaoPct}
              pagamento={pagamento}
              totalLoc={totalLoc} premioMensal={premioMensal} premioAnual={premioAnual} totalFinal={totalFinal}
              taxaAtivacao={taxaAtivacao} pinturaTotal={pinturaTotal}
              enviando={enviando}
              onVoltar={() => setEtapa("pagamento")}
              onEnviar={handleEnviar}
            />
          )}

          {etapa === "enviada" && (
            <EtapaEnviada
              numeroProposta={numeroProposta}
              consulta={consulta} inquilino={inquilino} plano={plano} pagamento={pagamento}
              onVerDetalhes={() => navigate({ to: `/consultas/${id}/resultado` as any })}
              onVoltarContratos={() => navigate({ to: "/consultas" as any })}
              onNovaConsulta={() => navigate({ to: "/consultas/nova" as any })}
            />
          )}
        </div>
      </div>

      <Dialog open={termosOpen} onOpenChange={setTermosOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Termos e Condições do Seguro</DialogTitle>
            <DialogDescription>NOX Fiança — Contrato de seguro imobiliário</DialogDescription>
          </DialogHeader>
          <div className="text-sm text-neutral-700 space-y-3 leading-relaxed">
            <p><strong>1. Objeto.</strong> O presente seguro tem por objeto garantir, dentro dos limites contratados, prejuízos diretos causados aos bens segurados em decorrência de riscos cobertos.</p>
            <p><strong>2. Coberturas.</strong> As coberturas selecionadas durante a contratação compõem a apólice. Coberturas obrigatórias não podem ser removidas.</p>
            <p><strong>3. Imóveis aceitos.</strong> A apólice cobre imóveis em alvenaria. Imóveis de madeira ou com estrutura predominantemente madeireira não são aceitos.</p>
            <p><strong>4. Pagamento.</strong> O pagamento é realizado conforme a forma escolhida (cartão de crédito, Pix ou boleto). Alterações posteriores podem exigir nova cotação.</p>
            <p><strong>5. Restrições.</strong> Caso seja identificada característica impeditiva para emissão do seguro, a apólice poderá não ser emitida e a proposta poderá ser cancelada.</p>
            <p><strong>6. Vigência.</strong> A apólice vigora por 12 meses a contar da data de ativação pelo inquilino.</p>
            <p><strong>7. Sinistros.</strong> Sinistros devem ser comunicados em até 5 dias úteis pelos canais oficiais da NOX.</p>
          </div>
          <DialogFooter>
            <Button onClick={() => { setAceiteTermos(true); setTermosOpen(false); }} className="bg-yellow-400 text-neutral-900 hover:bg-yellow-300">
              Li e aceito os termos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function ResumoPropostaLoft(p: any) {
  const {
    id, numeroProposta, consulta, inquilino, imovel, plano, documentos, historico,
    historicoAberto, setHistoricoAberto, tipoSeguroImovel, setTipoSeguroImovel,
    residencialSubtipo, setResidencialSubtipo, comercialSubtipo, setComercialSubtipo,
    coberturas, toggleCobertura,
    assistencia, setAssistencia, comissaoPct, setComissaoPct, valorComissao,
    totalSeguroImobiliario, parcelaSeguro, percentualIncendio, premioIncendioMensal, premioIncendioAnual,
    aluguel, condominio, taxas, totalLoc,
    premioMensal, taxaAtivacao, custoSaida, contratoAssinadoPendente, enviando,
    pagamento, setPagamento, naoMadeira, setNaoMadeira,
    aceiteTermos, setAceiteTermos, abrirTermos, seguroConcluido,
    onEditarDados, onCancelar, onEnviar,
  } = p;
  const dataNascimento = consulta?.tenant_data_nascimento
    ? new Date(`${consulta.tenant_data_nascimento}T00:00:00`).toLocaleDateString("pt-BR")
    : "—";
  const planoNome = (plano?.nome ?? "—").replace(/^NOX\s+/i, "");
  const tipoPagador = consulta?.payment_type === "imobiliaria" ? "Recorrência via Imobiliária" : "Recorrência via Inquilino";
  const solicitacao = String(id).slice(0, 8).replace(/\D/g, "") || numeroProposta.replace("NOX-", "");
  const historicoPadrao = `Criada solicitação ${numeroProposta} no produto ${planoNome}. Aluguel ${fmt(aluguel)}, condomínio ${fmt(condominio)}, outras taxas ${fmt(taxas)} e total ${fmt(totalLoc)}.`;
  const assistLabel = ASSISTENCIAS.find((a) => a.id === assistencia)?.nome ?? "Sem assistência";
  const coberturaObrigatoria = COBERTURAS.find((c) => c.id === "incendio");
  const valorSetup = taxaAtivacao;
  const coberturaTotal = `${Number(plano?.cobertura_multiplicador) || 35}x`;
  const custoSaidaTexto = `${Number(custoSaida) || 3}x`;
  const documentosNomes = documentos.map((doc: any) => doc.file_name).filter(Boolean);

  return (
    <div className="min-h-screen bg-[#eef1f5] pb-28">
      <div className="mx-auto w-full max-w-[780px] px-4 py-10 space-y-5">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-200 text-slate-800">
            <FileText size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-950">Resumo da proposta</h1>
            <p className="text-sm text-neutral-700">Solicitação {solicitacao}</p>
          </div>
        </header>

        <section className="rounded-md border border-slate-300 bg-white p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="mb-4 text-sm font-bold text-neutral-950">Situação da proposta</h2>
              <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-100 px-2 py-1 text-sm text-neutral-950">
                <Info size={16} /> Rascunho • Aprovado
              </span>
            </div>
            <Button variant="outline" onClick={onCancelar} className="h-11 rounded-md border-neutral-900 px-6 text-neutral-950">
              Cancelar proposta
            </Button>
          </div>
        </section>

        <ResumoBox title="Dados do plano" onEdit={onEditarDados}>
          <ResumoRow label="Plano" value={<strong>{planoNome}</strong>} />
          <ResumoRow label="Tipo de pagador" value={tipoPagador} />
          <ResumoRow label="Valor da taxa" value={fmt(premioMensal * 12)} />
          <ResumoRow label="Valor do setup" value={fmt(valorSetup)} />
          <ResumoRow label="Custo de saída" value={custoSaidaTexto} />
          <ResumoRow label="Cobertura total" value={coberturaTotal} />
        </ResumoBox>

        <ResumoBox title="Dados da locação" onEdit={onEditarDados}>
          <ResumoRow label="Tipo de imóvel" value={<strong>{consulta?.imovel_subtipo || imovel?.tipo || "Residencial"}</strong>} />
          <ResumoRow label="Valor do aluguel" value={fmt(aluguel)} />
          <ResumoRow label="Valor do condomínio" value={fmt(condominio)} />
          <ResumoRow label="Outras taxas" value={fmt(taxas)} />
          <div className="mt-3 border-t border-slate-300 pt-3">
            <ResumoRow label="Total" value={fmt(totalLoc)} />
          </div>
        </ResumoBox>

        <ResumoBox title="Endereço do imóvel" onEdit={onEditarDados}>
          <div className="space-y-5 text-sm text-neutral-950">
            <div>
              <p className="font-bold">CEP</p>
              <p>{consulta?.imovel_cep || imovel?.cep || "—"}</p>
            </div>
            <div>
              <p className="font-bold">Endereço</p>
              <p>
                {[consulta?.imovel_endereco, consulta?.imovel_numero, consulta?.imovel_bairro, consulta?.imovel_cidade].filter(Boolean).join(", ")}
                {consulta?.imovel_estado ? ` - ${consulta.imovel_estado}` : ""}
              </p>
            </div>
            <div>
              <p className="font-bold">Complemento</p>
              <p>{consulta?.imovel_complemento || "—"}</p>
            </div>
          </div>
        </ResumoBox>

        <ResumoBox title="Dados do inquilino" onEdit={onEditarDados}>
          <div className="rounded-sm border border-slate-300">
            <span className="inline-flex bg-sky-700 px-2 py-1 text-xs font-bold text-white">Pagador</span>
            <div className="grid gap-4 p-5 text-sm sm:grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr]">
              <div>
                <p className="font-bold">Nome</p>
                <p>{inquilino?.nome ?? consulta?.tenant_name ?? "—"}</p>
                {contratoAssinadoPendente && <p className="text-neutral-700">(Pendente)</p>}
              </div>
              <div>
                <p className="font-bold">CPF</p>
                <p>{inquilino?.cpf ?? consulta?.tenant_document ?? "—"}</p>
              </div>
              <div>
                <p className="font-bold">Telefone</p>
                <p>{consulta?.tenant_telefone || inquilino?.telefone || "—"}</p>
              </div>
              <div>
                <p className="font-bold">Data nascimento</p>
                <p>{dataNascimento}</p>
              </div>
              <div className="sm:col-span-4">
                <p className="mb-4 font-bold">Documentos</p>
                <div className="space-y-2">
                  {documentosNomes.length ? documentosNomes.map((name: string) => <p key={name}>{name}</p>) : <p className="text-neutral-500">Nenhum documento enviado.</p>}
                </div>
              </div>
            </div>
          </div>
        </ResumoBox>

        <section className="rounded-md border border-slate-300 bg-white">
          <button
            type="button"
            onClick={() => setHistoricoAberto(!historicoAberto)}
            className="flex w-full items-center justify-between px-6 py-5 text-left text-lg font-bold text-neutral-950"
          >
            Histórico
            <span className="text-lg">{historicoAberto ? "⌃" : "⌄"}</span>
          </button>
          {historicoAberto && (
            <div className="mx-6 border-t border-slate-300 py-5 text-sm leading-relaxed text-slate-700">
              {historico.length ? historico.map((h: any) => (
                <p key={h.id} className="mb-3">
                  {new Date(h.created_at).toLocaleString("pt-BR")} - {h.descricao}
                </p>
              )) : <p>{historicoPadrao}</p>}
            </div>
          )}
        </section>

        <section className="rounded-md border border-slate-300 bg-white p-6">
          <h2 className="mb-5 text-lg font-bold text-neutral-950">Seguro Imobiliário</h2>
          <div className="space-y-6">
            <div>
              <p className="mb-4 text-sm font-medium">Tipo de imóvel</p>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <TipoImovelCard
                  title="Residencial"
                  selected={tipoSeguroImovel === "residencial"}
                  onClick={() => setTipoSeguroImovel("residencial")}
                  icon={<Home size={17} />}
                  selectValue={residencialSubtipo}
                  onSelect={setResidencialSubtipo}
                  placeholder="Tipo de residência"
                  options={RESIDENCIAL_OPCOES}
                />
                <TipoImovelCard
                  title="Comercial"
                  selected={tipoSeguroImovel === "comercial"}
                  onClick={() => setTipoSeguroImovel("comercial")}
                  icon={<Building2 size={17} />}
                  selectValue={comercialSubtipo}
                  onSelect={setComercialSubtipo}
                  placeholder="Tipo de comércio"
                  options={COMERCIAL_OPCOES}
                />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-bold">Coberturas</h3>
              <p className="text-sm text-slate-600">Cobertura básica obrigatória, calculada sobre o valor do aluguel do imóvel.</p>

              {/* Cobertura obrigatória — cartão em destaque, com espaço reservado para um personagem */}
              <div className="relative flex min-h-[280px] items-center justify-between gap-4 overflow-hidden rounded-md border border-slate-300 bg-white p-8">
                <div className="max-w-[70%]">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-yellow-400 text-neutral-900">
                      <Flame size={18} />
                    </div>
                    <span className="rounded-full bg-yellow-400 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-neutral-900">
                      Cobertura obrigatória
                    </span>
                  </div>
                  <p className="text-lg font-bold text-neutral-950">Incêndio, explosão, queda de raio, fumaça e queda de aeronave</p>
                  <p className="mt-2 text-sm text-slate-600">Cobertura básica obrigatória contra sinistros estruturais graves.</p>
                  <p className="mt-4 text-2xl font-bold text-neutral-950">
                    {fmt(premioIncendioMensal)} <span className="text-sm font-normal text-slate-500">/mês</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Total anual de {fmt(premioIncendioAnual)}, dividido em 12x de {fmt(premioIncendioMensal)} ({percentualIncendio}% do aluguel).
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-bold">Assistências</h3>
              <p className="text-sm text-slate-600">Escolha qual assistência será adicionada no seguro:</p>
              {ASSISTENCIAS.map((a) => {
                const selected = assistencia === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAssistencia(a.id)}
                    className={`flex min-h-[92px] w-full items-center justify-between rounded-md border p-5 text-left transition-colors ${
                      selected ? "border-emerald-500 bg-white" : "border-slate-300 bg-white hover:border-slate-500"
                    }`}
                  >
                    <div>
                      <p className="text-base font-bold text-neutral-950">{a.nome}</p>
                      <p className="mt-3 text-sm text-slate-600">Ver detalhes</p>
                    </div>
                    <span className={`h-4 w-4 rounded-full border ${selected ? "border-emerald-600 bg-emerald-500" : "border-neutral-900"}`} />
                  </button>
                );
              })}
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-bold">Comissão</h3>
              <p className="text-sm text-slate-600">Escolha a % de comissão que deseja aplicar neste contrato de seguro.</p>
              <div>
                <label className="mb-2 block text-sm text-neutral-950">Valor de comissão:</label>
                <Select value={String(comissaoPct)} onValueChange={(v) => setComissaoPct(Number(v))}>
                  <SelectTrigger className="h-11 rounded-md border-slate-400"><SelectValue /></SelectTrigger>
                  <SelectContent>{COMISSAO_OPCOES.map((o) => <SelectItem key={o} value={String(o)}>{o}%</SelectItem>)}</SelectContent>
                </Select>
                <p className="mt-2 text-xs text-neutral-950">Esse valor é incluso no custo final ao inquilino.</p>
              </div>
              <div className="overflow-hidden rounded-md bg-slate-50">
                <div className="p-5">
                  <p className="text-sm">Valor total de comissão a receber:</p>
                  <p className="mt-2 text-3xl font-bold">{fmt(valorComissao || 0)} <span className="text-sm font-normal text-slate-600">em 12x</span></p>
                </div>
                {comissaoPct >= 10 && (
                  <div className="bg-emerald-500 p-5 text-center text-sm font-bold text-white">
                    Bônus NOX de R$ 20 aplicado ao valor final de comissão!
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-bold">Forma de pagamento do seguro</h3>
              <p className="text-sm text-slate-600">Selecione a forma de pagamento que o cliente deseja utilizar na contratação do seguro:</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {PAGAMENTOS.map((m) => {
                  const Icon = m.icon;
                  const selected = pagamento === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPagamento(m.id)}
                      className={`flex flex-col items-center gap-2 rounded-md border p-5 text-center transition-colors ${
                        selected ? "border-emerald-500 bg-white" : "border-slate-300 bg-white hover:border-slate-500"
                      }`}
                    >
                      <Icon size={20} className="text-neutral-950" />
                      <span className="text-sm font-bold text-neutral-950">{m.label}</span>
                      <span className={`h-4 w-4 rounded-full border ${selected ? "border-emerald-600 bg-emerald-500" : "border-neutral-900"}`} />
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 rounded-md border border-sky-200 bg-sky-50 p-4 text-xs text-neutral-700">
                <Info size={14} className="mt-0.5 shrink-0 text-sky-600" />
                <span>Caso seja necessário alterar a forma de pagamento, uma nova cotação deve ser criada.</span>
              </div>
            </div>

            <div className="space-y-4 rounded-md border border-slate-300 p-5">
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox checked={naoMadeira} onCheckedChange={(v) => setNaoMadeira(!!v)} />
                <span className="text-sm text-neutral-800">Confirmo que o imóvel a ser segurado <strong>não é de madeira</strong>.</span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox checked={aceiteTermos} onCheckedChange={(v) => setAceiteTermos(!!v)} />
                <span className="text-sm text-neutral-800">
                  Li e concordo com os{" "}
                  <button type="button" onClick={abrirTermos} className="font-bold text-yellow-700 underline">Termos e Condições</button>{" "}
                  da 180 Seguros.
                </span>
              </label>
            </div>

            <div className="flex gap-3 rounded-md border border-yellow-300 bg-yellow-50 p-4 text-sm text-neutral-800">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-yellow-700" />
              <p>Caso seja identificado que o imóvel possui alguma dessas características, a apólice do seguro não será emitida, e a proposta será cancelada.</p>
            </div>
          </div>
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[780px] flex-col gap-1">
          <Button
            onClick={onEnviar}
            disabled={enviando || !seguroConcluido}
            className="h-11 w-fit rounded-md bg-yellow-400 px-6 font-bold text-neutral-900 hover:bg-yellow-300 disabled:opacity-50"
          >
            {enviando ? "Enviando..." : "Enviar proposta"} <ArrowRight size={16} className="ml-2" />
          </Button>
          {!seguroConcluido && (
            <p className="text-xs text-neutral-500">Conclua a configuração do Seguro Imobiliário (coberturas e forma de pagamento) para enviar a proposta.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ResumoBox({ title, children, onEdit }: { title: string; children: React.ReactNode; onEdit?: () => void }) {
  return (
    <section className="rounded-md border border-slate-300 bg-white p-6">
      <div className="mb-4 flex items-center justify-between border-b border-slate-300 pb-4">
        <h2 className="text-sm font-bold text-neutral-950">{title}</h2>
        {onEdit && <button type="button" onClick={onEdit} className="text-sm text-emerald-700 underline">Editar dados</button>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function ResumoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 text-sm">
      <span className="text-neutral-950">{label}</span>
      <span className="text-right text-neutral-950">{value || "—"}</span>
    </div>
  );
}

function TipoImovelCard(p: {
  title: string;
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  selectValue: string;
  onSelect: (value: string) => void;
  placeholder: string;
  options: string[];
}) {
  return (
    <div className={`rounded-md border p-5 ${p.selected ? "border-slate-400" : "border-slate-300"}`}>
      <button type="button" onClick={p.onClick} className="mb-4 flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-2 text-sm font-bold text-neutral-950">{p.icon}{p.title}</span>
        <span className={`h-4 w-4 rounded-full border ${p.selected ? "border-emerald-700 bg-emerald-500" : "border-neutral-900 bg-white"}`} />
      </button>
      <Select value={p.selectValue} onValueChange={(v) => { p.onClick(); p.onSelect(v); }}>
        <SelectTrigger className="h-11 rounded-md border-slate-400">
          <SelectValue placeholder={p.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {p.options.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function WindIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
  return <Sparkles size={size} className={className} />;
}

/* ---------------- Sub-componentes ---------------- */

function Stepper({ etapa }: { etapa: EtapaKey }) {
  const idx = ETAPAS.findIndex((e) => e.key === etapa);
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 sm:p-5">
      <ol className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-3">
        {ETAPAS.map((e, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <li key={e.key} className={`flex items-center gap-2 p-2 rounded-lg ${active ? "bg-yellow-50 border border-yellow-200" : ""}`}>
              <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-black ${
                done ? "bg-emerald-500 text-white" : active ? "bg-neutral-900 text-yellow-400" : "bg-neutral-200 text-neutral-500"
              }`}>
                {done ? <CheckCircle2 size={14} /> : i + 1}
              </span>
              <span className={`text-xs font-bold leading-tight ${active ? "text-neutral-900" : done ? "text-neutral-700" : "text-neutral-400"}`}>
                {e.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StatusBadge({ status, substatus }: { status?: string; substatus?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    pendente: { label: "Pendente", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" },
    reprovado: { label: "Reprovado", cls: "bg-red-100 text-red-700 border-red-200" },
    pendente_documentacao: { label: "Pendente", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  };
  const s = map[status ?? ""] ?? { label: "Pendente", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" };
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wide border ${s.cls}`}>
        <ShieldCheck size={12} /> {s.label}
      </span>
      {substatus && (
        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-neutral-900 text-yellow-400 border border-neutral-900">
          {substatus.replace(/_/g, " ")}
        </span>
      )}
    </div>
  );
}

function Card({ icon, title, children }: { icon?: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-5 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="w-7 h-7 rounded-lg bg-yellow-50 text-yellow-700 flex items-center justify-center">{icon}</span>}
        <h3 className="text-sm font-black uppercase tracking-widest text-neutral-700">{title}</h3>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Linha({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="font-semibold text-neutral-900 text-right">{value || "—"}</span>
    </div>
  );
}

const DOCUMENTO_LABELS: Record<string, string> = {
  vistoria_imovel: "Vistoria do imóvel",
  contrato_locacao: "Contrato de locação",
  comprovante_residencia: "Comprovante de residência",
  comprovante_residencia_imovel: "Comprovante de residência",
  comprovante_renda: "Comprovante de renda",
  documento_foto: "Documento com foto",
  documento_inquilino: "Documento com foto",
};

function documentoLabel(type?: string | null) {
  if (!type) return "Documento";
  return DOCUMENTO_LABELS[type] ?? type.replace(/_/g, " ");
}

/* Etapa 1 — Resumo */
function EtapaResumo(p: any) {
  const { consulta, inquilino, imovel, plano, documentos, contratoAssinadoPendente, totalLoc, cobertura, premioMensal, taxaAtivacao, custoSaida, onVoltar, onAvancar } = p;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black text-neutral-900">Resumo da proposta</h2>
        <p className="text-sm text-neutral-500">Confira os dados da locação antes de avançar para a configuração do seguro.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
        <Card icon={<FileText size={14} />} title="Dados do plano">
          <Linha label="Plano" value={plano?.nome} />
          <Linha label="Prêmio mensal" value={fmt(premioMensal)} />
          <Linha label="Taxa de ativação" value={fmt(taxaAtivacao)} />
          <Linha label="Custo de saída" value={fmt(custoSaida)} />
          <Linha label="Cobertura total" value={fmt(cobertura)} />
          <Linha label="Comissão" value={consulta?.commission_enabled ? "Habilitada" : "Padrão"} />
        </Card>

        <Card icon={<Home size={14} />} title="Dados da locação">
          <Linha label="Tipo de imóvel" value={consulta?.imovel_subtipo} />
          <Linha label="Aluguel" value={fmt(Number(imovel?.valor_aluguel) || 0)} />
          <Linha label="Condomínio" value={fmt(Number(imovel?.valor_condominio) || 0)} />
          <Linha label="Outras taxas" value={fmt(Number(imovel?.valor_taxas) || 0)} />
          <Linha label="Total locatício" value={<strong>{fmt(totalLoc)}</strong>} />
        </Card>

        <Card icon={<MapPin size={14} />} title="Endereço do imóvel">
          <Linha label="CEP" value={consulta?.imovel_cep} />
          <Linha label="Endereço" value={`${consulta?.imovel_endereco ?? ""} ${consulta?.imovel_numero ?? ""}`} />
          <Linha label="Complemento" value={consulta?.imovel_complemento} />
          <Linha label="Bairro" value={consulta?.imovel_bairro} />
          <Linha label="Cidade/UF" value={`${consulta?.imovel_cidade ?? ""}/${consulta?.imovel_estado ?? ""}`} />
        </Card>

        <Card icon={<User size={14} />} title="Dados do inquilino">
          <Linha label="Nome" value={inquilino?.nome ?? consulta?.tenant_name} />
          <Linha label="CPF" value={inquilino?.cpf ?? consulta?.tenant_document} />
          <Linha label="Telefone" value={consulta?.tenant_telefone} />
          <Linha label="E-mail" value={consulta?.tenant_email} />
          <Linha label="Nascimento" value={consulta?.tenant_data_nascimento} />
        </Card>

        <Card icon={<Building2 size={14} />} title="Tipo de pagamento">
          <div className={`p-3 rounded-xl border-2 ${consulta?.payment_type === "imobiliaria" ? "border-yellow-400 bg-yellow-50" : "border-neutral-200"} mb-2`}>
            <p className="text-xs font-black flex items-center gap-1"><Building2 size={14} /> Via imobiliária</p>
            <p className="text-[11px] text-neutral-600">Imobiliária recebe boleto único mensal com todos os contratos.</p>
          </div>
          <div className={`p-3 rounded-xl border-2 ${consulta?.payment_type === "inquilino" ? "border-yellow-400 bg-yellow-50" : "border-neutral-200"}`}>
            <p className="text-xs font-black flex items-center gap-1"><User size={14} /> Via inquilino</p>
            <p className="text-[11px] text-neutral-600">O inquilino paga a fiança diretamente à NOX.</p>
          </div>
        </Card>

        <Card icon={<FileCheck2 size={14} />} title="Documentos enviados">
          {documentos.length === 0 && <p className="text-xs text-neutral-400">Nenhum documento enviado.</p>}
          <ul className="space-y-2">
            {documentos.map((d: any) => (
              <li key={d.id} className="flex items-center gap-2 text-xs">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                <span className="font-semibold text-neutral-800">{documentoLabel(d.document_type)}</span>
                <span className="text-neutral-400 truncate">— {d.file_name}</span>
              </li>
            ))}
          </ul>
          {contratoAssinadoPendente && (
            <div className="mt-3 flex gap-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-xs text-neutral-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-yellow-700" />
              <span><strong>Pendência:</strong> enviar o contrato de locação assinado e atualizado após finalizar.</span>
            </div>
          )}
        </Card>
      </div>

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="outline" onClick={onVoltar}><ArrowLeft size={16} className="mr-1" /> Voltar</Button>
        <Button onClick={onAvancar} className="bg-neutral-900 text-yellow-400 hover:bg-neutral-800">
          Próximo: Forma de pagamento <ArrowRight size={16} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}

/* Etapa 2 — Personalizar */
function EtapaPersonalizar(p: any) {
  const {
    coberturas, toggleCobertura, assistencia, setAssistencia, comissaoPct, setComissaoPct,
    valorComissao, premioMensal, premioAnual, totalFinal, taxaAtivacao, pinturaTotal,
    consulta, onVoltar, onAvancar,
  } = p;
  const bonus = comissaoPct >= 10 ? 20 : 0;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black text-neutral-900">Monte a proteção do contrato</h2>
        <p className="text-sm text-neutral-500">Escolha coberturas, assistências e configuração comercial do seguro.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
          {/* Coberturas */}
          <Card icon={<ShieldCheck size={14} />} title="Coberturas do seguro imobiliário">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 auto-rows-fr">
              {COBERTURAS.map((c) => {
                const sel = coberturas.includes(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => toggleCobertura(c.id)}
                    className={`text-left p-4 rounded-xl border-2 transition-all h-full flex flex-col ${
                      sel ? "border-yellow-400 bg-yellow-50" : "border-neutral-200 bg-white hover:border-neutral-300"
                    } ${c.obrigatoria ? "opacity-100 cursor-default" : "cursor-pointer"}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-xs font-black text-neutral-900 leading-tight">{c.nome}</span>
                      {c.obrigatoria ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-neutral-900 text-yellow-400 px-2 py-0.5 rounded-full"><Lock size={10} /> Obrigatória</span>
                      ) : (
                        <Switch checked={sel} onCheckedChange={() => toggleCobertura(c.id)} />
                      )}
                    </div>
                    <p className="text-[11px] text-neutral-500 flex-1">{c.desc}</p>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Assistências */}
          <Card icon={<Sparkles size={14} />} title="Assistências">
            <p className="text-xs text-neutral-500 mb-3">Escolha qual assistência será adicionada ao seguro.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-fr">
              {ASSISTENCIAS.map((a) => {
                const sel = assistencia === a.id;
                return (
                  <button key={a.id} type="button" onClick={() => setAssistencia(a.id)}
                    className={`text-left p-4 rounded-xl border-2 transition-all h-full flex flex-col ${
                      sel ? "border-yellow-400 bg-yellow-50" : "border-neutral-200 bg-white hover:border-neutral-300"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-black text-neutral-900">{a.nome}</span>
                      <span className={`w-4 h-4 rounded-full border-2 ${sel ? "border-neutral-900 bg-yellow-400" : "border-neutral-300"}`} />
                    </div>
                    <p className="text-[11px] text-neutral-500 flex-1">{a.desc}</p>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Comissão */}
          <Card icon={<CreditCard size={14} />} title="Comissão">
            <p className="text-xs text-neutral-500 mb-3">Escolha a % de comissão que deseja aplicar neste contrato de seguro.</p>
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={String(comissaoPct)} onValueChange={(v) => setComissaoPct(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{COMISSAO_OPCOES.map((o) => <SelectItem key={o} value={String(o)}>{o}%</SelectItem>)}</SelectContent>
              </Select>
              <div className="text-sm">
                <span className="text-neutral-500">Valor total de comissão: </span>
                <strong className="text-neutral-900">{fmt(valorComissao)}</strong>
              </div>
            </div>
            {bonus > 0 && (
              <div className="mt-3 p-3 rounded-lg bg-yellow-50 border border-yellow-300 text-xs font-semibold text-neutral-800">
                <Sparkles size={12} className="inline mr-1 text-yellow-700" />
                Bônus NOX de {fmt(bonus)} aplicado ao valor final da comissão.
              </div>
            )}
            <p className="text-[11px] text-neutral-400 mt-2">Esse valor é incluso no custo final ao inquilino.</p>
          </Card>

          {/* Extras */}
          {(pinturaTotal > 0 || taxaAtivacao > 0) && (
            <Card icon={<Info size={14} />} title="Extras opcionais">
              {pinturaTotal > 0 && (
                <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200 mb-2">
                  <p className="text-xs font-black">Pintura externa — {fmt(pinturaTotal)}</p>
                  <p className="text-[11px] text-neutral-500">Cobertura válida para pinturas com mal uso ou danificadas por vontade própria. Pintura com desgaste natural de uso não cobre.</p>
                </div>
              )}
              {taxaAtivacao > 0 && (
                <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                  <p className="text-xs font-black">Taxa de ativação — {fmt(taxaAtivacao)}</p>
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Resumo sticky */}
        <ResumoSticky
          premioMensal={premioMensal} premioAnual={premioAnual} totalFinal={totalFinal}
          coberturas={coberturas} assistencia={assistencia} comissaoPct={comissaoPct}
          taxaAtivacao={taxaAtivacao} pinturaTotal={pinturaTotal}
        />
      </div>

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="outline" onClick={onVoltar}><ArrowLeft size={16} className="mr-1" /> Voltar</Button>
        <Button onClick={onAvancar} className="bg-neutral-900 text-yellow-400 hover:bg-neutral-800">
          Próximo: Forma de pagamento <ArrowRight size={16} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}

/* Etapa 3 — Pagamento */
function EtapaPagamento(p: any) {
  const {
    pagamento, setPagamento, naoMadeira, setNaoMadeira, aceiteTermos, setAceiteTermos,
    abrirTermos, premioMensal, premioAnual, totalFinal,
    coberturas, assistencia, comissaoPct, taxaAtivacao, pinturaTotal, imovel,
    onVoltar, onAvancar,
  } = p;
  const enabled = pagamento && naoMadeira && aceiteTermos;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black text-neutral-900">Forma de pagamento do seguro</h2>
        <p className="text-sm text-neutral-500">Selecione como o cliente deseja pagar a contratação do seguro.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 auto-rows-fr">
            {PAGAMENTOS.map((m) => {
              const Icon = m.icon;
              const sel = pagamento === m.id;
              return (
                <button key={m.id} type="button" onClick={() => setPagamento(m.id)}
                  className={`p-5 rounded-xl border-2 text-left h-full flex flex-col transition-all ${
                    sel ? "border-yellow-400 bg-yellow-50" : "border-neutral-200 bg-white hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <Icon size={22} className="text-neutral-700" />
                    <span className={`w-4 h-4 rounded-full border-2 ${sel ? "border-neutral-900 bg-yellow-400" : "border-neutral-300"}`} />
                  </div>
                  <p className="font-black text-sm text-neutral-900">{m.label}</p>
                  <p className="text-[11px] text-neutral-500 mt-1 flex-1">{m.desc}</p>
                </button>
              );
            })}
          </div>

          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-neutral-700 flex gap-2">
            <Info size={14} className="text-blue-600 shrink-0 mt-0.5" />
            <span><strong>Atenção:</strong> caso seja necessário alterar a forma de pagamento depois, uma nova cotação poderá ser criada.</span>
          </div>

          <div className="bg-white border border-neutral-200 rounded-2xl p-5 space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox checked={naoMadeira} onCheckedChange={(v) => setNaoMadeira(!!v)} />
              <span className="text-sm text-neutral-800">Confirmo que o imóvel a ser segurado <strong>não é de madeira</strong>.</span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox checked={aceiteTermos} onCheckedChange={(v) => setAceiteTermos(!!v)} />
              <span className="text-sm text-neutral-800">
                Li e concordo com os{" "}
                <button type="button" onClick={abrirTermos} className="text-yellow-700 underline font-bold">Termos e Condições</button>{" "}
                do seguro.
              </span>
            </label>
          </div>

          <div className="p-4 rounded-xl bg-yellow-50 border border-yellow-300 text-sm text-neutral-800 flex gap-3">
            <AlertTriangle size={18} className="text-yellow-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-black">Importante</p>
              <p className="text-xs leading-relaxed">Caso seja identificado que o imóvel possui alguma característica impeditiva para emissão do seguro, a apólice poderá não ser emitida e a proposta poderá ser cancelada.</p>
            </div>
          </div>
        </div>

        <ResumoSticky
          premioMensal={premioMensal} premioAnual={premioAnual} totalFinal={totalFinal}
          coberturas={coberturas} assistencia={assistencia} comissaoPct={comissaoPct}
          taxaAtivacao={taxaAtivacao} pinturaTotal={pinturaTotal}
          pagamento={pagamento} valorBaseImovel={Number(imovel?.valor_aluguel) || 0}
        />
      </div>

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="outline" onClick={onVoltar}><ArrowLeft size={16} className="mr-1" /> Voltar</Button>
        <Button onClick={onAvancar} disabled={!enabled}
          className={enabled ? "bg-neutral-900 text-yellow-400 hover:bg-neutral-800" : "bg-neutral-200 text-neutral-400"}>
          Continuar <ArrowRight size={16} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}

/* Etapa 4 — Revisão */
function EtapaRevisao(p: any) {
  const {
    numeroProposta, consulta, inquilino, imovel, plano, documentos, historico, contratoAssinadoPendente,
    coberturas, assistencia, comissaoPct, pagamento, totalLoc, premioMensal,
    premioAnual, totalFinal, taxaAtivacao, pinturaTotal, enviando,
    onVoltar, onEnviar,
  } = p;
  const pagLabel = PAGAMENTOS.find((x) => x.id === pagamento)?.label;
  const assistLabel = ASSISTENCIAS.find((x) => x.id === assistencia)?.nome;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black text-neutral-900">Revisão final da proposta</h2>
        <p className="text-sm text-neutral-500">Confirme todas as informações antes de enviar para ativação do inquilino.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
        <Card icon={<FileText size={14} />} title="Resumo geral">
          <Linha label="Nº da proposta" value={numeroProposta} />
          <Linha label="Status" value={consulta?.status} />
          <Linha label="Plano" value={plano?.nome} />
          <Linha label="Pagamento" value={consulta?.payment_type} />
          <Linha label="Criada em" value={new Date(consulta?.created_at).toLocaleDateString("pt-BR")} />
        </Card>

        <Card icon={<Home size={14} />} title="Locação">
          <Linha label="Tipo de imóvel" value={consulta?.imovel_subtipo} />
          <Linha label="Aluguel" value={fmt(Number(imovel?.valor_aluguel) || 0)} />
          <Linha label="Condomínio" value={fmt(Number(imovel?.valor_condominio) || 0)} />
          <Linha label="Outras taxas" value={fmt(Number(imovel?.valor_taxas) || 0)} />
          <Linha label="Total" value={<strong>{fmt(totalLoc)}</strong>} />
        </Card>

        <Card icon={<MapPin size={14} />} title="Endereço">
          <p className="text-sm text-neutral-700">
            {consulta?.imovel_endereco}, {consulta?.imovel_numero}<br />
            {consulta?.imovel_bairro} — {consulta?.imovel_cidade}/{consulta?.imovel_estado}<br />
            CEP {consulta?.imovel_cep}
          </p>
        </Card>

        <Card icon={<User size={14} />} title="Inquilino">
          <Linha label="Nome" value={inquilino?.nome ?? consulta?.tenant_name} />
          <Linha label="CPF" value={inquilino?.cpf ?? consulta?.tenant_document} />
          <Linha label="Telefone" value={consulta?.tenant_telefone} />
          <Linha label="E-mail" value={consulta?.tenant_email} />
          <Linha label="Nascimento" value={consulta?.tenant_data_nascimento} />
        </Card>

        <Card icon={<FileCheck2 size={14} />} title="Documentos">
          <ul className="space-y-1.5">
            {documentos.map((d: any) => (
              <li key={d.id} className="text-xs flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-500" />
                <span className="font-semibold">{documentoLabel(d.document_type)}</span>
              </li>
            ))}
          </ul>
          {contratoAssinadoPendente && (
            <div className="mt-3 flex gap-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-xs text-neutral-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-yellow-700" />
              <span><strong>Pendência:</strong> enviar o contrato de locação assinado e atualizado após finalizar.</span>
            </div>
          )}
        </Card>

        <Card icon={<ShieldCheck size={14} />} title="Seguro imobiliário">
          <Linha label="Coberturas" value={`${coberturas.length} selecionadas`} />
          <Linha label="Assistência" value={assistLabel} />
          <Linha label="Comissão" value={`${comissaoPct}%`} />
          <Linha label="Taxa de ativação" value={fmt(taxaAtivacao)} />
          <Linha label="Pintura externa" value={pinturaTotal ? fmt(pinturaTotal) : "—"} />
          <Linha label="Forma de pagamento" value={pagLabel} />
        </Card>

        <Card icon={<CheckCircle2 size={14} />} title="Confirmações">
          <Linha label="Imóvel não é de madeira" value="Confirmado" />
          <Linha label="Termos e condições" value="Aceitos" />
          <Linha label="Data do aceite" value={consulta?.terms_accepted_at ? new Date(consulta.terms_accepted_at).toLocaleString("pt-BR") : "—"} />
        </Card>

        <Card icon={<Clock size={14} />} title="Histórico da proposta">
          <ol className="space-y-2">
            <li className="text-xs flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500" /> Proposta criada</li>
            <li className="text-xs flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500" /> Dados preenchidos</li>
            <li className="text-xs flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500" /> Seguro configurado</li>
            <li className="text-xs flex items-center gap-2"><Circle size={12} className="text-neutral-400" /> Revisão pronta para envio</li>
            {historico.map((h: any) => (
              <li key={h.id} className="text-xs flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500" /> {h.descricao}</li>
            ))}
          </ol>
        </Card>

        <Card icon={<CreditCard size={14} />} title="Valor final">
          <Linha label="Prêmio mensal" value={fmt(premioMensal)} />
          <Linha label="Prêmio anual" value={fmt(premioAnual)} />
          <Linha label="Taxa de ativação" value={fmt(taxaAtivacao)} />
          <Linha label="Pintura" value={pinturaTotal ? fmt(pinturaTotal) : "—"} />
          <div className="border-t border-neutral-100 mt-2 pt-2">
            <Linha label="Total final" value={<strong className="text-neutral-900">{fmt(totalFinal)}</strong>} />
          </div>
        </Card>
      </div>

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="outline" onClick={onVoltar}><ArrowLeft size={16} className="mr-1" /> Voltar</Button>
        <Button onClick={onEnviar} disabled={enviando} className="bg-yellow-400 text-neutral-900 hover:bg-yellow-300 font-black">
          <Send size={16} className="mr-1" /> {enviando ? "Enviando..." : "Enviar proposta"}
        </Button>
      </div>
    </div>
  );
}

/* Etapa 5 — Enviada */
function EtapaEnviada(p: any) {
  const { numeroProposta, consulta, inquilino, plano, pagamento, onVerDetalhes, onVoltarContratos, onNovaConsulta } = p;
  const pagLabel = PAGAMENTOS.find((x) => x.id === pagamento)?.label ?? consulta?.insurance_payment_method_label;
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-gradient-to-br from-neutral-900 to-neutral-800 rounded-3xl p-8 text-white text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-yellow-400 flex items-center justify-center mb-4">
          <CheckCircle2 size={32} className="text-neutral-900" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-black">Proposta enviada e aguardando ativação do inquilino</h2>
        <p className="text-sm text-neutral-300 mt-3 max-w-xl mx-auto">
          A ativação do contrato de locação com garantia da NOX Fiança será concluída após a assinatura do contrato de seguro pelo inquilino.
        </p>
        <p className="text-xs text-neutral-400 mt-3">
          Enviamos o link de ativação para o e-mail e também por SMS para a pessoa inquilina, para que ela possa revisar, assinar o contrato de seguro e seguir com a forma de pagamento escolhida.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 auto-rows-fr">
        <Card icon={<FileText size={14} />} title="Detalhes do envio">
          <Linha label="Nº da proposta" value={numeroProposta} />
          <Linha label="Inquilino" value={inquilino?.nome ?? consulta?.tenant_name} />
          <Linha label="Plano" value={plano?.nome} />
          <Linha label="Pagamento" value={pagLabel} />
          <Linha label="Status" value="Proposta enviada" />
          <Linha label="Enviada em" value={consulta?.proposta_enviada_em ? new Date(consulta.proposta_enviada_em).toLocaleString("pt-BR") : "—"} />
        </Card>

        <Card icon={<Sparkles size={14} />} title="Próximos passos">
          <ol className="space-y-2 text-xs text-neutral-700">
            <li className="flex gap-2"><span className="font-black text-yellow-700">1.</span> A proposta foi gerada com sucesso</li>
            <li className="flex gap-2"><span className="font-black text-yellow-700">2.</span> O inquilino receberá o link de ativação</li>
            <li className="flex gap-2"><Mail size={14} className="text-yellow-700 shrink-0 mt-0.5" /> Link enviado por e-mail</li>
            <li className="flex gap-2"><MessageSquare size={14} className="text-yellow-700 shrink-0 mt-0.5" /> Link enviado por SMS</li>
            <li className="flex gap-2"><span className="font-black text-yellow-700">3.</span> O inquilino acessa o link e assina o contrato</li>
            <li className="flex gap-2"><span className="font-black text-yellow-700">4.</span> Após assinatura, o status é atualizado no painel</li>
          </ol>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <Button variant="outline" onClick={onVerDetalhes}>Ver detalhes da proposta</Button>
        <Button onClick={onVoltarContratos} className="bg-neutral-900 text-yellow-400 hover:bg-neutral-800">Voltar para contratos</Button>
        <Button variant="outline" onClick={onNovaConsulta}>Nova consulta</Button>
      </div>
    </div>
  );
}

/* Resumo lateral */
function ResumoSticky(p: any) {
  const {
    premioMensal, premioAnual, totalFinal, coberturas, assistencia,
    comissaoPct, taxaAtivacao, pinturaTotal, pagamento, valorBaseImovel,
  } = p;
  const parcela12 = totalFinal / 12;
  const assistLabel = ASSISTENCIAS.find((a) => a.id === assistencia)?.nome ?? "—";
  return (
    <div className="lg:sticky lg:top-6 h-fit bg-neutral-900 text-white rounded-2xl p-5 space-y-3">
      <p className="text-[11px] font-black uppercase tracking-widest text-yellow-400">Resumo</p>
      <div>
        <p className="text-xs text-neutral-400">Total de</p>
        <p className="text-2xl font-black">{fmt(totalFinal)}</p>
      </div>
      {pagamento === "credit_card" && (
        <p className="text-xs text-neutral-300">Em 12x de <strong className="text-white">{fmt(parcela12)}</strong> no cartão de crédito</p>
      )}
      {pagamento && pagamento !== "credit_card" && (
        <p className="text-xs text-neutral-300">Forma: <strong className="text-yellow-400">{PAGAMENTOS.find((p) => p.id === pagamento)?.label}</strong></p>
      )}

      <div className="border-t border-neutral-700 pt-3 space-y-1.5 text-xs">
        <div className="flex justify-between"><span className="text-neutral-400">Prêmio mensal</span><span>{fmt(premioMensal)}</span></div>
        <div className="flex justify-between"><span className="text-neutral-400">Prêmio anual</span><span>{fmt(premioAnual)}</span></div>
        <div className="flex justify-between"><span className="text-neutral-400">Comissão</span><span>{comissaoPct}%</span></div>
        <div className="flex justify-between"><span className="text-neutral-400">Taxa ativação</span><span>{fmt(taxaAtivacao)}</span></div>
        {pinturaTotal > 0 && <div className="flex justify-between"><span className="text-neutral-400">Pintura</span><span>{fmt(pinturaTotal)}</span></div>}
        {valorBaseImovel ? <div className="flex justify-between"><span className="text-neutral-400">Aluguel base</span><span>{fmt(valorBaseImovel)}</span></div> : null}
      </div>

      <div className="border-t border-neutral-700 pt-3 space-y-1 text-xs">
        <p className="text-neutral-400 font-bold">Coberturas</p>
        <ul className="space-y-1">
          {coberturas.slice(0, 4).map((c: string) => {
            const cob = COBERTURAS.find((x) => x.id === c);
            return <li key={c} className="flex items-start gap-1"><CheckCircle2 size={12} className="text-yellow-400 shrink-0 mt-0.5" /> <span className="text-neutral-200">{cob?.nome}</span></li>;
          })}
        </ul>
      </div>

      <div className="text-xs">
        <p className="text-neutral-400 font-bold">Assistência</p>
        <p className="text-neutral-200">{assistLabel}</p>
      </div>
    </div>
  );
}
