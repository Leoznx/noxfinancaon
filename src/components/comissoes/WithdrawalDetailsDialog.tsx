import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  LockKeyhole,
  Receipt,
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
import {
  FINANCIAL_STATUS_LABELS,
  formatCents,
  getWithdrawalDetails,
  getWithdrawalReceiptUrl,
  revealWithdrawalPix,
  toWithdrawalError,
  WITHDRAWAL_STATUS_LABELS,
  type WithdrawalDetails,
  type WithdrawalStatus,
} from "@/lib/withdrawals";

type Props = {
  withdrawalId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manager?: boolean;
};

const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("pt-BR") : "—";

const statusTone: Record<WithdrawalStatus, string> = {
  PENDING_REVIEW: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-blue-200 bg-blue-50 text-blue-800",
  AWAITING_PAYMENT: "border-indigo-200 bg-indigo-50 text-indigo-800",
  PAID: "border-emerald-200 bg-emerald-50 text-emerald-800",
  REJECTED: "border-red-200 bg-red-50 text-red-800",
  CANCELLED: "border-neutral-200 bg-neutral-100 text-neutral-700",
  MANUAL_REVIEW: "border-orange-200 bg-orange-50 text-orange-800",
};

const financialTone: Record<string, string> = {
  ON_TIME: "border-emerald-200 bg-emerald-50 text-emerald-800",
  PAYMENT_PENDING: "border-amber-200 bg-amber-50 text-amber-800",
  OVERDUE: "border-red-200 bg-red-50 text-red-800",
  CANCELLED: "border-red-200 bg-red-50 text-red-800",
  CLOSED: "border-neutral-200 bg-neutral-100 text-neutral-700",
  UNDER_REVIEW: "border-orange-200 bg-orange-50 text-orange-800",
};

export function WithdrawalDetailsDialog({
  withdrawalId,
  open,
  onOpenChange,
  manager = false,
}: Props) {
  const [details, setDetails] = useState<WithdrawalDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [fullPix, setFullPix] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [openingReceipt, setOpeningReceipt] = useState(false);

  useEffect(() => {
    if (!open || !withdrawalId) {
      setDetails(null);
      setFullPix(null);
      return;
    }
    let active = true;
    setLoading(true);
    setFullPix(null);
    getWithdrawalDetails(withdrawalId)
      .then((value) => {
        if (active) setDetails(value);
      })
      .catch((error) => {
        if (active) toast.error(toWithdrawalError(error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, withdrawalId]);

  const revealPix = async () => {
    if (!withdrawalId || !manager || revealing) return;
    setRevealing(true);
    try {
      const result = await revealWithdrawalPix(withdrawalId);
      setFullPix(result.pix_key);
      toast.success("Chave Pix revelada. Este acesso foi registrado na auditoria.");
    } catch (error) {
      toast.error(toWithdrawalError(error).message);
    } finally {
      setRevealing(false);
    }
  };

  const copyPix = async () => {
    if (!fullPix) return;
    try {
      await navigator.clipboard.writeText(fullPix);
      toast.success("Chave Pix copiada.");
    } catch {
      toast.error("Não foi possível copiar a chave Pix.");
    }
  };

  const openReceipt = async (accessType: "view" | "download") => {
    if (!withdrawalId || openingReceipt) return;
    const popup = window.open("", "_blank", "noopener,noreferrer");
    setOpeningReceipt(true);
    try {
      const url = await getWithdrawalReceiptUrl(withdrawalId, accessType);
      if (popup) popup.location.href = url;
      else window.location.assign(url);
    } catch (error) {
      popup?.close();
      toast.error(toWithdrawalError(error).message);
    } finally {
      setOpeningReceipt(false);
    }
  };

  const withdrawal = details?.withdrawal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-5xl overflow-y-auto rounded-2xl p-0">
        <DialogHeader className="border-b border-neutral-100 px-5 py-5 text-left sm:px-7">
          <DialogTitle className="flex items-center gap-2 text-xl font-black text-neutral-950">
            <Receipt className="h-5 w-5 text-yellow-500" /> Detalhes da solicitação
          </DialogTitle>
          <DialogDescription>
            Dados bancários, contratos vinculados e histórico financeiro do saque.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-72 items-center justify-center gap-3 text-neutral-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Carregando dados reais...
          </div>
        ) : !details || !withdrawal ? (
          <div className="min-h-72 px-6 py-16 text-center text-neutral-500">
            Não foi possível localizar esta solicitação.
          </div>
        ) : (
          <div className="space-y-6 px-5 py-6 sm:px-7">
            <section className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-neutral-500" />
                  <h3 className="font-black text-neutral-950">Dados do solicitante</h3>
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <Info label="Nome" value={details.requester?.name} />
                  <Info label="E-mail" value={details.requester?.email} />
                  <Info label="Perfil" value={details.requester?.role} />
                  <Info label="CPF/CNPJ" value={details.requester?.document} />
                  <Info label="Nível" value={details.requester?.commission_level} />
                  <Info label="Cadastro" value={dateTime(details.requester?.created_at)} />
                  <Info
                    label="Contratos ativos"
                    value={String(details.requester?.active_contracts ?? 0)}
                  />
                  <Info
                    label="Histórico de saques"
                    value={String(details.requester?.withdrawal_count ?? 0)}
                  />
                  <Info
                    label="Total acumulado"
                    value={formatCents(details.requester?.total_accumulated_cents)}
                  />
                  <Info
                    label="Total já sacado"
                    value={formatCents(details.requester?.total_withdrawn_cents)}
                  />
                </dl>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-black text-neutral-950">Dados do saque</h3>
                  <Badge className={statusTone[withdrawal.status]}>
                    {WITHDRAWAL_STATUS_LABELS[withdrawal.status]}
                  </Badge>
                </div>
                <div className="mb-4 rounded-xl bg-neutral-950 p-4 text-white">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-yellow-400">
                    Valor reservado
                  </p>
                  <p className="mt-1 text-3xl font-black">{formatCents(withdrawal.amount_cents)}</p>
                  <p className="mt-1 text-xs text-neutral-400">Sem desconto fictício</p>
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <Info label="ID interno" value={withdrawal.id} mono />
                  <Info label="Solicitado em" value={dateTime(withdrawal.requested_at)} />
                  <Info label="Banco" value={withdrawal.bank_name} />
                  <Info label="Titular" value={withdrawal.holder_name} />
                  <Info label="Tipo Pix" value={withdrawal.pix_key_type} />
                  <Info label="Aprovado em" value={dateTime(withdrawal.approved_at)} />
                  <Info label="Pago em" value={dateTime(withdrawal.paid_at)} />
                </dl>

                <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                        Chave Pix
                      </p>
                      <p className="mt-1 break-all font-mono text-sm font-semibold text-neutral-900">
                        {fullPix || withdrawal.pix_key_masked}
                      </p>
                    </div>
                    {manager && !fullPix && (
                      <Button variant="outline" size="sm" onClick={revealPix} disabled={revealing}>
                        {revealing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                        <span className="ml-2 hidden sm:inline">Revelar</span>
                      </Button>
                    )}
                    {manager && fullPix && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={copyPix}
                        aria-label="Copiar chave Pix"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {manager && (
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-neutral-500">
                      <LockKeyhole className="h-3 w-3" /> A revelação da chave completa é auditada.
                    </p>
                  )}
                </div>

                {withdrawal.rejection_reason && (
                  <div className="mt-4 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <strong>Motivo da recusa:</strong> {withdrawal.rejection_reason}
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-black text-neutral-950">Contratos vinculados a este saque</h3>
                  <p className="text-sm text-neutral-500">
                    Snapshot das comissões e situação financeira consultada no banco.
                  </p>
                </div>
                <Badge variant="outline">{details.contracts.length} contrato(s)</Badge>
              </div>

              {details.contracts.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-neutral-500">
                  Nenhum contrato vinculado foi encontrado.
                </div>
              ) : (
                <div className="space-y-3">
                  {details.contracts.map((contract) => (
                    <article
                      key={contract.contract_id}
                      className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5"
                    >
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div className="flex gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-50 text-yellow-700">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-black text-neutral-950">
                              Contrato #
                              {contract.contract_number || contract.contract_id.slice(0, 8)}
                            </p>
                            <p className="text-sm text-neutral-500">
                              {contract.tenant_name || "Inquilino não informado"} ·{" "}
                              {contract.owner_name || "Proprietário não informado"}
                            </p>
                          </div>
                        </div>
                        <Badge
                          className={
                            financialTone[contract.financial_status] || financialTone.UNDER_REVIEW
                          }
                        >
                          {FINANCIAL_STATUS_LABELS[contract.financial_status] || "Em análise"}
                        </Badge>
                      </div>
                      <dl className="mt-4 grid gap-3 border-t border-neutral-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <Info
                          label="Valor do contrato"
                          value={formatCents(contract.contract_value_cents)}
                        />
                        <Info label="Valor-base" value={formatCents(contract.base_amount_cents)} />
                        <Info
                          label="Percentual"
                          value={
                            contract.percentage_applied != null
                              ? `${contract.percentage_applied}%`
                              : "—"
                          }
                        />
                        <Info label="Comissão" value={formatCents(contract.commission_cents)} />
                        <Info label="Início" value={dateTime(contract.start_date)} />
                        <Info label="Último pagamento" value={dateTime(contract.last_payment_at)} />
                        <Info label="Próximo vencimento" value={dateTime(contract.next_due_date)} />
                        <Info
                          label="Parcelas"
                          value={`${contract.paid_installments} pagas · ${contract.pending_installments} pendentes`}
                        />
                      </dl>
                      <div className="mt-4 flex justify-end">
                        <a
                          href={contract.contract_url}
                          className="inline-flex items-center gap-2 text-sm font-bold text-neutral-700 hover:text-neutral-950"
                        >
                          Ver contrato <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
              <h3 className="font-black text-neutral-950">Linha do tempo</h3>
              <div className="mt-4 space-y-0">
                {details.timeline.length === 0 ? (
                  <p className="text-sm text-neutral-500">Aguardando o primeiro evento auditado.</p>
                ) : (
                  details.timeline.map((event, index) => (
                    <div
                      key={`${event.action}-${event.created_at}-${index}`}
                      className="relative flex gap-3 pb-5 last:pb-0"
                    >
                      {index < details.timeline.length - 1 && (
                        <span className="absolute left-[9px] top-5 h-full w-px bg-neutral-200" />
                      )}
                      <CheckCircle2 className="relative z-10 mt-0.5 h-5 w-5 shrink-0 fill-white text-emerald-500" />
                      <div>
                        <p className="text-sm font-bold text-neutral-900">
                          {timelineLabel(event.action, event.new_status)}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {dateTime(event.created_at)}
                          {event.actor_name ? ` · ${event.actor_name}` : ""}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {withdrawal.receipt_available && (
              <section className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Receipt className="h-5 w-5 text-emerald-700" />
                  <div>
                    <p className="font-bold text-emerald-950">Comprovante disponível</p>
                    <p className="text-sm text-emerald-800">Acesso privado por URL temporária.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => openReceipt("view")}
                    disabled={openingReceipt}
                  >
                    <Eye className="mr-2 h-4 w-4" /> Ver
                  </Button>
                  <Button
                    className="bg-emerald-700 hover:bg-emerald-800"
                    onClick={() => openReceipt("download")}
                    disabled={openingReceipt}
                  >
                    {openingReceipt ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Baixar
                  </Button>
                </div>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{label}</dt>
      <dd
        className={`mt-1 break-words font-semibold text-neutral-900 ${mono ? "font-mono text-xs" : "text-sm"}`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

function timelineLabel(action: string, newStatus: string | null) {
  const labels: Record<string, string> = {
    WITHDRAWAL_CREATED: "Solicitação criada",
    BALANCE_RESERVED: "Saldo reservado",
    WITHDRAWAL_APPROVED: "Saque aprovado",
    WITHDRAWAL_REJECTED: "Saque recusado",
    WITHDRAWAL_RECEIPT_ATTACHED: "Comprovante anexado",
    WITHDRAWAL_PAID: "Pagamento confirmado",
    WITHDRAWAL_SENT_TO_MANUAL_REVIEW: "Enviado para revisão manual",
  };
  if (labels[action]) return labels[action];
  if (newStatus && newStatus in WITHDRAWAL_STATUS_LABELS) {
    return WITHDRAWAL_STATUS_LABELS[newStatus as WithdrawalStatus];
  }
  return action.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}
