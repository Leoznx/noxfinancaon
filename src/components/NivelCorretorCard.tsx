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
  const progress = info.metaProximo ? (info.contratos / info.metaProximo) * 100 : 100;
  
  return (
    <div className={`relative overflow-hidden p-8 rounded-3xl border transition-all ${info.nome.toLowerCase() === 'ouro' ? 'bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800 border-yellow-400 shadow-2xl shadow-yellow-400/10' : 'bg-white border-neutral-100 shadow-sm'}`}>
      {info.nome.toLowerCase() === 'ouro' && (
        <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-400 opacity-[0.03] rounded-full blur-[80px] -mr-32 -mt-32"></div>
      )}
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-10 relative z-10">
        <div className="flex items-center gap-8">
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg ${info.nome.toLowerCase() === 'ouro' ? 'bg-yellow-400 text-neutral-900' : 'bg-neutral-50 text-neutral-600 border border-neutral-100'}`}>
            <info.icone size={40} strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex flex-col gap-1 mb-2">
              <p className={`text-[10px] font-black uppercase tracking-[0.3em] ${info.nome.toLowerCase() === 'ouro' ? 'text-yellow-400' : 'text-neutral-400'}`}>
                Status de Parceria
              </p>
              <h2 className={`text-4xl font-black tracking-tighter uppercase ${info.nome.toLowerCase() === 'ouro' ? 'text-white' : 'text-neutral-900'}`}>
                {info.nome}
              </h2>
            </div>
            <div className="flex items-center gap-4">
              <div className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest flex items-center gap-2 ${info.nome.toLowerCase() === 'ouro' ? 'bg-white text-neutral-900' : 'bg-neutral-900 text-white'}`}>
                {info.percentual}% COMISSÃO
              </div>
              <p className={`text-xs font-bold ${info.nome.toLowerCase() === 'ouro' ? 'text-neutral-400' : 'text-neutral-500'}`}>
                <span className={info.nome.toLowerCase() === 'ouro' ? 'text-white' : 'text-neutral-900'}>{info.contratos} contratos ativos</span> vinculados
              </p>
            </div>
          </div>
        </div>

        <div className="w-full md:w-80 space-y-4">
          <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-1">
            <span className={info.nome.toLowerCase() === 'ouro' ? 'text-neutral-500' : 'text-neutral-400'}>Progresso {info.nome}</span>
            <span className={info.nome.toLowerCase() === 'text-white' ? 'text-white' : 'text-neutral-900'}>{info.contratos} / {info.metaProximo || info.contratos}</span>
          </div>
          <div className={`h-2.5 rounded-full overflow-hidden ${info.nome.toLowerCase() === 'ouro' ? 'bg-white/10' : 'bg-neutral-100'}`}>
            <div 
              className={`h-full transition-all duration-1000 ${info.nome.toLowerCase() === 'ouro' ? 'bg-yellow-400' : 'bg-neutral-900'}`} 
              style={{ width: `${progress}%` }}
            />
          </div>
          {info.proximoNivel && (
            <p className={`text-[10px] font-black uppercase tracking-widest text-right ${info.nome.toLowerCase() === 'ouro' ? 'text-neutral-500' : 'text-neutral-400'}`}>
              Faltam <span className={info.nome.toLowerCase() === 'ouro' ? 'text-yellow-400' : 'text-neutral-900'}>{info.metaProximo! - info.contratos} contratos</span> para {info.proximoNivel}
            </p>
          )}
        </div>
      </div>
    </div>

  );
}
