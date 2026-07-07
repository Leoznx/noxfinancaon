import { createFileRoute, Link } from "@tanstack/react-router";
import { InstitutionalHeader } from "@/components/landing/InstitutionalHeader";
import { InstitutionalFooter } from "@/components/landing/FaqAndFooterInstitutional";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Sparkles,
  Rocket,
  Users,
  Lock,
  Zap,
  Target,
  Award,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/sobre")({
  head: () => ({
    meta: [
      { title: "Sobre a NOX Fiança — A nova forma de garantir locações" },
      { name: "description", content: "Conheça a NOX Fiança: plataforma nacional de garantia locatícia que conecta corretores, imobiliárias, proprietários e inquilinos com tecnologia, segurança e agilidade." },
      { property: "og:title", content: "Sobre a NOX Fiança" },
      { property: "og:description", content: "A nova forma de garantir locações no Brasil — digital, segura e nacional." },
    ],
  }),
  component: SobrePage,
});

function SobrePage() {
  return (
    <div className="min-h-screen bg-white">
      <InstitutionalHeader />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 text-white">
        <div className="absolute -top-20 -right-20 w-[480px] h-[480px] bg-yellow-400/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-[420px] h-[420px] bg-yellow-400/5 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-28 pb-16 sm:py-24 md:py-32">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-400/15 border border-yellow-400/30 text-yellow-300 text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-6">
            <Sparkles size={14} /> Sobre a NOX
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-black tracking-tight max-w-4xl leading-[1.1]">
            A nova forma de <span className="text-yellow-400">garantir locações</span> no Brasil
          </h1>
          <p className="mt-5 text-base sm:text-lg md:text-xl text-neutral-300 max-w-2xl">
            A NOX Fiança conecta corretores, imobiliárias, proprietários e inquilinos em uma experiência mais rápida, segura e digital.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/simular">
              <Button size="lg" className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold gap-2">Conheça nossos planos <ArrowRight size={16} /></Button>
            </Link>
            <Link to="/contato">
              <Button size="lg" variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 font-bold">Fale com a NOX</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Quem somos */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-yellow-600 mb-3">Quem somos</p>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">Tecnologia, segurança e simplicidade para a locação brasileira.</h2>
            <p className="mt-5 text-neutral-600 text-lg leading-relaxed">
              A NOX nasceu para reinventar a garantia locatícia. Substituímos burocracia por um fluxo 100% digital, com análise inteligente, contratação em minutos e suporte humano em todo o país.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Plataforma nacional e digital",
                "Análise de crédito automatizada",
                "Suporte especializado para imobiliárias e corretores",
                "Pagamentos, sinistros e relatórios em um só lugar",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2 text-neutral-700"><CheckCircle2 size={18} className="text-emerald-500 mt-1 shrink-0" /> {t}</li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { i: <Users size={22} />, t: "+ corretores", d: "Rede ativa em todo o Brasil" },
              { i: <ShieldCheck size={22} />, t: "Proteção", d: "Cobertura completa do contrato" },
              { i: <Zap size={22} />, t: "Agilidade", d: "Aprovação em poucos minutos" },
              { i: <Award size={22} />, t: "Confiança", d: "Plataforma reconhecida no mercado" },
            ].map((c) => (
              <div key={c.t} className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
                <div className="w-10 h-10 rounded-xl bg-yellow-400/15 text-yellow-700 grid place-items-center mb-3">{c.i}</div>
                <p className="font-bold">{c.t}</p>
                <p className="text-sm text-neutral-500">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Missão */}
      <section className="bg-neutral-50 border-y border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20 grid md:grid-cols-3 gap-6">
          {[
            { i: <Target size={22} />, t: "Missão", d: "Democratizar a garantia locatícia, tornando o aluguel mais simples, seguro e acessível para todos." },
            { i: <Rocket size={22} />, t: "Visão", d: "Ser a maior plataforma de garantia locatícia digital do Brasil, referência em tecnologia e atendimento." },
            { i: <Sparkles size={22} />, t: "Valores", d: "Transparência, agilidade, segurança, parceria e foco no cliente." },
          ].map((c) => (
            <div key={c.t} className="bg-white border border-neutral-200 rounded-2xl p-7">
              <div className="w-11 h-11 rounded-xl bg-neutral-900 text-yellow-400 grid place-items-center mb-4">{c.i}</div>
              <h3 className="text-xl font-bold">{c.t}</h3>
              <p className="mt-2 text-neutral-600">{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Como funcionamos */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-xs font-bold uppercase tracking-widest text-yellow-600 mb-3">Como funcionamos</p>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">Do cadastro ao contrato em minutos</h2>
        </div>
        <div className="grid md:grid-cols-4 gap-4">
          {[
            { n: 1, t: "Cadastro digital", d: "Crie sua conta em minutos, sem burocracia." },
            { n: 2, t: "Análise inteligente", d: "Nossa engine avalia o inquilino com segurança." },
            { n: 3, t: "Aprovação", d: "Aprovamos contratos com agilidade e clareza." },
            { n: 4, t: "Acompanhamento", d: "Painel completo, pagamentos e relatórios." },
          ].map((s) => (
            <div key={s.n} className="bg-white border border-neutral-200 rounded-2xl p-6">
              <div className="w-9 h-9 rounded-full bg-yellow-400 text-neutral-900 grid place-items-center font-black">{s.n}</div>
              <p className="mt-4 font-bold">{s.t}</p>
              <p className="text-sm text-neutral-500">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Por que NOX */}
      <section className="bg-neutral-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-yellow-400 mb-3">Por que escolher a NOX</p>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">Mais que garantia, parceria.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { i: <Lock size={20} />, t: "Segurança", d: "Dados protegidos, conformidade total com LGPD." },
              { i: <Zap size={20} />, t: "Velocidade", d: "Análise e contratação em minutos, sem papelada." },
              { i: <Users size={20} />, t: "Parceria", d: "Programa de indicação, suporte e plano de carreira." },
              { i: <ShieldCheck size={20} />, t: "Cobertura", d: "Proteção completa do contrato locatício." },
              { i: <Award size={20} />, t: "Reconhecimento", d: "Níveis, comissões e premiações para parceiros." },
              { i: <Rocket size={20} />, t: "Inovação", d: "Tecnologia que evolui junto com o mercado." },
            ].map((b) => (
              <div key={b.t} className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition">
                <div className="w-10 h-10 rounded-xl bg-yellow-400 text-neutral-900 grid place-items-center mb-3">{b.i}</div>
                <p className="font-bold">{b.t}</p>
                <p className="text-sm text-neutral-400 mt-1">{b.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Números */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { v: "100%", l: "Digital" },
            { v: "24/7", l: "Plataforma disponível" },
            { v: "Min.", l: "Tempo de aprovação" },
            { v: "BR", l: "Cobertura nacional" },
          ].map((s) => (
            <div key={s.l} className="bg-gradient-to-br from-neutral-900 to-neutral-800 text-white rounded-2xl p-7 text-center">
              <p className="text-3xl md:text-4xl font-black text-yellow-400">{s.v}</p>
              <p className="text-xs uppercase tracking-widest text-neutral-400 mt-2">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 sm:pb-24">
        <div className="rounded-3xl bg-gradient-to-br from-yellow-400 to-yellow-500 text-neutral-900 p-6 sm:p-10 md:p-14 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="text-xl sm:text-2xl md:text-3xl font-black">Pronto para fazer parte da NOX?</h3>
            <p className="mt-2 text-neutral-900/80 max-w-xl">Cadastre-se agora ou converse com nosso time. Sua próxima locação começa aqui.</p>
          </div>
          <div className="flex gap-3">
            <Link to="/cadastro"><Button size="lg" className="bg-neutral-900 text-white hover:bg-neutral-800 font-bold">Criar conta</Button></Link>
            <Link to="/contato"><Button size="lg" variant="outline" className="border-neutral-900 text-neutral-900 hover:bg-neutral-900 hover:text-white font-bold">Falar com a NOX</Button></Link>
          </div>
        </div>
      </section>

      <InstitutionalFooter />
    </div>
  );
}
