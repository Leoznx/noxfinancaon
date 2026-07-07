import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, ArrowRight, User, Mail, DollarSign, FileCheck, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/consulta-rapida")({
  component: QuickConsultation,
});

function QuickConsultation() {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      setStep(step + 1);
    } else {
      setIsLoading(true);
      setTimeout(() => {
        setIsLoading(false);
        setStep(4);
      }, 2000);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6">
      <div className="mb-12 flex items-center gap-3 cursor-pointer group" onClick={() => navigate({ to: "/" })}>
        <div className="w-10 h-10 bg-black flex items-center justify-center rounded-lg font-bold text-white text-xl group-hover:scale-105 transition-transform">N</div>
        <span className="text-xl font-bold tracking-tight text-neutral-900">NOX FIANÇA</span>
      </div>

      <Card className="w-full max-w-xl bg-white shadow-xl border-neutral-200 border-none rounded-xl overflow-hidden">
        <div className="h-1.5 w-full bg-neutral-100 relative">
          <div 
            className="absolute top-0 left-0 h-full bg-[#FACC15] transition-all duration-700 ease-in-out" 
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>
        
        <CardHeader className="text-center pt-10 px-10">
          <CardTitle className="text-2xl font-bold text-neutral-900 tracking-tight">Consulta de Crédito Digital</CardTitle>
          <CardDescription className="text-neutral-500 font-medium pt-2">
            {step < 4 ? `Etapa ${step} de 3 — Informações básicas` : 'Resultado da Pré-Análise'}
          </CardDescription>
        </CardHeader>
        
        <CardContent className="p-10">
          {step === 1 && (
            <form onSubmit={handleNext} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-neutral-700">Nome completo</label>
                  <Input placeholder="Digite seu nome completo" required className="h-12 rounded-lg border-neutral-300 focus:ring-neutral-900" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-neutral-700">CPF</label>
                  <Input placeholder="000.000.000-00" required className="h-12 rounded-lg border-neutral-300 focus:ring-neutral-900" />
                </div>
              </div>
              <Button className="w-full h-14 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-lg mt-4 shadow-lg shadow-neutral-100">
                Continuar
                <ArrowRight className="ml-2 w-5 h-5" strokeWidth={1.5} />
              </Button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleNext} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-neutral-700">E-mail para contato</label>
                  <Input type="email" placeholder="seu@email.com.br" required className="h-12 rounded-lg border-neutral-300 focus:ring-neutral-900" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-neutral-700">Telefone (WhatsApp)</label>
                  <Input placeholder="(00) 00000-0000" required className="h-12 rounded-lg border-neutral-300 focus:ring-neutral-900" />
                </div>
              </div>
              <div className="flex gap-4">
                <Button variant="outline" type="button" className="flex-1 h-14 rounded-lg border-neutral-300" onClick={() => setStep(1)}>
                  Voltar
                </Button>
                <Button className="flex-[2] h-14 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-lg shadow-lg shadow-neutral-100">
                  Continuar
                </Button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={handleNext} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-neutral-700">Valor pretendido do aluguel</label>
                  <Input type="number" placeholder="Ex: 2.500" required className="h-12 rounded-lg border-neutral-300 focus:ring-neutral-900" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-neutral-700">Sua renda mensal comprovada</label>
                  <Input type="number" placeholder="Ex: 7.500" required className="h-12 rounded-lg border-neutral-300 focus:ring-neutral-900" />
                </div>
              </div>
              <div className="flex gap-4">
                <Button variant="outline" type="button" className="flex-1 h-14 rounded-lg border-neutral-300" onClick={() => setStep(2)}>
                  Voltar
                </Button>
                <Button className="flex-[2] h-14 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-lg shadow-lg shadow-neutral-100" disabled={isLoading}>
                  {isLoading ? "Processando análise..." : "Finalizar solicitação"}
                  {!isLoading && <Search className="ml-2 w-5 h-5" strokeWidth={1.5} />}
                </Button>
              </div>
            </form>
          )}

          {step === 4 && (
            <div className="text-center space-y-8 animate-fade-in">
              <div className="w-20 h-20 bg-green-50 text-green-700 rounded-full flex items-center justify-center mx-auto border border-green-100 shadow-inner">
                <FileCheck size={40} strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-neutral-900 mb-2">Crédito Pré-Aprovado</h3>
                <p className="text-neutral-500 font-medium leading-relaxed">
                  Com base nos indicadores fornecidos, seu perfil possui compatibilidade com as diretrizes de garantia da NOX FIANÇA.
                </p>
              </div>
              <div className="space-y-4 pt-4">
                <Button className="w-full h-14 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-lg shadow-xl shadow-neutral-100" onClick={() => navigate({ to: "/" })}>
                  Retornar ao início
                </Button>
                <Button variant="ghost" className="w-full h-12 text-neutral-500 font-semibold hover:text-neutral-900" onClick={() => navigate({ to: "/login" })}>
                  Acessar painel completo
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      <p className="mt-10 text-xs text-neutral-400 max-w-sm text-center font-medium leading-relaxed">
        A pré-aprovação não substitui a análise documental final obrigatória para a emissão da apólice de seguro fiança.
      </p>
    </div>
  );
}
