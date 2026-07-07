import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { InstitutionalHeader } from "@/components/landing/InstitutionalHeader";
import { InstitutionalFooter } from "@/components/landing/FaqAndFooterInstitutional";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock, ArrowRight, User, Calendar, AlertCircle, Sparkles, Share2 } from "lucide-react";
import { getPostBySlug, getRelatedPosts, type BlogPost } from "@/lib/blog-posts";
import { useMemo } from "react";
import { PostReactions } from "@/components/blog/PostReactions";
import { toast } from "sonner";

export const Route = createFileRoute("/blog/$slug")({
  head: ({ loaderData }: { loaderData?: { post: BlogPost } }) => {
    const post = loaderData?.post;
    const url = post ? `/blog/${post.slug}` : "/blog";
    return {
      meta: [
        { title: post ? `${post.titulo} — Blog NOX Fiança` : "Artigo — Blog NOX Fiança" },
        { name: "description", content: post?.resumo ?? "Conteúdos sobre garantia locatícia." },
        { name: "keywords", content: post?.tags.join(", ") ?? "" },
        { name: "author", content: post?.autor ?? "NOX Fiança" },
        { property: "og:title", content: post?.titulo ?? "Blog NOX Fiança" },
        { property: "og:description", content: post?.resumo ?? "" },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { property: "article:section", content: post?.categoria ?? "" },
        { property: "article:published_time", content: post?.data ?? "" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: post?.titulo ?? "" },
        { name: "twitter:description", content: post?.resumo ?? "" },
        ...(post?.imageUrl ? [
          { property: "og:image", content: post.imageUrl },
          { name: "twitter:image", content: post.imageUrl },
        ] : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: post ? [{
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: post.titulo,
          description: post.resumo,
          author: { "@type": "Organization", name: post.autor },
          publisher: { "@type": "Organization", name: "NOX Fiança" },
          datePublished: post.data,
          articleSection: post.categoria,
          keywords: post.tags.join(", "),
        }),
      }] : [],
    };
  },
  loader: ({ params }): { post: BlogPost } => {
    const post = getPostBySlug(params.slug);
    if (!post) throw notFound();
    return { post };
  },
  notFoundComponent: () => (
    <div className="min-h-screen grid place-items-center bg-white">
      <div className="text-center">
        <p className="text-neutral-500">Artigo não encontrado.</p>
        <Link to="/blog"><Button variant="outline" className="mt-4">Voltar ao blog</Button></Link>
      </div>
    </div>
  ),
  errorComponent: () => <div className="min-h-screen grid place-items-center">Erro ao carregar artigo.</div>,
  component: PostPage,
});

function PostPage() {
  const { post } = Route.useLoaderData() as { post: BlogPost };
  const relacionados = useMemo(() => getRelatedPosts(post.slug, post.categoria, 3), [post]);
  const indice = useMemo(() => post.conteudo.filter((b): b is { tipo: "h2"; texto: string } => b.tipo === "h2").map((b, i) => ({ id: `sec-${i}`, texto: b.texto })), [post]);

  let h2Index = -1;

  return (
    <div className="min-h-screen bg-white">
      <InstitutionalHeader />

      <article className="max-w-6xl mx-auto px-6 py-12 md:py-16">
        <Link to="/blog" className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 mb-6"><ArrowLeft size={16} /> Voltar ao blog</Link>

        <header className="max-w-3xl">
          <Badge className="bg-yellow-400 text-neutral-900 border-0">{post.categoria}</Badge>
          <h1 className="mt-4 text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05]">{post.titulo}</h1>
          <p className="mt-4 text-lg text-neutral-600">{post.resumo}</p>
          <div className="mt-5 flex flex-wrap gap-4 text-sm text-neutral-500">
            <span className="inline-flex items-center gap-1.5"><User size={14} /> {post.autor}</span>
            <span className="inline-flex items-center gap-1.5"><Calendar size={14} /> {post.data}</span>
            <span className="inline-flex items-center gap-1.5"><Clock size={14} /> {post.leitura}</span>
          </div>
        </header>

        <div className="mt-10 aspect-[21/9] rounded-3xl overflow-hidden shadow-2xl">
          <img src={post.imageUrl} alt={post.titulo} className="w-full h-full object-cover" />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <PostReactions slug={post.slug} variant="page" />
          <Button
            variant="outline"
            onClick={async () => {
              const url = typeof window !== "undefined" ? window.location.href : "";
              try {
                if (navigator.share) await navigator.share({ title: post.titulo, text: post.resumo, url });
                else { await navigator.clipboard.writeText(url); toast.success("Link copiado!"); }
              } catch { /* cancelado */ }
            }}
            className="font-bold"
          >
            <Share2 size={16} className="mr-2" /> Compartilhar
          </Button>
        </div>

        <div className="mt-12 grid lg:grid-cols-[1fr_280px] gap-12">
          <div className="min-w-0">
            {post.conteudo.map((bloco, i) => {
              if (bloco.tipo === "p") return <p key={i} className="mt-5 text-neutral-700 leading-relaxed text-[17px]">{bloco.texto}</p>;
              if (bloco.tipo === "h2") { h2Index++; return <h2 key={i} id={`sec-${h2Index}`} className="mt-12 text-2xl md:text-3xl font-black tracking-tight scroll-mt-24">{bloco.texto}</h2>; }
              if (bloco.tipo === "h3") return <h3 key={i} className="mt-8 text-xl font-bold tracking-tight">{bloco.texto}</h3>;
              if (bloco.tipo === "lista") return (
                <ul key={i} className="mt-5 space-y-2">
                  {bloco.itens.map((it, j) => (
                    <li key={j} className="flex gap-3 text-neutral-700 text-[17px]"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0" />{it}</li>
                  ))}
                </ul>
              );
              if (bloco.tipo === "tabela") return (
                <div key={i} className="mt-6 overflow-x-auto rounded-2xl border border-neutral-200">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50">
                      <tr>{bloco.cabecalho.map((c, k) => <th key={k} className="text-left px-4 py-3 font-bold text-neutral-700">{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {bloco.linhas.map((l, k) => (
                        <tr key={k} className="border-t border-neutral-200">{l.map((cel, m) => <td key={m} className="px-4 py-3 text-neutral-700">{cel}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
              if (bloco.tipo === "cta") return (
                <div key={i} className="mt-10 rounded-2xl bg-gradient-to-br from-yellow-400 to-yellow-500 text-neutral-900 p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <p className="font-black text-xl">{bloco.titulo}</p>
                    <p className="mt-1 text-sm text-neutral-900/80">{bloco.texto}</p>
                  </div>
                  <Link to={bloco.link}><Button className="bg-neutral-900 text-yellow-400 hover:bg-neutral-800 font-bold whitespace-nowrap">{bloco.botao} <ArrowRight size={14} className="ml-1" /></Button></Link>
                </div>
              );
              if (bloco.tipo === "aviso") return (
                <div key={i} className="mt-8 rounded-xl bg-neutral-50 border border-neutral-200 p-4 flex gap-3 text-sm text-neutral-600">
                  <AlertCircle size={16} className="text-neutral-500 shrink-0 mt-0.5" />{bloco.texto}
                </div>
              );
              return null;
            })}

            {/* Tags */}
            <div className="mt-12 flex flex-wrap gap-2">
              {post.tags.map(t => (
                <span key={t} className="px-3 py-1 bg-neutral-100 text-neutral-700 rounded-full text-xs font-medium">#{t}</span>
              ))}
            </div>
          </div>

          {/* Sidebar com índice */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 bg-neutral-50 rounded-2xl p-5 border border-neutral-200">
              <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-3 flex items-center gap-2"><Sparkles size={12} /> Neste artigo</p>
              <ul className="space-y-2.5">
                {indice.map(s => (
                  <li key={s.id}><a href={`#${s.id}`} className="text-sm text-neutral-700 hover:text-yellow-700 transition leading-snug block">{s.texto}</a></li>
                ))}
              </ul>
            </div>
          </aside>
        </div>

        {/* CTA Final */}
        <div className="mt-16 rounded-3xl bg-gradient-to-br from-neutral-950 to-neutral-800 text-white p-10 md:p-12">
          <h3 className="text-2xl md:text-3xl font-black">Conheça a NOX Fiança</h3>
          <p className="mt-2 text-neutral-300 max-w-xl">A plataforma que conecta corretores, imobiliárias, proprietários e inquilinos em uma jornada de locação mais simples, segura e digital.</p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 flex-wrap">
            <Link to="/simular"><Button className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 font-bold">Solicitar análise</Button></Link>
            <Link to="/cadastro"><Button variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">Criar acesso</Button></Link>
            <Link to="/contato"><Button variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">Falar com a NOX</Button></Link>
          </div>
        </div>

        {/* Posts relacionados */}
        {relacionados.length > 0 && (
          <section className="mt-16">
            <p className="text-xs font-bold uppercase tracking-widest text-yellow-700">Continue lendo</p>
            <h3 className="mt-2 text-2xl md:text-3xl font-black tracking-tight">Posts relacionados</h3>
            <div className="mt-6 grid md:grid-cols-3 gap-5">
              {relacionados.map(p => (
                <Link key={p.slug} to="/blog/$slug" params={{ slug: p.slug }} className="bg-white border border-neutral-200 rounded-2xl overflow-hidden hover:border-yellow-400 hover:shadow-xl hover:-translate-y-1 transition-all group">
                  <div className="aspect-[16/9] overflow-hidden">
                    <img src={p.imageUrl} alt={p.titulo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="p-5">
                    <Badge variant="outline" className="text-[10px]">{p.categoria}</Badge>
                    <h4 className="mt-3 font-bold leading-tight group-hover:text-yellow-700 transition">{p.titulo}</h4>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <p className="text-xs text-neutral-400 flex items-center gap-2"><Clock size={12} /> {p.leitura}</p>
                      <PostReactions slug={p.slug} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>

      <InstitutionalFooter />
    </div>
  );
}
