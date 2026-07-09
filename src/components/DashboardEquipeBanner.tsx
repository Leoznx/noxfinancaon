import { Users } from "lucide-react";

// Só visual por enquanto — a funcionalidade de convite de equipe sem senha
// ainda não existe, então o botão não tem ação/destino.
export function DashboardEquipeBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#8a6a12] via-[#caa227] to-[#FACC15] px-6 py-6 sm:px-10 sm:py-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xl">
      <div className="absolute inset-0 opacity-[0.08] bg-[radial-gradient(circle_at_15%_30%,white,transparent_45%)]" />
      <div className="absolute inset-0 opacity-[0.06] bg-[radial-gradient(circle_at_85%_70%,white,transparent_45%)]" />

      <h3 className="relative z-10 text-2xl sm:text-3xl font-black uppercase tracking-tight text-neutral-900 text-center sm:text-left shrink-0">
        Você no controle.
      </h3>

      <div className="relative z-10 flex items-center gap-3 bg-neutral-900 text-yellow-400 font-bold px-6 py-3 rounded-xl border border-yellow-400/40 shadow-md shrink-0">
        <Users className="w-5 h-5" strokeWidth={2.2} />
        Equipe
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-400" />
        </span>
      </div>

      <p className="relative z-10 text-sm sm:text-base font-medium text-white/90 text-center sm:text-right max-w-xs">
        Gerencie quem acessa sua dashboard. <span className="text-white font-bold">Sem senha. Sem risco.</span>
      </p>
    </div>
  );
}
