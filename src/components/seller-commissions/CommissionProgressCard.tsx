import { TrendingUp } from "lucide-react";
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
    <section className="overflow-hidden rounded-[18px] border border-[#F1C900] bg-gradient-to-br from-[#FFFDF2] via-white to-[#FFFCEF] shadow-[0_8px_28px_rgba(30,30,30,0.06)]">
      <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_385px] xl:items-center">
        <div className="flex min-w-0 flex-col justify-center py-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-full bg-[#FFD91A] px-4 py-2 text-sm font-extrabold text-[#080808] shadow-[0_3px_8px_rgba(216,174,0,0.18)]">
              Nível {level.nome}
            </span>
            <span className="rounded-full border border-[#DEDEDE] bg-white px-4 py-2 text-sm font-bold text-[#272727] shadow-sm">
              {contracts} {contracts === 1 ? "contrato fechado" : "contratos fechados"} no mês
            </span>
          </div>

          <h2 className="mt-4 text-lg font-black leading-snug tracking-[-0.015em] text-[#101010] sm:text-[20px]">
            {level.mensagem}
          </h2>
          <p className="mt-1.5 text-sm font-medium text-[#6B6B6B]">
            Seu próximo contrato vale {formatMoney(level.valorPorProximoContrato)} de comissão.
          </p>

          <div className="mt-4">
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

          <div className="relative mt-3 grid grid-cols-3 gap-2 pt-2">
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
                  <span className="mt-1.5 rounded-full border border-[#DEDEDE] bg-white px-3 py-1 text-[11px] font-bold text-[#333] shadow-sm sm:text-xs">
                    {formatMoney(milestone.bonus)} bônus
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative flex min-h-[218px] flex-col justify-center overflow-hidden rounded-[22px] bg-[#090A0A] px-7 py-6 text-white shadow-[0_10px_24px_rgba(0,0,0,0.12)] sm:px-9 xl:h-[232px] xl:min-h-0">
          <div className="absolute -bottom-28 -right-20 h-64 w-64 rounded-full border border-[#FFD400]/15" aria-hidden="true" />
          <div className="absolute -bottom-20 -right-14 h-48 w-48 rounded-full border border-dashed border-[#FFD400]/15" aria-hidden="true" />
          <div className="absolute bottom-0 right-0 h-28 w-52 bg-[radial-gradient(circle,_rgba(255,212,0,0.24)_1px,_transparent_1px)] [background-size:7px_7px] opacity-25" aria-hidden="true" />
          <TrendingUp className="relative h-7 w-7 text-[#FFD400]" strokeWidth={2.6} aria-hidden="true" />
          <p className="relative mt-5 text-[13px] font-black uppercase tracking-[0.16em] text-[#BEBEBE]">
            Produção estimada do mês
          </p>
          <p className="relative mt-2 text-[38px] font-black leading-none tracking-[-0.035em] text-[#FFD400] sm:text-[42px]">
            {formatMoney(monthlyGain.total)}
          </p>
          <p className="relative mt-4 text-sm font-medium text-[#E0E0E0]">
            Comissão {formatMoney(monthlyGain.comissao)} + bônus {formatMoney(monthlyGain.bonus)}
          </p>
        </div>
      </div>
    </section>
  );
}
