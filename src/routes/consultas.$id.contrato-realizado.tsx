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
  Sparkles,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const CONFETTI = [
  { left: "8%", top: "13%", color: "#facc15", rotate: -24, delay: 0.08 },
  { left: "17%", top: "28%", color: "#22c55e", rotate: 38, delay: 0.16 },
  { left: "28%", top: "9%", color: "#0f172a", rotate: 65, delay: 0.24 },
  { left: "70%", top: "11%", color: "#eab308", rotate: -48, delay: 0.12 },
  { left: "81%", top: "27%", color: "#10b981", rotate: 31, delay: 0.2 },
  { left: "91%", top: "14%", color: "#facc15", rotate: 72, delay: 0.28 },
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
  const duration = reduceMotion ? 0 : 0.55;

  return (
    <DashboardLayout>
      <main className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[radial-gradient(circle_at_top,_#dcfce7_0,_#f8fafc_42%,_#f8fafc_100%)] px-4 py-8 sm:px-6 sm:py-12">
        <motion.div
          aria-hidden="true"
          className="absolute -left-20 top-16 h-64 w-64 rounded-full bg-yellow-300/20 blur-3xl"
          animate={reduceMotion ? undefined : { scale: [1, 1.12, 1], opacity: [0.45, 0.7, 0.45] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden="true"
          className="absolute -right-20 bottom-8 h-72 w-72 rounded-full bg-emerald-300/20 blur-3xl"
          animate={
            reduceMotion ? undefined : { scale: [1.08, 0.95, 1.08], opacity: [0.4, 0.68, 0.4] }
          }
          transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
        />

        <motion.section
          initial={reduceMotion ? false : { opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-[2rem] border border-white/80 bg-white/95 shadow-[0_32px_90px_-35px_rgba(15,23,42,0.38)] backdrop-blur"
        >
          <div className="relative overflow-hidden border-b border-emerald-100 bg-gradient-to-b from-emerald-50 via-white to-white px-5 pb-8 pt-10 text-center sm:px-10 sm:pb-10 sm:pt-12">
            {CONFETTI.map((particle, index) => (
              <motion.span
                aria-hidden="true"
                key={`${particle.left}-${particle.top}`}
                className="absolute h-2.5 w-1.5 rounded-sm"
                style={{
                  left: particle.left,
                  top: particle.top,
                  backgroundColor: particle.color,
                  rotate: particle.rotate,
                }}
                initial={reduceMotion ? false : { opacity: 0, y: -20, scale: 0 }}
                animate={{ opacity: [0, 1, 1], y: [reduceMotion ? 0 : -20, 0, 6], scale: 1 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.75,
                  delay: particle.delay + index * 0.03,
                }}
              />
            ))}

            <div className="relative mx-auto mb-6 h-28 w-28">
              <motion.div
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-emerald-200/80"
                animate={reduceMotion ? undefined : { scale: [1, 1.22, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.div
                initial={reduceMotion ? false : { scale: 0, rotate: -18 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{
                  delay: reduceMotion ? 0 : 0.12,
                  type: "spring",
                  stiffness: 210,
                  damping: 14,
                }}
                className="absolute inset-2 flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-200"
              >
                <Check size={54} strokeWidth={3.2} />
              </motion.div>
            </div>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.28, duration }}
            >
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                <Sparkles size={14} />
                Tudo certo
              </div>
              <h1 className="text-balance text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Contrato realizado com sucesso!
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-7 text-slate-600 sm:text-lg">
                A proposta foi concluída. Agora enviaremos o contrato da apólice para assinatura
                pelo e-mail e pelo WhatsApp cadastrados.
              </p>
            </motion.div>
          </div>

          <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1.12fr_0.88fr] lg:p-10">
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.4, duration }}
              className="rounded-3xl border border-yellow-200 bg-yellow-50 p-6"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-yellow-300 shadow-md">
                  <Mail size={23} />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-950">
                    Confira seu e-mail e WhatsApp
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    O link seguro de assinatura será enviado pelos dois canais. O envio pode levar
                    alguns minutos; confira também a caixa de spam ou lixo eletrônico.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Channel icon={Mail} label="E-mail cadastrado" />
                <Channel icon={MessageCircle} label="WhatsApp cadastrado" />
              </div>
            </motion.div>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.48, duration }}
              className="rounded-3xl border border-slate-200 bg-slate-50 p-6"
            >
              <div className="mb-5 flex items-center gap-3">
                <ListChecks className="text-emerald-600" size={22} />
                <h2 className="font-black text-slate-950">Próximos passos</h2>
              </div>
              <ol className="space-y-4">
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
            </motion.div>
          </div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : 0.58, duration }}
            className="flex flex-col gap-3 border-t border-slate-100 bg-white px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-10"
          >
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Clock3 size={16} />O pagamento escolhido como “pagar depois” continuará pendente.
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => navigate({ to: "/consultas" })}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-800 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Ver minhas consultas
              </button>
              <button
                type="button"
                onClick={() =>
                  navigate({ to: "/consultas/$id/status", params: { id }, replace: true })
                }
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white shadow-lg shadow-slate-300 transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                Acompanhar proposta
                <ArrowRight size={17} />
              </button>
            </div>
          </motion.div>
        </motion.section>
      </main>
    </DashboardLayout>
  );
}

function Channel({ icon: Icon, label }: { icon: typeof Mail; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-yellow-200/80 bg-white/80 px-3 py-3 text-sm font-bold text-slate-800">
      <Icon size={18} className="text-emerald-600" />
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
    <li className="flex items-start gap-3">
      <div
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-emerald-500 text-white" : "border border-slate-200 bg-white text-slate-700"
        }`}
      >
        <Icon size={18} />
      </div>
      <div>
        <p className="text-sm font-black text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{detail}</p>
      </div>
    </li>
  );
}
