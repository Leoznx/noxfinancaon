import { Trophy, ArrowUpRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface NivelInfo {
  nome: string;
  percentual: number;
  cor: string;
  icone: any;
  contratos: number;
  proximoNivel?: string;
  metaProximo?: number;
}

export function NivelCorretorCard({ info }: { info: NivelInfo }) {
  const isOuro = info.nome.toLowerCase() === 'ouro';
  const progress = info.metaProximo ? Math.min(100, (info.contratos / info.metaProximo) * 100) : 100;

  return (
    <div className={`relative overflow-hidden p-5 rounded-2xl border transition-all ${isOuro ? 'bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800 border-yellow-400 shadow-xl shadow-yellow-400/10' : 'bg-white border-neutral-100 shadow-sm'}`}>
      {isOuro && (
        <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-400 opacity-[0.03] rounded-full blur-[80px] -mr-24 -mt-24"></div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md shrink-0 ${isOuro ? 'bg-yellow-400 text-neutral-900' : 'bg-neutral-50 text-neutral-600 border border-neutral-100'}`}>
            <info.icone size={24} strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex flex-col gap-0.5 mb-1.5">
              <p className={`text-[9px] font-black uppercase tracking-[0.3em] ${isOuro ? 'text-yellow-400' : 'text-neutral-400'}`}>
                Status de Parceria
              </p>
              <h2 className={`text-xl font-black tracking-tighter uppercase leading-none ${isOuro ? 'text-white' : 'text-neutral-900'}`}>
                {info.nome}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <div className={`px-3 py-1 rounded-full text-[9px] font-black tracking-widest flex items-center gap-2 ${isOuro ? 'bg-white text-neutral-900' : 'bg-neutral-900 text-white'}`}>
                {info.percentual}% COMISSÃO
              </div>
              <p className={`text-[11px] font-bold ${isOuro ? 'text-neutral-400' : 'text-neutral-500'}`}>
                <span className={isOuro ? 'text-white' : 'text-neutral-900'}>{info.contratos} contratos ativos</span> vinculados
              </p>
            </div>
          </div>
        </div>

        <div className="w-full md:w-72 space-y-2">
          <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
            <span className={isOuro ? 'text-neutral-500' : 'text-neutral-400'}>Progresso {info.nome}</span>
            <span className={isOuro ? 'text-white' : 'text-neutral-900'}>{info.contratos} / {info.metaProximo || info.contratos}</span>
          </div>
          <div className={`h-1.5 rounded-full overflow-hidden ${isOuro ? 'bg-white/10' : 'bg-neutral-100'}`}>
            <div
              className={`h-full transition-all duration-1000 ${isOuro ? 'bg-yellow-400' : 'bg-neutral-900'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {info.proximoNivel && (
            <p className={`text-[9px] font-black uppercase tracking-widest text-right ${isOuro ? 'text-neutral-500' : 'text-neutral-400'}`}>
              Faltam <span className={isOuro ? 'text-yellow-400' : 'text-neutral-900'}>{Math.max(0, info.metaProximo! - info.contratos)} contratos</span> para {info.proximoNivel}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
