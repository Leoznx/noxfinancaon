import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { UserRound, Building2, Users } from "lucide-react";

interface IdentificacaoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (userId: string) => void;
}

export function IdentificacaoModal({ open, onOpenChange, onSuccess }: IdentificacaoModalProps) {
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<'imobiliaria' | 'corretor' | 'proprietario'>('corretor');

  // Login Form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginSenha, setLoginSenha] = useState('');

  // Register Form
  const [regNome, setRegNome] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regTelefone, setRegTelefone] = useState('');
  const [regSenha, setRegSenha] = useState('');
  const [regTermos, setRegTermos] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginSenha,
      });
      if (error) throw error;
      if (data.user) {
        toast.success("Login realizado com sucesso!");
        onSuccess(data.user.id);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regTermos) {
      toast.error("Você deve aceitar os termos");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: regEmail,
        password: regSenha,
        options: {
          data: {
            nome: regNome,
            role: role,
            status: 'pendente_aprovacao'
          }
        }
      });
      if (error) throw error;
      if (data.user) {
        toast.success("Conta criada com sucesso!");
        onSuccess(data.user.id);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-none rounded-3xl shadow-2xl">
        <Tabs defaultValue="login" className="w-full">
          <div className="bg-neutral-50 px-8 pt-8 pb-6 border-b border-neutral-100">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-2xl font-black text-neutral-900 tracking-tight">Acesse para ver sua simulação</DialogTitle>
              <DialogDescription className="text-neutral-500 font-medium">
                Sua simulação foi preparada. Entre ou crie uma conta gratuita para visualizar os planos disponíveis.
              </DialogDescription>
            </DialogHeader>
            <TabsList className="grid w-full grid-cols-2 bg-neutral-200/50 p-1 rounded-xl h-12">
              <TabsTrigger value="login" className="rounded-lg font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">Já tenho conta</TabsTrigger>
              <TabsTrigger value="cadastro" className="rounded-lg font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">Criar conta rápida</TabsTrigger>
            </TabsList>
          </div>

          <div className="p-8">
            <TabsContent value="login" className="mt-0 outline-none">
              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">E-mail</Label>
                  <Input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required className="h-12 rounded-xl border-neutral-200" placeholder="seu@email.com.br" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Senha</Label>
                    <button type="button" className="text-[10px] font-bold text-yellow-600 uppercase tracking-widest hover:text-yellow-700">Esqueci a senha</button>
                  </div>
                  <Input type="password" value={loginSenha} onChange={e => setLoginSenha(e.target.value)} required className="h-12 rounded-xl border-neutral-200" placeholder="••••••••" />
                </div>
                <Button disabled={loading} type="submit" className="w-full h-14 bg-neutral-900 text-white hover:bg-neutral-800 rounded-2xl font-black text-lg shadow-xl shadow-neutral-200">
                  {loading ? "Entrando..." : "Entrar e ver minha simulação"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="cadastro" className="mt-0 outline-none">
              <form onSubmit={handleRegister} className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Tipo de conta</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'imobiliaria', label: 'Imobiliária', icon: Building2 },
                      { id: 'corretor', label: 'Corretor', icon: UserRound },
                      { id: 'proprietario', label: 'Proprietário', icon: Users },
                    ].map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setRole(t.id as any)}
                        className={`p-3 border rounded-xl flex flex-col items-center gap-1.5 transition-all ${role === t.id ? 'border-neutral-900 bg-yellow-400 text-neutral-900' : 'border-neutral-100 bg-neutral-50 text-neutral-400 hover:border-neutral-200'}`}
                      >
                        <t.icon size={18} />
                        <span className="text-[10px] font-bold">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Nome completo</Label>
                  <Input value={regNome} onChange={e => setRegNome(e.target.value)} required className="h-12 rounded-xl border-neutral-200" placeholder="Seu nome" />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">E-mail</Label>
                    <Input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} required className="h-12 rounded-xl border-neutral-200" placeholder="E-mail" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">WhatsApp</Label>
                    <Input value={regTelefone} onChange={e => setRegTelefone(e.target.value)} required className="h-12 rounded-xl border-neutral-200" placeholder="(00) 00000-0000" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Senha (mínimo 8 caracteres)</Label>
                  <Input type="password" value={regSenha} onChange={e => setRegSenha(e.target.value)} required minLength={8} className="h-12 rounded-xl border-neutral-200" placeholder="••••••••" />
                </div>

                <div className="flex items-start space-x-3 pt-2">
                  <Checkbox id="termos_modal" checked={regTermos} onCheckedChange={v => setRegTermos(!!v)} />
                  <label htmlFor="termos_modal" className="text-[10px] font-medium text-neutral-500 leading-tight">
                    Aceito os Termos de Uso e Política de Privacidade. Poderá completar os demais dados depois.
                  </label>
                </div>

                <Button disabled={loading} type="submit" className="w-full h-14 bg-yellow-400 text-neutral-900 hover:bg-yellow-500 rounded-2xl font-black text-lg shadow-xl shadow-yellow-100">
                  {loading ? "Criando conta..." : "Criar conta e ver simulação"}
                </Button>
              </form>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
