import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  Copy,
  Home,
  Link2,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Send,
  UserRound,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  buildSellerSignupUrl,
  fetchSellerSignupLinks,
  fetchSignupLinkSdrs,
  type SellerSignupLink,
  type SellerSignupRole,
  type SignupLinkSdr,
} from "@/lib/seller-signup-links";
import { getSellerContext, type SellerType } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/enviar-link")({
  component: () => (
    <ProtectedRoute roles={["vendedor"]} sellerTypes={["sdr", "closer"]}>
      <EnviarLinkPage />
    </ProtectedRoute>
  ),
});

const ROLE_CONFIG: Record<
  SellerSignupRole,
  { title: string; description: string; icon: typeof Home; messageLabel: string }
> = {
  proprietario: {
    title: "Proprietário",
    description: "Cadastro de quem quer proteger o aluguel do próprio imóvel.",
    icon: Home,
    messageLabel: "proprietário",
  },
  imobiliaria: {
    title: "Imobiliária",
    description: "Cadastro completo da empresa e do responsável.",
    icon: Building2,
    messageLabel: "imobiliária",
  },
  corretor: {
    title: "Corretor",
    description: "Cadastro do corretor autônomo ou vinculado a uma imobiliária.",
    icon: UserRound,
    messageLabel: "corretor",
  },
};

function EnviarLinkPage() {
  const [sellerType, setSellerType] = useState<SellerType | null>(null);
  const [links, setLinks] = useState<SellerSignupLink[]>([]);
  const [sdrs, setSdrs] = useState<SignupLinkSdr[]>([]);
  const [sharedWithSdr, setSharedWithSdr] = useState(false);
  const [selectedSdrId, setSelectedSdrId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [error, setError] = useState("");
  const [copiedRole, setCopiedRole] = useState<SellerSignupRole | null>(null);

  const loadLinks = useCallback(async (sourceSdrId: string | null) => {
    setLoadingLinks(true);
    setError("");
    try {
      setLinks(await fetchSellerSignupLinks(sourceSdrId));
    } catch (cause) {
      setLinks([]);
      setError(cause instanceof Error ? cause.message : "Não foi possível gerar os links.");
    } finally {
      setLoadingLinks(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const context = await getSellerContext();
        if (!context.isSeller || !context.sellerType)
          throw new Error("Sua conta comercial ainda não está ativa.");
        const availableSdrs = context.sellerType === "closer" ? await fetchSignupLinkSdrs() : [];
        if (cancelled) return;
        setSellerType(context.sellerType);
        setSdrs(availableSdrs);
        await loadLinks(null);
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Não foi possível abrir seus links.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLinks]);

  const selectedSdr = useMemo(
    () => sdrs.find((sdr) => sdr.id === selectedSdrId) ?? null,
    [sdrs, selectedSdrId],
  );

  function changeSharedMode(checked: boolean) {
    setSharedWithSdr(checked);
    setSelectedSdrId("");
    if (checked) {
      setLinks([]);
      setError("");
    } else {
      void loadLinks(null);
    }
  }

  function selectSdr(id: string) {
    setSelectedSdrId(id);
    void loadLinks(id);
  }

  async function copyLink(role: SellerSignupRole, url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedRole(role);
    toast.success("Link de cadastro copiado.");
    window.setTimeout(() => setCopiedRole((current) => (current === role ? null : current)), 1800);
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="grid min-h-[55vh] place-items-center">
          <LoaderCircle className="h-8 w-8 animate-spin text-yellow-500" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <main className="space-y-5">
        <section className="relative overflow-hidden rounded-[26px] bg-neutral-950 p-6 text-white shadow-xl sm:p-8">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-yellow-400/20 blur-3xl" />
          <div className="relative">
            <Badge className="border-0 bg-yellow-400 px-3 py-1.5 font-black text-neutral-950">
              <Send className="mr-1.5 h-4 w-4" /> ENVIAR LINK
            </Badge>
            <h1 className="mt-4 max-w-3xl text-3xl font-black tracking-[-0.04em] sm:text-4xl">
              Três cadastros, um vínculo <span className="text-yellow-400">automático.</span>
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-300 sm:text-base">
              Escolha o perfil e envie. Quando o cliente concluir o cadastro normal da NOX, ele
              entra no seu ranking e você recebe o aviso por e-mail e no sininho.
            </p>
          </div>
        </section>

        {sellerType === "closer" && (
          <Card className="overflow-hidden border-yellow-300 bg-yellow-50/60">
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-yellow-400 text-neutral-950">
                    <UsersRound className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-black text-neutral-950">
                      Este cliente veio de reunião de um SDR?
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                      Ative antes de copiar o link. O cadastro será contabilizado uma vez para você
                      e uma vez para o SDR que encaminhou a reunião.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-yellow-300 bg-white px-4 py-3">
                  <span className="text-sm font-black">{sharedWithSdr ? "Sim" : "Não"}</span>
                  <Switch
                    checked={sharedWithSdr}
                    onCheckedChange={changeSharedMode}
                    className="data-[state=checked]:bg-yellow-400"
                    aria-label="Compartilhar cadastro com SDR"
                  />
                </div>
              </div>

              {sharedWithSdr && (
                <div className="mt-5 max-w-xl">
                  <label className="mb-2 block text-xs font-black uppercase tracking-wider text-neutral-700">
                    SDR que encaminhou a reunião
                  </label>
                  {sdrs.length > 0 ? (
                    <Select value={selectedSdrId} onValueChange={selectSdr}>
                      <SelectTrigger className="h-12 rounded-xl border-yellow-300 bg-white">
                        <SelectValue placeholder="Selecione o SDR de origem" />
                      </SelectTrigger>
                      <SelectContent>
                        {sdrs.map((sdr) => (
                          <SelectItem key={sdr.id} value={sdr.id}>
                            {sdr.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="rounded-xl border border-dashed border-yellow-400 bg-white p-3 text-sm text-neutral-600">
                      Ainda não há reunião de SDR encaminhada para você. Use seus links individuais
                      abaixo.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadLinks(sharedWithSdr ? selectedSdrId || null : null)}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente
            </Button>
          </div>
        )}

        {sharedWithSdr && !selectedSdrId ? (
          <section className="rounded-[22px] border border-dashed border-yellow-400 bg-white p-10 text-center">
            <Link2 className="mx-auto h-8 w-8 text-yellow-500" />
            <h2 className="mt-3 text-lg font-black">
              Selecione o SDR para liberar os links compartilhados
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Assim o sistema registra corretamente os dois responsáveis.
            </p>
          </section>
        ) : (
          <section>
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-black">Links de cadastro</h2>
                <p className="text-sm text-neutral-500">
                  {selectedSdr
                    ? `Crédito compartilhado com ${selectedSdr.name}.`
                    : "Links individuais vinculados ao seu usuário."}
                </p>
              </div>
              {loadingLinks && (
                <span className="flex items-center gap-2 text-xs font-bold text-yellow-700">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Gerando links...
                </span>
              )}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {links.map((link) => {
                const config = ROLE_CONFIG[link.profileRole];
                const Icon = config.icon;
                const url = buildSellerSignupUrl(link.profileRole, link.token);
                const message = `Olá! Faça seu cadastro de ${config.messageLabel} na NOX Fiança por este link exclusivo: ${url}`;
                return (
                  <article
                    key={link.profileRole}
                    className="flex min-h-[270px] flex-col rounded-[22px] border border-neutral-200 bg-white p-5 shadow-sm"
                  >
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-neutral-950 text-yellow-400">
                      <Icon className="h-6 w-6" />
                    </span>
                    <h3 className="mt-4 text-xl font-black">{config.title}</h3>
                    <p className="mt-1 text-sm leading-5 text-neutral-500">{config.description}</p>
                    <div className="mt-4 rounded-xl bg-neutral-50 p-3">
                      <p className="truncate font-mono text-[11px] text-neutral-600">{url}</p>
                    </div>
                    <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => void copyLink(link.profileRole, url)}
                      >
                        {copiedRole === link.profileRole ? (
                          <Check className="mr-2 h-4 w-4 text-emerald-600" />
                        ) : (
                          <Copy className="mr-2 h-4 w-4" />
                        )}
                        {copiedRole === link.profileRole ? "Copiado" : "Copiar"}
                      </Button>
                      <Button
                        className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                        asChild
                      >
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
                        </a>
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </DashboardLayout>
  );
}
