import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  FileSignature,
  ListChecks,
  Mail,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const SUCCESS_ACCENTS = [
  { left: "18%", top: "32%", color: "#eab308", rotate: -35, delay: 0.12 },
  { left: "29%", top: "17%", color: "#0f172a", rotate: 55, delay: 0.2 },
  { left: "71%", top: "18%", color: "#10b981", rotate: -45, delay: 0.16 },
  { left: "82%", top: "34%", color: "#eab308", rotate: 35, delay: 0.24 },
];

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
  const duration = reduceMotion ? 0 : 0.5;

  return (
    <DashboardLayout lockViewport>
      <main className="relative -m-3 flex h-[calc(100%+1.5rem)] w-[calc(100%+1.5rem)] min-h-0 overflow-hidden bg-[#f6f8f7] sm:-m-4 sm:h-[calc(100%+2rem)] sm:w-[calc(100%+2rem)] lg:-m-5 lg:h-[calc(100%+2.5rem)] lg:w-[calc(100%+2.5rem)]">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[48%] bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_68%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] [background-size:36px_36px]"
        />

        <motion.section
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex h-full min-h-0 w-full flex-col"
        >
          <header className="relative flex shrink-0 flex-col items-center px-5 pb-5 pt-6 text-center sm:px-8 sm:pb-7 sm:pt-8 xl:pt-10">
            {SUCCESS_ACCENTS.map((accent, index) => (
              <motion.span
                aria-hidden="true"
                key={`${accent.left}-${accent.top}`}
                className="absolute h-1.5 w-5 rounded-full"
                style={{
                  left: accent.left,
                  top: accent.top,
                  backgroundColor: accent.color,
                  rotate: accent.rotate,
                }}
                initial={reduceMotion ? false : { opacity: 0, scale: 0, y: -10 }}
                animate={{ opacity: [0, 1, 0.72], scale: 1, y: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.65,
                  delay: accent.delay + index * 0.03,
                }}
              />
            ))}

            <div className="relative mb-4 grid h-20 w-20 place-items-center sm:h-24 sm:w-24">
              <motion.div
                aria-hidden="true"
                className="absolute inset-1 rounded-full border border-emerald-400/40"
                initial={reduceMotion ? false : { scale: 0.85, opacity: 0 }}
                animate={reduceMotion ? { scale: 1, opacity: 0 } : { scale: 1.32, opacity: 0 }}
                transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
              />
              <motion.div
                initial={reduceMotion ? false : { scale: 0, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{
                  delay: reduceMotion ? 0 : 0.08,
                  type: "spring",
                  stiffness: 230,
                  damping: 15,
                }}
                className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_12px_30px_-12px_rgba(16,185,129,0.8)] sm:h-20 sm:w-20"
              >
                <Check className="h-9 w-9 sm:h-11 sm:w-11" strokeWidth={3.2} />
              </motion.div>
            </div>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.22, duration }}
            >
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.24em] text-emerald-700">
                Tudo certo
              </p>
              <h1 className="text-balance text-3xl font-black tracking-[-0.035em] text-slate-950 sm:text-4xl xl:text-[2.75rem] xl:leading-[1.08]">
                Contrato realizado com sucesso!
              </h1>
              <p className="mx-auto mt-3 max-w-2xl text-pretty text-sm leading-6 text-slate-600 sm:text-base">
                A proposta foi concluída. O contrato da apólice será enviado para assinatura pelo
                e-mail e pelo WhatsApp cadastrados.
              </p>
            </motion.div>
          </header>

          <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 content-center gap-4 px-5 pb-5 sm:px-8 sm:pb-7 lg:grid-cols-[1.08fr_0.92fr] lg:gap-5 xl:px-10">
            <motion.section
              initial={reduceMotion ? false : { opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.32, duration }}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_35px_-28px_rgba(15,23,42,0.7)] sm:p-6"
            >
              <div className="flex items-start gap-4">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <Mail size={21} />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-950 sm:text-lg">
                    Confira suas mensagens
                  </h2>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">
                    O link seguro de assinatura pode levar alguns minutos para chegar. Se não
                    aparecer, confira também a caixa de spam ou lixo eletrônico.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Channel icon={Mail} label="E-mail cadastrado" />
                <Channel icon={MessageCircle} label="WhatsApp cadastrado" />
              </div>
            </motion.section>

            <motion.section
              initial={reduceMotion ? false : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.4, duration }}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_35px_-28px_rgba(15,23,42,0.7)] sm:p-6"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <ListChecks className="text-emerald-600" size={20} />
                <h2 className="font-black text-slate-950">Próximos passos</h2>
              </div>
              <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <Step
                  icon={CheckCircle2}
                  title="Proposta concluída"
                  detail="Etapa finalizada"
                  done
                />
                <Step
                  icon={FileSignature}
                  title="Envio para assinatura"
                  detail="Por e-mail e WhatsApp"
                />
                <Step
                  icon={ShieldCheck}
                  title="Assinatura eletrônica"
                  detail="Revise e assine pelo link seguro"
                />
              </ol>
            </motion.section>
          </div>

          <motion.footer
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : 0.48, duration }}
            className="shrink-0 border-t border-slate-200/80 bg-white/80 px-5 py-4 backdrop-blur sm:px-8"
          >
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-500 sm:text-sm">
                <Clock3 className="shrink-0" size={16} />
                <span>O pagamento escolhido como “pagar depois” continuará pendente.</span>
              </div>
              <div className="flex shrink-0 gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => navigate({ to: "/consultas" })}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-800 transition hover:border-slate-300 hover:bg-slate-50 sm:flex-none sm:text-sm"
                >
                  Ver minhas consultas
                </button>
                <button
                  type="button"
                  onClick={() =>
                    navigate({ to: "/consultas/$id/status", params: { id }, replace: true })
                  }
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 sm:flex-none sm:text-sm"
                >
                  Acompanhar proposta
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </motion.footer>
        </motion.section>
      </main>
    </DashboardLayout>
  );
}

function Channel({ icon: Icon, label }: { icon: typeof Mail; label: string }) {
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-50 px-3 text-xs font-bold text-slate-700 sm:text-sm">
      <Icon size={17} className="text-emerald-600" />
      {label}
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
    <li className="flex items-center gap-3">
      <div
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
          done ? "bg-emerald-500 text-white" : "border border-slate-200 bg-slate-50 text-slate-700"
        }`}
      >
        <Icon size={17} />
      </div>
      <div>
        <p className="text-sm font-black text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs leading-4 text-slate-500">{detail}</p>
      </div>
    </li>
  );
}
