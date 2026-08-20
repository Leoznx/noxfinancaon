import { useEffect, useState } from "react";
import { Building2, Calendar, Copy, IdCard, Mail, MapPin, Phone, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
  isNomeValido,
  resolverStatusConsulta,
  type StatusExibicaoConsulta,
} from "@/lib/consultasCredito";
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

export function ConsultaDetalhesModal({ consulta, open, onOpenChange }: Props) {
  const [extras, setExtras] = useState<ExtrasSolicitante | null>(null);

  const profileIdSolicitante = consulta?.profile_id_solicitante ?? null;
  const emailSolicitante = consulta?.solicitante?.email ?? null;

  // Cidade do solicitante não existe em `profiles` — corretor guarda em `corretores`,
  // imobiliária em `imobiliarias`. Busca só quando a caixa abre, pra não pesar a lista.
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
  const cep = formatarCep(consulta.cep || consulta.imovel_cep || consulta.imoveis?.cep);
  const localizacao =
    cidadeUf && cep ? `${cidadeUf} (CEP ${cep})` : cidadeUf || (cep ? `CEP ${cep}` : null);

  const documentoInquilino =
    consulta.documento ||
    consulta.tenant_document ||
    consulta.inquilinos?.cpf ||
    consulta.inquilinos?.cnpj ||
    null;
  const nomeInquilino =
    [consulta.tenant_name, consulta.inquilinos?.nome, consulta.inquilinos?.razao_social].find(
      isNomeValido,
    ) || null;

  const aluguel = Number(consulta.rent_value ?? consulta.valor_aluguel ?? consulta.imoveis?.valor_aluguel ?? 0);

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
      </DialogContent>
    </Dialog>
  );
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
