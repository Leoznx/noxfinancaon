import { createLazyFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { UserPlus, Mail, Phone, Trash2, Info, Eye, IdCard, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

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

function CorretoresAdmin() {
  const { user } = useAuth();
  const [corretores, setCorretores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [searchMode, setSearchMode] = useState<"cpf" | "email">("cpf");
  const [searchInput, setSearchInput] = useState("");
  const [foundCorretor, setFoundCorretor] = useState<any | null>(null);
  const [imobiliariaId, setImobiliariaId] = useState<string | null>(null);
  const [toUnlink, setToUnlink] = useState<any | null>(null);
  const [detailOf, setDetailOf] = useState<any | null>(null);


  const isImobiliaria = user?.role === "imobiliaria";

  useEffect(() => {
    if (!user) return;
    if (isImobiliaria) resolveImobiliariaId();
    else fetchAllCorretores();
  }, [user]);

  const resolveImobiliariaId = async () => {
    setLoading(true);
    const userEmail = user?.email;
    if (!userEmail) {
      setLoading(false);
      return;
    }
    const { data: imob } = await supabase
      .from("imobiliarias")
      .select("id")
      .ilike("contato_email", userEmail)
      .maybeSingle();
    if (imob?.id) {
      setImobiliariaId(imob.id);
      await fetchLinkedCorretores(imob.id);
    } else {
      setLoading(false);
    }
  };

  const fetchLinkedCorretores = async (imobId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("corretores")
      .select("*, profiles:profile_id (nome, email, telefone, status)")
      .eq("imobiliaria_id", imobId);
    if (error) toast.error("Erro ao carregar corretores: " + error.message);
    setCorretores(data || []);
    setLoading(false);
  };

  const fetchAllCorretores = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("corretores")
      .select("*, profiles:profile_id (nome, email, telefone, status)");
    if (error) toast.error("Erro ao carregar corretores: " + error.message);
    setCorretores(data || []);
    setLoading(false);
  };

  const resetModal = () => {
    setSearchInput("");
    setSearchMode("cpf");
    setFoundCorretor(null);
    setIsSearching(false);
    setIsLinking(false);
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
      } else {
        const email = searchInput.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          toast.error("Digite um e-mail válido.");
          return;
        }
        queryValue = email;
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
      if (row.status && row.status !== "ativo") {
        toast.error("Este corretor ainda não está ativo na plataforma.");
        return;
      }
      if (row.imobiliaria_id && row.imobiliaria_id === imobiliariaId) {
        toast.error("Este corretor já está vinculado à sua imobiliária.");
        return;
      }
      if (row.imobiliaria_id) {
        toast.error("Este corretor já possui vínculo com outra imobiliária.");
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
    if (!foundCorretor || !imobiliariaId) {
      toast.error("Não foi possível identificar sua imobiliária. Atualize a página e tente novamente.");
      return;
    }
    setIsLinking(true);
    try {
      const { error } = await supabase
        .from("corretores")
        .update({ imobiliaria_id: imobiliariaId, vinculado_imobiliaria: true })
        .eq("id", foundCorretor.id);
      if (error) {
        toast.error("Não foi possível vincular: " + error.message);
        return;
      }
      toast.success("Corretor vinculado com sucesso à sua imobiliária.");
      setOpen(false);
      resetModal();
      await fetchLinkedCorretores(imobiliariaId);
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlink = async () => {
    if (!toUnlink || !imobiliariaId) return;
    const { error } = await supabase
      .from("corretores")
      .update({ imobiliaria_id: null, vinculado_imobiliaria: false })
      .eq("id", toUnlink.id)
      .eq("imobiliaria_id", imobiliariaId);
    if (error) {
      toast.error("Erro ao desvincular: " + error.message);
      return;
    }
    toast.success("Corretor desvinculado com sucesso.");
    setToUnlink(null);
    await fetchLinkedCorretores(imobiliariaId);
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Meus Corretores</h1>
          <p className="text-neutral-500 mt-1">
            {isImobiliaria
              ? "Gerencie a equipe de corretores vinculada à sua imobiliária."
              : "Lista de corretores cadastrados na plataforma."}
          </p>
        </div>

        {isImobiliaria && (
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetModal(); }}>
            <Button
              onClick={() => setOpen(true)}
              className="bg-neutral-900 hover:bg-neutral-800 text-white font-bold h-12 px-6 rounded-xl flex items-center gap-2"
            >
              <UserPlus size={20} />
              CADASTRAR CORRETOR
            </Button>
            <DialogContent className="sm:max-w-[500px]">
              {!foundCorretor ? (
                <form onSubmit={handleSearch}>
                  <DialogHeader className="mb-4">
                    <DialogTitle className="text-2xl font-bold">Vincular corretor</DialogTitle>
                    <DialogDescription>
                      Busque um corretor já cadastrado na plataforma para vinculá-lo à sua imobiliária.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="rounded-xl bg-yellow-50 border border-yellow-200 p-4 flex gap-3 mb-6">
                    <Info size={18} className="text-yellow-700 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-900 leading-relaxed">
                      Só é possível vincular corretores que já possuem cadastro ativo na plataforma.
                    </p>
                  </div>

                  <div className="mb-5">
                    <Label className="text-xs font-black uppercase tracking-widest text-neutral-400 mb-2 block">
                      Buscar por
                    </Label>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded-xl">
                      {(["cpf", "email"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => { setSearchMode(m); setSearchInput(""); }}
                          className={`h-10 rounded-lg text-sm font-bold uppercase tracking-wide transition-all ${
                            searchMode === m
                              ? "bg-neutral-900 text-white shadow"
                              : "bg-transparent text-neutral-500 hover:text-neutral-900"
                          }`}
                        >
                          {m === "cpf" ? "CPF" : "E-mail"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-8">
                    <Label className="text-xs font-black uppercase tracking-widest text-neutral-400">
                      {searchMode === "cpf" ? "CPF do corretor" : "E-mail do corretor"}
                    </Label>
                    {searchMode === "cpf" ? (
                      <Input
                        required
                        autoFocus
                        inputMode="numeric"
                        value={formatCpf(searchInput)}
                        onChange={(e) => setSearchInput(e.target.value.replace(/\D/g, "").slice(0, 11))}
                        placeholder="000.000.000-00"
                        className="h-12 px-4 rounded-xl border-neutral-200 font-mono tracking-wider"
                      />
                    ) : (
                      <Input
                        required
                        autoFocus
                        type="email"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="corretor@email.com"
                        className="h-12 px-4 rounded-xl border-neutral-200"
                      />
                    )}
                  </div>


                  <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={() => { setOpen(false); resetModal(); }} className="h-12 rounded-xl">
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
                    <DialogDescription>
                      Confira os dados antes de vincular à sua imobiliária.
                    </DialogDescription>
                  </DialogHeader>

                  <Card className="p-5 mb-6 bg-neutral-50 border-neutral-200 space-y-3">
                    <Row label="Nome completo" value={foundCorretor.nome} />
                    <Row label="CPF" value={formatCpf(foundCorretor.cpf)} />
                    <Row label="E-mail" value={foundCorretor.email} />
                    {foundCorretor.telefone && <Row label="Telefone" value={foundCorretor.telefone} />}
                    {foundCorretor.creci && <Row label="CRECI" value={foundCorretor.creci} />}
                    <Row
                      label="Status"
                      value={
                        <Badge variant="outline" className={foundCorretor.status === "ativo" ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}>
                          {foundCorretor.status === "ativo" ? "Ativo" : "Pendente"}
                        </Badge>
                      }
                    />
                  </Card>

                  <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={() => setFoundCorretor(null)} className="h-12 rounded-xl">
                      Cancelar
                    </Button>
                    <Button type="button" onClick={handleConfirmLink} disabled={isLinking} className="h-12 bg-neutral-900 hover:bg-neutral-800 text-white font-bold rounded-xl">
                      {isLinking ? "Vinculando..." : "OK, vincular corretor"}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="border-neutral-200 shadow-sm overflow-hidden bg-white">
        <Table>
          <TableHeader className="bg-neutral-50/50">
            <TableRow>
              <TableHead className="text-[10px] font-black uppercase tracking-widest py-5 px-8">Corretor</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest py-5">Identificação</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest py-5">Vínculo</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest py-5 text-center">Status</TableHead>
              {isImobiliaria && (
                <TableHead className="text-[10px] font-black uppercase tracking-widest py-5 text-right px-8">Ações</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={isImobiliaria ? 5 : 4} className="h-32 text-center text-neutral-400">
                  Carregando corretores...
                </TableCell>
              </TableRow>
            ) : corretores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isImobiliaria ? 5 : 4} className="h-64 text-center">
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
              corretores.map((c) => (
                <TableRow key={c.id} className="hover:bg-neutral-50/50 transition-colors">
                  <TableCell className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-yellow-400 flex items-center justify-center font-black text-neutral-900">
                        {c.profiles?.nome?.substring(0, 1) || "?"}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold text-neutral-900">{c.profiles?.nome || "Sem nome"}</span>
                        <span className="text-xs text-neutral-500 font-medium">
                          Vinculado em {new Date(c.updated_at || c.created_at).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-6">
                    <div className="space-y-1">
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
                          {c.profiles.telefone}
                        </div>
                      )}
                      {c.creci && <div className="text-xs text-neutral-500 font-medium">CRECI {c.creci}</div>}
                    </div>
                  </TableCell>
                  <TableCell className="py-6 text-xs font-bold text-neutral-500">
                    {c.imobiliaria_id ? "EQUIPE" : "AUTÔNOMO"}
                  </TableCell>
                  <TableCell className="py-6 text-center">
                    <Badge variant="outline" className={c.profiles?.status === "ativo" ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}>
                      {c.profiles?.status === "ativo" ? "Ativo" : "Pendente"}
                    </Badge>
                  </TableCell>
                  {isImobiliaria && (
                    <TableCell className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setDetailOf(c)} className="h-9 px-3 rounded-lg text-neutral-700 hover:bg-neutral-100">
                          <Eye size={16} className="mr-1.5" />
                          Detalhes
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setToUnlink(c)} className="h-9 px-3 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700">
                          <Trash2 size={16} className="mr-1.5" />
                          Desvincular
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {isImobiliaria && !imobiliariaId && !loading && (
        <p className="mt-4 text-xs text-neutral-500">
          Complete os dados da sua empresa em Configurações quando possível para personalizar seu painel.
        </p>
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
              {detailOf.profiles?.telefone && <Row label="Telefone" value={detailOf.profiles.telefone} />}
              {detailOf.creci && <Row label="CRECI" value={detailOf.creci} />}
              <Row
                label="Status"
                value={
                  <Badge variant="outline" className={detailOf.profiles?.status === "ativo" ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}>
                    {detailOf.profiles?.status === "ativo" ? "Ativo" : "Pendente"}
                  </Badge>
                }
              />
              <Row label="Vinculado em" value={new Date(detailOf.updated_at || detailOf.created_at).toLocaleDateString("pt-BR")} />
            </Card>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
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
