import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Send,
  UserRound,
  UserRoundPlus,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  claimSellerClientPhone,
  formatBrazilianPhoneInput,
  isValidBrazilianPhone,
  lookupSellerClientByEmail,
  registerSellerClient,
  type SellerClientAttributionKind,
  type SellerClientLookup,
  type SellerClientPhoneClaim,
} from "@/lib/seller-clients";

type SellerClientRegistrationFlowProps = {
  onPhoneClaimed?: () => void;
  onRegistered?: () => void;
  mode?: "full" | "registration-only";
};

export function SellerClientRegistrationFlow({
  onPhoneClaimed,
  onRegistered,
  mode = "full",
}: SellerClientRegistrationFlowProps) {
  const [consultationPhone, setConsultationPhone] = useState("");
  const [claim, setClaim] = useState<SellerClientPhoneClaim | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [email, setEmail] = useState("");
  const [client, setClient] = useState<SellerClientLookup | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedNow, setConfirmedNow] = useState(false);
  const [registrationStep, setRegistrationStep] = useState<"confirm" | "relationship" | null>(null);
  const [attributionKind, setAttributionKind] = useState<SellerClientAttributionKind | null>(null);
  const lookupRequest = useRef(0);

  const normalizedEmail = email.trim().toLowerCase();
  const validEmail = isLikelyEmail(normalizedEmail);

  useEffect(() => {
    const requestId = ++lookupRequest.current;
    setClient(null);
    setLookupError(null);
    setConfirmedNow(false);
    setRegistrationStep(null);
    setAttributionKind(null);

    if (!validEmail) {
      setCheckingEmail(false);
      return;
    }

    setCheckingEmail(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await lookupSellerClientByEmail(normalizedEmail);
        if (lookupRequest.current === requestId) setClient(result);
      } catch (caught) {
        if (lookupRequest.current === requestId) {
          setLookupError(
            caught instanceof Error ? caught.message : "Não foi possível localizar o cliente.",
          );
        }
      } finally {
        if (lookupRequest.current === requestId) setCheckingEmail(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [normalizedEmail, validEmail]);

  async function checkPhone() {
    if (!isValidBrazilianPhone(consultationPhone)) {
      toast.error("Informe um telefone válido com DDD.");
      return;
    }
    setCheckingPhone(true);
    try {
      const result = await claimSellerClientPhone(consultationPhone);
      setConsultationPhone(result.phone_display);
      setClaim(result);
      if (result.outcome !== "in_use") onPhoneClaimed?.();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Não foi possível consultar o telefone.",
      );
    } finally {
      setCheckingPhone(false);
    }
  }

  async function confirmClient() {
    if (!client || client.link_status === "already_mine" || !attributionKind) return;
    setSubmitting(true);
    try {
      await registerSellerClient(client.email, attributionKind);
      setClient((current) =>
        current ? { ...current, link_status: "already_mine", linked_seller_name: null } : current,
      );
      setConfirmedNow(true);
      setRegistrationStep(null);
      toast.success(
        attributionKind === "apresentou"
          ? "Cliente apresentado e contabilizado no seu ranking."
          : "Cliente captado e contabilizado no seu ranking.",
      );
      onRegistered?.();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Não foi possível confirmar o cliente.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={mode === "registration-only" ? "" : "grid gap-4 lg:grid-cols-2"}>
      {mode === "full" && (
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <FlowHeading
            icon={Search}
            title="Consultar antes do atendimento"
            description="A consulta é independente do cadastro e reserva o telefone para você por 1 hora."
            dark
          />
          <Label
            htmlFor="consultation-phone"
            className="mt-5 block text-xs font-black uppercase tracking-widest text-neutral-600"
          >
            Telefone com DDD
          </Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <IconInput icon={Phone}>
              <Input
                id="consultation-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                maxLength={15}
                value={consultationPhone}
                onChange={(event) => {
                  setConsultationPhone(formatBrazilianPhoneInput(event.target.value));
                  setClaim(null);
                }}
                placeholder="(47) 99999-9999"
                className="h-11 border-0 bg-transparent pl-10 shadow-none focus-visible:ring-0"
                disabled={checkingPhone}
              />
            </IconInput>
            <Button
              type="button"
              className="h-11 gap-2 bg-neutral-950 px-5 text-white hover:bg-neutral-800"
              onClick={() => void checkPhone()}
              disabled={checkingPhone}
            >
              {checkingPhone ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {checkingPhone ? "Consultando" : "Verificar"}
            </Button>
          </div>
          {claim && <PhoneClaimNotice claim={claim} />}
        </section>
      )}

      <section className="rounded-2xl border border-yellow-300 bg-yellow-50/50 p-5 shadow-sm">
        <FlowHeading
          icon={UserRound}
          title="Cadastrar cliente de fato"
          description="Digite o e-mail do login NOX. O sistema confere o cadastro diretamente no banco, inclusive quando ainda aguarda aprovação, para você confirmar o vínculo."
        />
        <Label
          htmlFor="client-email"
          className="mt-5 block text-xs font-black uppercase tracking-widest text-neutral-600"
        >
          E-mail de login NOX
        </Label>
        <div className="mt-2">
          <IconInput icon={Mail}>
            <Input
              id="client-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="cliente@empresa.com.br"
              className="h-11 border-0 bg-transparent pl-10 pr-32 shadow-none focus-visible:ring-0"
              disabled={submitting}
            />
            <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 text-[11px] font-bold text-neutral-500">
              {checkingEmail && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              {checkingEmail ? "Buscando" : validEmail ? "Busca automática" : "Digite o e-mail"}
            </span>
          </IconInput>
        </div>

        {lookupError && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{lookupError}</span>
          </div>
        )}
        {client && (
          <ClientLookupCard
            client={client}
            confirmedNow={confirmedNow}
            submitting={submitting}
            onConfirm={() => setRegistrationStep("confirm")}
          />
        )}
      </section>

      <Dialog
        open={registrationStep !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            setRegistrationStep(null);
            setAttributionKind(null);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl">
          {registrationStep === "confirm" ? (
            <>
              <DialogHeader>
                <DialogTitle>Tem certeza de que deseja adicionar este cliente?</DialogTitle>
                <DialogDescription>
                  {client?.link_status === "linked_to_other"
                    ? "Ele já possui vínculo com outro profissional desta função. O vínculo atual será mantido e um novo será criado para você."
                    : "O cliente será incluído na sua carteira sem alterar os demais dados do cadastro."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRegistrationStep(null)}>
                  Não, cancelar
                </Button>
                <Button
                  type="button"
                  className="bg-neutral-950 text-white hover:bg-neutral-800"
                  onClick={() => setRegistrationStep("relationship")}
                >
                  Sim, continuar
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Você apresentou ou captou o cliente?</DialogTitle>
                <DialogDescription>
                  Selecione como esse relacionamento começou. A informação ficará registrada junto
                  ao vínculo manual.
                </DialogDescription>
              </DialogHeader>
              <RadioGroup
                value={attributionKind ?? ""}
                onValueChange={(value) => setAttributionKind(value as SellerClientAttributionKind)}
                className="gap-3"
              >
                <AttributionOption
                  value="apresentou"
                  title="Apresentei o cliente"
                  description="Você realizou a apresentação ou conectou o cliente à NOX."
                  icon={Send}
                />
                <AttributionOption
                  value="captou"
                  title="Captei o cliente"
                  description="Você prospectou e trouxe o cliente para a sua carteira."
                  icon={UserRoundPlus}
                />
              </RadioGroup>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => setRegistrationStep("confirm")}
                >
                  Voltar
                </Button>
                <Button
                  type="button"
                  className="gap-2 bg-neutral-950 text-white hover:bg-neutral-800"
                  disabled={!attributionKind || submitting}
                  onClick={() => void confirmClient()}
                >
                  {submitting && <RefreshCw className="h-4 w-4 animate-spin" />}
                  {submitting ? "Cadastrando" : "Confirmar cadastro"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {mode === "full" && (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-950 px-5 py-4 text-sm text-white lg:col-span-2">
          <strong className="text-yellow-300">Contabilização imediata:</strong> cada Vendedor e cada
          Closer pode confirmar o próprio vínculo com o mesmo cliente. A confirmação entra
          automaticamente no ranking da respectiva função como cadastro realizado.
        </div>
      )}
    </div>
  );
}

function ClientLookupCard({
  client,
  confirmedNow,
  submitting,
  onConfirm,
}: {
  client: SellerClientLookup;
  confirmedNow: boolean;
  submitting: boolean;
  onConfirm: () => void;
}) {
  const linkedElsewhere = client.link_status === "linked_to_other";
  const mine = client.link_status === "already_mine";
  const typeLabel =
    client.partner_type === "proprietario"
      ? "Proprietário"
      : client.partner_type === "imobiliaria"
        ? "Imobiliária"
        : client.partner_type === "corretor_autonomo"
          ? "Corretor autônomo"
          : "Cliente NOX";

  return (
    <div
      className={`mt-4 rounded-2xl border p-4 ${linkedElsewhere ? "border-amber-200 bg-amber-50" : mine ? "border-emerald-200 bg-emerald-50" : "border-yellow-300 bg-white"}`}
    >
      <div className="flex items-start gap-3">
        {linkedElsewhere ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        ) : (
          <CheckCircle2
            className={`mt-0.5 h-5 w-5 shrink-0 ${mine ? "text-emerald-600" : "text-yellow-600"}`}
          />
        )}
        <div>
          <p className="text-sm font-black text-neutral-950">
            {linkedElsewhere
              ? "Cliente já vinculado nesta função"
              : mine
                ? "Cliente já confirmado"
                : "Cliente encontrado"}
          </p>
          <p className="mt-1 text-xs leading-5 text-neutral-600">
            {linkedElsewhere
              ? `Este cadastro já pertence a ${client.linked_seller_name ?? "outro vendedor"} nesta mesma função. Você pode adicioná-lo também à sua carteira sem remover o vínculo existente.`
              : mine
                ? confirmedNow
                  ? "O vínculo foi confirmado e já entrou no seu ranking."
                  : "Este vínculo já consta nos seus cadastros e no seu ranking."
                : "Confira os dados abaixo antes de confirmar que este cliente é seu."}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <LookupField icon={UserRound} label="Usuário" value={client.full_name} />
        <LookupField icon={Building2} label="Tipo" value={typeLabel} />
        <LookupField icon={Building2} label="Cliente" value={client.partner_name} />
        <LookupField icon={Mail} label="E-mail" value={client.email} />
        {client.phone && <LookupField icon={Phone} label="Telefone" value={client.phone} />}
        {client.city && <LookupField icon={MapPin} label="Cidade" value={client.city} />}
      </div>

      {!mine && (
        <Button
          type="button"
          className="mt-4 h-11 w-full gap-2 bg-neutral-950 font-bold text-white hover:bg-neutral-800"
          onClick={onConfirm}
          disabled={submitting}
        >
          {submitting ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {submitting
            ? "Confirmando vínculo"
            : linkedElsewhere
              ? "Adicionar também à minha carteira"
              : "Adicionar cliente à minha carteira"}
        </Button>
      )}
    </div>
  );
}

function AttributionOption({
  value,
  title,
  description,
  icon: Icon,
}: {
  value: SellerClientAttributionKind;
  title: string;
  description: string;
  icon: typeof Send;
}) {
  return (
    <Label
      htmlFor={`attribution-${value}`}
      className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 p-4 transition-colors hover:border-yellow-400 hover:bg-yellow-50"
    >
      <RadioGroupItem id={`attribution-${value}`} value={value} className="mt-1" />
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-yellow-300 text-neutral-950">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-sm font-black text-neutral-950">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-neutral-500">{description}</span>
      </span>
    </Label>
  );
}

function LookupField({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-black/5 bg-white/80 px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-neutral-400" />
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-wider text-neutral-400">{label}</p>
        <p className="truncate text-xs font-bold text-neutral-800">{value}</p>
      </div>
    </div>
  );
}

function FlowHeading({
  icon: Icon,
  title,
  description,
  dark = false,
}: {
  icon: typeof Search;
  title: string;
  description: string;
  dark?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${dark ? "bg-neutral-950 text-yellow-300" : "bg-yellow-300 text-neutral-950"}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="font-black text-neutral-950">{title}</p>
        <p className="mt-1 text-xs leading-5 text-neutral-500">{description}</p>
      </div>
    </div>
  );
}

function PhoneClaimNotice({ claim }: { claim: SellerClientPhoneClaim }) {
  const conflict = claim.outcome === "in_use";
  const registered = claim.contact_status === "cadastrado";
  const mine = claim.outcome === "owned_by_me";
  const title = conflict
    ? `Esse número já está ${registered ? "cadastrado" : "em atendimento"} através do vendedor ${claim.seller_name}.`
    : registered
      ? "Esse número já está cadastrado com você."
      : mine
        ? "Esse número já está reservado para você."
        : "Pode continuar o atendimento.";

  return (
    <div
      className={`mt-4 flex items-start gap-3 rounded-xl border p-3 ${conflict ? "border-red-200 bg-red-50" : mine ? "border-blue-200 bg-blue-50" : "border-emerald-200 bg-emerald-50"}`}
    >
      {conflict ? (
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      ) : (
        <CheckCircle2
          className={`mt-0.5 h-5 w-5 shrink-0 ${mine ? "text-blue-600" : "text-emerald-600"}`}
        />
      )}
      <div>
        <p
          className={`text-sm font-black ${conflict ? "text-red-800" : mine ? "text-blue-800" : "text-emerald-800"}`}
        >
          {title}
        </p>
        <p className="mt-1 text-xs leading-5 text-neutral-600">
          {conflict ? (
            "Não inicie outro contato para evitar atendimento duplicado."
          ) : registered ? (
            "O vínculo definitivo continua protegido no banco."
          ) : (
            <>
              A reserva aparece no seu histórico e vence às{" "}
              <strong>{formatTime(claim.expires_at)}</strong> se o cadastro não for concluído.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function IconInput({ icon: Icon, children }: { icon: typeof Phone; children: ReactNode }) {
  return (
    <div className="relative flex-1 rounded-md border border-neutral-200 bg-white">
      <Icon className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-neutral-400" />
      {children}
    </div>
  );
}
