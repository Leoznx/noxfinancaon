import { createLazyFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { UserPlus, Mail, Phone, Trash2, Info, Eye, IdCard, CheckCircle2, Pencil, Split } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  BROKER_COMMISSION_OPTIONS,
  clearBrokerCommissionAccessCache,
  getBrokerCommissionOption,
  type BrokerCommissionAllocationMode,
} from "@/lib/broker-commission-policy";
import {
  createBrokerAgencyInvitation,
  listMyBrokerAgencyMembers,
} from "@/lib/broker-agency-invitations";

export const Route = createLazyFileRoute("/corretores-admin")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "imobiliaria"]} moduleKey="corretores">
      <CorretoresAdmin />
    </ProtectedRoute>
  ),
});

function formatCpf(cpf?: string | null) {
  if (!cpf) return "";
  const d = cpf.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

type CorretorSearchMode = "cpf" | "email" | "telefone";

const LINKABLE_CORRETOR_STATUSES = new Set(["ativo", "pendente", "pendente_aprovacao"]);

function normalizePhoneInput(value: string) {
  let digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 11);
}

function formatPhone(value?: string | null) {
  const digits = normalizePhoneInput(value || "");
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function CorretoresAdmin() {
  const { user } = useAuth();
  const [corretores, setCorretores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [searchMode, setSearchMode] = useState<CorretorSearchMode>("cpf");
  const [searchInput, setSearchInput] = useState("");
  const [foundCorretor, setFoundCorretor] = useState<any | null>(null);
  const [imobiliariaId, setImobiliariaId] = useState<string | null>(null);
  const [toUnlink, setToUnlink] = useState<any | null>(null);
  const [detailOf, setDetailOf] = useState<any | null>(null);
  const [detailApolices, setDetailApolices] = useState<any[]>([]);
  const [loadingDetailApolices, setLoadingDetailApolices] = useState(false);
  const [commissionMode, setCommissionMode] = useState<BrokerCommissionAllocationMode>("broker_full");
  const [editingCommissionOf, setEditingCommissionOf] = useState<any | null>(null);
  const [savingCommissionMode, setSavingCommissionMode] = useState(false);

  const isImobiliaria = user?.role === "imobiliaria";

  const fetchLinkedCorretores = useCallback(async (imobId: string, silent = false) => {
    if (!silent) setLoading(true);
    const { data, error } = await listMyBrokerAgencyMembers(imobId);
    if (error) toast.error("Erro ao carregar corretores: " + error);
    setCorretores(
      (data || []).map((row) => ({
        ...row,
        id: row.corretor_id,
        profiles: {
          nome: row.nome,
          email: row.email,
          telefone: row.telefone,
          status: row.profile_status,
        },
      })),
    );
    if (!silent) setLoading(false);
  }, []);

  const fetchAllCorretores = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("corretores").select("*, profiles:profile_id (nome, email, telefone, status)");
    if (error) toast.error("Erro ao carregar corretores: " + error.message);
    setCorretores(data || []);
    setLoading(false);
  }, []);

  const resolveImobiliariaId = useCallback(async () => {
    setLoading(true);
    const userEmail = user?.email;
    if (!userEmail) {
      setLoading(false);
      return;
    }
    const { data: imob } = await supabase.from("imobiliarias").select("id").ilike("contato_email", userEmail).maybeSingle();
    if (imob?.id) {
      setImobiliariaId(imob.id);
      await fetchLinkedCorretores(imob.id);
    } else {
      setLoading(false);
    }
  }, [user?.email, fetchLinkedCorretores]);

  useEffect(() => {
    if (!user) return;
    if (isImobiliaria) resolveImobiliariaId();
    else fetchAllCorretores();
  }, [user, isImobiliaria, resolveImobiliariaId, fetchAllCorretores]);

  useEffect(() => {
    if (!isImobiliaria || !imobiliariaId) return;
    const refresh = () => void fetchLinkedCorretores(imobiliariaId, true);
    const channel = supabase
      .channel(`broker-team-${imobiliariaId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "broker_agency_invitations", filter: `imobiliaria_id=eq.${imobiliariaId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "corretores", filter: `imobiliaria_id=eq.${imobiliariaId}` },
        refresh,
      )
      .subscribe();
    const interval = window.setInterval(refresh, 30_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [fetchLinkedCorretores, imobiliariaId, isImobiliaria]);

  const resetModal = () => {
    setSearchInput("");
    setSearchMode("cpf");
    setFoundCorretor(null);
    setIsSearching(false);
    setIsLinking(false);
    setCommissionMode("broker_full");
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearching(true);
    setFoundCorretor(null);
    try {
      let queryValue = "";
      if (searchMode === "cpf") {
        const digits = searchInput.replace(/\D/g, "");
        if (digits.length !== 11) {
          toast.error("Digite um CPF válido.");
          return;
        }
        queryValue = digits;
      } else if (searchMode === "email") {
        const email = searchInput.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          toast.error("Digite um e-mail válido.");
          return;
        }
        queryValue = email;
      } else {
        const phone = normalizePhoneInput(searchInput);
        if (phone.length !== 10 && phone.length !== 11) {
          toast.error("Digite um telefone válido com DDD.");
          return;
        }
        queryValue = phone;
      }

      const { data, error } = await supabase.rpc("find_corretor", {
        p_query: queryValue,
        p_by: searchMode,
      });

      if (error) {
        toast.error("Erro na busca: " + error.message);
        return;
      }

      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;

      if (!row) {
        toast.error("Corretor não encontrado. Peça para ele se cadastrar primeiro na plataforma.");
        return;
      }
      if (!row.status || !LINKABLE_CORRETOR_STATUSES.has(row.status)) {
        toast.error("Este corretor está bloqueado ou indisponível para vínculo.");
        return;
      }
      if (row.imobiliaria_id && row.imobiliaria_id === imobiliariaId) {
        toast.error("Este corretor já está vinculado à sua imobiliária.");
        return;
      }

      setFoundCorretor({
        id: row.corretor_id,
        profile_id: row.profile_id,
        nome: row.nome,
        email: row.email,
        telefone: row.telefone,
        cpf: row.cpf,
        creci: row.creci,
        status: row.status,
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleConfirmLink = async () => {
    if (!foundCorretor) return;
    setIsLinking(true);
    try {
      const result = await createBrokerAgencyInvitation(foundCorretor.id, commissionMode);
      if (!result.ok) {
        toast.error(result.error || "Não foi possível enviar o convite.");
        return;
      }
      if (result.emailSent) {
        toast.success("Convite enviado. O vínculo ficará pendente até a confirmação do corretor.");
      } else {
        toast.warning("O convite foi registrado, mas o e-mail não pôde ser enviado. Tente enviar novamente.");
      }
      setOpen(false);
      resetModal();
      if (imobiliariaId) await fetchLinkedCorretores(imobiliariaId);
      else await resolveImobiliariaId();
    } finally {
      setIsLinking(false);
    }
  };

  const handleUpdateCommissionMode = async () => {
    if (!editingCommissionOf) return;
    setSavingCommissionMode(true);
    try {
      const { error } = await supabase.rpc("update_my_corretor_commission_allocation", {
        p_corretor_id: editingCommissionOf.id,
        p_commission_allocation_mode: commissionMode,
      });
      if (error) {
        toast.error("Não foi possível atualizar a regra: " + error.message);
        return;
      }
      clearBrokerCommissionAccessCache(editingCommissionOf.profile_id);
      toast.success("Regra atualizada para os próximos contratos.");
      setEditingCommissionOf(null);
      if (imobiliariaId) await fetchLinkedCorretores(imobiliariaId);
    } finally {
      setSavingCommissionMode(false);
    }
  };

  const handleUnlink = async () => {
    if (!toUnlink) return;
    const { error } = await supabase.rpc("unlink_my_corretor", {
      p_corretor_id: toUnlink.id,
    });
    if (error) {
      toast.error("Erro ao desvincular: " + error.message);
      return;
    }
    toast.success("Corretor desvinculado com sucesso.");
    setToUnlink(null);
    if (imobiliariaId) await fetchLinkedCorretores(imobiliariaId);
    else await resolveImobiliariaId();
  };

  useEffect(() => {
    if (!detailOf?.profile_id) {
      setDetailApolices([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingDetailApolices(true);
      // apolices não guarda o profile do corretor diretamente (coluna nunca
      // preenchida) — o vínculo real é via consulta_id -> profile_id_solicitante.
      const { data: consultasDoCorretor } = await supabase.from("consultas_credito").select("id").eq("profile_id_solicitante", detailOf.profile_id);
      const ids = (consultasDoCorretor || []).map((c: any) => c.id);
      if (ids.length === 0) {
        if (!cancelled) {
          setDetailApolices([]);
          setLoadingDetailApolices(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from("apolices")
        .select(
          `
          id, numero, status, valor_premio,
          consulta:consultas_credito(
            inquilino:inquilinos(nome),
            imovel:imoveis(endereco, cidade, estado)
          )
        `,
        )
        .in("consulta_id", ids)
        .eq("status", "ativa")
        .order("created_at", { ascending: false });
      if (!cancelled) {
        if (error) toast.error("Erro ao carregar contratos do corretor: " + error.message);
        setDetailApolices(data || []);
        setLoadingDetailApolices(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailOf]);

  return (
    <DashboardLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Meus Corretores</h1>
          <p className="text-neutral-500 mt-1">
            {isImobiliaria ? "Gerencie a equipe de corretores vinculada à sua imobiliária." : "Lista de corretores cadastrados na plataforma."}
          </p>
        </div>

        {isImobiliaria && (
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) resetModal();
            }}
          >
            <Button onClick={() => setOpen(true)} className="bg-neutral-900 hover:bg-neutral-800 text-white font-bold h-12 px-6 rounded-xl flex items-center gap-2">
              <UserPlus size={20} />
              CADASTRAR CORRETOR
            </Button>
            <DialogContent className="sm:max-w-[500px]">
              {!foundCorretor ? (
                <form onSubmit={handleSearch}>
                  <DialogHeader className="mb-4">
                    <DialogTitle className="text-2xl font-bold">Vincular corretor</DialogTitle>
                    <DialogDescription>Busque um corretor já cadastrado na plataforma para vinculá-lo à sua imobiliária.</DialogDescription>
                  </DialogHeader>

                  <div className="rounded-xl bg-yellow-50 border border-yellow-200 p-4 flex gap-3 mb-6">
                    <Info size={18} className="text-yellow-700 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-900 leading-relaxed">
                      Corretores cadastrados podem ser vinculados mesmo enquanto aguardam a ativação da conta.
                    </p>
                  </div>

                  <div className="mb-5">
                    <Label className="text-xs font-black uppercase tracking-widest text-neutral-400 mb-2 block">Buscar por</Label>
                    <div className="grid grid-cols-3 gap-2 p-1 bg-neutral-100 rounded-xl">
                      {(["cpf", "email", "telefone"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setSearchMode(m);
                            setSearchInput("");
                          }}
                          className={`h-10 rounded-lg text-sm font-bold uppercase tracking-wide transition-all ${
                            searchMode === m ? "bg-neutral-900 text-white shadow" : "bg-transparent text-neutral-500 hover:text-neutral-900"
                          }`}
                        >
                          {m === "cpf" ? "CPF" : m === "email" ? "E-mail" : "Telefone"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-8">
                    <Label className="text-xs font-black uppercase tracking-widest text-neutral-400">
                      {searchMode === "cpf" ? "CPF do corretor" : searchMode === "email" ? "E-mail do corretor" : "Telefone do corretor"}
                    </Label>
                    <Input
                      required
                      autoFocus
                      type={searchMode === "email" ? "email" : "text"}
                      inputMode={searchMode === "email" ? "email" : searchMode === "telefone" ? "tel" : "numeric"}
                      value={searchMode === "cpf" ? formatCpf(searchInput) : searchMode === "telefone" ? formatPhone(searchInput) : searchInput}
                      onChange={(e) =>
                        setSearchInput(
                          searchMode === "cpf" ? e.target.value.replace(/\D/g, "").slice(0, 11) : searchMode === "telefone" ? normalizePhoneInput(e.target.value) : e.target.value,
                        )
                      }
                      placeholder={searchMode === "cpf" ? "000.000.000-00" : searchMode === "telefone" ? "(00) 00000-0000" : "corretor@email.com"}
                      className={`h-12 px-4 rounded-xl border-neutral-200 ${searchMode === "email" ? "" : "font-mono tracking-wider"}`}
                    />
                  </div>

                  <DialogFooter className="gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setOpen(false);
                        resetModal();
                      }}
                      className="h-12 rounded-xl"
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={isSearching} className="h-12 bg-yellow-400 hover:bg-yellow-500 text-neutral-900 font-black rounded-xl">
                      {isSearching ? "Buscando..." : "Buscar corretor"}
                    </Button>
                  </DialogFooter>
                </form>
              ) : (
                <div>
                  <DialogHeader className="mb-4">
                    <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                      <CheckCircle2 className="text-green-600" size={26} />
                      Corretor encontrado
                    </DialogTitle>
                    <DialogDescription>Confira os dados e envie o convite de confirmação ao corretor.</DialogDescription>
                  </DialogHeader>

                  <Card className="p-5 mb-6 bg-neutral-50 border-neutral-200 space-y-3">
                    <Row label="Nome completo" value={foundCorretor.nome} />
                    <Row label="CPF" value={formatCpf(foundCorretor.cpf)} />
                    <Row label="E-mail" value={foundCorretor.email} />
                    {foundCorretor.telefone && <Row label="Telefone" value={formatPhone(foundCorretor.telefone)} />}
                    {foundCorretor.creci && <Row label="CRECI" value={foundCorretor.creci} />}
                    <Row
                      label="Status"
                      value={
                        <Badge
                          variant="outline"
                          className={foundCorretor.status === "ativo" ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}
                        >
                          {foundCorretor.status === "ativo" ? "Ativo" : "Aguardando ativação"}
                        </Badge>
                      }
                    />
                  </Card>

                  <div className="mb-6">
                    <CommissionPolicySelector value={commissionMode} onChange={setCommissionMode} />
                  </div>

                  <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={() => setFoundCorretor(null)} className="h-12 rounded-xl">
                      Cancelar
                    </Button>
                    <Button type="button" onClick={handleConfirmLink} disabled={isLinking} className="h-12 bg-neutral-900 hover:bg-neutral-800 text-white font-bold rounded-xl">
                      {isLinking ? "Enviando convite..." : "Enviar convite de vínculo"}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="border-neutral-200 shadow-sm overflow-hidden bg-white">
        {/* Mobile/tablet estreito: cards empilhados, sem tabela pra arrastar. */}
        <div className="md:hidden divide-y divide-neutral-100">
          {loading ? (
            <p className="h-32 flex items-center justify-center text-center text-neutral-400">Carregando corretores...</p>
          ) : corretores.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-300">
                <Mail size={32} />
              </div>
              <p className="text-neutral-900 font-bold">Nenhum corretor vinculado ainda.</p>
              {isImobiliaria && (
                <p className="text-sm text-neutral-500 max-w-md">
                  Cadastre corretores pelo e-mail ou CPF já registrado na plataforma para acompanhar consultas e contratos da sua equipe.
                </p>
              )}
            </div>
          ) : (
            corretores.map((c) => {
              const activeMembership = !isImobiliaria || c.membership_status === "active";
              return (
              <div key={c.membership_id || c.id} className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-yellow-400 flex items-center justify-center font-black text-neutral-900 shrink-0">
                    {c.profiles?.nome?.substring(0, 1) || "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-neutral-900 truncate">{c.profiles?.nome || "Sem nome"}</p>
                    <p className="text-xs text-neutral-500 font-medium">
                      {activeMembership
                        ? `Cadastrado em ${new Date(c.registered_at || c.created_at).toLocaleDateString("pt-BR")}`
                        : `Convite enviado em ${new Date(c.linked_at).toLocaleDateString("pt-BR")}`}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 ${activeMembership ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}`}
                  >
                    {activeMembership ? "Ativo" : "Pendente"}
                  </Badge>
                </div>
                {activeMembership ? <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-neutral-600">
                    <Mail size={14} className="text-neutral-400 shrink-0" />
                    <span className="truncate">{c.profiles?.email}</span>
                  </div>
                  {c.cpf && (
                    <div className="flex items-center gap-2 text-sm text-neutral-600">
                      <IdCard size={14} className="text-neutral-400 shrink-0" />
                      {formatCpf(c.cpf)}
                    </div>
                  )}
                  {c.profiles?.telefone && (
                    <div className="flex items-center gap-2 text-sm text-neutral-600">
                      <Phone size={14} className="text-neutral-400 shrink-0" />
                      {formatPhone(c.profiles.telefone)}
                    </div>
                  )}
                  {c.creci && <div className="text-xs text-neutral-500 font-medium">CRECI {c.creci}</div>}
                  <div className="text-xs font-bold text-neutral-500">{c.contracts_count || 0} contrato(s) gerado(s)</div>
                </div> : (
                  <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
                    Aguardando a confirmação enviada ao e-mail do corretor.
                  </div>
                )}
                {isImobiliaria && (
                  <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Comissão dos próximos contratos</p>
                    <p className="mt-1 text-sm font-bold text-neutral-900">{getBrokerCommissionOption(c.commission_allocation_mode).shortLabel}</p>
                  </div>
                )}
                {isImobiliaria && activeMembership && (
                  <div className="flex items-center gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => setDetailOf(c)} className="flex-1 h-9 rounded-lg text-neutral-700">
                      <Eye size={16} className="mr-1.5" />
                      Detalhes
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCommissionMode((c.commission_allocation_mode || "broker_full") as BrokerCommissionAllocationMode);
                        setEditingCommissionOf(c);
                      }}
                      className="flex-1 h-9 rounded-lg text-neutral-700"
                    >
                      <Pencil size={15} className="mr-1.5" />
                      Comissão
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setToUnlink(c)} className="flex-1 h-9 rounded-lg text-red-600 hover:text-red-700">
                      <Trash2 size={16} className="mr-1.5" />
                      Desvincular
                    </Button>
                  </div>
                )}
              </div>
            );})
          )}
        </div>
        {/* Tablet/desktop: tabela completa. */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-neutral-50/50">
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase tracking-widest py-5 px-8">Corretor</TableHead>
                <TableHead className="text-[10px] font-black uppercase tracking-widest py-5">Identificação</TableHead>
                <TableHead className="text-[10px] font-black uppercase tracking-widest py-5">Vínculo</TableHead>
                {isImobiliaria && <TableHead className="text-[10px] font-black uppercase tracking-widest py-5">Comissão</TableHead>}
                <TableHead className="text-[10px] font-black uppercase tracking-widest py-5 text-center">Status</TableHead>
                {isImobiliaria && <TableHead className="text-[10px] font-black uppercase tracking-widest py-5 text-right px-8">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isImobiliaria ? 6 : 4} className="h-32 text-center text-neutral-400">
                    Carregando corretores...
                  </TableCell>
                </TableRow>
              ) : corretores.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isImobiliaria ? 6 : 4} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3 px-6">
                      <div className="w-16 h-16 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-300">
                        <Mail size={32} />
                      </div>
                      <p className="text-neutral-900 font-bold">Nenhum corretor vinculado ainda.</p>
                      {isImobiliaria && (
                        <p className="text-sm text-neutral-500 max-w-md">
                          Cadastre corretores pelo e-mail ou CPF já registrado na plataforma para acompanhar consultas e contratos da sua equipe.
                        </p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                corretores.map((c) => {
                  const activeMembership = !isImobiliaria || c.membership_status === "active";
                  return (
                  <TableRow key={c.membership_id || c.id} className="hover:bg-neutral-50/50 transition-colors">
                    <TableCell className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-yellow-400 flex items-center justify-center font-black text-neutral-900">
                          {c.profiles?.nome?.substring(0, 1) || "?"}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-neutral-900">{c.profiles?.nome || "Sem nome"}</span>
                          <span className="text-xs text-neutral-500 font-medium">
                            {activeMembership
                              ? `Cadastrado em ${new Date(c.registered_at || c.created_at).toLocaleDateString("pt-BR")}`
                              : `Convite enviado em ${new Date(c.linked_at).toLocaleDateString("pt-BR")}`}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-6">
                      {activeMembership ? <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-neutral-600">
                          <Mail size={14} className="text-neutral-400" />
                          {c.profiles?.email}
                        </div>
                        {c.cpf && (
                          <div className="flex items-center gap-2 text-sm text-neutral-600">
                            <IdCard size={14} className="text-neutral-400" />
                            {formatCpf(c.cpf)}
                          </div>
                        )}
                        {c.profiles?.telefone && (
                          <div className="flex items-center gap-2 text-sm text-neutral-600">
                            <Phone size={14} className="text-neutral-400" />
                            {formatPhone(c.profiles.telefone)}
                          </div>
                        )}
                        {c.creci && <div className="text-xs text-neutral-500 font-medium">CRECI {c.creci}</div>}
                      </div> : <span className="text-sm text-neutral-500">Dados liberados após a confirmação</span>}
                    </TableCell>
                    <TableCell className="py-6 text-xs font-bold text-neutral-500">
                      {activeMembership ? `${c.contracts_count || 0} contrato(s) gerado(s)` : "Aguardando aceite por e-mail"}
                    </TableCell>
                    {isImobiliaria && (
                      <TableCell className="py-6">
                        <Badge variant="outline" className="border-yellow-200 bg-yellow-50 text-yellow-800">
                          {getBrokerCommissionOption(c.commission_allocation_mode).shortLabel}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell className="py-6 text-center">
                      <Badge
                        variant="outline"
                        className={activeMembership ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}
                      >
                        {activeMembership ? "Ativo" : "Pendente"}
                      </Badge>
                    </TableCell>
                    {isImobiliaria && activeMembership && (
                      <TableCell className="px-8 py-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setDetailOf(c)} className="h-9 px-3 rounded-lg text-neutral-700 hover:bg-neutral-100">
                            <Eye size={16} className="mr-1.5" />
                            Detalhes
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setCommissionMode((c.commission_allocation_mode || "broker_full") as BrokerCommissionAllocationMode);
                              setEditingCommissionOf(c);
                            }}
                            className="h-9 px-3 rounded-lg text-neutral-700 hover:bg-neutral-100"
                          >
                            <Pencil size={16} className="mr-1.5" />
                            Comissão
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setToUnlink(c)} className="h-9 px-3 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700">
                            <Trash2 size={16} className="mr-1.5" />
                            Desvincular
                          </Button>
                        </div>
                      </TableCell>
                    )}
                    {isImobiliaria && !activeMembership && (
                      <TableCell className="px-8 py-6 text-right text-xs font-bold text-yellow-700">
                        Confirmação pendente
                      </TableCell>
                    )}
                  </TableRow>
                );})
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {isImobiliaria && !imobiliariaId && !loading && (
        <p className="mt-4 text-xs text-neutral-500">Complete os dados da sua empresa em Configurações quando possível para personalizar seu painel.</p>
      )}

      <AlertDialog open={!!toUnlink} onOpenChange={(o) => !o && setToUnlink(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular corretor</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja desvincular este corretor? O histórico será mantido, mas ele não aparecerá mais como ativo na sua equipe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnlink} className="bg-red-600 hover:bg-red-700">
              Desvincular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editingCommissionOf} onOpenChange={(next) => !next && setEditingCommissionOf(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Regra de comissão de {editingCommissionOf?.profiles?.nome || "corretor"}</DialogTitle>
            <DialogDescription>
              A alteração vale somente para contratos criados depois da confirmação. O histórico financeiro permanece intacto.
            </DialogDescription>
          </DialogHeader>
          <CommissionPolicySelector value={commissionMode} onChange={setCommissionMode} />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingCommissionOf(null)}>Cancelar</Button>
            <Button onClick={handleUpdateCommissionMode} disabled={savingCommissionMode} className="bg-neutral-900 text-white hover:bg-neutral-800">
              {savingCommissionMode ? "Salvando..." : "Salvar para próximos contratos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailOf} onOpenChange={(o) => !o && setDetailOf(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-2xl font-bold">{detailOf?.profiles?.nome}</DialogTitle>
            <DialogDescription>Detalhes do corretor vinculado</DialogDescription>
          </DialogHeader>
          {detailOf && (
            <Card className="p-5 bg-neutral-50 border-neutral-200 space-y-3">
              <Row label="E-mail" value={detailOf.profiles?.email} />
              {detailOf.cpf && <Row label="CPF" value={formatCpf(detailOf.cpf)} />}
              {detailOf.profiles?.telefone && <Row label="Telefone" value={formatPhone(detailOf.profiles.telefone)} />}
              {detailOf.creci && <Row label="CRECI" value={detailOf.creci} />}
              <Row
                label="Status"
                value={
                  <Badge
                    variant="outline"
                    className="bg-green-50 text-green-700 border-green-200"
                  >
                    Ativo
                  </Badge>
                }
              />
              <Row label="Cadastrado em" value={new Date(detailOf.registered_at || detailOf.created_at).toLocaleDateString("pt-BR")} />
              <Row label="Contratos gerados" value={String(detailOf.contracts_count || 0)} />
            </Card>
          )}

          <div className="mt-5">
            <h4 className="text-xs font-black uppercase tracking-widest text-neutral-400 mb-3">Contratos ativos</h4>
            {loadingDetailApolices ? (
              <p className="text-sm text-neutral-400 py-2">Carregando contratos...</p>
            ) : detailApolices.length === 0 ? (
              <p className="text-sm text-neutral-400 py-2">Nenhum contrato ativo para este corretor.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {detailApolices.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                    <div className="min-w-0">
                      <p className="font-bold text-neutral-900 text-sm truncate">
                        #{a.numero} · {a.consulta?.inquilino?.nome || "—"}
                      </p>
                      <p className="text-xs text-neutral-500 truncate">{a.consulta?.imovel?.endereco || ""}</p>
                    </div>
                    <span className="text-xs font-black text-neutral-900 shrink-0">
                      {Number(a.valor_premio || 0).toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function CommissionPolicySelector({
  value,
  onChange,
}: {
  value: BrokerCommissionAllocationMode;
  onChange: (value: BrokerCommissionAllocationMode) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 flex items-center gap-2 text-sm font-black text-neutral-900">
        <Split size={17} className="text-yellow-600" />
        Como deseja distribuir a comissão dos contratos?
      </legend>
      <p className="mb-3 text-xs text-neutral-500">A regra é individual para este corretor e fica registrada em cada novo contrato.</p>
      <div className="space-y-2">
        {BROKER_COMMISSION_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`w-full rounded-xl border p-3 text-left transition ${
                selected ? "border-yellow-400 bg-yellow-50 ring-1 ring-yellow-300" : "border-neutral-200 bg-white hover:border-neutral-300"
              }`}
            >
              <span className="flex items-start gap-3">
                <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-4 ${selected ? "border-neutral-900 bg-yellow-400" : "border-neutral-300 bg-white"}`} />
                <span>
                  <span className="block text-sm font-black text-neutral-900">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">{option.description}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">{label}</span>
      <span className="text-sm font-semibold text-neutral-900 text-right">{value}</span>
    </div>
  );
}
