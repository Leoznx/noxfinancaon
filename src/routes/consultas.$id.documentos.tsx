import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FileUp, CheckCircle2, ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export const Route = createFileRoute("/consultas/$id/documentos")({
  component: () => (
    <ProtectedRoute>
      <DocumentosUpload />
    </ProtectedRoute>
  ),
});

function DocumentosUpload() {
  const { id } = Route.useParams();
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    const welcome = localStorage.getItem('nox_show_welcome_banner');
    if (welcome === 'true') {
        setShowWelcome(true);
        localStorage.removeItem('nox_show_welcome_banner');
    }
  }, []);

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto py-8 px-6">
        <AnimatePresence>
            {showWelcome && (
                <motion.div 
                    initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                    animate={{ height: 'auto', opacity: 1, marginBottom: 24 }}
                    exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                    className="overflow-hidden"
                >
                    <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6 relative">
                        <div className="flex items-start gap-4">
                            <div className="bg-yellow-400 rounded-xl p-2.5 shadow-sm">
                                <CheckCircle2 className="w-6 h-6 text-neutral-900" strokeWidth={2.5} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-black text-neutral-900 text-lg">Sua simulação foi gerada com sucesso!</h3>
                                <p className="text-sm text-neutral-600 mt-1 font-medium">
                                    Para que nossa equipe analise e aprove o crédito, envie agora os documentos do inquilino. Aprovação garantida em até 24h úteis.
                                </p>
                            </div>
                            <button onClick={() => setShowWelcome(false)} className="text-neutral-400 hover:text-neutral-900 transition-colors">
                                <X size={20} strokeWidth={1.5} />
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>

        <Link to="/consultas" className="text-neutral-500 hover:text-neutral-900 mb-6 flex items-center gap-2 transition-colors font-bold uppercase text-[10px] tracking-widest">
          <ArrowLeft size={14} /> Voltar para consultas
        </Link>
        
        <div className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Anexar Documentação</h1>
            <p className="text-neutral-500">Consulta #{id.slice(0, 8)}</p>
          </div>
          <div className="px-4 py-2 bg-yellow-100 text-yellow-700 rounded-lg text-sm font-bold border border-yellow-200 uppercase tracking-wider">
            Aguardando Documentos
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
                <FileUp className="text-yellow-500" /> Documentos do Inquilino
            </h2>
            <div className="p-8 border-2 border-dashed border-neutral-200 rounded-2xl flex flex-col items-center justify-center text-center bg-neutral-50 hover:bg-white hover:border-yellow-400 transition-all cursor-pointer group">
              <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center text-neutral-400 group-hover:text-yellow-500 mb-4 transition-colors">
                <FileUp size={24} />
              </div>
              <p className="font-bold text-neutral-900">Documento de Identidade</p>
              <p className="text-sm text-neutral-500 max-w-[200px] mt-1">RG ou CNH (Frente e Verso)</p>
            </div>
            
            <div className="p-8 border-2 border-dashed border-neutral-200 rounded-2xl flex flex-col items-center justify-center text-center bg-neutral-50 hover:bg-white hover:border-yellow-400 transition-all cursor-pointer group">
              <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center text-neutral-400 group-hover:text-yellow-500 mb-4 transition-colors">
                <FileUp size={24} />
              </div>
              <p className="font-bold text-neutral-900">Comprovante de Renda</p>
              <p className="text-sm text-neutral-500 max-w-[200px] mt-1">Holerites, IRPF ou Extrato Bancário</p>
            </div>
          </div>

          <div className="bg-white border border-neutral-100 rounded-3xl p-8 shadow-sm h-fit">
            <h3 className="font-bold text-lg mb-4">Instruções</h3>
            <ul className="space-y-4">
                <li className="flex gap-3 text-sm text-neutral-600">
                    <CheckCircle2 className="text-green-500 flex-shrink-0" size={18} />
                    <span>Arquivos permitidos: PDF, JPG, PNG.</span>
                </li>
                <li className="flex gap-3 text-sm text-neutral-600">
                    <CheckCircle2 className="text-green-500 flex-shrink-0" size={18} />
                    <span>Tamanho máximo: 10MB por arquivo.</span>
                </li>
                <li className="flex gap-3 text-sm text-neutral-600">
                    <CheckCircle2 className="text-green-500 flex-shrink-0" size={18} />
                    <span>Garanta que a foto esteja nítida e com todas as bordas visíveis.</span>
                </li>
            </ul>
            <Button className="w-full mt-10 bg-neutral-900 h-12 rounded-xl">Enviar para análise</Button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
