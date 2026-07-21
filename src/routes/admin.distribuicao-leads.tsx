import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Shuffle, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseLeadLines, readCsvFileAsText, readPdfFileAsText, type ParsedLeadRow } from "@/lib/lead-import";
import { leadStatusClass, leadStatusLabel, formatDateTime } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/admin/distribuicao-leads")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "admin_master", "marketing"]} moduleKey="distribuicao_leads">
      <DistribuicaoLeadsAdmin />
    </ProtectedRoute>
  ),
});

type FilaVendedor = {
  id: string;
  ativo: boolean;
  ordem: number;
  ultimo_recebimento: string | null;
  total_leads_recebidos: number;
  vendedor: { id: string; full_name: string; status: string } | null;
};

type LeadDistribuido = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  origin: string | null;
  status: string;
  distributed_at: string | null;
  vendedor: { full_name: string } | null;
};

type ItemResultado = { nome: string; detalhe: string };
type ResultadoLote = {
  distribuidos: { nome: string; vendedor: string }[];
  duplicados: ItemResultado[];
  erros: ItemResultado[];
};

const emptyManualLead = { nome: "", telefone: "", email: "", cidade: "", origem: "", observacao: "" };

/**
 * Página própria "Distribuição de Leads" — o back-end (fila com rodízio, RPC
 * transacional distribuir_sales_lead, notificação automática pro vendedor) já
 * existia no banco (ver 20260709223000_sales_lead_distribution_crm.sql); esta
 * página é a interface pra usar tudo isso: adicionar um lead na mão, colar/
 * importar vários de uma vez, e ver a fila + o histórico de quem recebeu o quê.
 */
function DistribuicaoLeadsAdmin() {
  const [fila, setFila] = useState<FilaVendedor[]>([]);
  const [recentes, setRecentes] = useState<LeadDistribuido[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [manual, setManual] = useState(emptyManualLead);
  const [enviandoManual, setEnviandoManual] = useState(false);
  const [listaTexto, setListaTexto] = useState("");
  const [enviandoLista, setEnviandoLista] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function carregarFila() {
    await supabase.rpc("sincronizar_fila_vendedores_leads" as any);
    const { data, error } = await supabase
      .from("lead_distribution_queue" as any)
      .select(
        "id, ativo, ordem, ultimo_recebimento, total_leads_recebidos, vendedor:vendedor_id(id, full_name, status)",
      )
      .order("ordem", { ascending: true });
    if (error) {
      console.error("[distribuicao-leads] falha ao carregar fila:", error);
      return;
    }
    setFila(((data as any) ?? []) as FilaVendedor[]);
  }

  async function carregarRecentes() {
    const { data, error } = await supabase
      .from("sales_leads" as any)
      .select(
        "id, full_name, phone, email, city, origin, status, distributed_at, vendedor:assigned_seller_id(full_name)",
      )
      .not("distributed_at", "is", null)
      .order("distributed_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("[distribuicao-leads] falha ao carregar distribuídos recentes:", error);
      return;
    }
    setRecentes(((data as any) ?? []) as LeadDistribuido[]);
  }

  async function carregarTudo() {
    setCarregando(true);
    await Promise.all([carregarFila(), carregarRecentes()]);
    setCarregando(false);
  }

  useEffect(() => {
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carrega telefones/e-mails já cadastrados UMA VEZ por lote (não a cada lead) e
  // vai atualizando o Set localmente conforme distribui — pega tanto duplicidade
  // contra o banco quanto duplicidade dentro da própria lista colada/importada.
  async function carregarChavesDedup() {
    const { data } = await supabase.from("sales_leads" as any).select("phone, email").limit(5000);
    const telefones = new Set<string>();
    const emails = new Set<string>();
    ((data as any[]) ?? []).forEach((row) => {
      const p = String(row.phone ?? "").replace(/\D/g, "");
      if (p.length >= 8) telefones.add(p);
      const e = String(row.email ?? "").trim().toLowerCase();
      if (e) emails.add(e);
    });
    return { telefones, emails };
  }

  async function distribuirUmLead(
    dados: { nome: string; telefone?: string; email?: string; cidade?: string; origem?: string; observacao?: string },
    chaves: { telefones: Set<string>; emails: Set<string> },
  ): Promise<{ ok: true; vendedor: string } | { ok: false; motivo: "duplicado" | "erro"; detalhe: string }> {
    const telefoneDigits = dados.telefone?.replace(/\D/g, "") ?? "";
    const emailNorm = dados.email?.trim().toLowerCase() ?? "";
    const duplicado =
      (telefoneDigits.length >= 8 && chaves.telefones.has(telefoneDigits)) ||
      (!!emailNorm && chaves.emails.has(emailNorm));
    if (duplicado) {
      return { ok: false, motivo: "duplicado", detalhe: "Telefone ou e-mail já cadastrado em outro lead." };
    }

    const { data, error } = await supabase.rpc("distribuir_sales_lead" as any, {
      p_full_name: dados.nome,
      p_phone: dados.telefone || null,
      p_email: dados.email || null,
      p_origin: dados.origem || null,
      p_city: dados.cidade || null,
      p_type: null,
      p_interest: null,
      p_notes: dados.observacao || null,
    });

    if (error) return { ok: false, motivo: "erro", detalhe: error.message };

    if (telefoneDigits.length >= 8) chaves.telefones.add(telefoneDigits);
    if (emailNorm) chaves.emails.add(emailNorm);

    const vendedorId = (data as any)?.assigned_seller_id;
    const vendedorNome = fila.find((f) => f.vendedor?.id === vendedorId)?.vendedor?.full_name ?? "um vendedor";
    return { ok: true, vendedor: vendedorNome };
  }

  async function enviarManual() {
    if (!manual.nome.trim()) {
      toast.error("Informe o nome do lead.");
      return;
    }
    setEnviandoManual(true);
    try {
      const chaves = await carregarChavesDedup();
      const r = await distribuirUmLead(
        {
          nome: manual.nome.trim(),
          telefone: manual.telefone.trim() || undefined,
          email: manual.email.trim() || undefined,
          cidade: manual.cidade.trim() || undefined,
          origem: manual.origem.trim() || "manual",
          observacao: manual.observacao.trim() || undefined,
        },
        chaves,
      );
      if (r.ok) {
        toast.success(`Lead distribuído para ${r.vendedor}.`);
        setManual(emptyManualLead);
      } else if (r.motivo === "duplicado") {
        toast.error("Esse lead já está cadastrado (telefone ou e-mail repetido).");
      } else {
        toast.error(r.detalhe);
      }
      await carregarTudo();
    } finally {
      setEnviandoManual(false);
    }
  }

  async function distribuirLista() {
    const rows = parseLeadLines(listaTexto);
    if (rows.length === 0) {
      toast.error("Cole ao menos um lead na lista (um por linha).");
      return;
    }
    setEnviandoLista(true);
    setResultado(null);
    try {
      const chaves = await carregarChavesDedup();
      const loteResultado: ResultadoLote = { distribuidos: [], duplicados: [], erros: [] };
      for (const row of rows) {
        const r = await distribuirUmLead(
          { nome: row.nome, telefone: row.telefone, email: row.email, cidade: row.cidade, origem: "lista_colada" },
          chaves,
        );
        if (r.ok) loteResultado.distribuidos.push({ nome: row.nome, vendedor: r.vendedor });
        else if (r.motivo === "duplicado") loteResultado.duplicados.push({ nome: row.nome, detalhe: r.detalhe });
        else loteResultado.erros.push({ nome: row.nome, detalhe: r.detalhe });
      }
      setResultado(loteResultado);
      if (loteResultado.distribuidos.length > 0) {
        toast.success(`${loteResultado.distribuidos.length} lead(s) distribuído(s) com sucesso.`);
        setListaTexto("");
      }
      if (loteResultado.duplicados.length > 0 || loteResultado.erros.length > 0) {
        toast.warning(
          `${loteResultado.duplicados.length} duplicado(s), ${loteResultado.erros.length} com erro — veja o resumo abaixo.`,
        );
      }
      await carregarTudo();
    } finally {
      setEnviandoLista(false);
    }
  }

  async function importarArquivo(file: File) {
    setImportando(true);
    try {
      const extensao = file.name.split(".").pop()?.toLowerCase();
      let texto = "";
      if (extensao === "csv" || extensao === "txt") {
        texto = await readCsvFileAsText(file);
      } else if (extensao === "pdf") {
        texto = await readPdfFileAsText(file);
      } else {
        toast.error("Formato não suportado. Use .csv ou .pdf.");
        return;
      }
      const rows: ParsedLeadRow[] = parseLeadLines(texto);
      if (rows.length === 0) {
        toast.error("Não encontrei nenhum lead reconhecível nesse arquivo.");
        return;
      }
      const linhasFormatadas = rows
        .map((row) => [row.nome, row.telefone, row.email, row.cidade].filter(Boolean).join(", "))
        .join("\n");
      setListaTexto((atual) => (atual.trim() ? `${atual.trim()}\n${linhasFormatadas}` : linhasFormatadas));
      toast.success(`${rows.length} lead(s) importado(s) para a lista — revise antes de distribuir.`);
    } catch (e: any) {
      toast.error("Não foi possível ler o arquivo: " + (e?.message || "erro desconhecido"));
    } finally {
      setImportando(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <header className="flex items-center gap-3">
          <div className="rounded-lg bg-yellow-100 p-2 text-yellow-700">
            <Shuffle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-neutral-950">Distribuição de Leads</h1>
            <p className="text-sm font-medium text-neutral-500">
              Adicione leads na mão ou em lista — cada um é distribuído automaticamente pro próximo vendedor do
              rodízio, sem repetir ninguém.
            </p>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-black text-neutral-950">
              <Plus className="h-4 w-4" /> Adicionar lead manualmente
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Esse lead é distribuído na hora pro próximo vendedor do rodízio.
            </p>
            <div className="mt-4 grid gap-3">
              <div>
                <Label>Nome *</Label>
                <Input
                  className="mt-1"
                  placeholder="Nome do lead"
                  value={manual.nome}
                  onChange={(e) => setManual({ ...manual, nome: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Telefone</Label>
                  <Input
                    className="mt-1"
                    placeholder="(47) 99999-9999"
                    value={manual.telefone}
                    onChange={(e) => setManual({ ...manual, telefone: e.target.value })}
                  />
                </div>
                <div>
                  <Label>E-mail</Label>
                  <Input
                    className="mt-1"
                    placeholder="lead@email.com"
                    value={manual.email}
                    onChange={(e) => setManual({ ...manual, email: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Cidade</Label>
                  <Input
                    className="mt-1"
                    value={manual.cidade}
                    onChange={(e) => setManual({ ...manual, cidade: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Origem</Label>
                  <Input
                    className="mt-1"
                    placeholder="Instagram, indicação..."
                    value={manual.origem}
                    onChange={(e) => setManual({ ...manual, origem: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>Observação</Label>
                <Textarea
                  className="mt-1 min-h-[70px]"
                  value={manual.observacao}
                  onChange={(e) => setManual({ ...manual, observacao: e.target.value })}
                />
              </div>
            </div>
            <Button
              className="mt-4 w-full gap-2 bg-neutral-950 text-white hover:bg-neutral-800"
              onClick={enviarManual}
              disabled={enviandoManual}
            >
              <Shuffle className="h-4 w-4" />
              {enviandoManual ? "Distribuindo..." : "Distribuir lead"}
            </Button>
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-black text-neutral-950">
              <Users className="h-4 w-4" /> Adicionar leads em lista
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Um lead por linha — "Nome, Telefone, E-mail, Cidade". Também aceita colar direto do Excel/Google
              Planilhas.
            </p>
            <Textarea
              className="mt-4 min-h-[180px] font-mono text-xs"
              placeholder={
                "Ana Silva, 47999998888, ana@email.com, Blumenau\nCarlos Souza, 47988887777, carlos@email.com, Itajaí"
              }
              value={listaTexto}
              onChange={(e) => setListaTexto(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={importando}
              >
                {importando ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Importar planilha (.csv) ou PDF
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importarArquivo(file);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                className="gap-2 bg-neutral-950 text-white hover:bg-neutral-800"
                onClick={distribuirLista}
                disabled={enviandoLista || !listaTexto.trim()}
              >
                <Shuffle className="h-4 w-4" />
                {enviandoLista ? "Distribuindo..." : "Distribuir todos"}
              </Button>
            </div>

            {resultado && (
              <div className="mt-4 space-y-2 rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-xs">
                {resultado.distribuidos.length > 0 && (
                  <p className="font-bold text-emerald-700">
                    {resultado.distribuidos.length} distribuído(s):{" "}
                    {resultado.distribuidos.map((d) => `${d.nome} → ${d.vendedor}`).join(" · ")}
                  </p>
                )}
                {resultado.duplicados.length > 0 && (
                  <p className="font-bold text-amber-700">
                    {resultado.duplicados.length} ignorado(s) por duplicidade:{" "}
                    {resultado.duplicados.map((d) => d.nome).join(", ")}
                  </p>
                )}
                {resultado.erros.length > 0 && (
                  <p className="font-bold text-red-700">
                    {resultado.erros.length} com erro:{" "}
                    {resultado.erros.map((d) => `${d.nome} (${d.detalhe})`).join("; ")}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-neutral-100 p-5">
            <div>
              <h2 className="font-black text-neutral-950">Fila de distribuição</h2>
              <p className="text-sm text-neutral-500">Ordem do rodízio — quem recebeu há mais tempo é o próximo.</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={carregarTudo} disabled={carregando}>
              <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total recebido</TableHead>
                  <TableHead>Último lead</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fila.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-neutral-400">
                      {carregando ? "Carregando fila..." : "Nenhum vendedor ativo na fila."}
                    </TableCell>
                  </TableRow>
                ) : (
                  fila.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-bold text-neutral-950">{item.vendedor?.full_name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            item.ativo
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-neutral-200 bg-neutral-50 text-neutral-500"
                          }
                        >
                          {item.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">{item.total_leads_recebidos}</TableCell>
                      <TableCell className="text-xs text-neutral-500">
                        {formatDateTime(item.ultimo_recebimento) || "Nunca recebeu"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-100 p-5">
            <h2 className="font-black text-neutral-950">Distribuídos recentemente</h2>
            <p className="text-sm text-neutral-500">Últimos 20 leads e pra quem foram.</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Quando</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-neutral-400">
                      {carregando ? "Carregando..." : "Nenhum lead distribuído ainda."}
                    </TableCell>
                  </TableRow>
                ) : (
                  recentes.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell className="font-bold text-neutral-950">{lead.full_name}</TableCell>
                      <TableCell className="text-xs text-neutral-600">
                        {lead.phone || lead.email || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-neutral-700">{lead.vendedor?.full_name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge className={leadStatusClass(lead.status)}>{leadStatusLabel(lead.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-neutral-500">
                        {formatDateTime(lead.distributed_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
