import { MARCOS_BONUS_VENDEDOR, type NivelComissaoVendedor } from "@/lib/comissao-vendedor";
import { formatMoney } from "@/lib/vendedor-portal";

type CommissionProgressCardProps = {
  contracts: number;
  level: NivelComissaoVendedor;
  monthlyGain: { comissao: number; bonus: number; total: number };
};

export function CommissionProgressCard({
  contracts,
  level,
  monthlyGain,
}: CommissionProgressCardProps) {
  const lastMilestone = MARCOS_BONUS_VENDEDOR[MARCOS_BONUS_VENDEDOR.length - 1].contratos;
  const target = level.proximoMarco ?? Math.max(contracts, lastMilestone);
  const progress = target > 0 ? Math.min((contracts / target) * 100, 100) : 0;

  return (
    <section className="rounded-[18px] border border-[#F1C900] bg-gradient-to-br from-[#FFFDF2] via-white to-[#FFFCEF] p-4 shadow-[0_8px_28px_rgba(30,30,30,0.06)] sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-full bg-[#FFD91A] px-4 py-2 text-sm font-extrabold text-[#080808] shadow-[0_3px_8px_rgba(216,174,0,0.18)]">
              Nível {level.nome}
            </span>
            <span className="rounded-full border border-[#DEDEDE] bg-white px-4 py-2 text-sm font-bold text-[#272727] shadow-sm">
              {contracts} {contracts === 1 ? "contrato fechado" : "contratos fechados"} no mês
            </span>
          </div>

          <h2 className="mt-3 text-base font-black leading-snug tracking-[-0.015em] text-[#101010] sm:text-lg">
            {level.mensagem}
          </h2>
          <p className="mt-1 text-xs font-medium text-[#6B6B6B] sm:text-sm">
            Seu próximo contrato vale {formatMoney(level.valorPorProximoContrato)} de comissão.
          </p>

        </div>

        <div className="grid grid-cols-2 gap-2.5" aria-label="Estimativa do mês">
          <div className="rounded-xl border border-[#E8E1B9] bg-white px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#777]">Próximo contrato</p>
            <p className="mt-1 text-lg font-black text-[#111]">{formatMoney(level.valorPorProximoContrato)}</p>
          </div>
          <div className="rounded-xl border border-[#E8E1B9] bg-white px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#777]">Estimativa do mês</p>
            <p className="mt-1 text-lg font-black text-[#B28E00]">{formatMoney(monthlyGain.total)}</p>
            <p className="mt-0.5 text-[10px] text-[#777]">
              {formatMoney(monthlyGain.comissao)} + {formatMoney(monthlyGain.bonus)} bônus
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-[#EEE6B9] pt-3">
          <div>
            <div className="mb-2.5 flex items-center justify-between gap-4 text-sm text-[#4F4F4F]">
              <span>{contracts} {contracts === 1 ? "contrato" : "contratos"}</span>
              <span>
                <strong className="text-[#151515]">{contracts} / {target}</strong> contratos
              </span>
            </div>
            <div
              className="relative h-3 overflow-visible rounded-full bg-[#E7E7E7]"
              role="progressbar"
              aria-label="Progresso para o próximo objetivo"
              aria-valuemin={0}
              aria-valuemax={target}
              aria-valuenow={Math.min(contracts, target)}
            >
              <div
                className="h-full rounded-full bg-[#FFD400] transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
              <span
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[4px] border-[#FFD400] bg-white shadow-sm transition-[left] duration-500 ease-out"
                style={{ left: `${Math.max(progress, 1)}%` }}
                aria-hidden="true"
              />
            </div>
          </div>

          <div className="relative mt-2 grid grid-cols-3 gap-2 pt-2">
            <div className="pointer-events-none absolute left-[11%] right-[11%] top-[23px] border-t border-dashed border-[#CFCFCF]" aria-hidden="true" />
            {MARCOS_BONUS_VENDEDOR.map((milestone) => {
              const reached = contracts >= milestone.contratos;
              return (
                <div key={milestone.contratos} className="relative z-10 flex flex-col items-center text-center">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-black transition-colors ${
                      reached
                        ? "border-[#EAC200] bg-[#FFD400] text-[#080808]"
                        : "border-[#D8D8D8] bg-[#DEDEDE] text-[#303030]"
                    }`}
                  >
                    {milestone.rotulo}
                  </span>
                  <span className="mt-1 rounded-full border border-[#DEDEDE] bg-white px-2 py-1 text-[10px] font-bold text-[#333] shadow-sm sm:text-xs">
                    {formatMoney(milestone.bonus)} bônus
                  </span>
                </div>
              );
            })}
          </div>
      </div>
    </section>
  );
}
