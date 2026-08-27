import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Home,
  Loader2,
  MapPin,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import CurrencyInput from "react-currency-input-field";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createOwnerProperty,
  EMPTY_OWNER_PROPERTY,
  normalizeCep,
  ownerPropertyTotalCents,
  validateOwnerProperty,
  type OwnerPropertyDraft,
} from "@/lib/owner-property";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const Route = createFileRoute("/cadastrar-imovel")({
  component: () => (
    <ProtectedRoute>
      <RegisterPropertyPage />
    </ProtectedRoute>
  ),
});

function RegisterPropertyPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<OwnerPropertyDraft>(EMPTY_OWNER_PROPERTY);
  const [saving, setSaving] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function update<K extends keyof OwnerPropertyDraft>(key: K, value: OwnerPropertyDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  async function lookupCep() {
    const cep = draft.cep.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setLookingUpCep(true);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const address = await response.json();
      if (!response.ok || address.erro) return;
      setDraft((current) => ({
        ...current,
        street: address.logradouro || current.street,
        neighborhood: address.bairro || current.neighborhood,
        city: address.localidade || current.city,
        state: address.uf || current.state,
      }));
    } catch {
      // A busca do CEP e apenas uma conveniencia; o preenchimento manual continua disponivel.
    } finally {
      setLookingUpCep(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateOwnerProperty(draft);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createOwnerProperty(draft);
      toast.success("Imóvel cadastrado com sucesso.");
      await navigate({ to: "/imoveis" });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível cadastrar o imóvel.");
    } finally {
      setSaving(false);
    }
  }

  const monthlyTotal = ownerPropertyTotalCents(draft);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1120px]">
        <Link
          to="/imoveis"
          className="inline-flex items-center gap-2 text-xs font-bold text-neutral-500 transition hover:text-neutral-950"
        >
          <ArrowLeft size={15} /> Voltar para meus imóveis
        </Link>

        <div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-500">
              Patrimônio
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-neutral-950">
              Cadastrar imóvel
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              Informe o endereço e os valores mensais vinculados ao imóvel.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">
            <ShieldCheck size={17} /> Cadastro protegido e vinculado à sua conta
          </div>
        </div>

        <form onSubmit={submit} className="mt-6 grid items-start gap-5 xl:grid-cols-[1fr_310px]">
          <div className="space-y-5">
            <Section
              icon={MapPin}
              title="Endereço do imóvel"
              description="Preencha a localização completa."
            >
              <div className="grid gap-4 sm:grid-cols-6">
                <div className="sm:col-span-2">
                  <Input
                    label="CEP *"
                    value={draft.cep}
                    onChange={(event) => update("cep", normalizeCep(event.target.value))}
                    onBlur={() => void lookupCep()}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    placeholder="00000-000"
                    maxLength={9}
                  />
                  {lookingUpCep && (
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-neutral-400">
                      <Loader2 size={10} className="animate-spin" /> Buscando endereço
                    </span>
                  )}
                </div>
                <div className="sm:col-span-4">
                  <Input
                    label="Logradouro *"
                    value={draft.street}
                    onChange={(event) => update("street", event.target.value)}
                    autoComplete="address-line1"
                    placeholder="Rua, avenida..."
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    label="Número *"
                    value={draft.number}
                    onChange={(event) => update("number", event.target.value)}
                    placeholder="123"
                  />
                </div>
                <div className="sm:col-span-4">
                  <Input
                    label="Complemento"
                    value={draft.complement}
                    onChange={(event) => update("complement", event.target.value)}
                    autoComplete="address-line2"
                    placeholder="Apartamento, bloco..."
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    label="Bairro *"
                    value={draft.neighborhood}
                    onChange={(event) => update("neighborhood", event.target.value)}
                    placeholder="Bairro"
                  />
                </div>
                <div className="sm:col-span-3">
                  <Input
                    label="Cidade *"
                    value={draft.city}
                    onChange={(event) => update("city", event.target.value)}
                    autoComplete="address-level2"
                    placeholder="Cidade"
                  />
                </div>
                <div className="sm:col-span-1">
                  <Input
                    label="UF *"
                    value={draft.state}
                    onChange={(event) =>
                      update("state", event.target.value.toUpperCase().slice(0, 2))
                    }
                    autoComplete="address-level1"
                    placeholder="SP"
                    maxLength={2}
                  />
                </div>
              </div>
            </Section>

            <Section
              icon={ReceiptText}
              title="Valores mensais"
              description="Cadastre o aluguel e os encargos aplicáveis."
            >
              <MoneyField
                label="Valor do aluguel *"
                valueCents={draft.rentCents}
                onChangeCents={(value) => update("rentCents", value)}
              />

              <ToggleRow
                label="Possui condomínio?"
                description="Inclua condomínio, fundo de reserva e taxa de lixo."
                checked={draft.hasCondominium}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    hasCondominium: checked,
                    ...(!checked
                      ? { condominiumCents: 0, reserveFundCents: 0, garbageFeeCents: 0 }
                      : {}),
                  }))
                }
              />
              {draft.hasCondominium && (
                <div className="grid gap-4 rounded-xl bg-neutral-50 p-4 sm:grid-cols-3">
                  <MoneyField
                    label="Condomínio *"
                    valueCents={draft.condominiumCents}
                    onChangeCents={(value) => update("condominiumCents", value)}
                  />
                  <MoneyField
                    label="Fundo de reserva"
                    valueCents={draft.reserveFundCents}
                    onChangeCents={(value) => update("reserveFundCents", value)}
                  />
                  <MoneyField
                    label="Taxa de lixo"
                    valueCents={draft.garbageFeeCents}
                    onChangeCents={(value) => update("garbageFeeCents", value)}
                  />
                </div>
              )}

              <ToggleRow
                label="Possui IPTU?"
                description="Informe o valor mensal do IPTU, se houver."
                checked={draft.hasIptu}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    hasIptu: checked,
                    ...(!checked ? { iptuCents: 0 } : {}),
                  }))
                }
              />
              {draft.hasIptu && (
                <div className="rounded-xl bg-neutral-50 p-4 sm:max-w-xs">
                  <MoneyField
                    label="Valor mensal do IPTU *"
                    valueCents={draft.iptuCents}
                    onChangeCents={(value) => update("iptuCents", value)}
                  />
                </div>
              )}
            </Section>
          </div>

          <aside className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm xl:sticky xl:top-24">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-50 text-amber-500">
              <Home size={21} />
            </div>
            <h2 className="mt-4 text-base font-black text-neutral-950">Resumo do cadastro</h2>
            <div className="mt-5 space-y-3 text-xs">
              <SummaryLine label="Aluguel" value={draft.rentCents} />
              {draft.hasCondominium && (
                <>
                  <SummaryLine label="Condomínio" value={draft.condominiumCents} />
                  <SummaryLine label="Fundo de reserva" value={draft.reserveFundCents} />
                  <SummaryLine label="Taxa de lixo" value={draft.garbageFeeCents} />
                </>
              )}
              {draft.hasIptu && <SummaryLine label="IPTU" value={draft.iptuCents} />}
            </div>
            <div className="mt-5 border-t border-neutral-100 pt-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                Custo mensal informado
              </p>
              <p className="mt-1 text-2xl font-black text-neutral-950">
                {BRL.format(monthlyTotal / 100)}
              </p>
            </div>
            {formError && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-medium text-red-700"
              >
                {formError}
              </div>
            )}
            <Button
              type="submit"
              disabled={saving}
              className="mt-5 h-11 w-full rounded-xl bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-500"
            >
              {saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {saving ? "Salvando..." : "Cadastrar imóvel"}
            </Button>
            <Button asChild variant="ghost" className="mt-2 w-full rounded-xl text-neutral-500">
              <Link to="/imoveis">Cancelar</Link>
            </Button>
          </aside>
        </form>
      </div>
    </DashboardLayout>
  );
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-start gap-3 border-b border-neutral-100 pb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-50 text-amber-500">
          <Icon size={19} />
        </div>
        <div>
          <h2 className="text-base font-black text-neutral-950">{title}</h2>
          <p className="mt-1 text-xs text-neutral-500">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function MoneyField({
  label,
  valueCents,
  onChangeCents,
}: {
  label: string;
  valueCents: number;
  onChangeCents: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-neutral-700">{label}</Label>
      <CurrencyInput
        prefix="R$ "
        decimalsLimit={2}
        decimalSeparator=","
        groupSeparator="."
        value={valueCents ? valueCents / 100 : ""}
        onValueChange={(_, _name, values) =>
          onChangeCents(Math.max(0, Math.round((values?.float || 0) * 100)))
        }
        inputMode="decimal"
        autoComplete="off"
        placeholder="R$ 0,00"
        className="flex h-9 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
      />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 p-4">
      <div>
        <Label className="text-sm font-bold text-neutral-900">{label}</Label>
        <p className="mt-1 text-xs text-neutral-500">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-neutral-500">{label}</span>
      <span className="font-bold text-neutral-900">{BRL.format(value / 100)}</span>
    </div>
  );
}
