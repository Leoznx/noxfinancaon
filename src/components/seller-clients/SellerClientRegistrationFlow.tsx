import { useState } from "react";
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

export function SellerClientRegistrationFlow({
  onPhoneClaimed,
  onRegistered,
}: SellerClientRegistrationFlowProps) {
  const [phone, setPhone] = useState("");
  const [claim, setClaim] = useState<SellerClientPhoneClaim | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [email, setEmail] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [partnerType, setPartnerType] = useState<PartnerType | "">("");
  const [agencyName, setAgencyName] = useState("");
  const [brokerName, setBrokerName] = useState("");
  const [city, setCity] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canContinue = claim?.outcome === "available" || claim?.outcome === "owned_by_me";

  function resetAfterPhoneChange(nextPhone: string) {
    setPhone(formatBrazilianPhoneInput(nextPhone));
    setClaim(null);
    setEmail("");
    setDetailsOpen(false);
    setPartnerType("");
    setAgencyName("");
    setBrokerName("");
    setCity("");
  }

  async function checkPhone() {
    if (!isValidBrazilianPhone(phone)) {
      toast.error("Informe um telefone válido com DDD.");
      return;
    }

    setCheckingPhone(true);
    try {
      const result = await claimSellerClientPhone(phone);
      setPhone(result.phone_display);
      setClaim(result);
      if (result.outcome === "in_use") {
        setEmail("");
        setDetailsOpen(false);
      } else {
        onPhoneClaimed();
      }
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

  async function submitDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        phone,
        partnerType,
        agencyName: agencyName.trim(),
        brokerName: brokerName.trim(),
        city: city.trim(),
      });
      toast.success("Cliente cadastrado e produção vinculada.");
      setPhone("");
      setClaim(null);
      setEmail("");
      setDetailsOpen(false);
      setPartnerType("");
      setAgencyName("");
      setBrokerName("");
      setCity("");
      onRegistered();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Não foi possível cadastrar o cliente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <div>
        <Label htmlFor="client-phone" className="text-xs font-black uppercase tracking-widest text-neutral-600">
          1. Telefone com DDD
        </Label>
        <p className="mt-1 text-xs text-neutral-500">Consulte antes de iniciar o atendimento.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Phone className="absolute left-3 top-3 h-5 w-5 text-neutral-400" aria-hidden="true" />
            <Input
              id="client-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              maxLength={15}
              value={phone}
              onChange={(event) => resetAfterPhoneChange(event.target.value)}
              placeholder="(47) 99999-9999"
              className="h-11 pl-10"
              disabled={checkingPhone || submitting}
            />
          </div>
          <Button
            type="button"
            className="h-11 gap-2 bg-neutral-950 px-5 text-white hover:bg-neutral-800"
            onClick={() => void checkPhone()}
            disabled={checkingPhone || submitting}
          >
            {checkingPhone ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {checkingPhone ? "Consultando" : "Verificar"}
          </Button>
        </div>
      </div>

      {claim && <PhoneClaimNotice claim={claim} />}

      {canContinue && (
        <div className="mt-5 border-t border-neutral-200 pt-5">
          <Label htmlFor="client-email" className="text-xs font-black uppercase tracking-widest text-neutral-600">
            2. E-mail de login NOX
          </Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-3 h-5 w-5 text-neutral-400" aria-hidden="true" />
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
                className="h-11 pl-10"
                disabled={submitting}
              />
            </div>
            <Button type="button" variant="outline" className="h-11 font-bold" onClick={openDetails} disabled={submitting}>
              Continuar cadastro
            </Button>
          </div>
        </div>
      )}

      {canContinue && detailsOpen && (
        <form onSubmit={submitDetails} className="mt-5 space-y-4 rounded-2xl border border-yellow-300 bg-yellow-50/70 p-4">
          <div>
            <p className="text-sm font-black text-neutral-950">3. Complete as informações do cliente</p>
            <p className="mt-1 text-xs text-neutral-500">O e-mail e o telefone confirmados já foram preenchidos.</p>
          </div>

          <fieldset>
            <legend className="text-xs font-black uppercase tracking-widest text-neutral-600">Tipo de cliente</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <TypeButton
                active={partnerType === "corretor"}
                icon={UserRound}
                label="Corretor"
                onClick={() => setPartnerType("corretor")}
              />
              <TypeButton
                active={partnerType === "imobiliaria"}
                icon={Building2}
                label="Imobiliária"
                onClick={() => setPartnerType("imobiliaria")}
              />
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <ReadOnlyField label="E-mail" value={email} icon={Mail} />
            <ReadOnlyField label="Telefone" value={phone} icon={Phone} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id="broker-name"
              label="Nome do corretor ou responsável"
              value={brokerName}
              onChange={setBrokerName}
              placeholder="Nome completo"
              icon={UserRound}
              disabled={submitting}
            />
            <FormField
              id="agency-name"
              label={partnerType === "imobiliaria" ? "Nome da imobiliária" : "Imobiliária (opcional)"}
              value={agencyName}
              onChange={setAgencyName}
              placeholder={partnerType === "corretor" ? "Autônomo / não possui" : "Nome da empresa"}
              icon={Building2}
              disabled={submitting}
            />
          </div>

          <FormField
            id="client-city"
            label="Cidade onde o cliente está localizado"
            value={city}
            onChange={setCity}
            placeholder="Ex.: Blumenau"
            icon={MapPin}
            disabled={submitting}
          />

          <Button type="submit" className="h-11 w-full gap-2 bg-neutral-950 text-white hover:bg-neutral-800" disabled={submitting}>
            {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {submitting ? "Cadastrando cliente..." : "Finalizar cadastro"}
          </Button>
        </form>
      )}
    </div>
  );
}

function PhoneClaimNotice({ claim }: { claim: SellerClientPhoneClaim }) {
  const conflict = claim.outcome === "in_use";
  const mine = claim.outcome === "owned_by_me";
  return (
    <div
      role="status"
      className={`mt-4 flex items-start gap-3 rounded-xl border p-4 ${
        conflict
          ? "border-red-200 bg-red-50 text-red-900"
          : mine
            ? "border-blue-200 bg-blue-50 text-blue-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
    >
      {conflict ? (
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      )}
      <div>
        <p className="text-sm font-black">
          {conflict
            ? `Esse número já está em atendimento através do vendedor ${claim.seller_name}.`
            : mine
              ? "Esse número já está no seu atendimento."
              : "Pode continuar o atendimento."}
        </p>
        <p className="mt-1 text-xs font-medium opacity-80">
          {conflict
            ? "Não inicie um novo contato para evitar atendimento duplicado."
            : "O telefone já aparece no seu histórico e será sinalizado aos outros vendedores que consultarem o mesmo número."}
        </p>
      </div>
    </div>
  );
}

function TypeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof UserRound;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-black transition ${
        active
          ? "border-neutral-950 bg-neutral-950 text-yellow-300"
          : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function ReadOnlyField({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Mail }) {
  return (
    <div>
      <Label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">{label}</Label>
      <div className="mt-1 flex h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white/70 px-3 text-sm font-semibold text-neutral-600">
        <Icon className="h-4 w-4 text-neutral-400" aria-hidden="true" />
        <span className="min-w-0 truncate">{value}</span>
      </div>
    </div>
  );
}

function FormField({
  id,
  label,
  value,
  onChange,
  placeholder,
  icon: Icon,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon: typeof UserRound;
  disabled: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-[10px] font-black uppercase tracking-widest text-neutral-500">{label}</Label>
      <div className="relative mt-1">
        <Icon className="absolute left-3 top-3 h-4 w-4 text-neutral-400" aria-hidden="true" />
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-10 bg-white pl-9"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
