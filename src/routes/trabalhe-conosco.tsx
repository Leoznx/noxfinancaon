import { createFileRoute, Link } from "@tanstack/react-router";
import { InstitutionalHeader } from "@/components/landing/InstitutionalHeader";
import { InstitutionalFooter } from "@/components/landing/FaqAndFooterInstitutional";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Briefcase, Heart, Sparkles, Rocket, Code, Headphones, Wallet, Scale, Megaphone,
  Send, CheckCircle2, MapPin, Building2, FileUp, Users, TrendingUp, Layers,
} from "lucide-react";
import { z } from "zod";

export const Route = createFileRoute("/trabalhe-conosco")({
  head: () => ({
    meta: [
      { title: "Trabalhe conosco — Faça parte do time NOX Fiança" },
      { name: "description", content: "Construa o futuro da garantia locatícia com a NOX. Veja vagas abertas e envie seu currículo em PDF para fazer parte do time." },
      { property: "og:title", content: "Trabalhe conosco — NOX Fiança" },
      { property: "og:description", content: "Vagas abertas e candidatura espontânea para entrar no time NOX." },
    ],
  }),
  component: TrabalheConoscoPage,
});

const AREAS = [
  { i: <Briefcase size={20} />, t: "Comercial", d: "Vendas, parcerias e expansão." },
  { i: <Headphones size={20} />, t: "Atendimento", d: "Suporte para clientes e parceiros." },
  { i: <Wallet size={20} />, t: "Financeiro", d: "Operação, faturamento e cobrança." },
  { i: <Scale size={20} />, t: "Jurídico", d: "Contratos, compliance e LGPD." },
  { i: <Megaphone size={20} />, t: "Marketing", d: "Conteúdo, growth e branding." },
  { i: <Code size={20} />, t: "Tecnologia", d: "Engenharia, dados e produto." },
  { i: <Layers size={20} />, t: "Operações", d: "Processos e excelência operacional." },
];

const POR_QUE = [
  { i: <TrendingUp size={20} />, t: "Crescimento acelerado", d: "Plataforma em expansão nacional." },
  { i: <Briefcase size={20} />, t: "Ambiente comercial forte", d: "Time focado em resultado." },
  { i: <Sparkles size={20} />, t: "Tecnologia no imobiliário", d: "Produto digital de ponta." },
  { i: <Rocket size={20} />, t: "Oportunidade de desenvolvimento", d: "Trilha clara de carreira." },
  { i: <Heart size={20} />, t: "Cultura de resultado", d: "Pessoas e performance." },
  { i: <Users size={20} />, t: "Time em expansão", d: "Vagas em várias áreas." },
];

const schema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome completo").max(120),
  email: z.string().trim().email("E-mail inválido").max(255),
  telefone: z.string().trim().min(8, "Informe o WhatsApp").max(20),
  area: z.string().min(1, "Selecione a área de interesse"),
  cidade: z.string().trim().min(2, "Informe cidade/UF").max(120),
  linkedin: z.string().trim().max(255).optional().or(z.literal("")),
  mensagem: z.string().trim().max(1000).optional().or(z.literal("")),
});

type Vaga = {
  id: string; title: string; area: string; work_model: string;
  city: string | null; state: string | null; contract_type: string | null;
  published_at: string | null;
};

function TrabalheConoscoPage() {
  const [vagas, setVagas] = useState<Vaga[]>([]);
  const [vagaSelecionada, setVagaSelecionada] = useState<string>("");
  const [form, setForm] = useState({ nome: "", email: "", telefone: "", area: "", cidade: "", linkedin: "", mensagem: "" });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("job_openings")
        .select("id,title,area,work_model,city,state,contract_type,published_at")
        .eq("status", "aberta")
        .order("published_at", { ascending: false, nullsFirst: false });
      setVagas((data ?? []) as Vaga[]);
    })();
  }, []);

  const handleFile = (f: File | null) => {
    setFileError("");
    if (!f) { setFile(null); return; }
    if (f.type !== "application/pdf") {
      setFileError("Formato inválido. Envie apenas arquivo PDF.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setFileError("Arquivo maior que 10MB. Reduza o tamanho do PDF.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(f);
  };

  const candidatar = (vagaId: string, area: string) => {
    setVagaSelecionada(vagaId);
    setForm(f => ({ ...f, area }));
    document.getElementById("formulario")?.scrollIntoView({ behavior: "smooth" });
  };

  const submit = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!file) {
      setFileError("Envie seu currículo em PDF para continuar.");
      toast.error("Envie seu currículo em PDF para continuar.");
      return;
    }
    setLoading(true);
    try {
      const [city, state] = (form.cidade.includes("/") ? form.cidade.split("/") : [form.cidade, ""]).map(s => s.trim());
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${new Date().getFullYear()}/${crypto.randomUUID()}-${safeName}`;

      const up = await supabase.storage.from("curriculos").upload(path, file, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (up.error) throw up.error;

      const ins = await supabase.from("job_applications").insert({
        job_id: vagaSelecionada || null,
        full_name: form.nome,
        email: form.email,
        phone: form.telefone,
        city: city || null,
        state: state || null,
        area_interest: form.area,
        linkedin_url: form.linkedin || null,
        message: form.mensagem || null,
        resume_file_path: up.data.path,
        resume_file_name: file.name,
        source: vagaSelecionada ? "vaga_especifica" : "candidatura_espontanea",
      });
      if (ins.error) throw ins.error;

      // Lead paralelo
      await supabase.from("leads_contato").insert({
        perfil: "candidato",
        nome: form.nome,
        email: form.email,
        telefone: form.telefone,
        cidade: city || "",
        uf: state || "BR",
        mensagem: [form.mensagem, form.linkedin ? `LinkedIn: ${form.linkedin}` : null].filter(Boolean).join("\n"),
        origem: "trabalhe_conosco",
        area_interesse: form.area,
      });

      setEnviado(true);
      toast.success("Currículo enviado com sucesso.");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao enviar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <InstitutionalHeader />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 text-white">
        <div className="absolute -top-20 -right-20 w-[480px] h-[480px] bg-yellow-400/10 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-24 pb-12 md:py-28">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-400/15 border border-yellow-400/30 text-yellow-300 text-xs font-bold uppercase tracking-widest mb-6">
            <Rocket size={14} /> Trabalhe na NOX
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-black tracking-tight max-w-4xl leading-[1.05]">
            Faça parte do <span className="text-yellow-400">time NOX</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-neutral-300 max-w-2xl">
            Estamos construindo uma plataforma nacional de garantia locatícia e queremos pessoas boas ao nosso lado.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <a href="#vagas"><Button size="lg" className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold">Ver vagas abertas</Button></a>
            <a href="#formulario"><Button size="lg" variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 font-bold">Enviar currículo</Button></a>
          </div>
        </div>
      </section>

      {/* Por que NOX */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-center">Por que trabalhar na NOX</h2>
        <div className="mt-12 grid md:grid-cols-3 gap-4">
          {POR_QUE.map(c => (
            <div key={c.t} className="bg-white border border-neutral-200 rounded-2xl p-6 hover:border-yellow-400 transition">
              <div className="w-11 h-11 rounded-xl bg-yellow-400/15 text-yellow-700 grid place-items-center mb-3">{c.i}</div>
              <p className="font-bold">{c.t}</p>
              <p className="text-sm text-neutral-500 mt-1">{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Áreas */}
      <section className="bg-neutral-50 border-y border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-center mb-12">Áreas de atuação</h2>
          <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4">
            {AREAS.map(a => (
              <div key={a.t} className="bg-white border border-neutral-200 rounded-2xl p-6 hover:shadow-md transition">
                <div className="w-11 h-11 rounded-xl bg-neutral-900 text-yellow-400 grid place-items-center mb-3">{a.i}</div>
                <p className="font-bold">{a.t}</p>
                <p className="text-sm text-neutral-500 mt-1">{a.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Vagas abertas */}
      <section id="vagas" className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight mb-8">Vagas abertas</h2>
        {vagas.length === 0 ? (
          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-10 text-center">
            <Briefcase className="mx-auto text-neutral-400" size={40} />
            <p className="mt-3 font-bold text-neutral-700">No momento não temos vagas abertas.</p>
            <p className="text-sm text-neutral-500 mt-1">Envie seu currículo como candidatura espontânea — vamos avaliar seu perfil para futuras oportunidades.</p>
            <a href="#formulario" className="inline-block mt-5"><Button className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold">Enviar currículo</Button></a>
          </div>
        ) : (
          <div className="space-y-3">
            {vagas.map(v => (
              <div key={v.id} className="bg-white border border-neutral-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:border-yellow-400 transition">
                <div className="flex-1">
                  <p className="font-bold">{v.title}</p>
                  <p className="text-sm text-neutral-500 flex flex-wrap gap-x-3 gap-y-1 mt-1">
                    <span className="inline-flex items-center gap-1"><Building2 size={14} /> {v.area}</span>
                    <span className="inline-flex items-center gap-1 capitalize">{v.work_model}</span>
                    {(v.city || v.state) && <span className="inline-flex items-center gap-1"><MapPin size={14} /> {[v.city, v.state].filter(Boolean).join("/")}</span>}
                    {v.contract_type && <span>• {v.contract_type}</span>}
                  </p>
                </div>
                <Button onClick={() => candidatar(v.id, v.area)} variant={vagaSelecionada === v.id ? "default" : "outline"} className={vagaSelecionada === v.id ? "bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold" : "font-bold"}>
                  {vagaSelecionada === v.id ? "Selecionada" : "Candidatar-se"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Formulário */}
      <section id="formulario" className="bg-neutral-950 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">Envie seu currículo</h2>
          <p className="mt-3 text-neutral-400">
            {vagaSelecionada
              ? `Candidatura para a vaga: ${vagas.find(v => v.id === vagaSelecionada)?.title}`
              : "Candidatura espontânea — vamos avaliar seu perfil para oportunidades compatíveis."}
          </p>
          {vagaSelecionada && (
            <button onClick={() => setVagaSelecionada("")} className="text-yellow-300 text-xs underline mt-1">Limpar vaga selecionada</button>
          )}

          {enviado ? (
            <div className="mt-8 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-8 text-center">
              <CheckCircle2 className="mx-auto text-emerald-400" size={40} />
              <p className="mt-3 text-lg font-bold">Currículo enviado com sucesso.</p>
              <p className="text-neutral-400 mt-1">Nosso time avaliará seu perfil e entrará em contato se houver uma oportunidade compatível.</p>
            </div>
          ) : (
            <div className="mt-8 grid md:grid-cols-2 gap-4">
              <Field label="Nome completo *"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>
              <Field label="E-mail *"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>
              <Field label="WhatsApp *"><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>
              <Field label="Cidade/UF *"><Input placeholder="São Paulo/SP" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>
              <Field label="Área de interesse *">
                <Select value={form.area} onValueChange={(v) => setForm({ ...form, area: v })}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{AREAS.map(a => <SelectItem key={a.t} value={a.t}>{a.t}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="LinkedIn (opcional)"><Input placeholder="https://linkedin.com/in/..." value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>
              <Field label="Mensagem (opcional)" className="md:col-span-2"><Textarea rows={3} value={form.mensagem} onChange={(e) => setForm({ ...form, mensagem: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>

              <Field label="Anexe seu currículo em PDF *" className="md:col-span-2">
                <label className="flex items-center justify-between gap-3 bg-white/5 border border-dashed border-white/20 rounded-xl p-4 cursor-pointer hover:border-yellow-400/60 transition">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-yellow-400 text-neutral-900 grid place-items-center"><FileUp size={18} /></div>
                    <div>
                      <p className="text-sm font-bold">{file ? file.name : "Selecionar arquivo PDF"}</p>
                      <p className="text-xs text-neutral-400">Apenas PDF • até 10MB</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-yellow-300 underline">{file ? "Trocar" : "Escolher"}</span>
                  <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
                </label>
                {fileError && <p className="text-red-400 text-xs mt-2">{fileError}</p>}
              </Field>

              <div className="md:col-span-2">
                <Button onClick={submit} disabled={loading} size="lg" className="w-full bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold gap-2"><Send size={16} /> {loading ? "Enviando..." : "Enviar currículo"}</Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* CTA final */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div className="rounded-3xl bg-gradient-to-br from-yellow-400 to-yellow-500 text-neutral-900 p-10 md:p-14 text-center">
          <h3 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">Pronto para construir o futuro da locação com a NOX?</h3>
          <p className="mt-3 text-neutral-900/85 max-w-2xl mx-auto">Envie seu currículo e venha fazer parte de um time que está transformando o mercado imobiliário.</p>
          <a href="#formulario" className="inline-block mt-6"><Button size="lg" className="bg-neutral-900 text-white hover:bg-neutral-800 font-bold">Enviar currículo</Button></a>
        </div>
      </section>

      <InstitutionalFooter hideCta />
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs uppercase tracking-widest text-neutral-400 font-bold">{label}</Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
