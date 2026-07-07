import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronRight, HelpCircle, Lock, MapPin, Plus, UserRound, Building2 } from "lucide-react";
import CurrencyInput from "react-currency-input-field";
import { IMaskInput } from "react-imask";
import { toast } from "sonner";
import { validateCPF, validateCNPJ } from "@/utils/validators";

export interface DadosSimulacao {
  tipoInquilino: 'PF' | 'PJ';
  inquilinos: { cpf: string; nome: string }[];
  razaoSocial: string;
  cnpj: string;
  tipoImovel: 'Residencial' | 'Comercial';
  cep: string;
  endereco: { cidade: string; uf: string } | null;
  valores: {
    aluguel: number;
    condominio: number;
    taxas: number;
  };
}

interface FormularioSimulacaoProps {
  modo: 'publico' | 'interno';
  onSubmit: (dados: DadosSimulacao) => void;
  dadosIniciais?: Partial<DadosSimulacao>;
  /** Desabilita o botão de envio — usado para bloquear novos cliques enquanto uma consulta já está em andamento. */
  disabled?: boolean;
}

export function FormularioSimulacao({ modo, onSubmit, dadosIniciais, disabled }: FormularioSimulacaoProps) {
  const [tipoInquilino, setTipoInquilino] = useState<'PF' | 'PJ'>(dadosIniciais?.tipoInquilino || 'PF');
  const [inquilinos, setInquilinos] = useState(dadosIniciais?.inquilinos || [{ cpf: '', nome: '' }]);
  const [razaoSocial, setRazaoSocial] = useState(dadosIniciais?.razaoSocial || '');
  const [cnpj, setCnpj] = useState(dadosIniciais?.cnpj || '');
  
  const [tipoImovel, setTipoImovel] = useState<'Residencial' | 'Comercial'>(dadosIniciais?.tipoImovel || 'Residencial');
  const [cep, setCep] = useState(dadosIniciais?.cep || '');
  const [endereco, setEndereco] = useState<{cidade: string, uf: string} | null>(dadosIniciais?.endereco || null);
  
  const [aluguel, setAluguel] = useState<number>(dadosIniciais?.valores?.aluguel || 0);
  const [condominio, setCondominio] = useState<number>(dadosIniciais?.valores?.condominio || 0);
  const [taxas, setTaxas] = useState<number>(dadosIniciais?.valores?.taxas || 0);
  const [erro, setErro] = useState<string | null>(null);

  const buscarCEP = async (valor: string) => {
    const limpo = valor.replace(/\D/g, '');
    if (limpo.length === 8) {
      try {
        const response = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
        const data = await response.json();
        if (!data.erro) {
          setEndereco({ cidade: data.localidade, uf: data.uf });
        } else {
          setEndereco(null);
        }
      } catch (err) {
        console.error("Erro ao buscar CEP", err);
      }
    }
  };

  const handleSimular = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    setErro(null);

    // Validação mínima — só bloqueia o que é essencial pra calcular
    if (!aluguel || aluguel <= 0) {
      const msg = "Informe o valor do aluguel para calcular a simulação.";
      setErro(msg); toast.error(msg); return;
    }
    if (!cep || cep.replace(/\D/g, '').length < 8) {
      const msg = "Informe um CEP válido do imóvel.";
      setErro(msg); toast.error(msg); return;
    }

    // Validação extra apenas no modo INTERNO (corretor já logado preenchendo dados oficiais)
    if (modo === 'interno') {
      if (tipoInquilino === 'PF') {
        for (const inq of inquilinos) {
          if (!validateCPF(inq.cpf)) {
            const msg = `CPF inválido: ${inq.cpf || '(vazio)'}`;
            setErro(msg); toast.error(msg); return;
          }
        }
      } else {
        if (!validateCNPJ(cnpj)) {
          const msg = "CNPJ inválido.";
          setErro(msg); toast.error(msg); return;
        }
      }
    }

    onSubmit({
      tipoInquilino,
      inquilinos,
      razaoSocial,
      cnpj,
      tipoImovel,
      cep,
      endereco,
      valores: { aluguel, condominio, taxas }
    });
  };


  return (
    <div className="w-full max-w-5xl">
      <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-2 tracking-tight">
        Simule a fiança do seu cliente
      </h1>
      <p className="text-lg text-neutral-600 mb-10">
        Preencha os dados abaixo. A simulação leva menos de 1 minuto.
      </p>

      <form onSubmit={handleSimular}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          {/* COLUNA ESQUERDA — Inquilino */}
          <section className="space-y-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-600 mb-4">
              Dados do inquilino
            </h2>
            
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <Button 
                type="button" 
                variant={tipoInquilino === 'PF' ? 'default' : 'outline'}
                onClick={() => setTipoInquilino('PF')}
                className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 h-12 sm:h-14 px-2 sm:px-4 font-bold text-xs sm:text-base whitespace-nowrap ${tipoInquilino === 'PF' ? 'bg-neutral-900 text-white' : 'text-neutral-600'}`}
              >
                <UserRound size={16} className="shrink-0 sm:w-5 sm:h-5" /> Pessoa Física
              </Button>
              <Button 
                type="button" 
                variant={tipoInquilino === 'PJ' ? 'default' : 'outline'}
                onClick={() => setTipoInquilino('PJ')}
                className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 h-12 sm:h-14 px-2 sm:px-4 font-bold text-xs sm:text-base whitespace-nowrap ${tipoInquilino === 'PJ' ? 'bg-neutral-900 text-white' : 'text-neutral-600'}`}
              >
                <Building2 size={16} className="shrink-0 sm:w-5 sm:h-5" /> Pessoa Jurídica
              </Button>
            </div>

            {tipoInquilino === 'PF' ? (
              <div className="space-y-4">
                {inquilinos.map((inq, i) => (
                  <div key={i} className="space-y-2">
                    <Label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Inquilino {i + 1}</Label>
                    <IMaskInput 
                      mask="000.000.000-00" 
                      value={inq.cpf}
                      onAccept={(val: any) => {
                        const newInqs = [...inquilinos];
                        newInqs[i].cpf = val;
                        setInquilinos(newInqs);
                      }}
                      className="flex h-14 w-full rounded-lg border border-neutral-200 bg-white px-4 py-2 text-base font-medium focus:ring-2 focus:ring-yellow-400 outline-none transition-all" 
                      placeholder="CPF" 
                    />
                  </div>
                ))}
                {inquilinos.length < 3 && (
                  <button type="button" onClick={() => setInquilinos([...inquilinos, { cpf: '', nome: '' }])} className="text-sm text-yellow-700 hover:underline flex items-center gap-1 font-bold">
                    <Plus className="w-4 h-4" /> Adicionar outro inquilino
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">CNPJ</Label>
                  <IMaskInput 
                    mask="00.000.000/0000-00" 
                    value={cnpj}
                    onAccept={(val: any) => setCnpj(val)}
                    className="flex h-14 w-full rounded-lg border border-neutral-200 bg-white px-4 py-2 text-base font-medium focus:ring-2 focus:ring-yellow-400 outline-none transition-all" 
                    placeholder="00.000.000/0000-00" 
                  />
                </div>
              </div>
            )}
          </section>

          {/* COLUNA DIREITA — Imóvel + Valores */}
          <section className="space-y-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-600 mb-4">
              Dados do imóvel
            </h2>
            
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <Button 
                type="button" 
                variant={tipoImovel === 'Residencial' ? 'default' : 'outline'}
                onClick={() => setTipoImovel('Residencial')}
                className={`flex-1 h-12 sm:h-14 px-2 sm:px-4 font-bold text-xs sm:text-base whitespace-nowrap ${tipoImovel === 'Residencial' ? 'bg-neutral-900 text-white' : 'text-neutral-600'}`}
              >
                Residencial
              </Button>
              <Button 
                type="button" 
                variant={tipoImovel === 'Comercial' ? 'default' : 'outline'}
                onClick={() => setTipoImovel('Comercial')}
                className={`flex-1 h-12 sm:h-14 px-2 sm:px-4 font-bold text-xs sm:text-base whitespace-nowrap ${tipoImovel === 'Comercial' ? 'bg-neutral-900 text-white' : 'text-neutral-600'}`}
              >
                Comercial
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">CEP</Label>
              <IMaskInput 
                mask="00000-000" 
                value={cep}
                onAccept={(val: any) => { setCep(val); if(val.length === 9) buscarCEP(val); }} 
                className="flex h-14 w-full rounded-lg border border-neutral-200 bg-white px-4 py-2 text-base font-medium focus:ring-2 focus:ring-yellow-400 outline-none transition-all" 
                placeholder="00000-000" 
              />
              {endereco && (
                <p className="text-xs text-neutral-500 mt-1 flex items-center gap-1 font-bold uppercase">
                  <MapPin className="w-4 h-4 text-yellow-600" strokeWidth={1.5} />
                  {endereco.cidade}, {endereco.uf}
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3 items-end">
              <div className="space-y-1.5 sm:space-y-2 min-w-0">
                <Label className="text-[10px] sm:text-xs font-bold text-neutral-500 uppercase tracking-wider sm:tracking-widest block h-4 sm:h-5">Aluguel</Label>
                <CurrencyInput 
                  prefix="R$ " 
                  decimalsLimit={2} 
                  value={aluguel || ''}
                  onValueChange={(v, name, values) => {
                    setAluguel(values?.float || 0);
                  }} 
                  className="flex h-12 sm:h-14 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-2 sm:px-4 py-2 text-sm sm:text-base font-bold text-neutral-900 focus:ring-2 focus:ring-yellow-400 outline-none transition-all" 
                  placeholder="R$ 0,00" 
                />
              </div>
              <div className="space-y-1.5 sm:space-y-2 min-w-0">
                <Label className="text-[10px] sm:text-xs font-bold text-neutral-500 uppercase tracking-wider sm:tracking-widest block h-4 sm:h-5">Condomínio</Label>
                <CurrencyInput 
                  prefix="R$ " 
                  decimalsLimit={2} 
                  value={condominio || ''}
                  onValueChange={(v, name, values) => {
                    setCondominio(values?.float || 0);
                  }} 
                  className="flex h-12 sm:h-14 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-2 sm:px-4 py-2 text-sm sm:text-base font-medium focus:ring-2 focus:ring-yellow-400 outline-none transition-all" 
                  placeholder="R$ 0,00" 
                />
              </div>
              <div className="space-y-1.5 sm:space-y-2 min-w-0">
                <div className="flex items-center gap-1 h-4 sm:h-5">
                  <Label className="text-[10px] sm:text-xs font-bold text-neutral-500 uppercase tracking-wider sm:tracking-widest">Taxas</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle size={12} className="text-neutral-400 cursor-help shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent className="bg-neutral-900 text-white border-neutral-800 p-3 rounded-lg shadow-xl max-w-xs">
                        <p className="text-xs font-medium leading-relaxed">
                          Taxas no geral, taxa de administração, IPTU, condomínio.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <CurrencyInput 
                  prefix="R$ " 
                  decimalsLimit={2} 
                  value={taxas || ''}
                  onValueChange={(v, name, values) => {
                    setTaxas(values?.float || 0);
                  }} 
                  className="flex h-12 sm:h-14 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-2 sm:px-4 py-2 text-sm sm:text-base font-medium focus:ring-2 focus:ring-yellow-400 outline-none transition-all" 
                  placeholder="R$ 0,00" 
                />
              </div>
            </div>
          </section>
        </div>

        {/* Aviso compacto */}
        <div className="mt-8 flex items-start gap-3 text-sm text-neutral-600 bg-neutral-50 rounded-lg p-4 border border-neutral-100">
          <Lock className="w-5 h-5 text-neutral-400 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
          <span>
            {modo === 'publico' 
              ? 'Para visualizar o resultado, será necessário entrar ou criar uma conta gratuita.'
              : 'Para visualizar o resultado, preencha todos os dados corretamente.'
            }
          </span>
        </div>

        {erro && (
          <div className="mt-4 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-base font-medium text-red-700">
            {erro}
          </div>
        )}

        {/* Botão largura total */}
        <Button
          type="submit"
          disabled={disabled}
          className="w-full mt-8 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-300 text-white py-8 rounded-xl font-bold text-xl inline-flex items-center justify-center gap-2 transition-all shadow-xl shadow-neutral-200 active:scale-[0.98]"
        >
          {modo === 'publico' ? 'Simular crédito e entrar' : 'Simular crédito'}
          <ChevronRight className="w-6 h-6" strokeWidth={2.5} />
        </Button>

      </form>
    </div>
  );
}

