import { useEffect, useState } from "react";
import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  FileText,
  IdCard,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Send,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  LABEL_STATUS_CONSULTA,
  formatDocumento,
  resolverStatusConsulta,
  type StatusExibicaoConsulta,
} from "@/lib/consultasCredito";
import { resolveCreditCustomerName } from "@/lib/credit-customer-name";
import {
  reconcileExistingAsaasSubscription,
  type ExistingAsaasSubscriptionPreview,
} from "@/lib/asaas-import";
import { maskPhone } from "@/utils/validators";

type Props = {
  consulta: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const TOM_STATUS: Record<StatusExibicaoConsulta, string> = {
  aprovado: "border-emerald-200 bg-emerald-50 text-emerald-700",
  recusado: "border-red-200 bg-red-50 text-red-700",
  em_analise: "border-amber-200 bg-amber-50 text-amber-700",
  falta_documentos: "border-orange-200 bg-orange-50 text-orange-700",
  requer_verificacao: "border-violet-200 bg-violet-50 text-violet-700",
  erro: "border-red-200 bg-red-50 text-red-700",
  processando: "border-yellow-200 bg-yellow-50 text-yellow-700",
  pendente: "border-neutral-200 bg-neutral-100 text-neutral-700",
};

const LABEL_PERFIL: Record<string, string> = {
  admin: "Administrador",
  admin_master: "Admin Master",
  analista: "Analista",
  corretor: "Corretor",
  imobiliaria: "Imobiliária",
  proprietario: "Proprietário",
  inquilino: "Inquilino",
  juridico: "Jurídico",
  financeiro: "Financeiro",
  marketing: "Marketing",
  suporte: "Suporte",
  vendedor: "Vendedor",
};

/** Dados de cadastro do solicitante que não moram em `profiles` (cidade/UF e telefone da imobiliária). */
type ExtrasSolicitante = {
  cidade: string | null;
  estado: string | null;
  telefone: string | null;
};

function formatarCep(cep?: string | null): string | null {
  const digits = String(cep ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return cep?.trim() || null;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function formatarTelefone(telefone?: string | null): string | null {
  const bruto = String(telefone ?? "").trim();
  if (!bruto) return null;
  const digits = bruto.replace(/\D/g, "");
  // Números com DDI (+55) ou fora do padrão brasileiro ficam como estão — a máscara
  // só sabe formatar 10/11 dígitos e cortaria o resto.
  if (digits.length < 10 || digits.length > 11) return bruto;
  return maskPhone(digits);
}

type EventoHistorico = {
  id: string;
  tipo_evento: string;
  descricao: string;
  created_at: string;
};

/** Rótulo curto de cada etapa do funil, para a leitura rápida de performance. */
const LABEL_EVENTO: Record<string, string> = {
  plano_selecionado: "Plano escolhido",
  documentos_enviados: "Documentos enviados",
  dados_complementares: "Dados complementares",
  pagamento_selecionado: "Forma de pagamento",
  pagamento_adiado: "Pagamento adiado",
  proposta_registrada: "Proposta registrada",
  aguardando_pagamento: "Aguardando pagamento",
  pagamento_confirmado: "Pagamento confirmado",
  contrato_d4sign_pendente: "Contrato pendente",
  contrato_enviado: "Contrato enviado para assinatura",
  contrato_assinado: "Contrato assinado",
  ativacao_enviada: "Link de ativação enviado",
  fianca_ativada: "Fiança ativada",
};

/** Etapa em que a proposta está hoje, em texto direto para o administrador. */
const LABEL_ETAPA: Record<string, string> = {
  pendente_documentacao: "Aguardando documentação",
  dados_complementares: "Preenchendo dados complementares",
  documentacao_complementar_enviada: "Documentação enviada para análise",
  falta_documentos: "Falta de documentos",
  aguardando_pagamento: "Aguardando pagamento",
  aguardando_assinatura: "Aguardando assinatura",
  aguardando_assinatura_d4sign: "Aguardando assinatura (D4Sign)",
  aguardando_ativacao: "Aguardando ativação",
  ativado: "Fiança ativada",
  finalizada: "Finalizada",
};

export function ConsultaDetalhesModal({ consulta, open, onOpenChange }: Props) {
  const [extras, setExtras] = useState<ExtrasSolicitante | null>(null);
  const [historico, setHistorico] = useState<EventoHistorico[] | null>(null);
  const [asaasPreview, setAsaasPreview] = useState<ExistingAsaasSubscriptionPreview | null>(null);
  const [asaasAction, setAsaasAction] = useState<"preview" | "import" | null>(null);

  const profileIdSolicitante = consulta?.profile_id_solicitante ?? null;
  const emailSolicitante = consulta?.solicitante?.email ?? null;

  // Cidade do solicitante não existe em `profiles` — corretor guarda em `corretores`,
  // imobiliária em `imobiliarias`. Busca só quando a caixa abre, pra não pesar a lista.
  const consultaId = consulta?.id ?? null;

  useEffect(() => {
    setAsaasPreview(null);
    setAsaasAction(null);
  }, [consultaId, open]);

  const consultarAssinaturaExistente = async () => {
    if (!consultaId || asaasAction) return;
    setAsaasAction("preview");
    try {
      const result = await reconcileExistingAsaasSubscription(consultaId, "preview");
      setAsaasPreview(result);
      toast.success("Assinatura existente localizada no Asaas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível consultar o Asaas.");
    } finally {
      setAsaasAction(null);
    }
  };

  const importarAssinaturaExistente = async () => {
    if (!consultaId || asaasAction || !asaasPreview?.contractReady) return;
    setAsaasAction("import");
    try {
      const result = await reconcileExistingAsaasSubscription(consultaId, "import");
      setAsaasPreview(result);
      if (result.contractSent) {
        toast.success("Assinatura importada e contrato enviado para assinatura.");
      } else {
        toast.warning("Assinatura importada, mas o envio do contrato precisa de revisão.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível importar a assinatura.",
      );
    } finally {
      setAsaasAction(null);
    }
  };

  // Passo a passo da proposta depois da aprovação — é o que o administrador usa
  // para acompanhar a performance de quem fez a consulta.
  useEffect(() => {
    if (!open || !consultaId) {
      setHistorico(null);
      return;
    }
    let ativo = true;

    (async () => {
      const { data, error } = await supabase
        .from("proposta_historico")
        .select("id, tipo_evento, descricao, created_at")
        .eq("consulta_id", consultaId)
        .order("created_at", { ascending: true });
      if (!ativo) return;
      if (error) {
        console.error("Erro ao carregar histórico da proposta:", error);
        setHistorico([]);
        return;
      }
      setHistorico((data as EventoHistorico[]) ?? []);
    })();

    return () => {
      ativo = false;
    };
  }, [open, consultaId]);

  useEffect(() => {
    if (!open) {
      setExtras(null);
      return;
    }
    let ativo = true;

    (async () => {
      let cidade: string | null = null;
      let estado: string | null = null;
      let telefone: string | null = null;

      if (profileIdSolicitante) {
        const { data: corretor } = await supabase
          .from("corretores")
          .select("cidade, estado")
          .eq("profile_id", profileIdSolicitante)
          .maybeSingle();
        cidade = corretor?.cidade ?? null;
        estado = corretor?.estado ?? null;
      }

      if (!cidade && emailSolicitante) {
        const { data: imobiliaria } = await supabase
          .from("imobiliarias")
          .select("cidade, estado, contato_telefone")
          .eq("contato_email", emailSolicitante)
          .maybeSingle();
        cidade = imobiliaria?.cidade ?? null;
        estado = imobiliaria?.estado ?? null;
        telefone = imobiliaria?.contato_telefone ?? null;
      }

      if (ativo) setExtras({ cidade, estado, telefone });
    })();

    return () => {
      ativo = false;
    };
  }, [open, profileIdSolicitante, emailSolicitante]);

  if (!consulta) return null;

  const status = resolverStatusConsulta(consulta);
  const aprovada = status === "aprovado";

  const criadaEm = consulta.created_at ? new Date(consulta.created_at) : null;
  const atualizadaEm = consulta.updated_at ? new Date(consulta.updated_at) : null;

  const solicitante = consulta.solicitante ?? null;
  const nomeSolicitante = solicitante?.nome?.trim() || "Não identificado";
  const perfilSolicitante =
    LABEL_PERFIL[solicitante?.role ?? consulta.role_solicitante ?? ""] ??
    (solicitante?.role || consulta.role_solicitante || "—");
  const telefoneSolicitante =
    formatarTelefone(solicitante?.telefone) ?? formatarTelefone(extras?.telefone) ?? null;

  // Cidade/CEP da consulta (o imóvel analisado) é o dado mais direto; o cadastro do
  // solicitante entra como reserva quando a consulta não guardou endereço nenhum.
  const cidadeConsulta = consulta.imovel_cidade || consulta.imoveis?.cidade || null;
  const estadoConsulta = consulta.imovel_estado || consulta.imoveis?.estado || null;
  const cidade = cidadeConsulta || extras?.cidade || null;
  const estado = cidadeConsulta ? estadoConsulta : (extras?.estado ?? null);
  const cidadeUf = [cidade, estado].filter(Boolean).join(" / ") || null;
  const cep = formatarCep(consulta.imovel_cep || consulta.imoveis?.cep);
  const localizacao =
    cidadeUf && cep ? `${cidadeUf} (CEP ${cep})` : cidadeUf || (cep ? `CEP ${cep}` : null);

  const documentoInquilino =
    consulta.documento ||
    consulta.tenant_document ||
    consulta.inquilinos?.cpf ||
    consulta.inquilinos?.cnpj ||
    null;
  const nomeInquilino = resolveCreditCustomerName({
    tenantName: consulta.tenant_name,
    rawResponse: consulta.raw_response,
    fallbacks: [consulta.inquilinos?.nome, consulta.inquilinos?.razao_social],
  });

  const aluguel = Number(
    consulta.rent_value ?? consulta.valor_aluguel ?? consulta.imoveis?.valor_aluguel ?? 0,
  );

  const moeda = (valor: unknown) => {
    const numero = Number(valor ?? 0);
    return numero > 0
      ? numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : null;
  };
  const planoEscolhido = consulta.planos?.nome ?? null;
  const premioMensal = moeda(consulta.valor_premio_mensal);
  const valorAnual = moeda(consulta.valor_anual);
  const etapaAtual =
    LABEL_ETAPA[String(consulta.substatus ?? "")] ??
    LABEL_ETAPA[String(consulta.status ?? "")] ??
    (consulta.substatus || consulta.status || null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-neutral-900">
            Detalhes da consulta
          </DialogTitle>
          <DialogDescription>
            Quem solicitou, quando solicitou e o que foi analisado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className={`font-bold px-3 ${TOM_STATUS[status]}`}>
            {LABEL_STATUS_CONSULTA[status]}
          </Badge>
          <span className="text-xs font-medium text-neutral-500">
            {criadaEm ? `Solicitada em ${criadaEm.toLocaleString("pt-BR")}` : "Data não registrada"}
          </span>
        </div>

        <Secao titulo="Quem fez a consulta">
          <Campo icone={UserRound} rotulo="Nome do usuário" valor={nomeSolicitante} />
          <Campo icone={Building2} rotulo="Perfil" valor={perfilSolicitante} />
          <Campo icone={Mail} rotulo="E-mail" valor={solicitante?.email ?? null} copiavel />
          <Campo icone={Phone} rotulo="Telefone" valor={telefoneSolicitante} copiavel />
          <Campo icone={MapPin} rotulo="Cidade (CEP)" valor={localizacao} />
        </Secao>

        <Secao titulo="Data e horário">
          <Campo
            icone={Calendar}
            rotulo="Data e hora da consulta"
            valor={criadaEm ? criadaEm.toLocaleString("pt-BR") : null}
          />
          <Campo
            icone={Calendar}
            rotulo="Última atualização"
            valor={atualizadaEm ? atualizadaEm.toLocaleString("pt-BR") : null}
          />
        </Secao>

        <Secao titulo="Inquilino analisado">
          <Campo
            icone={IdCard}
            rotulo="CPF / CNPJ do inquilino"
            valor={documentoInquilino ? formatDocumento(documentoInquilino) : null}
            copiavel
          />
          {/* Nome do inquilino só aparece em consulta aprovada — nas recusadas a CredPago
              costuma não devolver nome nenhum e o admin pediu esse dado só na aprovação. */}
          {aprovada ? (
            <Campo icone={UserRound} rotulo="Nome do inquilino" valor={nomeInquilino} />
          ) : (
            <Campo
              icone={UserRound}
              rotulo="Nome do inquilino"
              valor={null}
              vazio="Disponível apenas em consultas aprovadas"
            />
          )}
          <Campo
            icone={MapPin}
            rotulo="Imóvel"
            valor={consulta.property_address || cidadeUf || null}
          />
          <Campo
            icone={Building2}
            rotulo="Aluguel"
            valor={
              aluguel > 0
                ? aluguel.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                : null
            }
          />
        </Secao>

        {/* Plano escolhido + passo a passo pós-aprovação: é o que mostra até onde
            o usuário levou a proposta e onde ela parou. */}
        {(planoEscolhido || aprovada) && (
          <Secao titulo="Plano contratado">
            <Campo icone={FileText} rotulo="Plano escolhido" valor={planoEscolhido} />
            <Campo icone={Building2} rotulo="Prêmio mensal" valor={premioMensal} />
            <Campo icone={Building2} rotulo="Total anual" valor={valorAnual} />
            <Campo icone={Clock} rotulo="Etapa atual" valor={etapaAtual} />
          </Secao>
        )}

        {aprovada && planoEscolhido && (
          <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <CreditCard size={16} className="text-blue-700" />
                  Assinatura criada manualmente no Asaas
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                  Localiza pelo CPF, confere cartão mensal, valor, prazo e primeira cobrança sem
                  criar uma nova assinatura.
                </p>
              </div>
              {!asaasPreview && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5 bg-white"
                  disabled={asaasAction !== null}
                  onClick={consultarAssinaturaExistente}
                >
                  {asaasAction === "preview" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Localizar
                </Button>
              )}
            </div>

            {asaasPreview && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 gap-2 text-xs text-neutral-700 sm:grid-cols-2">
                  <p>
                    <strong>Cartão mensal:</strong> {asaasPreview.provider.installments} cobranças
                  </p>
                  <p>
                    <strong>Primeira:</strong>{" "}
                    {formatarDataCurta(asaasPreview.provider.firstDueDate)} · Paga no cartão
                  </p>
                  <p>
                    <strong>Cobrança no cartão:</strong>{" "}
                    {moeda(asaasPreview.provider.grossMonthlyAmount)}
                  </p>
                  <p>
                    <strong>Prêmio do contrato:</strong>{" "}
                    {moeda(asaasPreview.provider.contractualMonthlyAmount)}
                  </p>
                  <p>
                    <strong>Próxima:</strong> {formatarDataCurta(asaasPreview.provider.nextDueDate)}
                  </p>
                  <p>
                    <strong>Término:</strong> {formatarDataCurta(asaasPreview.provider.endDate)}
                  </p>
                  <p>
                    <strong>E-mail:</strong> {asaasPreview.tenant.emailMasked ?? "Não informado"}
                  </p>
                  <p>
                    <strong>WhatsApp:</strong> {asaasPreview.tenant.phoneMasked ?? "Não informado"}
                  </p>
                </div>

                {asaasPreview.missingContractFields.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="font-bold">Dados obrigatórios antes da D4Sign</p>
                    <p className="mt-1">{asaasPreview.missingContractFields.join(", ")}.</p>
                  </div>
                )}

                {asaasPreview.contractSent ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 size={17} />
                    Cobrança conciliada e contrato enviado para assinatura.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      disabled={asaasAction !== null || !asaasPreview.contractReady}
                      onClick={importarAssinaturaExistente}
                    >
                      {asaasAction === "import" ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Send size={14} />
                      )}
                      Importar e enviar para assinatura
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5 bg-white"
                      disabled={asaasAction !== null}
                      onClick={consultarAssinaturaExistente}
                    >
                      <RefreshCw size={14} /> Atualizar conferência
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {planoEscolhido && (
          <section className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-neutral-400">
              Passo a passo após a aprovação
            </h3>
            {historico === null ? (
              <p className="mt-3 text-sm text-neutral-400">Carregando histórico...</p>
            ) : !historico.length ? (
              <p className="mt-3 text-sm text-neutral-500">
                Nenhuma etapa registrada depois da escolha do plano.
              </p>
            ) : (
              <ol className="mt-3 space-y-3">
                {historico.map((evento, indice) => (
                  <li key={evento.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                      {indice < historico.length - 1 && (
                        <span className="mt-1 w-px flex-1 bg-neutral-200" />
                      )}
                    </div>
                    <div className="min-w-0 pb-1">
                      <p className="text-sm font-semibold text-neutral-900">
                        {LABEL_EVENTO[evento.tipo_evento] ?? evento.tipo_evento.replace(/_/g, " ")}
                      </p>
                      <p className="text-sm text-neutral-600 break-words">{evento.descricao}</p>
                      <p className="text-[11px] font-medium text-neutral-400">
                        {new Date(evento.created_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatarDataCurta(value?: string | null) {
  if (!value) return "—";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("pt-BR");
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
      <h3 className="text-[10px] font-black uppercase tracking-widest text-neutral-400">
        {titulo}
      </h3>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Campo({
  icone: Icone,
  rotulo,
  valor,
  copiavel = false,
  vazio = "Não informado",
}: {
  icone: React.ComponentType<{ size?: number; className?: string }>;
  rotulo: string;
  valor: string | null;
  copiavel?: boolean;
  vazio?: string;
}) {
  const copiar = async () => {
    if (!valor) return;
    try {
      await navigator.clipboard.writeText(valor);
      toast.success(`${rotulo} copiado.`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <div className="flex items-start gap-2.5">
      <Icone size={15} className="mt-0.5 shrink-0 text-neutral-400" />
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
          {rotulo}
        </dt>
        <dd className="flex items-center gap-1.5">
          <span
            className={`text-sm font-semibold break-words ${valor ? "text-neutral-900" : "text-neutral-400 font-medium"}`}
          >
            {valor ?? vazio}
          </span>
          {copiavel && valor && (
            <button
              type="button"
              onClick={copiar}
              className="shrink-0 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700"
              aria-label={`Copiar ${rotulo}`}
            >
              <Copy size={12} />
            </button>
          )}
        </dd>
      </div>
    </div>
  );
}
