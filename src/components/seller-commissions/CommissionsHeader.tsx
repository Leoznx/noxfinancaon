import { DollarSign, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type CommissionsHeaderProps = {
  refreshing: boolean;
  onRefresh: () => void;
};

export function CommissionsHeader({ refreshing, onRefresh }: CommissionsHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-[48px] w-9 shrink-0 items-center justify-center">
          <DollarSign className="h-8 w-8 text-[#0A0A0A]" strokeWidth={2.25} aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-[28px] font-black leading-tight tracking-[-0.035em] text-[#080808] sm:text-[32px]">
            Minhas Comissões
          </h1>
          <p className="mt-0.5 text-sm font-medium text-[#6B6B6B]">
            Resumo, valores liberados e histórico completo em uma única página.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11 gap-2 self-start rounded-xl border-[#E3E3E3] bg-white px-5 font-bold text-[#0A0A0A] shadow-sm hover:bg-neutral-50 sm:self-auto"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={refreshing ? "Atualizando comissões" : "Atualizar comissões"}
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
        {refreshing ? "Atualizando..." : "Atualizar"}
      </Button>
    </div>
  );
}
