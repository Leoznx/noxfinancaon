import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LogoNox } from "@/components/LogoNox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Mail, ShieldCheck, ArrowRight } from "lucide-react";
import { maskPhone } from "@/utils/validators";
import { signUpNoxEmployee } from "@/lib/nox-employees.functions";
import { noxInternalAccounts, type NoxInternalRole } from "@/lib/nox-internal-accounts";

const ERRO_MENSAGEM: Record<string, string> = {
  invalido: "Verifique os dados informados e tente novamente.",
  email_cadastrado: "Já existe uma conta cadastrada com este e-mail.",
  erro: "Não foi possível criar sua conta. Tente novamente.",
};

export function NoxEmployeeSignup({ role }: { role: NoxInternalRole }) {
  const signUpFn = useServerFn(signUpNoxEmployee);
  const conta = noxInternalAccounts[role];

  const [sucesso, setSucesso] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  const validar = () => {
    const novos: Record<string, string> = {};
    const nomeNormalizado = nome.trim().replace(/\s+/g, " ");
    if (nomeNormalizado.length < 3) {
      novos.nome = "Informe seu nome completo.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      novos.email = "E-mail inválido.";
    }
    if (telefone.replace(/\D/g, "").length < 10) {
      novos.telefone = "Telefone inválido.";
    }
    if (senha.length < 8 || !/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) {
      novos.senha = "Mínimo 8 caracteres, com pelo menos 1 letra e 1 número.";
    }
    if (confirmarSenha !== senha) {
      novos.confirmarSenha = "As senhas informadas não são iguais.";
    }
    setErros(novos);
    return Object.keys(novos).length === 0;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    if (!validar()) return;

    setEnviando(true);
    try {
      const nomeNormalizado = nome.trim().replace(/\s+/g, " ");
      const emailLower = email.toLowerCase().trim();
      const result = await signUpFn({
        data: { role, nome: nomeNormalizado, email: emailLower, telefone, senha },
      });
      if (!result.ok) {
        toast.error(ERRO_MENSAGEM[result.error] || ERRO_MENSAGEM.erro);
        setEnviando(false);
        return;
      }
      toast.success("Sua conta NOX foi criada com sucesso.");
      setSucesso(emailLower);
    } catch {
      toast.error(ERRO_MENSAGEM.erro);
      setEnviando(false);
    }
  };

  if (sucesso) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6 text-center">
        <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mb-8 text-yellow-600">
          <Mail size={44} />
        </div>
        <h1 className="text-3xl font-bold text-neutral-900 mb-4">Confirme seu e-mail</h1>
        <div className="max-w-md text-neutral-600 space-y-4 mb-10">
          <p>
            Sua conta foi criada. Verifique seu e-mail para confirmar o cadastro e acessar a plataforma — enviamos um
            link de confirmação para <strong className="text-neutral-900">{sucesso}</strong>.
          </p>
          <p className="text-sm italic">Não recebeu? Confira a caixa de spam ou tente novamente em alguns minutos.</p>
        </div>
        <Link to="/login">
          <Button variant="outline">Ir para o login</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between container mx-auto max-w-7xl">
        <Link to="/" className="flex items-center gap-3">
          <LogoNox variant="claro" size="sm" />
        </Link>
        <Link to="/login" className="text-sm font-black text-neutral-900 hover:text-yellow-600 transition-colors">
          Já tenho conta
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="p-6 pb-0">
            <div className="inline-flex items-center gap-2 bg-neutral-900 text-yellow-400 rounded-full px-3 py-1 mb-4">
              <ShieldCheck size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">{conta.badge}</span>
            </div>
            <h1 className="text-xl font-bold text-neutral-900">{conta.formTitle}</h1>
            <p className="text-sm text-neutral-500 mt-1">{conta.formDescription}</p>
          </div>

          <form onSubmit={onSubmit} className="p-6 space-y-4">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-neutral-700">Nome completo</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome completo" />
              {erros.nome && <p className="text-[10px] text-red-500">{erros.nome}</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-neutral-700">E-mail</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seuemail@email.com" />
              {erros.email && <p className="text-[10px] text-red-500">{erros.email}</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-neutral-700">Telefone</Label>
              <Input
                value={telefone}
                onChange={(e) => setTelefone(maskPhone(e.target.value))}
                placeholder="(47) 99999-9999"
              />
              {erros.telefone && <p className="text-[10px] text-red-500">{erros.telefone}</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-neutral-700">Senha</Label>
              <div className="relative">
                <Input
                  type={mostrarSenha ? "text" : "password"}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
                >
                  {mostrarSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {erros.senha && <p className="text-[10px] text-red-500">{erros.senha}</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-neutral-700">Confirmar senha</Label>
              <Input
                type={mostrarSenha ? "text" : "password"}
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                placeholder="••••••••"
              />
              {erros.confirmarSenha && <p className="text-[10px] text-red-500">{erros.confirmarSenha}</p>}
            </div>

            <p className="text-[10px] text-neutral-500">Mínimo 8 caracteres, com pelo menos 1 letra e 1 número.</p>

            <Button
              type="submit"
              disabled={enviando}
              className="w-full bg-neutral-900 hover:bg-neutral-800 text-white font-bold rounded-lg h-11 flex items-center justify-center gap-2"
            >
              {enviando ? "Criando conta..." : "Criar minha conta NOX"}
              {!enviando && <ArrowRight size={16} />}
            </Button>
          </form>
        </div>
      </main>

      <footer className="p-6 text-center text-xs text-neutral-400">
        © 2025 NOX FIANÇA - Todos os direitos reservados.
      </footer>
    </div>
  );
}
