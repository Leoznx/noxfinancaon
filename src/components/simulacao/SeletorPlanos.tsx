import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, Clock, AlertTriangle, ChevronRight, ArrowLeft, Pencil, PaintRoller, Sparkles, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Plano {
  id: string;
  nome: string;
  taxa_premio: number;
  custo_saida: number;
  cobertura_multiplicador: number;
  tem_comissao: boolean;
  cobre_taxas_condominio: boolean;
  comissao_meses: number | null;
  destaque: string | null;
}

interface PlanoSpec {
  nome: string;
  taxa_premio: number;
  cobertura_multiplicador: number;
  tem_comissao: boolean;
  cobre_taxas_condominio: boolean;
  destaque: string | null;
  ordem: number;
}

export interface PlanoSelecionadoCalculo {
  nome: string;
  taxa_premio: number;
  cobertura_multiplicador: number;
  cobre_taxas_condominio: boolean;
  tem_comissao: boolean;
  mensal: number;
  totalAnual: number;
  aVista: number;
  baseCalculo: number;
}

export interface ExtrasSelecionados {
  external_painting_enabled: boolean;
  external_painting_total: number;
  external_painting_installment: number;
  activation_fee_enabled: boolean;
  activation_fee_amount: number;
  activation_fee_commission: number;
}

const PLANOS_POR_COMISSAO: Record<'sem' | 'com', PlanoSpec[]> = {
  sem: [
    {
      nome: "NOX Fit",
      taxa_premio: 10,
      cobertura_multiplicador: 30,
      tem_comissao: false,
      cobre_taxas_condominio: false,
      destaque: null,
      ordem: 1,
    },
    {
      nome: "NOX Fit+",
      taxa_premio: 11.5,
      cobertura_multiplicador: 35,
      tem_comissao: false,
      cobre_taxas_condominio: true,
      destaque: null,
      ordem: 2,
    },
  ],
  com: [
    {
      nome: "NOX Smart",
      taxa_premio: 12,
      cobertura_multiplicador: 30,
      tem_comissao: true,
      cobre_taxas_condominio: false,
      destaque: "mais_aprovacoes",
      ordem: 1,
    },
    {
      nome: "NOX Smart+",
      taxa_premio: 13.5,
      cobertura_multiplicador: 35,
      tem_comissao: true,
      cobre_taxas_condominio: true,
      destaque: "cobre_taxas",
      ordem: 2,
    },
    {
      nome: "NOX Up",
      taxa_premio: 16,
      cobertura_multiplicador: 40,
      tem_comissao: true,
      cobre_taxas_condominio: true,
      destaque: "maior_cobertura",
      ordem: 3,
    },
  ],
};

function normalizarNomePlano(nome: string) {
  return nome.toLowerCase().replace(/\s+/g, "");
}

const ACTIVATION_FEE_OPTIONS: { value: number; label: string; justificativa: string }[] = [
  { value: 100, label: "R$ 100", justificativa: "Ativação básica para contratos simples e entrada acessível." },
  { value: 150, label: "R$ 150", justificativa: "Boa opção para contratos leves com suporte inicial." },
  { value: 200, label: "R$ 200", justificativa: "Valor equilibrado para ativação padrão do contrato." },
  { value: 250, label: "R$ 250", justificativa: "Indicado para propostas com atendimento e formalização mais completos." },
  { value: 300, label: "R$ 300", justificativa: "Recomendado para contratos com acompanhamento comercial reforçado." },
  { value: 350, label: "R$ 350", justificativa: "Opção intermediária premium para negociações mais estruturadas." },
  { value: 400, label: "R$ 400", justificativa: "Indicado para contratos com maior valor agregado." },
  { value: 500, label: "R$ 500", justificativa: "Boa opção para operações mais robustas e consultivas." },
  { value: 600, label: "R$ 600", justificativa: "Ativação premium para propostas de maior ticket." },
  { value: 800, label: "R$ 800", justificativa: "Ativação topo, indicada para contratos estratégicos." },
];

/**
 * Mapeia o status real da consulta (vindo da automação ou do fluxo legado) para o
 * selo exibido no topo desta tela. Cobre tanto o vocabulário da automação
 * (aprovado/recusado/em_analise/erro/processando) quanto os status legados do fluxo
 * de seleção de plano (que só existem depois de um crédito já aprovado).
 */
const STATUS_DISPLAY: Record<string, { label: string; textClass: string; circleClass: string; Icon: typeof CheckCircle2 }> = {
  aprovado: { label: "APROVADO", textClass: "text-green-600", circleClass: "bg-green-500 shadow-green-200", Icon: CheckCircle2 },
  recusado: { label: "RECUSADO", textClass: "text-red-600", circleClass: "bg-red-500 shadow-red-200", Icon: XCircle },
  reprovado: { label: "RECUSADO", textClass: "text-red-600", circleClass: "bg-red-500 shadow-red-200", Icon: XCircle },
  em_analise: { label: "EM ANÁLISE", textClass: "text-yellow-600", circleClass: "bg-yellow-500 shadow-yellow-200", Icon: Clock },
  pendente: { label: "EM ANÁLISE", textClass: "text-yellow-600", circleClass: "bg-yellow-500 shadow-yellow-200", Icon: Clock },
  processando: { label: "CONSULTANDO...", textClass: "text-yellow-600", circleClass: "bg-yellow-500 shadow-yellow-200", Icon: Clock },
  erro: { label: "ERRO NA CONSULTA", textClass: "text-red-600", circleClass: "bg-red-500 shadow-red-200", Icon: AlertTriangle },
  pendente_documentacao: { label: "APROVADO", textClass: "text-green-600", circleClass: "bg-green-500 shadow-green-200", Icon: CheckCircle2 },
  dados_complementares: { label: "APROVADO", textClass: "text-green-600", circleClass: "bg-green-500 shadow-green-200", Icon: CheckCircle2 },
  finalizada: { label: "APROVADO", textClass: "text-green-600", circleClass: "bg-green-500 shadow-green-200", Icon: CheckCircle2 },
  aguardando_ativacao: { label: "APROVADO", textClass: "text-green-600", circleClass: "bg-green-500 shadow-green-200", Icon: CheckCircle2 },
  ativado: { label: "APROVADO", textClass: "text-green-600", circleClass: "bg-green-500 shadow-green-200", Icon: CheckCircle2 },
};
const STATUS_DISPLAY_FALLBACK = STATUS_DISPLAY.em_analise;

interface SeletorPlanosProps {
  dados: {
    aluguel: number;
    condominio: number;
    taxas: number;
    nomeInquilino: string;
    /** CPF/CNPJ já mascarado para exibição — omitir se ainda não houver documento disponível. */
    documento?: string;
    /** Status real da consulta (aprovado/recusado/em_analise/erro/legados) — se ausente, exibe como em análise. */
    status?: string;
  };
  onVoltar: () => void;
  onSelecionarPlano: (planoId: string, extras?: ExtrasSelecionados, planoCalculado?: PlanoSelecionadoCalculo) => void;
  isSubmitting?: boolean;
  onAtualizarValores?: (valores: { aluguel: number; condominio: number; taxas: number }) => Promise<void> | void;
  planoIdInicial?: string | null;
  extrasIniciais?: Partial<ExtrasSelecionados> | null;
  ocultarVoltar?: boolean;
  ocultarStatusAnalise?: boolean;
}

export function SeletorPlanos({
  dados,
  onVoltar,
  onSelecionarPlano,
  isSubmitting,
  onAtualizarValores,
  planoIdInicial,
  extrasIniciais,
  ocultarVoltar = false,
  ocultarStatusAnalise = false,
}: SeletorPlanosProps) {
  const [todosPlanos, setTodosPlanos] = useState<Plano[]>([]);
  const [comissaoSelecionada, setComissaoSelecionada] = useState<'com' | 'sem'>('sem');
  const [planoEscolhidoId, setPlanoEscolhidoId] = useState<string | null>(planoIdInicial ?? null);

  // Extras
  const [pinturaEnabled, setPinturaEnabled] = useState<boolean>(!!extrasIniciais?.external_painting_enabled);
  const [activationAmount, setActivationAmount] = useState<number>(Number(extrasIniciais?.activation_fee_amount) || 0);

  // Valores editáveis (espelham `dados` mas permitem edição local + recálculo imediato)
  const [valores, setValores] = useState({
    aluguel: Number(dados.aluguel) || 0,
    condominio: Number(dados.condominio) || 0,
    taxas: Number(dados.taxas) || 0,
  });

  useEffect(() => {
    setValores({
      aluguel: Number(dados.aluguel) || 0,
      condominio: Number(dados.condominio) || 0,
      taxas: Number(dados.taxas) || 0,
    });
  }, [dados.aluguel, dados.condominio, dados.taxas]);

  // Modal de edição
  const [editOpen, setEditOpen] = useState(false);
  const [editAluguel, setEditAluguel] = useState("");
  const [editCondominio, setEditCondominio] = useState("");
  const [editTaxas, setEditTaxas] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const abrirEdicao = () => {
    setEditAluguel(valores.aluguel ? valores.aluguel.toFixed(2).replace('.', ',') : "");
    setEditCondominio(valores.condominio ? valores.condominio.toFixed(2).replace('.', ',') : "");
    setEditTaxas(valores.taxas ? valores.taxas.toFixed(2).replace('.', ',') : "");
    setEditOpen(true);
  };

  const parseBRL = (s: string): number => {
    if (!s) return 0;
    const limpo = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
    const n = parseFloat(limpo);
    return isNaN(n) ? 0 : n;
  };

  const handleSalvarEdicao = async () => {
    const novoAluguel = parseBRL(editAluguel);
    const novoCondominio = parseBRL(editCondominio);
    const novasTaxas = parseBRL(editTaxas);

    if (novoAluguel <= 0) {
      toast.error("O valor do aluguel é obrigatório.");
      return;
    }
    if (novoCondominio < 0 || novasTaxas < 0) {
      toast.error("Valores não podem ser negativos.");
      return;
    }

    setSalvandoEdicao(true);
    try {
      const novos = { aluguel: novoAluguel, condominio: novoCondominio, taxas: novasTaxas };
      setValores(novos);
      setPlanoEscolhidoId(null);
      if (onAtualizarValores) await onAtualizarValores(novos);
      toast.success("Simulação atualizada.");
      setEditOpen(false);
    } catch (e: any) {
      toast.error("Erro ao atualizar: " + (e?.message || "tente novamente"));
    } finally {
      setSalvandoEdicao(false);
    }
  };

  useEffect(() => {
    const fetchPlanos = async () => {
      const { data } = await supabase.from('planos').select('*').order('ordem');
      if (data) setTodosPlanos(data as Plano[]);
    };
    fetchPlanos();
  }, []);

  const formatarBRL = (valor: number) => {
    return valor.toLocaleString('pt-BR', { 
      style: 'currency', 
      currency: 'BRL',
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  };

  const planosCalculados = useMemo(() => {
    const aluguel = Number(valores.aluguel) || 0;
    const condominio = Number(valores.condominio) || 0;
    const taxas = Number(valores.taxas) || 0;

    return PLANOS_POR_COMISSAO[comissaoSelecionada].map(spec => {
      const planoSalvo = todosPlanos.find(p => normalizarNomePlano(p.nome) === normalizarNomePlano(spec.nome));
      if (!planoSalvo) return null;

      const plano = {
        ...planoSalvo,
        nome: spec.nome,
        taxa_premio: spec.taxa_premio,
        cobertura_multiplicador: spec.cobertura_multiplicador,
        tem_comissao: spec.tem_comissao,
        cobre_taxas_condominio: spec.cobre_taxas_condominio,
        destaque: spec.destaque,
        ordem: spec.ordem,
      };
      const baseCalculo = plano.cobre_taxas_condominio
        ? (aluguel + condominio + taxas)
        : aluguel;
      const mensal = baseCalculo * (plano.taxa_premio / 100);
      const totalAnual = mensal * 12;
      const aVista = totalAnual * 0.90;
      return { ...plano, mensal, totalAnual, aVista, baseCalculo };
    }).filter((p): p is Plano & PlanoSelecionadoCalculo => p !== null);
  }, [valores, todosPlanos, comissaoSelecionada]);

  const planoSelecionado = useMemo(
    () => planosCalculados.find(p => p.id === planoEscolhidoId) || null,
    [planosCalculados, planoEscolhidoId]
  );

  // Pintura interna: 4,8% do valor locatício aprovado (aluguel), em 3x.
  const pinturaTotal = useMemo(() => {
    const base = Number(valores.aluguel) || 0;
    return +(base * 0.048).toFixed(2);
  }, [valores.aluguel]);
  const pinturaParcela = useMemo(() => +(pinturaTotal / 3).toFixed(2), [pinturaTotal]);

  const activationCommission = useMemo(() => +(activationAmount * 0.5).toFixed(2), [activationAmount]);
  const activationJustificativa = useMemo(
    () => ACTIVATION_FEE_OPTIONS.find(o => o.value === activationAmount)?.justificativa || "",
    [activationAmount]
  );

  const extrasPayload: ExtrasSelecionados = {
    external_painting_enabled: pinturaEnabled,
    external_painting_total: pinturaEnabled ? pinturaTotal : 0,
    external_painting_installment: pinturaEnabled ? pinturaParcela : 0,
    activation_fee_enabled: activationAmount > 0,
    activation_fee_amount: activationAmount,
    activation_fee_commission: activationAmount > 0 ? activationCommission : 0,
  };

  const statusInfo = (dados.status && STATUS_DISPLAY[dados.status]) || STATUS_DISPLAY_FALLBACK;

  return (
    <div className="animate-fade-in">
      {!ocultarVoltar && (
      <button 
        onClick={onVoltar} 
        className="flex items-center gap-2 text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-6 hover:text-neutral-900 transition-colors"
      >
        <ArrowLeft size={12} /> Voltar para os dados
      </button>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div className="flex flex-col gap-4">
          {!ocultarStatusAnalise && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="inline-flex items-center gap-4 px-5 py-3 bg-white border border-green-100 rounded-2xl shadow-sm shadow-green-50/50"
          >
            <div className={`w-10 h-10 rounded-full ${statusInfo.circleClass} flex items-center justify-center text-white shadow-lg animate-pulse shrink-0`}>
              <statusInfo.Icon size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] leading-none mb-1">Status da Análise</p>
              <p className="text-sm font-black text-neutral-900 leading-snug">
                CLIENTE: {dados.nomeInquilino.toUpperCase()}
              </p>
              {dados.documento && (
                <p className="text-sm font-black text-neutral-900 leading-snug">
                  {dados.documento.includes("/") ? "CNPJ" : "CPF"}: {dados.documento}
                </p>
              )}
              <p className={`text-sm font-black mt-0.5 ${statusInfo.textClass}`}>{statusInfo.label}</p>
            </div>
          </motion.div>
          )}
          <div>
            <h1 className="text-3xl font-black text-neutral-900 tracking-tight">Escolha o Plano Ideal</h1>
            <p className="hidden">
              Planos calculados para o valor total de{' '}
              <span className="text-neutral-900 font-bold">
                {formatarBRL(Number(valores.aluguel) + Number(valores.condominio) + Number(valores.taxas))}
              </span>
              <button
                type="button"
                onClick={abrirEdicao}
                title="Alterar valores da simulação"
                aria-label="Alterar valores da simulação"
                className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-900 hover:border-neutral-900 hover:shadow-sm transition-all"
              >
                <Pencil size={12} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Editar</span>
              </button>
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 items-end">
          <div className="flex bg-neutral-100/80 p-1.5 rounded-2xl border border-neutral-200/50 backdrop-blur-sm">
            <button
              onClick={() => setComissaoSelecionada('sem')}
              className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${
                comissaoSelecionada === 'sem'
                  ? 'bg-yellow-400 text-neutral-900 shadow-md shadow-yellow-200/60 scale-105 ring-1 ring-yellow-500/40'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              Sem Comissão
            </button>
            <button
              onClick={() => setComissaoSelecionada('com')}
              className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${
                comissaoSelecionada === 'com'
                  ? 'bg-yellow-400 text-neutral-900 shadow-md shadow-yellow-200/60 scale-105 ring-1 ring-yellow-500/40'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              Com Comissão
            </button>
          </div>
        </div>

      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {planosCalculados.map((plano, index) => {
            const isSelected = planoEscolhidoId === plano.id;

            return (
              <motion.div 
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: index * 0.1 }}
                key={plano.id}
                onClick={() => setPlanoEscolhidoId(plano.id)}
                className={`relative p-8 rounded-[2.5rem] border-2 transition-all duration-500 cursor-pointer overflow-hidden flex flex-col h-full ${
                  isSelected 
                  ? 'bg-neutral-900 border-neutral-900 shadow-2xl shadow-neutral-200 ring-8 ring-neutral-900/5' 
                  : 'bg-white border-neutral-100 hover:border-neutral-200 hover:shadow-xl'
                }`}
              >
                {(() => {
                  const nome = (plano.nome || '').toLowerCase().replace(/\s+/g, '');
                  const labelsCom: Record<string, string> = {
                    'noxsmart': 'MAIS APROVAÇÕES',
                    'noxsmart+': 'COBRE TAXAS',
                    'noxup': 'MAIOR COBERTURA',
                  };
                  const labelsSem: Record<string, string> = {
                    'noxsmart': 'MAIS BARATO',
                    'noxsmart+': 'MELHOR CUSTO-BENEFÍCIO',
                    'noxup': 'MAIOR COBERTURA',
                  };
                  const map = comissaoSelecionada === 'com' ? labelsCom : labelsSem;
                  const label = map[nome] || (plano.destaque ? plano.destaque.replace(/_/g, ' ').toUpperCase() : null);
                  if (!label) return null;
                  return (
                    <div className="absolute top-0 right-0">
                      <div className="bg-orange-500 text-white text-[9px] font-black uppercase tracking-[0.18em] px-4 py-2 rounded-bl-3xl shadow-sm whitespace-nowrap text-center">
                        {label}
                      </div>
                    </div>
                  );
                })()}


                <div className="mb-8">
                  <p className={`text-[11px] font-black uppercase tracking-[0.3em] mb-3 ${isSelected ? 'text-neutral-400' : 'text-neutral-400'}`}>
                    {plano.nome}
                  </p>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-sm font-bold ${isSelected ? 'text-white/60' : 'text-neutral-400'}`}>R$</span>
                    <span className={`text-4xl font-black tracking-tighter ${isSelected ? 'text-white' : 'text-neutral-900'}`}>
                      {plano.mensal % 1 === 0 
                        ? plano.mensal.toLocaleString('pt-BR')
                        : plano.mensal.toFixed(2).replace('.', ',')
                      }
                    </span>
                    <span className={`text-sm font-bold ${isSelected ? 'text-white/60' : 'text-neutral-400'}`}>
                      /mês
                    </span>
                  </div>
                  <p className={`text-[10px] font-bold mt-2 uppercase tracking-wide ${isSelected ? 'text-neutral-500' : 'text-neutral-400'}`}>
                    Total: {formatarBRL(plano.totalAnual)}
                  </p>
                  <p className={`text-[10px] font-black mt-1 uppercase tracking-wider ${isSelected ? 'text-green-400' : 'text-green-600'}`}>
                    À vista: {formatarBRL(plano.aVista)} <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded ml-1 text-[8px]">-10% OFF</span>
                  </p>
                </div>

                <div className="space-y-4 mb-10">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]' : 'bg-neutral-200'}`} />
                    <p className={`text-sm font-bold ${isSelected ? 'text-neutral-300' : 'text-neutral-600'}`}>
                      Cobertura {plano.cobertura_multiplicador}x o aluguel
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]' : 'bg-neutral-200'}`} />
                    <p className={`text-sm font-bold ${isSelected ? 'text-neutral-300' : 'text-neutral-600'}`}>
                      Taxa de {plano.taxa_premio}%
                    </p>
                  </div>
                  {plano.cobre_taxas_condominio && (
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-neutral-200'}`} />
                      <p className={`text-sm font-bold ${isSelected ? 'text-green-400' : 'text-green-600'}`}>
                        Cobre taxas e condomínio
                      </p>
                    </div>
                  )}
                </div>

                <div className={`mt-auto w-full py-4 rounded-3xl text-[11px] font-black uppercase tracking-[0.25em] transition-all duration-300 flex items-center justify-center gap-2 ${
                  isSelected 
                  ? 'bg-white text-neutral-900 shadow-xl' 
                  : 'bg-neutral-50 text-neutral-400 border border-neutral-100'
                }`}>
                  {isSelected && <CheckCircle2 size={16} className="text-green-500" />}
                  {isSelected ? 'Selecionado' : 'Selecionar'}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {planoEscolhidoId && (
          <motion.div
            key="extras-area"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="pt-10"
          >
            {/* Header */}
            <div className="mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-yellow-50 border border-yellow-200 mb-3">
                <Sparkles size={12} className="text-yellow-600" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-700">Extras opcionais</span>
              </div>
              <h2 className="text-2xl font-black text-neutral-900 tracking-tight">Adicione serviços extras à proposta</h2>
              <p className="text-sm text-neutral-500 font-medium mt-1">
                Ofereça coberturas e ativações adicionais para deixar a proposta mais completa.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Pintura interna */}
              <motion.div
                layout
                onClick={() => setPinturaEnabled(v => !v)}
                className={`relative overflow-hidden min-h-[360px] p-5 rounded-2xl border-2 cursor-pointer transition-all duration-300 flex flex-col ${
                  pinturaEnabled
                    ? 'bg-neutral-900 border-neutral-900 shadow-xl shadow-neutral-200'
                    : 'bg-white border-neutral-100 hover:border-yellow-400 hover:shadow-md'
                }`}
              >
                <div className="relative flex items-center justify-between mb-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    pinturaEnabled ? 'bg-yellow-400 text-neutral-900' : 'bg-neutral-100 text-neutral-700'
                  }`}>
                    <PaintRoller size={16} />
                  </div>
                  <span className={`text-[9px] font-black uppercase tracking-[0.18em] px-2 py-0.5 rounded-full ${
                    pinturaEnabled ? 'bg-yellow-400 text-neutral-900' : 'bg-orange-50 text-orange-600'
                  }`}>
                    Opcional
                  </span>
                </div>
                <h3 className={`relative text-base font-black tracking-tight ${pinturaEnabled ? 'text-white' : 'text-neutral-900'}`}>
                  Pintura interna
                </h3>
                <p className={`relative md:max-w-[180px] text-[11px] font-medium mb-3 mt-0.5 ${pinturaEnabled ? 'text-neutral-400' : 'text-neutral-500'}`}>
                  Reforce a proteção do imóvel com cobertura de pintura interna.
                </p>
                {/* Mobile: imagem em fluxo normal, centralizada, sem risco de sobrepor o texto.
                    Em sm+, vira decoração absoluta no canto inferior direito do card. */}
                <img
                  src="/assets/nox-pintura-personagem.webp"
                  alt="Personagem NOX Fiança pintor, representando a cobertura de pintura interna"
                  className="pointer-events-none select-none block mx-auto h-36 w-auto object-contain md:absolute md:m-0 md:right-2 md:bottom-2 md:h-44 md:object-bottom"
                />
                <div className="relative mt-3 md:max-w-[180px]">
                  <div className="flex items-baseline gap-1 mb-0.5">
                    <span className={`text-sm font-black ${pinturaEnabled ? 'text-yellow-400' : 'text-orange-500'}`}>+</span>
                    <span className={`text-xl font-black tracking-tight ${pinturaEnabled ? 'text-white' : 'text-neutral-900'}`}>
                      {formatarBRL(pinturaParcela)}
                    </span>
                    <span className={`text-[11px] font-bold ${pinturaEnabled ? 'text-white/60' : 'text-neutral-400'}`}>
                      /mês
                    </span>
                  </div>
                  <p className={`text-[10px] font-bold uppercase tracking-wide mb-3 ${pinturaEnabled ? 'text-neutral-500' : 'text-neutral-400'}`}>
                    Cobertura de até 3× o valor do aluguel
                  </p>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`flex gap-2 p-2.5 rounded-xl border mb-3 ${
                      pinturaEnabled
                        ? 'bg-yellow-400/10 border-yellow-400/30'
                        : 'bg-yellow-50 border-yellow-200'
                    }`}
                  >
                    <Info size={12} className={`shrink-0 mt-0.5 ${pinturaEnabled ? 'text-yellow-400' : 'text-yellow-600'}`} />
                    <p className={`text-[10px] leading-snug font-medium ${pinturaEnabled ? 'text-neutral-300' : 'text-neutral-600'}`}>
                      <span className={`font-black ${pinturaEnabled ? 'text-yellow-400' : 'text-yellow-700'}`}>Atenção sobre a cobertura:</span> válida apenas para pinturas danificadas por mau uso ou danos intencionais/indevidos. Desgaste natural, envelhecimento ou deterioração pelo tempo não são cobertos.
                    </p>
                  </div>
                  <div className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.18em] flex items-center justify-center gap-2 transition-all ${
                    pinturaEnabled
                      ? 'bg-white text-neutral-900'
                      : 'bg-neutral-50 text-neutral-500 border border-neutral-100'
                  }`}>
                    {pinturaEnabled ? (<><CheckCircle2 size={12} className="text-green-500" /> Adicionado · remover</>) : 'Adicionar'}
                  </div>
                </div>
              </motion.div>


              {/* Taxa de ativação */}
              <motion.div
                layout
                className={`relative overflow-hidden min-h-[360px] p-5 rounded-2xl border-2 transition-all duration-300 flex flex-col ${
                  activationAmount > 0
                    ? 'bg-neutral-900 border-neutral-900 shadow-xl shadow-neutral-200'
                    : 'bg-white border-neutral-100 hover:border-yellow-400 hover:shadow-md'
                }`}
              >
                <div className="relative flex items-center justify-between mb-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    activationAmount > 0 ? 'bg-yellow-400 text-neutral-900' : 'bg-neutral-100 text-neutral-700'
                  }`}>
                    <Sparkles size={16} />
                  </div>
                  <span className={`text-[9px] font-black uppercase tracking-[0.18em] px-2 py-0.5 rounded-full ${
                    activationAmount > 0 ? 'bg-yellow-400 text-neutral-900' : 'bg-orange-50 text-orange-600'
                  }`}>
                    Opcional
                  </span>
                </div>
                <h3 className={`relative text-base font-black tracking-tight ${activationAmount > 0 ? 'text-white' : 'text-neutral-900'}`}>
                  Taxa de ativação
                </h3>
                <p className={`relative md:max-w-[180px] text-[11px] font-medium mb-3 mt-0.5 ${activationAmount > 0 ? 'text-neutral-400' : 'text-neutral-500'}`}>
                  Defina uma taxa opcional de ativação para o novo contrato.
                </p>

                <Select
                  value={String(activationAmount)}
                  onValueChange={(v) => setActivationAmount(Number(v))}
                >
                  <SelectTrigger
                    className={`relative md:max-w-[180px] h-10 rounded-xl text-xs font-bold ${
                      activationAmount > 0
                        ? 'bg-neutral-800 border-neutral-700 text-white hover:bg-neutral-700'
                        : 'bg-white border-neutral-200 text-neutral-900'
                    }`}
                  >
                    <SelectValue placeholder="Selecione a taxa de ativação" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Sem taxa</SelectItem>
                    {ACTIVATION_FEE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Mobile: imagem em fluxo normal, centralizada. Em sm+, vira decoração
                    absoluta no canto inferior direito do card, como no card de Pintura. */}
                <img
                  src="/assets/nox-ativacao-personagem.webp"
                  alt="Personagem NOX Fiança segurando prancheta de taxa de ativação"
                  className="pointer-events-none select-none block mx-auto mt-3 h-36 w-auto object-contain md:absolute md:m-0 md:right-2 md:bottom-2 md:h-44 md:object-bottom"
                />

                <div className="relative mt-3 md:max-w-[180px]">
                  {activationAmount > 0 ? (
                    <div className="pt-3 border-t border-neutral-800 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Taxa escolhida</span>
                        <span className="text-sm font-black text-white">{formatarBRL(activationAmount)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Comissão do corretor</span>
                        <span className="text-sm font-black text-yellow-400">{formatarBRL(activationCommission)}</span>
                      </div>
                      <p className="text-[10px] font-medium text-neutral-500 pt-1">
                        Parte da taxa de ativação é convertida em comissão para o corretor/imobiliária.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[10px] font-medium text-neutral-400 pt-3 border-t border-neutral-100">
                      Ao contratar este extra, o corretor recebe 50% da taxa de ativação.
                    </p>
                  )}
                </div>
              </motion.div>

            </div>

            {/* Resumo */}
            <div className="mt-8 p-6 rounded-3xl bg-gradient-to-br from-neutral-50 to-white border border-neutral-100">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-5 bg-yellow-400 rounded-full" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-neutral-900">Resumo da proposta</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
                <ResumoLinha label="Plano selecionado" value={planoSelecionado?.nome || '—'} />
                <ResumoLinha label="Valor mensal base" value={planoSelecionado ? formatarBRL(planoSelecionado.mensal) : '—'} />
                <ResumoLinha
                  label="Pintura interna"
                  value={pinturaEnabled ? `Sim · +${formatarBRL(pinturaParcela)}/mês (cobertura 3× aluguel)` : 'Não'}
                />
                <ResumoLinha
                  label="Taxa de ativação"
                  value={activationAmount > 0 ? `${formatarBRL(activationAmount)} (única)` : 'Não'}
                />
                <ResumoLinha label="Valor à vista do plano" value={planoSelecionado ? formatarBRL(planoSelecionado.aVista) : '—'} />
                <ResumoLinha
                  label="Mensal final com adicionais"
                  value={planoSelecionado ? formatarBRL(planoSelecionado.mensal + (pinturaEnabled ? pinturaParcela : 0)) : '—'}
                  highlight
                />
              </div>
              {pinturaEnabled && (
                <div className="mt-4 flex gap-2 p-3 rounded-xl bg-yellow-50 border border-yellow-200">
                  <Info size={14} className="shrink-0 mt-0.5 text-yellow-600" />
                  <p className="text-[11px] leading-snug font-medium text-neutral-700">
                    <span className="font-black text-yellow-700">Pintura interna adicionada:</span> cobertura para danos por mau uso. Não cobre desgaste natural.
                  </p>
                </div>
              )}
              {!pinturaEnabled && activationAmount === 0 && (
                <p className="text-xs text-neutral-400 font-medium mt-4 italic">
                  Nenhum serviço extra adicionado.
                </p>
              )}
            </div>

            <Button
              onClick={() => onSelecionarPlano(planoEscolhidoId!, extrasPayload, planoSelecionado ?? undefined)}
              disabled={isSubmitting}
              className="mt-6 w-full bg-neutral-900 hover:bg-neutral-800 text-white py-6 rounded-xl font-bold text-lg flex items-center justify-center gap-2 shadow-xl shadow-neutral-200 transition-all"
            >
              {isSubmitting ? 'Salvando...' : 'Finalizar Simulação'}
              <ChevronRight className="w-5 h-5" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>


      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight">Alterar valores da simulação</DialogTitle>
            <DialogDescription className="text-sm text-neutral-500">
              Atualize os valores para recalcular os planos disponíveis.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-aluguel" className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                Aluguel
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-neutral-400">R$</span>
                <Input
                  id="edit-aluguel"
                  inputMode="decimal"
                  value={editAluguel}
                  onChange={(e) => setEditAluguel(e.target.value)}
                  placeholder="0,00"
                  className="pl-10 h-11 rounded-xl font-medium"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-condominio" className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                Condomínio
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-neutral-400">R$</span>
                <Input
                  id="edit-condominio"
                  inputMode="decimal"
                  value={editCondominio}
                  onChange={(e) => setEditCondominio(e.target.value)}
                  placeholder="0,00"
                  className="pl-10 h-11 rounded-xl font-medium"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-taxas" className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                Taxa
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-neutral-400">R$</span>
                <Input
                  id="edit-taxas"
                  inputMode="decimal"
                  value={editTaxas}
                  onChange={(e) => setEditTaxas(e.target.value)}
                  placeholder="0,00"
                  className="pl-10 h-11 rounded-xl font-medium"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={salvandoEdicao}
              className="rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSalvarEdicao}
              disabled={salvandoEdicao}
              className="bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl"
            >
              {salvandoEdicao ? 'Atualizando...' : 'Atualizar simulação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function ResumoLinha({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-dashed border-neutral-100 last:border-0">
      <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">{label}</span>
      <span className={`text-sm font-black tabular-nums ${highlight ? 'text-green-600' : 'text-neutral-900'}`}>{value}</span>
    </div>
  );
}
