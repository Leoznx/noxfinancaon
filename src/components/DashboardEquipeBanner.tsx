import { Users } from "lucide-react";
import { toast } from "sonner";

// Funcionalidade de convite de equipe sem senha ainda não existe — o botão só
// avisa que está chegando, por enquanto (banner é só a peça visual).
export function DashboardEquipeBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-neutral-900 border border-yellow-400/20 px-6 py-6 sm:px-10 sm:py-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xl">
      <div className="absolute top-0 right-0 w-72 h-72 bg-yellow-400 opacity-[0.06] rounded-full blur-[100px] -mr-20 -mt-20" />
      <div className="absolute bottom-0 left-0 w-56 h-56 bg-yellow-400 opacity-[0.04] rounded-full blur-[80px] -ml-16 -mb-16" />

      <h3 className="relative z-10 text-2xl sm:text-3xl font-black uppercase tracking-tight text-yellow-400 text-center sm:text-left shrink-0">
        Você no controle.
      </h3>

      <button
        type="button"
        onClick={() => toast.info("Gestão de equipe chegando em breve.")}
        className="relative z-10 flex items-center gap-3 bg-black/40 text-yellow-400 font-bold px-6 py-3 rounded-xl border border-yellow-400/40 shadow-md hover:bg-black/60 transition-colors shrink-0"
      >
        <Users className="w-5 h-5" strokeWidth={2.2} />
        Equipe
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-400" />
        </span>
      </button>

      <p className="relative z-10 text-sm sm:text-base font-medium text-neutral-300 text-center sm:text-right max-w-xs">
        Gerencie quem acessa sua dashboard. <span className="text-white font-bold">Sem senha. Sem risco.</span>
      </p>
    </div>
  );
}
