import { Link } from '@tanstack/react-router';
import { ArrowRight, ChevronDown, CheckCircle2, BadgeCheck, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { InstitutionalHeader } from './InstitutionalHeader';
import { InstitutionalFooter } from './FaqAndFooterInstitutional';

type Cta = { label: string; to: string; search?: Record<string, string>; variant?: 'primary' | 'secondary' | 'ghost' };
type IconBlock = { icon: LucideIcon; t: string; d: string };
type ListBlock = { icon: LucideIcon; t: string; items: string[] };
type FaqItem = { q: string; a: string };

export type PerfilLandingProProps = {
  badge: { icon: LucideIcon; label: string };
  hero: {
    titulo: string;
    subtitulo: string;
    imagem: string;
    imagemAlt: string;
    ctas: Cta[];
    chips?: string[];
    ocultarBadge?: boolean;
    chipsCentralizados?: boolean;
    /** Ilustração de personagem (fundo branco/transparente) — substitui a foto em card à direita. */
    personagemImagem?: string;
    personagemAlt?: string;
  };
  comoFunciona: { titulo: string; passos: IconBlock[] };
  beneficios: { titulo: string; items: IconBlock[] };
  destaque?: {
    titulo: string;
    descricao: string;
    cards: { icon: LucideIcon; t: string; d: string }[];
  };
  ferramentas?: { titulo: string; subtitulo?: string; cards: ListBlock[] };
  faq: FaqItem[];
  ctaFinal: { titulo: string; subtitulo: string; ctas: Cta[] };
  hideFooterCta?: boolean;
};


function CtaButton({ cta, tone = 'light' }: { cta: Cta; tone?: 'light' | 'dark' }) {
  const variant = cta.variant ?? 'primary';
  const cls = (() => {
    if (tone === 'dark') {
      if (variant === 'primary') return 'bg-yellow-400 hover:bg-yellow-500 text-neutral-900 shadow-2xl shadow-yellow-500/20';
      if (variant === 'secondary') return 'bg-white/10 hover:bg-white/20 text-white border border-white/20 backdrop-blur';
      return 'text-white/80 hover:text-white underline underline-offset-4';
    }
    if (variant === 'primary') return 'bg-neutral-900 hover:bg-neutral-800 text-white shadow-xl shadow-neutral-200';
    if (variant === 'secondary') return 'bg-yellow-400 hover:bg-yellow-500 text-neutral-900 shadow-xl shadow-yellow-100';
    return 'text-neutral-700 hover:text-neutral-900 underline underline-offset-4';
  })();
  const base = variant === 'ghost'
    ? 'inline-flex items-center justify-center gap-2 px-4 py-3 font-semibold text-sm transition-all'
    : 'inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-bold transition-all active:scale-95';
  return (
    <Link to={cta.to} search={cta.search as any} className={`${base} ${cls}`}>
      {cta.label}
      {variant === 'primary' && <ArrowRight className="w-5 h-5" strokeWidth={2.5} />}
    </Link>
  );
}

// Grid count-aware: 4 items -> 2x2, 6 -> 3x2, 8 -> 4x2, 3 -> 3x1, etc.
// Sempre alinha alturas (auto-rows-fr) e nunca deixa "órfão" (3+1).
function gridCols(n: number): string {
  if (n <= 1) return 'grid-cols-1';
  if (n === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (n === 3) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  if (n === 4) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
  if (n === 5) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5';
  if (n === 6) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  if (n === 8) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
  if (n % 4 === 0) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
  if (n % 3 === 0) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
}


export function PerfilLandingPro(props: PerfilLandingProProps) {
  const { badge, hero, comoFunciona, beneficios, destaque, ferramentas, faq, ctaFinal, hideFooterCta } = props;
  const [open, setOpen] = useState<number | null>(0);
  const BadgeIcon = badge.icon;

  return (
    <div className="min-h-screen bg-white">
      <InstitutionalHeader />
      <main className="pt-20">
        {/* HERO */}
        <section className="perfil-hero-section container mx-auto max-w-7xl px-6">
          <div className="perfil-hero-grid grid gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center">
            <div className="perfil-hero-copy order-1 animate-in fade-in slide-in-from-left duration-700">
              {!hero.ocultarBadge && (
                <div className="inline-flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-full px-4 py-1.5 mb-8">
                  <BadgeIcon className="w-4 h-4 text-yellow-600" strokeWidth={2.5} />
                  <span className="text-xs font-black uppercase tracking-[0.15em] text-neutral-800">{badge.label}</span>
                </div>
              )}
              <h1 className="text-4xl lg:text-6xl font-black text-neutral-900 tracking-tighter leading-[1.05] mb-8">{hero.titulo}</h1>
              <p className="text-lg text-neutral-600 mb-10 leading-relaxed max-w-xl font-medium">{hero.subtitulo}</p>
              <div className="flex flex-col sm:flex-row gap-4">
                {hero.ctas.map((c, i) => <CtaButton key={i} cta={c} />)}
              </div>
              {hero.chips && (
                <div className={`${hero.chipsCentralizados ? 'mt-5 justify-center text-center' : 'mt-10'} flex flex-wrap gap-x-8 gap-y-3 text-sm text-neutral-500 font-medium`}>
                  {hero.chips.map((c, i) => (
                    <span key={i} className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> {c}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="perfil-hero-visual relative order-2 min-w-0 animate-in fade-in slide-in-from-right duration-1000">
              {hero.personagemImagem ? (
                <div className="perfil-hero-personagem-frame">
                  <img
                    src={hero.personagemImagem}
                    alt={hero.personagemAlt ?? hero.imagemAlt}
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    className="perfil-hero-personagem-img block"
                  />
                </div>
              ) : (
                <>
                  <div className="absolute -inset-4 bg-yellow-400/10 rounded-[2rem] blur-3xl -z-10" />
                  <img src={hero.imagem} alt={hero.imagemAlt} loading="eager" decoding="async" fetchPriority="high" width={1200} height={900} className="w-full h-auto rounded-3xl shadow-2xl border-4 border-white object-cover aspect-[4/3]" />
                </>
              )}
            </div>
          </div>
        </section>

        {/* COMO FUNCIONA */}
        <section className="bg-neutral-50 py-24">
          <div className="container mx-auto px-6 max-w-7xl">
            <div className="text-center mb-16">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-600 mb-3">PROCESSO</p>
              <h2 className="text-3xl lg:text-5xl font-black text-neutral-900 tracking-tight">{comoFunciona.titulo}</h2>
            </div>
            <div className={`grid ${gridCols(comoFunciona.passos.length)} gap-6 auto-rows-fr`}>

              {comoFunciona.passos.map((p, i) => {
                const Icon = p.icon;
                return (
                  <div key={i} className="group relative h-full flex flex-col bg-white rounded-2xl p-7 border border-neutral-100 hover:border-yellow-300 hover:shadow-xl hover:-translate-y-1 transition-all">
                    <div className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-neutral-900 text-yellow-400 text-sm font-black flex items-center justify-center shadow-lg">{i + 1}</div>
                    <div className="w-12 h-12 rounded-xl bg-yellow-50 flex items-center justify-center mb-5 group-hover:bg-yellow-100 transition-colors">
                      <Icon className="w-6 h-6 text-yellow-600" strokeWidth={2.2} />
                    </div>
                    <h3 className="text-lg font-bold text-neutral-900 mb-2">{p.t}</h3>
                    <p className="text-sm text-neutral-600 leading-relaxed">{p.d}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* BENEFÍCIOS */}
        <section className="py-24">
          <div className="container mx-auto px-6 max-w-7xl">
            <div className="text-center mb-16">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-600 mb-3">BENEFÍCIOS</p>
              <h2 className="text-3xl lg:text-5xl font-black text-neutral-900 tracking-tight">{beneficios.titulo}</h2>
            </div>
            <div className={`grid ${gridCols(beneficios.items.length)} gap-6 auto-rows-fr`}>
              {beneficios.items.map((b, i) => {
                const Icon = b.icon;
                return (
                  <div key={i} className="h-full flex flex-col bg-white rounded-2xl p-7 border border-neutral-200 hover:border-neutral-900 hover:shadow-2xl transition-all">

                    <div className="w-12 h-12 rounded-xl bg-neutral-900 flex items-center justify-center mb-5">
                      <Icon className="w-6 h-6 text-yellow-400" strokeWidth={2.2} />
                    </div>
                    <h3 className="text-lg font-bold text-neutral-900 mb-2">{b.t}</h3>
                    <p className="text-sm text-neutral-600 leading-relaxed">{b.d}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* DESTAQUE */}
        {destaque && (
          <section className="bg-neutral-50 py-24">
            <div className="container mx-auto px-6 max-w-7xl">
              <div className="text-center mb-12 max-w-3xl mx-auto">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-600 mb-3">EM DESTAQUE</p>
                <h2 className="text-3xl lg:text-5xl font-black text-neutral-900 tracking-tight mb-4">{destaque.titulo}</h2>
                <p className="text-lg text-neutral-600 font-medium leading-relaxed">{destaque.descricao}</p>
              </div>
              <div className={`grid ${gridCols(destaque.cards.length)} gap-6 auto-rows-fr`}>
                {destaque.cards.map((c, i) => {
                  const Icon = c.icon;
                  return (
                    <div key={i} className="h-full flex flex-col bg-white rounded-2xl p-8 border border-neutral-200 hover:shadow-2xl transition-all">

                      <div className="w-12 h-12 rounded-xl bg-yellow-400 flex items-center justify-center mb-5">
                        <Icon className="w-6 h-6 text-neutral-900" strokeWidth={2.2} />
                      </div>
                      <h3 className="text-xl font-bold text-neutral-900 mb-3">{c.t}</h3>
                      <p className="text-neutral-600 leading-relaxed">{c.d}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* FERRAMENTAS DO PAINEL */}
        {ferramentas && (
          <section className="py-24">
            <div className="container mx-auto px-6 max-w-7xl">
              <div className="text-center mb-16 max-w-3xl mx-auto">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-600 mb-3">FERRAMENTAS DO PAINEL</p>
                <h2 className="text-3xl lg:text-5xl font-black text-neutral-900 tracking-tight mb-4">{ferramentas.titulo}</h2>
                {ferramentas.subtitulo && <p className="text-lg text-neutral-600 font-medium">{ferramentas.subtitulo}</p>}
              </div>
              <div className={`grid ${gridCols(ferramentas.cards.length)} gap-6 auto-rows-fr`}>
                {ferramentas.cards.map((c, i) => {
                  const Icon = c.icon;
                  return (
                    <div key={i} className="h-full flex flex-col bg-white rounded-2xl p-7 border border-neutral-100 hover:shadow-xl transition-all">

                      <div className="w-12 h-12 rounded-xl bg-yellow-50 flex items-center justify-center mb-5">
                        <Icon className="w-6 h-6 text-yellow-600" strokeWidth={2.2} />
                      </div>
                      <h3 className="text-lg font-bold text-neutral-900 mb-4">{c.t}</h3>
                      <ul className="space-y-2">
                        {c.items.map((it, j) => (
                          <li key={j} className="text-sm text-neutral-600 flex items-center gap-2">
                            <BadgeCheck className="w-4 h-4 text-emerald-500 shrink-0" /> {it}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* FAQ */}
        <section className="bg-neutral-50 py-24">
          <div className="container mx-auto px-6 max-w-3xl">
            <div className="text-center mb-12">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-600 mb-3">FAQ</p>
              <h2 className="text-3xl lg:text-5xl font-black text-neutral-900 tracking-tight">Perguntas frequentes</h2>
            </div>
            <div className="space-y-3">
              {faq.map((f, i) => (
                <div key={i} className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setOpen(open === i ? null : i)}
                    className="w-full px-6 py-5 flex items-center justify-between text-left gap-4 hover:bg-neutral-50 transition-colors"
                  >
                    <span className="font-bold text-neutral-900">{f.q}</span>
                    <ChevronDown className={`w-5 h-5 text-neutral-500 shrink-0 transition-transform ${open === i ? 'rotate-180' : ''}`} />
                  </button>
                  {open === i && (
                    <div className="px-6 pb-5 text-neutral-600 leading-relaxed border-t border-neutral-100 pt-4">{f.a}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA FINAL */}
        <section className="bg-neutral-900 py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,214,10,0.15),transparent_60%)]" />
          <div className="container mx-auto px-6 max-w-4xl text-center relative">
            <div className="inline-flex items-center gap-2 bg-yellow-400/10 border border-yellow-400/30 rounded-full px-4 py-1.5 mb-8">
              <BadgeIcon className="w-4 h-4 text-yellow-400" strokeWidth={2.5} />
              <span className="text-xs font-black uppercase tracking-[0.15em] text-yellow-400">Comece agora</span>
            </div>
            <h2 className="text-3xl lg:text-5xl font-black text-white tracking-tight mb-6">{ctaFinal.titulo}</h2>
            <p className="text-lg text-neutral-300 mb-10 max-w-2xl mx-auto font-medium">{ctaFinal.subtitulo}</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {ctaFinal.ctas.map((c, i) => <CtaButton key={i} cta={c} tone="dark" />)}
            </div>
          </div>
        </section>
      </main>
      <InstitutionalFooter hideCta={hideFooterCta} />
    </div>
  );
}
