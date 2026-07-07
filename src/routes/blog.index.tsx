import { createFileRoute, Link } from "@tanstack/react-router";
import { InstitutionalHeader } from "@/components/landing/InstitutionalHeader";
import { InstitutionalFooter } from "@/components/landing/FaqAndFooterInstitutional";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { Search, Clock, ArrowRight, BookOpen, Users, Home, Building2, Briefcase, Mail, Sparkles, TrendingUp, Shield, Flame, Calendar } from "lucide-react";
import { getAllPosts, CATEGORIAS, type BlogPost } from "@/lib/blog-posts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PostReactions } from "@/components/blog/PostReactions";

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: "Blog NOX Fiança — Locação, garantia locatícia e mercado imobiliário" },
      { name: "description", content: "Guias completos, dicas e novidades sobre garantia locatícia, seguro fiança, aluguel sem fiador e mercado imobiliário para corretores, imobiliárias, proprietários e inquilinos." },
      { name: "keywords", content: "garantia locatícia, seguro fiança, aluguel sem fiador, caução, fiador, locação, NOX Fiança" },
      { property: "og:title", content: "Blog NOX Fiança" },
      { property: "og:description", content: "Central de conteúdos sobre locação, garantia e mercado imobiliário." },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1600&auto=format&fit=crop" },
    ],
  }),
  component: BlogPage,
});

const HERO_IMG = "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1800&auto=format&fit=crop";

function BlogPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("Todas");
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [topLiked, setTopLiked] = useState<Array<{ post_slug: string; like_count: number }>>([]);

  const posts = useMemo(() => getAllPosts(), []);

  const filtrados = useMemo(() => posts.filter(p =>
    (cat === "Todas" || p.categoria === cat) &&
    (q.trim() === "" ||
      p.titulo.toLowerCase().includes(q.toLowerCase()) ||
      p.resumo.toLowerCase().includes(q.toLowerCase()) ||
      p.tags.some(t => t.toLowerCase().includes(q.toLowerCase())))
  ), [q, cat, posts]);

  const destaque = filtrados.find(p => p.destaque) ?? filtrados[0];
  const restantes = filtrados.filter(p => p.slug !== destaque?.slug);
  const recentes = posts.slice(0, 6);
  const guias = posts.filter(p => p.titulo.toLowerCase().includes("guia") || /(8|10) min/.test(p.leitura)).slice(0, 4);
  const inquilino = posts.filter(p => p.categoria === "Dicas para Inquilinos").slice(0, 3);
  const proprietario = posts.filter(p => p.categoria === "Dicas para Proprietários" || p.categoria === "Proprietários").slice(0, 3);

  // Carrega mais curtidos da semana
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("blog_post_reactions" as never)
        .select("post_slug, like_count")
        .order("like_count", { ascending: false })
        .limit(5);
      setTopLiked((data as any) ?? []);
    })();
  }, []);

  const maisCurtidos = useMemo(() => {
    const map = new Map(topLiked.map(r => [r.post_slug, r.like_count]));
    return posts
      .filter(p => map.has(p.slug) && (map.get(p.slug) ?? 0) > 0)
      .map(p => ({ post: p, likes: map.get(p.slug)! }))
      .slice(0, 4);
  }, [topLiked, posts]);

  async function inscrever(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      toast.error("Informe um e-mail válido");
      return;
    }
    setEnviando(true);
    try {
      const { error } = await supabase.from("leads_contato").insert({
        email: email.trim().toLowerCase(),
        nome: "Inscrito Newsletter",
        origem: "blog_newsletter",
        tipo_perfil: "interesse",
        status: "novo",
      } as never);
      if (error) throw error;
      toast.success("Inscrição confirmada! Em breve você receberá nossos conteúdos.");
      setEmail("");
    } catch {
      toast.error("Não foi possível inscrever. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <InstitutionalHeader />

      {/* HERO com imagem real */}
      <section className="relative overflow-hidden bg-neutral-950 text-white">
        <div className="absolute inset-0">
          <img src={HERO_IMG} alt="Conteúdos sobre aluguel e garantia locatícia" className="w-full h-full object-cover opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-br from-neutral-950 via-neutral-950/85 to-neutral-900/60" />
          <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-yellow-400/20 blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-24 pb-12 lg:py-32 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-400/15 border border-yellow-400/30 text-yellow-300 text-xs font-bold uppercase tracking-widest mb-6">
            <BookOpen size={14} /> Blog NOX
          </div>
          <h1 className="text-3xl sm:text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-black tracking-tight max-w-4xl leading-[1.05]">
            Conteúdos sobre locação, garantia e mercado imobiliário
          </h1>
          <p className="mt-6 text-lg md:text-xl text-neutral-300 max-w-2xl">
            Guias, dicas e novidades sobre aluguel, contratos, garantia locatícia, mercado imobiliário e tudo que envolve locação.
          </p>
          <div className="mt-8 relative max-w-2xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar artigos, categorias, tags..." className="pl-12 h-14 bg-white/5 border-white/15 text-white placeholder:text-neutral-500 text-base focus-visible:ring-yellow-400/40" />
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#publicacoes" className="bg-yellow-400 hover:bg-yellow-500 text-neutral-900 px-6 py-3 rounded-xl font-bold inline-flex items-center gap-2 transition-all active:scale-95 shadow-xl shadow-yellow-500/20">
              Ler publicações <ArrowRight size={16} />
            </a>
            <Link to="/simular" className="bg-white/10 hover:bg-white/20 backdrop-blur text-white border border-white/20 px-6 py-3 rounded-xl font-bold inline-flex items-center gap-2 transition-all active:scale-95">
              Solicitar análise
            </Link>
          </div>
        </div>
      </section>

      {/* CATEGORIAS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-6 px-6 md:mx-0 md:px-0 md:flex-wrap">
          {CATEGORIAS.map(c => (
            <button key={c} onClick={() => setCat(c)} className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition ${cat === c ? "bg-neutral-900 text-yellow-400" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>{c}</button>
          ))}
        </div>
      </section>

      {/* POST DESTAQUE */}
      {destaque && (
        <section id="publicacoes" className="max-w-7xl mx-auto px-4 sm:px-6 pb-12">
          <Link to="/blog/$slug" params={{ slug: destaque.slug }} className="block group">
            <div className="grid md:grid-cols-2 gap-0 rounded-3xl overflow-hidden bg-neutral-900 text-white shadow-2xl">
              <div className="p-10 md:p-14 flex flex-col justify-center order-2 md:order-1">
                <Badge className="bg-yellow-400 text-neutral-900 border-0 w-fit">{destaque.categoria}</Badge>
                <h2 className="mt-5 text-2xl sm:text-3xl md:text-4xl font-black tracking-tight leading-tight group-hover:text-yellow-300 transition-colors">{destaque.titulo}</h2>
                <p className="mt-4 text-neutral-300 text-lg">{destaque.resumo}</p>
                <p className="mt-6 text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-neutral-400">
                  <Clock size={14} /> {destaque.leitura} • <Calendar size={14} /> {destaque.data}
                </p>
                <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
                  <p className="inline-flex items-center gap-2 font-bold text-yellow-400 group-hover:gap-3 transition-all">Ler artigo <ArrowRight size={16} /></p>
                  <PostReactions slug={destaque.slug} />
                </div>
              </div>
              <div className="relative min-h-[280px] order-1 md:order-2 overflow-hidden">
                <img src={destaque.imageUrl} alt={destaque.titulo} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                <div className="absolute inset-0 bg-gradient-to-r from-neutral-900/40 to-transparent md:bg-gradient-to-l" />
              </div>
            </div>
          </Link>
        </section>
      )}

      {/* MAIS CURTIDOS */}
      {maisCurtidos.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-12">
          <div className="flex items-end justify-between gap-4 mb-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-yellow-700 flex items-center gap-2"><Flame size={14} /> Mais curtidos da semana</p>
              <h2 className="mt-2 text-xl sm:text-2xl md:text-3xl font-black tracking-tight">O que está bombando no blog</h2>
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {maisCurtidos.map(({ post, likes }) => (
              <Link key={post.slug} to="/blog/$slug" params={{ slug: post.slug }} className="bg-white border border-neutral-200 rounded-2xl overflow-hidden hover:border-yellow-400 hover:shadow-xl hover:-translate-y-1 transition-all group flex flex-col">
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img src={post.imageUrl} alt={post.titulo} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                  <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 bg-yellow-400 text-neutral-900 px-3 py-1 rounded-full text-xs font-black">
                    <Flame size={12} /> {likes}
                  </div>
                </div>
                <div className="p-5">
                  <Badge variant="outline" className="text-[10px]">{post.categoria}</Badge>
                  <h4 className="mt-2 font-bold leading-tight group-hover:text-yellow-700 transition">{post.titulo}</h4>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* GRID + SIDEBAR */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-12 sm:pb-16 grid lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-6">Posts recentes</h3>
          {restantes.length === 0 ? (
            <div className="bg-neutral-50 rounded-2xl p-12 text-center">
              <p className="text-neutral-500">Nenhum artigo encontrado.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
              {restantes.map(p => <PostCard key={p.slug} post={p} />)}
            </div>
          )}
        </div>

        <aside className="space-y-8">
          <div className="bg-neutral-50 rounded-2xl p-6 border border-neutral-200">
            <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-4 flex items-center gap-2"><TrendingUp size={14} /> Mais recentes</h3>
            <ol className="space-y-4">
              {recentes.map((p, i) => (
                <li key={p.slug}>
                  <Link to="/blog/$slug" params={{ slug: p.slug }} className="flex gap-3 group">
                    <span className="text-2xl font-black text-yellow-400 leading-none w-8 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <p className="text-sm font-bold leading-snug group-hover:text-yellow-700 transition">{p.titulo}</p>
                      <p className="mt-1 text-[11px] text-neutral-400">{p.leitura} • {p.data}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </div>

          <div className="bg-gradient-to-br from-neutral-900 to-neutral-800 text-white rounded-2xl p-6">
            <Mail size={24} className="text-yellow-400" />
            <h3 className="mt-3 text-lg font-bold">Receba conteúdos sobre aluguel e garantia locatícia</h3>
            <p className="mt-1 text-sm text-neutral-300">Cadastre seu e-mail e fique por dentro.</p>
            <form onSubmit={inscrever} className="mt-4 space-y-2">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" className="bg-white/10 border-white/10 text-white placeholder:text-neutral-500" />
              <Button type="submit" disabled={enviando} className="w-full bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold">{enviando ? "Enviando..." : "Quero receber"}</Button>
            </form>
          </div>
        </aside>
      </section>

      {/* DICAS POR PERFIL */}
      {(inquilino.length > 0 || proprietario.length > 0) && (
        <section className="bg-neutral-50 py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-10">
            {inquilino.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-yellow-700 flex items-center gap-2"><Users size={14} /> Dicas para inquilinos</p>
                <h3 className="mt-2 text-xl sm:text-2xl md:text-3xl font-black tracking-tight mb-6">Para quem quer alugar</h3>
                <div className="space-y-4">
                  {inquilino.map(p => <PostCardCompact key={p.slug} post={p} />)}
                </div>
              </div>
            )}
            {proprietario.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-yellow-700 flex items-center gap-2"><Home size={14} /> Dicas para proprietários</p>
                <h3 className="mt-2 text-xl sm:text-2xl md:text-3xl font-black tracking-tight mb-6">Para quem aluga seu imóvel</h3>
                <div className="space-y-4">
                  {proprietario.map(p => <PostCardCompact key={p.slug} post={p} />)}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* GUIAS COMPLETOS */}
      {guias.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
          <div className="flex items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-yellow-700">Guias completos</p>
              <h2 className="mt-2 text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">Conteúdos aprofundados</h2>
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {guias.map(p => (
              <Link key={p.slug} to="/blog/$slug" params={{ slug: p.slug }} className="bg-white border border-neutral-200 rounded-2xl overflow-hidden hover:border-yellow-400 hover:shadow-md hover:-translate-y-1 transition-all group">
                <div className="aspect-[16/10] overflow-hidden">
                  <img src={p.imageUrl} alt={p.titulo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                </div>
                <div className="p-5">
                  <Sparkles size={18} className="text-yellow-500" />
                  <Badge variant="outline" className="text-[10px] mt-2">{p.categoria}</Badge>
                  <h4 className="mt-2 font-bold leading-tight group-hover:text-yellow-700 transition">{p.titulo}</h4>
                  <p className="mt-3 text-xs text-neutral-400 flex items-center gap-2"><Clock size={12} /> {p.leitura}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* PARA QUEM */}
      <section className="bg-neutral-50 py-16">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-xs font-bold uppercase tracking-widest text-yellow-700">Para quem é o conteúdo</p>
          <h2 className="mt-2 text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">Conteúdo para todos os perfis</h2>
          <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: Users, label: "Para inquilinos", desc: "Como alugar sem fiador com segurança", cat: "Dicas para Inquilinos" },
              { icon: Home, label: "Para proprietários", desc: "Proteja seu aluguel da inadimplência", cat: "Dicas para Proprietários" },
              { icon: Briefcase, label: "Para corretores", desc: "Venda mais com garantia locatícia", cat: "Corretores" },
              { icon: Building2, label: "Para imobiliárias", desc: "Escale sua carteira com tecnologia", cat: "Imobiliárias" },
            ].map(({ icon: Icon, label, desc, cat: c }) => (
              <button key={label} onClick={() => { setCat(c); window.scrollTo({ top: 600, behavior: "smooth" }); }} className="text-left bg-white border border-neutral-200 rounded-2xl p-6 hover:border-yellow-400 hover:shadow-md transition">
                <div className="w-12 h-12 rounded-xl bg-yellow-400/15 grid place-items-center">
                  <Icon size={22} className="text-yellow-700" />
                </div>
                <p className="mt-4 font-bold">{label}</p>
                <p className="mt-1 text-sm text-neutral-500">{desc}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div className="rounded-3xl bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 text-white p-10 md:p-16 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,214,10,0.18),transparent_60%)]" />
          <div className="relative">
            <Shield size={40} className="mx-auto text-yellow-400" />
            <h2 className="mt-4 text-3xl md:text-5xl font-black tracking-tight">Pronto para simplificar sua locação?</h2>
            <p className="mt-3 text-neutral-300 max-w-xl mx-auto">A NOX Fiança conecta inquilinos, proprietários, corretores e imobiliárias em uma jornada digital, simples e segura.</p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/simular"><Button size="lg" className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold">Solicitar análise</Button></Link>
              <Link to="/seja-parceiro"><Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">Seja parceiro</Button></Link>
            </div>
          </div>
        </div>
      </section>

      <InstitutionalFooter />
    </div>
  );
}

/* ────────── CARDS ────────── */
function PostCard({ post }: { post: BlogPost }) {
  return (
    <Link to="/blog/$slug" params={{ slug: post.slug }} className="bg-white border border-neutral-200 rounded-2xl overflow-hidden hover:border-yellow-400 hover:shadow-xl hover:-translate-y-1 transition-all group flex flex-col">
      <div className="aspect-[16/9] overflow-hidden">
        <img src={post.imageUrl} alt={post.titulo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
      </div>
      <div className="p-5 flex flex-col flex-1">
        <Badge variant="outline" className="text-[10px] w-fit">{post.categoria}</Badge>
        <h4 className="mt-3 font-bold text-lg leading-tight group-hover:text-yellow-700 transition">{post.titulo}</h4>
        <p className="mt-2 text-sm text-neutral-500 line-clamp-2 flex-1">{post.resumo}</p>
        <p className="mt-4 text-xs text-neutral-400 flex items-center gap-2"><Clock size={12} /> {post.leitura} • {post.data}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-yellow-700 inline-flex items-center gap-1 group-hover:gap-2 transition-all">Ler artigo <ArrowRight size={12} /></span>
          <PostReactions slug={post.slug} />
        </div>
      </div>
    </Link>
  );
}

function PostCardCompact({ post }: { post: BlogPost }) {
  return (
    <Link to="/blog/$slug" params={{ slug: post.slug }} className="flex gap-4 bg-white border border-neutral-200 rounded-2xl p-3 hover:border-yellow-400 hover:shadow-md transition group">
      <div className="w-28 h-24 rounded-xl overflow-hidden shrink-0">
        <img src={post.imageUrl} alt={post.titulo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
      </div>
      <div className="flex-1 min-w-0">
        <Badge variant="outline" className="text-[10px]">{post.categoria}</Badge>
        <h4 className="mt-1 font-bold leading-snug line-clamp-2 group-hover:text-yellow-700 transition">{post.titulo}</h4>
        <p className="mt-1 text-[11px] text-neutral-400 flex items-center gap-1.5"><Clock size={11} /> {post.leitura}</p>
      </div>
    </Link>
  );
}
