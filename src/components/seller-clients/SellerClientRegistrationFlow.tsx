import { useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  claimSellerClientPhone,
  formatBrazilianPhoneInput,
  isValidBrazilianPhone,
  registerSellerClient,
  type SellerClientPhoneClaim,
} from "@/lib/seller-clients";

type PartnerType = "corretor" | "imobiliaria";

type SellerClientRegistrationFlowProps = {
  onPhoneClaimed: () => void;
  onRegistered: () => void;
};

export function SellerClientRegistrationFlow({ onPhoneClaimed, onRegistered }: SellerClientRegistrationFlowProps) {
  const [consultationPhone, setConsultationPhone] = useState("");
  const [claim, setClaim] = useState<SellerClientPhoneClaim | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [email, setEmail] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [registrationPhone, setRegistrationPhone] = useState("");
  const [partnerType, setPartnerType] = useState<PartnerType | "">("");
  const [agencyName, setAgencyName] = useState("");
  const [brokerName, setBrokerName] = useState("");
  const [city, setCity] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      if (result.outcome !== "in_use") onPhoneClaimed();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Não foi possível consultar o telefone.");
    } finally {
      setCheckingPhone(false);
    }
  }

  function openDetails() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      toast.error("Informe o e-mail usado pelo cliente no login NOX.");
      return;
    }
    setEmail(normalizedEmail);
    setDetailsOpen(true);
  }

  function resetRegistration() {
    setEmail("");
    setDetailsOpen(false);
    setRegistrationPhone("");
    setPartnerType("");
    setAgencyName("");
    setBrokerName("");
    setCity("");
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidBrazilianPhone(registrationPhone)) {
      toast.error("Informe o telefone do cliente com DDD.");
      return;
    }
    if (!partnerType) {
      toast.error("Selecione Corretor ou Imobiliária.");
      return;
    }
    if (!brokerName.trim()) {
      toast.error("Informe o nome do corretor ou responsável.");
      return;
    }
    if (partnerType === "imobiliaria" && !agencyName.trim()) {
      toast.error("Informe o nome da imobiliária.");
      return;
    }
    if (!city.trim()) {
      toast.error("Informe a cidade do cliente.");
      return;
    }

    setSubmitting(true);
    try {
      await registerSellerClient({
        email,
        phone: registrationPhone,
        partnerType,
        agencyName: agencyName.trim(),
        brokerName: brokerName.trim(),
        city: city.trim(),
      });
      toast.success("Cliente cadastrado e produção vinculada.");
      resetRegistration();
      onRegistered();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Não foi possível cadastrar o cliente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <FlowHeading icon={Search} title="Consultar antes do atendimento" description="A consulta é independente do cadastro e reserva o telefone para você por 1 hora." dark />
        <Label htmlFor="consultation-phone" className="mt-5 block text-xs font-black uppercase tracking-widest text-neutral-600">Telefone com DDD</Label>
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
          <Button type="button" className="h-11 gap-2 bg-neutral-950 px-5 text-white hover:bg-neutral-800" onClick={() => void checkPhone()} disabled={checkingPhone}>
            {checkingPhone ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {checkingPhone ? "Consultando" : "Verificar"}
          </Button>
        </div>
        {claim && <PhoneClaimNotice claim={claim} />}
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <FlowHeading icon={UserRound} title="Cadastrar cliente de fato" description="Comece pelo e-mail quando o cliente decidir seguir. Esta etapa não depende da consulta ao lado." />
        <Label htmlFor="client-email" className="mt-5 block text-xs font-black uppercase tracking-widest text-neutral-600">E-mail de login NOX</Label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <IconInput icon={Mail}>
            <Input
              id="client-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setDetailsOpen(false);
              }}
              placeholder="cliente@empresa.com.br"
              className="h-11 border-0 bg-transparent pl-10 shadow-none focus-visible:ring-0"
              disabled={submitting}
            />
          </IconInput>
          <Button type="button" variant="outline" className="h-11 font-bold" onClick={openDetails} disabled={submitting}>Continuar cadastro</Button>
        </div>
      </section>

      {detailsOpen && (
        <form onSubmit={submitDetails} className="space-y-4 rounded-2xl border border-yellow-300 bg-yellow-50/80 p-5 shadow-sm lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-base font-black text-neutral-950">Complete as informações do cliente</p>
              <p className="mt-1 text-xs text-neutral-500">O telefone será validado novamente no banco no momento exato do cadastro.</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDetailsOpen(false)}>Fechar</Button>
          </div>

          <fieldset>
            <legend className="text-xs font-black uppercase tracking-widest text-neutral-600">Corretor ou imobiliária</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <TypeButton active={partnerType === "corretor"} icon={UserRound} label="Corretor" onClick={() => setPartnerType("corretor")} />
              <TypeButton active={partnerType === "imobiliaria"} icon={Building2} label="Imobiliária" onClick={() => setPartnerType("imobiliaria")} />
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReadOnlyField label="E-mail" value={email} icon={Mail} />
            <FormField id="registration-phone" label="Telefone com DDD" value={registrationPhone} onChange={(value) => setRegistrationPhone(formatBrazilianPhoneInput(value))} placeholder="(47) 99999-9999" icon={Phone} disabled={submitting} />
            <FormField id="broker-name" label="Nome do corretor ou responsável" value={brokerName} onChange={setBrokerName} placeholder="Nome completo" icon={UserRound} disabled={submitting} />
            <FormField id="agency-name" label={partnerType === "imobiliaria" ? "Nome da imobiliária" : "Imobiliária (opcional)"} value={agencyName} onChange={setAgencyName} placeholder={partnerType === "corretor" ? "Autônomo / não possui" : "Nome da empresa"} icon={Building2} disabled={submitting} />
            <FormField id="client-city" label="Cidade do cliente" value={city} onChange={setCity} placeholder="Ex.: Blumenau" icon={MapPin} disabled={submitting} />
          </div>

          <Button type="submit" className="h-11 w-full gap-2 bg-neutral-950 font-bold text-white hover:bg-neutral-800" disabled={submitting}>
            {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {submitting ? "Cadastrando cliente" : "Finalizar cadastro"}
          </Button>
        </form>
      )}
    </div>
  );
}

function FlowHeading({ icon: Icon, title, description, dark = false }: { icon: typeof Search; title: string; description: string; dark?: boolean }) {
  return <div className="flex items-start gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${dark ? "bg-neutral-950 text-yellow-300" : "bg-yellow-300 text-neutral-950"}`}><Icon className="h-5 w-5" /></div><div><p className="font-black text-neutral-950">{title}</p><p className="mt-1 text-xs leading-5 text-neutral-500">{description}</p></div></div>;
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
    <div className={`mt-4 flex items-start gap-3 rounded-xl border p-3 ${conflict ? "border-red-200 bg-red-50" : mine ? "border-blue-200 bg-blue-50" : "border-emerald-200 bg-emerald-50"}`}>
      {conflict ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /> : <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${mine ? "text-blue-600" : "text-emerald-600"}`} />}
      <div>
        <p className={`text-sm font-black ${conflict ? "text-red-800" : mine ? "text-blue-800" : "text-emerald-800"}`}>{title}</p>
        <p className="mt-1 text-xs leading-5 text-neutral-600">
          {conflict
            ? "Não inicie outro contato para evitar atendimento duplicado."
            : registered
              ? "O vínculo definitivo continua protegido no banco."
              : <>A reserva aparece no seu histórico e vence às <strong>{formatTime(claim.expires_at)}</strong> se o cadastro não for concluído.</>}
        </p>
      </div>
    </div>
  );
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function IconInput({ icon: Icon, children }: { icon: typeof Phone; children: ReactNode }) {
  return <div className="relative flex-1 rounded-md border border-neutral-200 bg-white"><Icon className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-neutral-400" />{children}</div>;
}

function TypeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof UserRound; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold transition ${active ? "border-neutral-950 bg-neutral-950 text-yellow-300" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"}`}><Icon className="h-4 w-4" />{label}</button>;
}

function ReadOnlyField({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Mail }) {
  return <div><Label className="text-[11px] font-black uppercase tracking-wider text-neutral-500">{label}</Label><div className="mt-1.5 flex h-11 items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-100 px-3"><Icon className="h-4 w-4 text-neutral-400" /><span className="min-w-0 truncate text-sm font-medium text-neutral-600">{value}</span></div></div>;
}

function FormField({ id, label, value, onChange, placeholder, icon: Icon, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string; icon: typeof UserRound; disabled: boolean }) {
  return <div><Label htmlFor={id} className="text-[11px] font-black uppercase tracking-wider text-neutral-500">{label}</Label><div className="relative mt-1.5"><Icon className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-neutral-400" /><Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} className="h-11 pl-9" /></div></div>;
}
