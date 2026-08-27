import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2, Home, MapPin, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";

type PropertyRow = {
  id: string;
  endereco: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  tipo: string;
  valor_aluguel: number;
  active: boolean;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const Route = createFileRoute("/imoveis")({
  component: () => (
    <ProtectedRoute>
      <PropertiesPage />
    </ProtectedRoute>
  ),
});

function PropertiesPage() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError(null);
    try {
      const { data: owners, error: ownerError } = await supabase
        .from("proprietarios")
        .select("id")
        .eq("profile_id", user.id);
      if (ownerError) throw ownerError;
      const ownerIds = (owners ?? []).map((owner) => owner.id);
      if (!ownerIds.length) {
        setProperties([]);
        return;
      }

      const { data: propertyRows, error: propertyError } = await supabase
        .from("imoveis")
        .select("id, endereco, logradouro, numero, bairro, cidade, estado, tipo, valor_aluguel")
        .in("proprietario_id", ownerIds)
        .order("created_at", { ascending: false });
      if (propertyError) throw propertyError;

      const ids = (propertyRows ?? []).map((property) => property.id);
      const activeIds = new Set<string>();
      if (ids.length) {
        const { data: consultations, error: consultationError } = await supabase
          .from("consultas_credito")
          .select("id, imovel_id")
          .in("imovel_id", ids);
        if (consultationError) throw consultationError;
        const consultationIds = (consultations ?? []).map((consultation) => consultation.id);
        if (consultationIds.length) {
          const { data: policies, error: policyError } = await supabase
            .from("apolices")
            .select("consulta_id")
            .in("consulta_id", consultationIds)
            .in("status", ["ativa", "active"]);
          if (policyError) throw policyError;
          const activeConsultations = new Set((policies ?? []).map((policy) => policy.consulta_id));
          for (const consultation of consultations ?? []) {
            if (activeConsultations.has(consultation.id)) activeIds.add(consultation.imovel_id);
          }
        }
      }

      setProperties(
        (propertyRows ?? []).map((property) => ({
          ...property,
          active: activeIds.has(property.id),
        })),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Não foi possível carregar seus imóveis.",
      );
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = useMemo(
    () => properties.filter((property) => property.active).length,
    [properties],
  );

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1280px]">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-500">
              Patrimônio
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-neutral-950">
              Meus imóveis
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              Imóveis vinculados ao seu cadastro de proprietário.
            </p>
          </div>
          <Button asChild className="rounded-xl bg-neutral-950 text-white hover:bg-neutral-800">
            <Link to="/cadastrar-imovel">
              <Plus size={16} /> Cadastrar imóvel
            </Link>
          </Button>
        </div>

        {!loading && !error && properties.length > 0 && (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Metric label="Imóveis cadastrados" value={properties.length} />
            <Metric label="Com contrato ativo" value={activeCount} />
            <Metric label="Sem contrato ativo" value={properties.length - activeCount} />
          </div>
        )}

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-52 animate-pulse rounded-2xl border border-neutral-200 bg-white"
              />
            ))}
          </div>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-red-100 bg-white p-10 text-center">
            <p className="font-bold text-neutral-900">Não foi possível carregar seus imóveis.</p>
            <p className="mt-2 text-sm text-neutral-500">{error}</p>
            <Button onClick={() => void load()} variant="outline" className="mt-5 gap-2 rounded-xl">
              <RefreshCw size={15} /> Tentar novamente
            </Button>
          </div>
        ) : properties.length === 0 ? (
          <div className="mt-6 flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-white p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-yellow-50 text-amber-500">
              <Home size={28} />
            </div>
            <h2 className="mt-5 text-lg font-bold text-neutral-900">
              Você ainda não possui imóveis cadastrados.
            </h2>
            <p className="mt-2 max-w-md text-sm text-neutral-500">
              Cadastre seu primeiro imóvel para acompanhar seu patrimônio e iniciar contratos.
            </p>
            <Button
              asChild
              className="mt-6 rounded-xl bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-500"
            >
              <Link to="/cadastrar-imovel">
                Cadastrar imóvel <ArrowRight size={15} />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {properties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{label}</p>
      <p className="mt-2 text-2xl font-black text-neutral-950">{value}</p>
    </div>
  );
}

function PropertyCard({ property }: { property: PropertyRow }) {
  const title =
    property.endereco ||
    [property.logradouro, property.numero].filter(Boolean).join(", ") ||
    "Imóvel sem endereço";
  const location = [property.bairro, property.cidade, property.estado].filter(Boolean).join(", ");
  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_28px_rgba(18,18,18,0.04)]">
      <div className="flex h-24 items-center justify-between bg-gradient-to-br from-[#fff8dc] to-[#fffdf5] px-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-amber-500 shadow-sm">
          <Building2 size={23} />
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[10px] font-bold ${property.active ? "bg-emerald-100 text-emerald-700" : "bg-white text-neutral-500"}`}
        >
          {property.active ? "Contrato ativo" : "Disponível"}
        </span>
      </div>
      <div className="p-5">
        <h2 className="truncate text-sm font-bold text-neutral-950" title={title}>
          {title}
        </h2>
        <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-neutral-500">
          <MapPin size={13} className="shrink-0" />
          {location || "Localização não informada"}
        </p>
        <div className="mt-5 flex items-end justify-between border-t border-neutral-100 pt-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">
              Valor do aluguel
            </p>
            <p className="mt-1 text-base font-black text-neutral-950">
              {BRL.format(Number(property.valor_aluguel || 0))}
            </p>
          </div>
          <span className="rounded-lg bg-neutral-50 px-2.5 py-1.5 text-[10px] font-semibold capitalize text-neutral-500">
            {property.tipo}
          </span>
        </div>
      </div>
    </article>
  );
}
