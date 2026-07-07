import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { InstitutionalHeader } from "@/components/landing/InstitutionalHeader";
import { InstitutionalFooter } from "@/components/landing/FaqAndFooterInstitutional";
import { 
  UserRound, 
  Building2, 
  Home, 
  Key,
  ArrowLeft, 
  Check, 
  Clock, 
  ChevronRight, 
  Loader2 
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";

const contatoSearchSchema = z.object({
  perfil: z.enum(['corretor', 'imobiliaria', 'proprietario', 'inquilino']).optional(),
});

export const Route = createFileRoute("/contato")({
  component: ContatoPage,
  validateSearch: (search) => contatoSearchSchema.parse(search),
});

const UFS_BRASIL = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", 
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

function ContatoPage() {
  const search = useSearch({ from: '/contato' });
  
  // Lê o perfil da URL apenas uma vez no mount inicial
  const [perfil, setPerfil] = useState<'corretor' | 'imobiliaria' | 'proprietario' | 'inquilino'>(search.perfil || 'corretor');
  const [sucesso, setSucesso] = useState(false);

  // Link de "Voltar" aponta para a landing do perfil correspondente
  const linkVoltar = perfil 
    ? `/${perfil}` 
    : '/';
  
  const textoVoltar = perfil
    ? `Voltar para ${perfil === 'corretor' ? 'corretores' : perfil === 'imobiliaria' ? 'imobiliárias' : perfil === 'inquilino' ? 'inquilinos' : 'proprietários'}`
    : 'Voltar à página inicial';

  // Sem useEffect para sincronizar URL -> estado. 
  // Isso evita que o navegador registre entradas duplicadas no histórico.

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col font-sans">
      <InstitutionalHeader />
      
      <main className="flex-1 flex items-center justify-center px-4 pt-24 pb-12 lg:py-32">
        <div className="w-full max-w-5xl mx-auto">
          {sucesso ? (
            <TelaSucesso perfil={perfil} />
          ) : (
            <FormularioContato 
              perfil={perfil} 
              setPerfil={setPerfil} 
              linkVoltar={linkVoltar} 
              textoVoltar={textoVoltar} 
              onSuccess={() => setSucesso(true)} 
            />
          )}
        </div>
      </main>

      <InstitutionalFooter />
    </div>
  );
}

function InputField({ label, value, onChange, type = "text", placeholder, required, mask }: any) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-11 rounded-lg border-neutral-200 focus:border-neutral-900 focus:ring-neutral-900 transition-all"
      />
    </div>
  );
}

function FormularioContato({ perfil, setPerfil, linkVoltar, textoVoltar, onSuccess }: any) {
  const [enviando, setEnviando] = useState(false);
  const [form, setForm] = useState({
    nome: '',
    email: '',
    telefone: '',
    cidade: '',
    uf: '',
    mensagem: '',
  });

  const conteudoPorPerfil = {
    corretor: {
      tituloHeader: 'Para Corretor',
      tituloPrincipal: 'Cresça mais com a NOX FIANÇA',
      subtitulo: 'Fale com nosso time e descubra como triplicar suas conversões com seguro fiança digital.',
      destaques: [
        'Aprovação em até 1 minuto',
        'Comissão progressiva por nível',
        'PIX automático após cada contrato',
      ],
      placeholderMensagem: 'Conte um pouco sobre sua atuação (opcional): quantos contratos fecha por mês, em quais cidades atua, etc.',
      labelBotao: 'Quero falar com a NOX',
      icone: UserRound,
    },
    imobiliaria: {
      tituloHeader: 'Para Imobiliária',
      tituloPrincipal: 'Mais contratos sem dor de cabeça',
      subtitulo: 'Fale com nosso time comercial e descubra como aumentar a conversão da sua imobiliária com seguro fiança.',
      destaques: [
        'Gestão centralizada de contratos',
        'Cashback exclusivo para parceiras',
        'Suporte jurídico dedicado',
      ],
      placeholderMensagem: 'Conte sobre sua imobiliária (opcional): número de unidades em carteira, equipe, principais desafios atuais, etc.',
      labelBotao: 'Falar com consultor',
      icone: Building2,
    },
    proprietario: {
      tituloHeader: 'Para Proprietário',
      tituloPrincipal: 'Aluguel garantido, sem fiador, sem caução',
      subtitulo: 'Fale com nosso time e tenha tranquilidade no recebimento do aluguel todos os meses, com proteção total do imóvel.',
      destaques: [
        'Aluguel garantido todo mês',
        'Cobertura de danos no imóvel',
        'Sem burocracia para o inquilino',
      ],
      placeholderMensagem: 'Conte sobre seu imóvel (opcional): tipo (residencial/comercial), localização, situação atual (alugado/disponível).',
      labelBotao: 'Quero proteger meu imóvel',
      icone: Home,
    },
    inquilino: {
      tituloHeader: 'Para Inquilino',
      tituloPrincipal: 'Alugue sem fiador e sem caução',
      subtitulo: 'Fale com nosso time e descubra como alugar o imóvel dos seus sonhos com aprovação rápida e parcelas que cabem no seu bolso.',
      destaques: [
        'Aprovação em até 1 minuto',
        'Sem fiador e sem depósito caução',
        'Parcelamento facilitado da fiança',
      ],
      placeholderMensagem: 'Conte um pouco sobre você (opcional): cidade onde quer alugar, faixa de aluguel, prazo desejado, etc.',
      labelBotao: 'Quero alugar com a NOX',
      icone: Key,
    },
  };

  const conteudo = conteudoPorPerfil[perfil as keyof typeof conteudoPorPerfil];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    
    try {
      // Salva o lead no Supabase
      const { error } = await supabase.from('leads_contato').insert({
        perfil,
        nome: form.nome,
        email: form.email,
        telefone: form.telefone,
        cidade: form.cidade,
        uf: form.uf,
        mensagem: form.mensagem,
        origem: 'landing_page',
        status: 'novo',
      });
      
      if (error) throw error;
      
      // Dispara e-mail interno via Edge Function
      await supabase.functions.invoke('notificar-time-comercial', {
        body: { perfil, ...form }
      });
      
      onSuccess();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao enviar. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-5 gap-0 bg-white rounded-2xl shadow-2xl shadow-neutral-200 border border-neutral-200 overflow-hidden">
      
      {/* COLUNA ESQUERDA — Contexto (2/5) */}
      <aside className="lg:col-span-2 bg-neutral-900 text-white p-8 lg:p-10 flex flex-col">
        <Link to={linkVoltar as any} className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
          {textoVoltar}
        </Link>
        
        {/* Badge do perfil */}
        <div className="inline-flex items-center gap-2 bg-[#FACC15] text-neutral-900 rounded-full px-3 py-1 mb-6 self-start">
          <conteudo.icone className="w-3.5 h-3.5" strokeWidth={2.} />
          <span className="text-[10px] font-bold uppercase tracking-widest">
            {conteudo.tituloHeader}
          </span>
        </div>
        
        <h1 className="text-2xl lg:text-3xl font-bold mb-4 leading-tight">
          {conteudo.tituloPrincipal}
        </h1>
        <p className="text-sm text-neutral-300 mb-8 leading-relaxed">
          {conteudo.subtitulo}
        </p>
        
        {/* Destaques */}
        <ul className="space-y-4 mb-auto">
          {conteudo.destaques.map((item, i) => (
            <li key={i} className="flex items-start gap-3 text-sm group">
              <div className="bg-[#FACC15] rounded-md p-1 flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform">
                <Check className="w-3 h-3 text-neutral-900" strokeWidth={3} />
              </div>
              <span className="text-neutral-200 leading-snug">{item}</span>
            </li>
          ))}
        </ul>
        
        {/* Tempo de resposta */}
        <div className="mt-8 pt-6 border-t border-neutral-800 flex items-center gap-3 text-sm text-neutral-400">
          <Clock className="w-4 h-4 text-[#FACC15]" strokeWidth={1.5} />
          Resposta em até 24 horas úteis
        </div>
      </aside>
      
      {/* COLUNA DIREITA — Formulário (3/5) */}
      <form onSubmit={handleSubmit} className="lg:col-span-3 p-8 lg:p-10">
        
        {/* Seletor de perfil */}
        <div className="mb-8">
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 mb-4">
            Quero me cadastrar como:
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { id: 'corretor',     label: 'Corretor',     icon: UserRound },
              { id: 'imobiliaria',  label: 'Imobiliária',  icon: Building2 },
              { id: 'proprietario', label: 'Proprietário', icon: Home },
              { id: 'inquilino',    label: 'Inquilino',    icon: Key },
            ].map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPerfil(p.id as any)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  perfil === p.id 
                    ? 'border-neutral-900 bg-neutral-50 shadow-inner' 
                    : 'border-neutral-100 bg-white hover:border-neutral-200 hover:bg-neutral-50/50'
                }`}
              >
                <p.icon 
                  className={`w-5 h-5 ${perfil === p.id ? 'text-neutral-900' : 'text-neutral-400'}`} 
                  strokeWidth={1.5} 
                />
                <span className={`text-[11px] font-bold uppercase tracking-wider ${perfil === p.id ? 'text-neutral-900' : 'text-neutral-500'}`}>
                  {p.label}
                </span>
              </button>
            ))}
          </div>
        </div>
        
        {/* Campos do formulário */}
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <InputField 
            label="Nome completo" 
            value={form.nome} 
            onChange={(v: string) => setForm({...form, nome: v})}
            required
            placeholder="Ex: João Silva"
          />
          <InputField 
            label="E-mail" 
            type="email"
            value={form.email} 
            onChange={(v: string) => setForm({...form, email: v})}
            required
            placeholder="nome@empresa.com.br"
          />
        </div>
        
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <InputField 
            label="Telefone / WhatsApp" 
            value={form.telefone} 
            onChange={(v: string) => setForm({...form, telefone: v})}
            placeholder="(11) 99999-9999"
            required
          />
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <InputField 
                label="Cidade" 
                value={form.cidade} 
                onChange={(v: string) => setForm({...form, cidade: v})}
                required
                placeholder="São Paulo"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-600">UF <span className="text-red-500">*</span></label>
              <Select value={form.uf} onValueChange={(v) => setForm({...form, uf: v})} required>
                <SelectTrigger className="h-11 rounded-lg border-neutral-200 focus:ring-neutral-900">
                  <SelectValue placeholder="--" />
                </SelectTrigger>
                <SelectContent>
                  {UFS_BRASIL.map(uf => (
                    <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        
        {/* Mensagem opcional */}
        <div className="mb-6">
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 mb-2">
            Mensagem <span className="text-neutral-400 font-normal lowercase">(opcional)</span>
          </label>
          <textarea
            value={form.mensagem}
            onChange={(e) => setForm({...form, mensagem: e.target.value})}
            placeholder={conteudo.placeholderMensagem}
            rows={3}
            className="w-full px-4 py-3 text-sm border border-neutral-200 rounded-xl focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 outline-none transition-all resize-none placeholder:text-neutral-400"
          />
        </div>
        
        {/* Consentimento LGPD */}
        <label className="flex items-start gap-3 mb-8 group cursor-pointer">
          <div className="relative flex items-center mt-0.5">
            <input 
              type="checkbox" 
              required 
              className="peer h-4 w-4 shrink-0 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 accent-neutral-900" 
            />
          </div>
          <span className="text-xs text-neutral-500 leading-relaxed group-hover:text-neutral-700 transition-colors">
            Concordo em receber contato da NOX FIANÇA e com a{' '}
            <Link to="/privacidade" className="text-yellow-700 font-bold hover:underline">Política de Privacidade</Link>.
          </span>
        </label>
        
        {/* Botão de envio */}
        <Button 
          type="submit"
          disabled={enviando}
          className="w-full bg-neutral-900 hover:bg-neutral-800 text-white h-14 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow-lg shadow-neutral-100 active:scale-[0.98]"
        >
          {enviando ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Enviando...
            </>
          ) : (
            <>
              {conteudo.labelBotao}
              <ChevronRight className="w-5 h-5" strokeWidth={2.5} />
            </>
          )}
        </Button>
      </form>
    </div>
  );
}

function TelaSucesso({ perfil }: any) {
  const mensagensPorPerfil = {
    corretor: {
      titulo: 'Tudo certo, corretor!',
      texto: 'Recebemos seu contato. Nosso time vai retornar em até 24 horas úteis com uma proposta de parceria e materiais sobre como triplicar suas conversões.',
      proximoPasso: 'Enquanto isso, conheça nosso plano de carreira:',
      cta: 'Ver plano de carreira',
      ctaLink: '/plano-carreira',
    },
    imobiliaria: {
      titulo: 'Contato registrado!',
      texto: 'Recebemos suas informações. Nosso time comercial entrará em contato em até 24 horas úteis para apresentar a parceria e o programa de cashback exclusivo.',
      proximoPasso: 'Conheça o programa de parceria:',
      cta: 'Ver programa para imobiliárias',
      ctaLink: '/imobiliaria',
    },
    proprietario: {
      titulo: 'Pedido recebido!',
      texto: 'Recebemos seu interesse na NOX FIANÇA. Em até 24 horas úteis nossa equipe retornará explicando como proteger seu imóvel e garantir o recebimento mensal.',
      proximoPasso: 'Saiba mais sobre nossa cobertura:',
      cta: 'Ver coberturas',
      ctaLink: '/proprietario',
    },
    inquilino: {
      titulo: 'Solicitação enviada!',
      texto: 'Recebemos seu contato. Nosso time vai retornar em até 24 horas úteis com as próximas etapas para você alugar sem fiador e sem caução.',
      proximoPasso: 'Enquanto isso, conheça os benefícios:',
      cta: 'Ver vantagens para inquilinos',
      ctaLink: '/inquilino',
    },
  };
  
  const mensagem = mensagensPorPerfil[perfil as keyof typeof mensagensPorPerfil];
  
  return (
    <div className="max-w-2xl mx-auto text-center bg-white rounded-3xl shadow-2xl shadow-neutral-100 border border-neutral-100 p-6 sm:p-10 lg:p-16">
      {/* Ícone de sucesso */}
      <div className="w-20 h-20 bg-[#FACC15] rounded-full mx-auto flex items-center justify-center mb-8 shadow-xl shadow-yellow-100/50 scale-110">
        <Check className="w-10 h-10 text-neutral-900" strokeWidth={3} />
      </div>
      
      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-neutral-900 mb-4 tracking-tight">
        {mensagem.titulo}
      </h1>
      
      <p className="text-neutral-500 leading-relaxed mb-10 text-lg max-w-lg mx-auto font-medium">
        {mensagem.texto}
      </p>
      
      <div className="border-t border-neutral-100 pt-10">
        <p className="text-sm font-bold uppercase tracking-widest text-neutral-400 mb-6">{mensagem.proximoPasso}</p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link 
            to={mensagem.ctaLink as any}
            className="bg-[#FACC15] hover:bg-yellow-500 text-neutral-900 h-12 px-8 rounded-xl font-bold text-sm flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-yellow-100"
          >
            {mensagem.cta}
          </Link>
          <Link 
            to="/"
            className="border border-neutral-200 hover:border-neutral-900 text-neutral-900 h-12 px-8 rounded-xl font-bold text-sm flex items-center justify-center transition-all active:scale-95 bg-white"
          >
            Voltar à página inicial
          </Link>
        </div>
      </div>
    </div>
  );
}
