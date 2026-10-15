import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  FileSignature,
  Mail,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const CONFETTI = [
  { left: "4%", color: "#facc15", delay: 0.1, duration: 7.2, size: 8 },
  { left: "11%", color: "#10b981", delay: 2.8, duration: 8.5, size: 6 },
  { left: "18%", color: "#0f172a", delay: 1.3, duration: 7.8, size: 7 },
  { left: "25%", color: "#f59e0b", delay: 4.1, duration: 9.2, size: 9 },
  { left: "33%", color: "#34d399", delay: 0.8, duration: 8.8, size: 6 },
  { left: "40%", color: "#facc15", delay: 5.4, duration: 7.5, size: 8 },
  { left: "47%", color: "#0f172a", delay: 3.4, duration: 9.5, size: 6 },
  { left: "54%", color: "#10b981", delay: 1.9, duration: 8.1, size: 8 },
  { left: "61%", color: "#f59e0b", delay: 6.2, duration: 9, size: 7 },
  { left: "68%", color: "#34d399", delay: 0.4, duration: 7.7, size: 9 },
  { left: "75%", color: "#facc15", delay: 3.9, duration: 8.9, size: 6 },
  { left: "82%", color: "#0f172a", delay: 1.1, duration: 9.6, size: 7 },
  { left: "89%", color: "#10b981", delay: 5.1, duration: 8.3, size: 8 },
  { left: "96%", color: "#f59e0b", delay: 2.4, duration: 7.9, size: 6 },
] as const;

export const Route = createFileRoute("/consultas/$id/contrato-realizado")({
  head: () => ({
    meta: [{ title: "NOX FIANÇA" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: () => (
    <ProtectedRoute>
      <ContratoRealizadoPage />
    </ProtectedRoute>
  ),
});

function ContratoRealizadoPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0 : 0.52;

  return (
    <DashboardLayout lockViewport>
      <main className="fixed inset-x-0 bottom-0 top-16 isolate overflow-hidden bg-[linear-gradient(135deg,#f6fffb_0%,#e4f9ef_46%,#fff8d9_100%)] lg:left-64">
        <div
          aria-hidden="true"
          className="absolute -left-[8%] top-[8%] h-[58%] w-[48%] rounded-full bg-yellow-300/25 blur-[110px]"
        />
        <div
          aria-hidden="true"
          className="absolute -right-[4%] -top-[18%] h-[74%] w-[58%] rounded-full bg-emerald-300/30 blur-[125px]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] [background-size:42px_42px]"
        />

        {!reduceMotion && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[2] overflow-hidden"
          >
            {CONFETTI.map((piece, index) => (
              <motion.span
                key={`${piece.left}-${piece.delay}`}
                className="absolute -top-8 rounded-sm"
                style={{
                  left: piece.left,
                  width: piece.size,
                  height: piece.size * 1.8,
                  backgroundColor: piece.color,
                }}
                initial={{ y: "-12vh", rotate: index % 2 === 0 ? 0 : 70, opacity: 0 }}
                animate={{
                  y: ["-12vh", "112vh"],
                  x: [0, index % 2 === 0 ? 22 : -20, index % 3 === 0 ? -12 : 10],
                  rotate: [0, index % 2 === 0 ? 420 : -420],
                  opacity: [0, 0.9, 0.9, 0],
                }}
                transition={{
                  duration: piece.duration,
                  delay: piece.delay,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
            ))}
          </div>
        )}

        <section className="relative z-10 grid h-full min-h-0 lg:grid-cols-[minmax(300px,0.42fr)_minmax(560px,0.58fr)]">
          <div className="relative hidden min-h-0 lg:block">
            <motion.div
              aria-hidden="true"
              className="absolute bottom-[3%] left-[8%] h-[20%] w-[78%] rounded-[50%] bg-slate-950/12 blur-3xl"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: reduceMotion ? 0 : 0.25, duration }}
            />
            <motion.img
              src="/assets/nox-contrato-sucesso-personagem.png"
              alt="Personagem NOX comemorando o contrato realizado"
              className="absolute bottom-[-3%] left-[4%] h-[min(88vh,820px)] w-auto max-w-[96%] object-contain object-bottom drop-shadow-[0_24px_28px_rgba(15,23,42,0.18)]"
              initial={reduceMotion ? false : { opacity: 0, x: -38, y: 22, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              transition={{
                delay: reduceMotion ? 0 : 0.08,
                duration: 0.68,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          </div>

          <div className="relative flex h-full min-h-0 items-center justify-center px-4 py-4 sm:px-6 lg:justify-start lg:px-6 xl:px-10">
            <motion.img
              aria-hidden="true"
              src="/assets/nox-contrato-sucesso-personagem.png"
              className="pointer-events-none absolute -bottom-16 -left-20 h-[58%] w-auto object-contain opacity-[0.14] lg:hidden"
              initial={reduceMotion ? false : { opacity: 0, x: -24 }}
              animate={{ opacity: 0.14, x: 0 }}
              transition={{ duration }}
            />

            <motion.article
              initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-3xl overflow-hidden rounded-[2rem] bg-white/75 p-5 shadow-[0_28px_70px_-38px_rgba(15,23,42,0.48)] backdrop-blur-xl sm:p-7 xl:p-8"
            >
              <div className="flex items-center gap-3">
                <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_10px_24px_-10px_rgba(16,185,129,0.85)]">
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full border border-emerald-500/50"
                    initial={reduceMotion ? false : { scale: 0.9, opacity: 0.7 }}
                    animate={reduceMotion ? { opacity: 0 } : { scale: 1.48, opacity: 0 }}
                    transition={{ delay: 0.25, duration: 0.9, ease: "easeOut" }}
                  />
                  <motion.div
                    initial={reduceMotion ? false : { scale: 0, rotate: -12 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 230, damping: 15 }}
                  >
                    <Check size={31} strokeWidth={3.2} />
                  </motion.div>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-700">
                    Tudo certo
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-500">Proposta concluída</p>
                </div>
              </div>

              <h1 className="mt-5 max-w-2xl text-balance text-3xl font-black tracking-[-0.04em] text-slate-950 sm:text-4xl xl:text-[2.75rem] xl:leading-[1.06]">
                Contrato realizado com sucesso!
              </h1>
              <p className="mt-3 max-w-2xl text-pretty text-sm leading-6 text-slate-600 sm:text-base">
                O contrato da apólice será enviado para assinatura pelo e-mail e pelo WhatsApp
                cadastrados.
              </p>

              <div className="mt-5 rounded-2xl bg-white/80 p-4 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.65)] sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Mail size={20} />
                  </div>
                  <div>
                    <h2 className="font-black text-slate-950">Confira suas mensagens</h2>
                    <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">
                      O link seguro pode levar alguns minutos para chegar. Confira também o spam ou
                      lixo eletrônico.
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Channel icon={Mail} label="E-mail cadastrado" />
                  <Channel icon={MessageCircle} label="WhatsApp cadastrado" />
                </div>
              </div>

              <ol className="mt-4 grid gap-2.5 sm:grid-cols-3">
                <Step
                  icon={CheckCircle2}
                  title="Proposta concluída"
                  detail="Etapa finalizada"
                  done
                />
                <Step
                  icon={FileSignature}
                  title="Envio para assinatura"
                  detail="E-mail e WhatsApp"
                />
                <Step icon={ShieldCheck} title="Assinatura eletrônica" detail="Link seguro" />
              </ol>

              <div className="mt-5 flex flex-col gap-3 border-t border-slate-200/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Clock3 className="shrink-0" size={15} />
                  <span>O pagamento em “pagar depois” seguirá pendente.</span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/consultas" })}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-white px-4 text-xs font-black text-slate-800 shadow-sm transition hover:bg-slate-50 sm:flex-none"
                  >
                    Minhas consultas
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      navigate({ to: "/consultas/$id/status", params: { id }, replace: true })
                    }
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 sm:flex-none"
                  >
                    Acompanhar proposta
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            </motion.article>
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}

function Channel({ icon: Icon, label }: { icon: typeof Mail; label: string }) {
  return (
    <div className="flex min-h-10 items-center gap-2 rounded-xl bg-slate-100/80 px-3 text-xs font-bold text-slate-700">
      <Icon size={16} className="shrink-0 text-emerald-600" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function Step({
  icon: Icon,
  title,
  detail,
  done = false,
}: {
  icon: typeof CheckCircle2;
  title: string;
  detail: string;
  done?: boolean;
}) {
  return (
    <li className="flex items-center gap-2.5 rounded-xl bg-white/55 px-3 py-2.5">
      <div
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
          done ? "bg-emerald-500 text-white" : "bg-white text-slate-700"
        }`}
      >
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-black text-slate-900">{title}</p>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">{detail}</p>
      </div>
    </li>
  );
}
