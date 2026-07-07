import { createFileRoute, Link } from "@tanstack/react-router";
import { InstitutionalHeader } from "@/components/landing/InstitutionalHeader";
import { InstitutionalFooter } from "@/components/landing/FaqAndFooterInstitutional";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";

import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Rocket,
  Gift,
  Share2,
  CheckCircle2,
  Sparkles,
  Users,
  TrendingUp,
  Wallet,
  HandshakeIcon,
  Send,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/seja-parceiro")({
  validateSearch: (s: Record<string, unknown>) => ({ ref: typeof s.ref === "string" ? s.ref.slice(0, 60) : "" }),

  head: () => ({
    meta: [
      { title: "Seja Parceiro NOX Fiança — Indique e ganhe R$ 50,00" },
      { name: "description", content: "Participe do programa de parceiros e indicação da NOX Fiança. Ganhe R$ 50,00 por cada indicação que fechar o primeiro contrato." },
      { property: "og:title", content: "Seja Parceiro NOX Fiança" },
      { property: "og:description", content: "Indique, conecte e ganhe com a plataforma que está transformando a garantia locatícia no Brasil." },
    ],
  }),
  component: SejaParceiroPage,
});

const formSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  telefone: z.string().trim().min(8).max(20),
  tipo: z.enum(["corretor", "imobiliaria", "proprietario", "influenciador", "consultor", "outro"]),
  cidade: z.string().trim().min(2).max(120),
  trabalhaLocacao: z.string().optional(),
  mensagem: z.string().trim().max(1000).optional().or(z.literal("")),
});

function SejaParceiroPage() {
  const { ref } = Route.useSearch();
  const [indicador, setIndicador] = useState<string | null>(null);
  const [form, setForm] = useState({ nome: "", email: "", telefone: "", tipo: "", cidade: "", trabalhaLocacao: "sim", mensagem: "" });
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    if (!ref) return;
    try { sessionStorage.setItem("nox_ref", ref); } catch {}
    (async () => {
      const { data } = await supabase.from("profiles").select("nome").eq("referral_code", ref).maybeSingle();
      if (data?.nome) setIndicador(String(data.nome).split(" ")[0]);
    })();
  }, [ref]);

  const submit = async () => {
    const parsed = formSchema.safeParse(form);
    if (!parsed.success) { toast.error("Preencha os campos obrigatórios corretamente."); return; }
    setLoading(true);
    const [cidade, uf] = (form.cidade.includes("/") ? form.cidade.split("/") : [form.cidade, "BR"]).map(s => s.trim());

    // Pega user_id se estiver logado
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const { error } = await supabase.from("affiliate_applications").insert({
      user_id: userId,
      full_name: form.nome,
      email: form.email,
      phone: form.telefone,
      partner_type: form.tipo as any,
      city: cidade,
      state: uf || null,
      works_with_rental: form.trabalhaLocacao === "sim",
      message: form.mensagem || null,
      status: "pendente",
    });

    // Lead paralelo
    await supabase.from("leads_contato").insert({
      perfil: form.tipo as any,
      nome: form.nome,
      email: form.email,
      telefone: form.telefone,
      cidade,
      uf: uf || "BR",
      mensagem: [form.mensagem, `Trabalha com locação: ${form.trabalhaLocacao}`].filter(Boolean).join("\n"),
      origem: "seja_parceiro",
      referral_code: ref || null,
    });

    setLoading(false);
    if (error) { toast.error("Erro ao enviar. Tente novamente."); return; }
    setEnviado(true);
    toast.success("Inscrição recebida. Nossa equipe analisará seu cadastro para liberar seu link de parceiro.");
  };

  const cadastroLink = ref ? `/cadastro?ref=${ref}` : "/cadastro";

  return (
    <div className="min-h-screen bg-white">
      <InstitutionalHeader />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 text-white">
        <div className="absolute -top-20 -right-20 w-[480px] h-[480px] bg-yellow-400/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-20 w-[480px] h-[480px] bg-yellow-400/10 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-24 pb-12 md:py-32">
          {indicador && (
            <Badge className="bg-yellow-400 text-neutral-900 border-0 mb-6 gap-1.5"><Sparkles size={14} /> Indicação de {indicador}</Badge>
          )}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-400/15 border border-yellow-400/30 text-yellow-300 text-xs font-bold uppercase tracking-widest mb-6 ml-0 md:ml-3">
            <HandshakeIcon size={14} /> Programa de Parceiros
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-black tracking-tight max-w-4xl leading-[1.05]">
            Seja parceiro da <span className="text-yellow-400">NOX Fiança</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-neutral-300 max-w-2xl">
            Indique, conecte e ganhe com a plataforma que está transformando a garantia locatícia no Brasil.
          </p>
          {ref && (
            <p className="mt-3 text-yellow-300 text-sm font-medium">Você foi convidado por um parceiro NOX.</p>
          )}
          <div className="mt-10 flex flex-wrap gap-3">
            <a href="#formulario"><Button size="lg" className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold gap-2">Quero ser parceiro <ArrowRight size={16} /></Button></a>
            <Link to="/cadastro" search={ref ? { ref } as any : undefined}>
              <Button size="lg" variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 font-bold">Entrar no programa de afiliados</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Indique e ganhe */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div className="rounded-3xl bg-gradient-to-br from-yellow-400 to-yellow-500 text-neutral-900 p-10 md:p-14">
          <Badge className="bg-neutral-900 text-yellow-400 border-0 gap-1.5"><Gift size={14} /> Programa de Indicação</Badge>
          <h2 className="mt-4 text-3xl sm:text-4xl md:text-5xl font-black tracking-tight">Indique e ganhe <span className="underline decoration-4 underline-offset-4">R$ 50,00</span></h2>
          <p className="mt-4 text-lg max-w-2xl text-neutral-900/85">Ganhe R$ 50,00 por cada pessoa indicada que usar seu link e fechar o primeiro contrato com sucesso na NOX Fiança.</p>

          <div className="mt-10 grid md:grid-cols-3 gap-4">
            {[
              { n: 1, t: "Compartilhe seu link", d: "Envie para corretores, imobiliárias e proprietários." },
              { n: 2, t: "O indicado cria cadastro", d: "Ele se registra usando seu link exclusivo." },
              { n: 3, t: "Você ganha R$ 50,00", d: "Recompensa liberada após o primeiro contrato aprovado." },
            ].map(s => (
              <div key={s.n} className="bg-neutral-900 text-white rounded-2xl p-6">
                <div className="w-10 h-10 rounded-full bg-yellow-400 text-neutral-900 grid place-items-center font-black">{s.n}</div>
                <p className="mt-4 font-bold text-lg">{s.t}</p>
                <p className="text-sm text-neutral-400 mt-1">{s.d}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 grid sm:grid-cols-3 gap-4">
            {[
              { ind: "5", val: "R$ 250,00" },
              { ind: "10", val: "R$ 500,00" },
              { ind: "20", val: "R$ 1.000,00" },
            ].map(c => (
              <div key={c.ind} className="bg-white/40 backdrop-blur border-2 border-neutral-900/10 rounded-2xl p-6 text-center">
                <p className="text-3xl font-black">{c.val}</p>
                <p className="text-xs uppercase tracking-widest font-bold mt-1">{c.ind} indicações convertidas</p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/cadastro" search={ref ? { ref } as any : undefined}><Button size="lg" className="bg-neutral-900 text-white hover:bg-neutral-800 font-bold">Criar minha conta</Button></Link>
            <a href="#formulario"><Button size="lg" variant="outline" className="border-neutral-900 text-neutral-900 hover:bg-neutral-900 hover:text-white font-bold">Entrar no programa de parceiros</Button></a>
            <Link to="/contato"><Button size="lg" variant="ghost" className="text-neutral-900 hover:bg-neutral-900/10 font-bold">Falar com a NOX</Button></Link>
          </div>
        </div>
      </section>

      {/* Para quem é */}
      <section className="bg-neutral-50 border-y border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-center">Para quem é o programa</h2>
          <div className="mt-12 grid md:grid-cols-4 gap-4">
            {[
              { t: "Corretores", d: "Aumente sua renda indicando colegas e clientes." },
              { t: "Imobiliárias", d: "Multiplique resultados com sua carteira." },
              { t: "Proprietários", d: "Compartilhe com sua rede e ganhe." },
              { t: "Influenciadores", d: "Monetize sua audiência do mercado imobiliário." },
            ].map(c => (
              <div key={c.t} className="bg-white border border-neutral-200 rounded-2xl p-6 text-center">
                <div className="w-12 h-12 mx-auto rounded-xl bg-yellow-400 text-neutral-900 grid place-items-center mb-3"><Users size={22} /></div>
                <p className="font-bold">{c.t}</p>
                <p className="text-sm text-neutral-500 mt-1">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefícios */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-center mb-12">Benefícios de ser parceiro</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { i: <Wallet size={20} />, t: "Renda extra", d: "Receba por indicação convertida." },
            { i: <Sparkles size={20} />, t: "Plataforma digital", d: "Acompanhe tudo pelo painel." },
            { i: <Rocket size={20} />, t: "Processo simples", d: "Compartilhe seu link e pronto." },
            { i: <Share2 size={20} />, t: "Marca profissional", d: "Associe-se a uma marca forte." },
            { i: <TrendingUp size={20} />, t: "Suporte especializado", d: "Time pronto para te apoiar." },
            { i: <CheckCircle2 size={20} />, t: "Acompanhamento", d: "Veja status e ganhos em tempo real." },
          ].map(b => (
            <div key={b.t} className="bg-white border border-neutral-200 rounded-2xl p-6 hover:border-yellow-400 transition">
              <div className="w-10 h-10 rounded-xl bg-neutral-900 text-yellow-400 grid place-items-center mb-3">{b.i}</div>
              <p className="font-bold">{b.t}</p>
              <p className="text-sm text-neutral-500 mt-1">{b.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Formulário */}
      <section id="formulario" className="bg-neutral-950 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">Quero ser parceiro</h2>
          <p className="mt-3 text-neutral-400">Preencha o formulário e nosso time entrará em contato.</p>
          {ref && <p className="mt-2 text-yellow-300 text-sm">Indicação registrada: <strong className="font-mono">{ref}</strong></p>}

          {enviado ? (
            <div className="mt-8 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-8 text-center">
              <CheckCircle2 className="mx-auto text-emerald-400" size={40} />
              <p className="mt-3 text-lg font-bold">Inscrição recebida.</p>
              <p className="text-neutral-400 mt-1">Nossa equipe analisará seu cadastro para liberar seu link de parceiro.</p>
            </div>
          ) : (
            <div className="mt-8 grid md:grid-cols-2 gap-4">
              <Field label="Nome completo *"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>
              <Field label="E-mail *"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>
              <Field label="WhatsApp *"><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>
              <Field label="Cidade/UF *"><Input placeholder="São Paulo/SP" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>
              <Field label="Tipo de parceiro *">
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="corretor">Corretor</SelectItem>
                    <SelectItem value="imobiliaria">Imobiliária</SelectItem>
                    <SelectItem value="proprietario">Proprietário</SelectItem>
                    <SelectItem value="influenciador">Influenciador</SelectItem>
                    <SelectItem value="consultor">Consultor</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Já trabalha com locação?">
                <Select value={form.trabalhaLocacao} onValueChange={(v) => setForm({ ...form, trabalhaLocacao: v })}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Mensagem" className="md:col-span-2"><Textarea rows={4} value={form.mensagem} onChange={(e) => setForm({ ...form, mensagem: e.target.value })} className="bg-white/5 border-white/10 text-white" /></Field>
              <div className="md:col-span-2">
                <Button onClick={submit} disabled={loading} size="lg" className="w-full bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold gap-2"><Send size={16} /> {loading ? "Enviando..." : "Enviar cadastro"}</Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-center mb-10">Perguntas frequentes</h2>
        <div className="space-y-3">
          {[
            { q: "Como recebo a recompensa de R$ 50,00?", a: "Quando seu indicado cadastrar usando seu link e fechar o primeiro contrato aprovado, a recompensa é liberada no seu painel de Indicações." },
            { q: "Posso indicar quantas pessoas?", a: "Não há limite. Quanto mais indicar e converter, mais você ganha." },
            { q: "Como acompanho minhas indicações?", a: "Pelo painel logado, na aba Indicação, você vê status, conversões e recompensas liberadas." },
            { q: "Quando recebo o pagamento?", a: "Após validação antifraude e aprovação do administrador, o pagamento é processado conforme as regras do programa." },
          ].map((f, i) => (
            <details key={i} className="bg-white border border-neutral-200 rounded-2xl p-5 group">
              <summary className="font-bold cursor-pointer list-none flex justify-between items-center">{f.q} <span className="text-yellow-600 group-open:rotate-45 transition">+</span></summary>
              <p className="mt-3 text-neutral-600 text-sm">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 sm:pb-24">
        <div className="rounded-3xl bg-neutral-950 text-white p-10 md:p-14 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="text-xl sm:text-2xl md:text-3xl font-black">Pronto para crescer como parceiro NOX?</h3>
            <p className="mt-2 text-neutral-400 max-w-xl">Cadastre-se, seja aprovado como afiliado e receba um link exclusivo para indicar novos clientes e gerar recompensas.</p>
          </div>
          <a href="#formulario"><Button size="lg" className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold">Quero ser parceiro</Button></a>
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
