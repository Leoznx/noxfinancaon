import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, ArrowLeft, MailCheck } from "lucide-react";
import { LogoNox } from "@/components/LogoNox";
import { requestPasswordReset } from "@/lib/password-reset.functions";

const searchSchema = z.object({
  email: z.string().optional(),
});

export const Route = createFileRoute("/recuperar-acesso")({
  component: RecuperarAcesso,
  validateSearch: (search) => searchSchema.parse(search),
});

const RESEND_COOLDOWN_S = 60;

function emailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visivel = local.slice(0, 2);
  return `${visivel}${"*".repeat(Math.max(3, local.length - visivel.length))}@${domain}`;
}

function RecuperarAcesso() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/recuperar-acesso" });
  const requestPasswordResetFn = useServerFn(requestPasswordReset);
  const [email, setEmail] = useState(search.email ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const iniciarCooldown = () => {
    setCooldown(RESEND_COOLDOWN_S);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((atual) => {
        if (atual <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return atual - 1;
      });
    }, 1000);
  };

  const enviarLink = async () => {
    const normalizado = email.trim().toLowerCase();
    if (!normalizado) {
      setErro("Informe o seu e-mail.");
      return;
    }
    if (!emailValido(normalizado)) {
      setErro("Informe um endereço de e-mail válido.");
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      // requestPasswordReset (servidor) nunca revela se o e-mail existe ou não — a
      // resposta é sempre { ok: true }, então a mensagem exibida também precisa ser
      // genérica independente do resultado real.
      await requestPasswordResetFn({ data: { email: normalizado } });
      setEnviado(true);
      iniciarCooldown();
    } catch (e) {
      // Erro de rede/infra ao chamar a função — não expõe detalhes técnicos, só avisa
      // que algo falhou, sem sugerir que o e-mail está errado.
      console.error("[recuperar-acesso] falha ao enviar link", e);
      setErro("Não foi possível concluir a solicitação. Verifique sua conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  const reenviar = async () => {
    if (cooldown > 0 || enviando) return;
    await enviarLink();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6">
      <div className="mb-10 flex items-center gap-3 cursor-pointer" onClick={() => navigate({ to: "/" })}>
        <LogoNox variant="claro" size="xl" />
      </div>

      <Card className="w-full max-w-md bg-white shadow-2xl border border-neutral-100 rounded-xl overflow-hidden">
        {!enviado ? (
          <>
            <CardHeader className="text-center pt-10 px-8">
              <CardTitle className="text-2xl font-bold text-neutral-900 tracking-tight">Recuperar acesso</CardTitle>
              <CardDescription className="text-neutral-500 font-medium mt-2">
                Informe o e-mail cadastrado na sua conta. Enviaremos um link seguro para você criar uma nova senha.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8 pb-10">
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  enviarLink();
                }}
                className="space-y-5"
              >
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-neutral-700">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3.5 text-neutral-400" size={18} strokeWidth={1.5} />
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (erro) setErro(null);
                      }}
                      placeholder="corporativo@empresa.com.br"
                      className="h-12 pl-10 rounded-lg border-neutral-300 focus:ring-neutral-900"
                      disabled={enviando}
                      aria-invalid={!!erro}
                      autoFocus
                    />
                  </div>
                  {erro && (
                    <p className="text-xs font-semibold text-red-600" aria-live="polite">
                      {erro}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={enviando}
                  className="w-full h-14 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-lg mt-2 shadow-lg shadow-neutral-100 transition-all"
                >
                  {enviando ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Enviando link...
                    </span>
                  ) : (
                    "Enviar link de recuperação"
                  )}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => navigate({ to: "/login" })}
                  disabled={enviando}
                  className="w-full h-12 rounded-lg font-bold text-neutral-500 hover:text-neutral-900"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" /> Voltar para o login
                </Button>
              </form>
            </CardContent>
          </>
        ) : (
          <CardContent className="p-8 pt-10 pb-10 text-center">
            <div className="w-14 h-14 rounded-full bg-yellow-50 border border-yellow-200 flex items-center justify-center mx-auto mb-5">
              <MailCheck className="w-7 h-7 text-yellow-600" strokeWidth={1.5} />
            </div>
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Verifique seu e-mail</h1>
            <p className="text-neutral-600 font-medium mt-3 leading-relaxed">
              Enviamos um link de redefinição de senha para{" "}
              <strong className="text-neutral-900">{maskEmail(email.trim().toLowerCase())}</strong>. Acesse sua caixa
              de entrada e clique no link para criar uma nova senha.
            </p>
            <p className="text-xs text-neutral-400 font-medium mt-3">
              Caso não encontre a mensagem, verifique a pasta de spam ou lixo eletrônico.
            </p>

            <div className="mt-8 space-y-3">
              <Button
                type="button"
                onClick={reenviar}
                disabled={cooldown > 0 || enviando}
                variant="outline"
                className="w-full h-12 rounded-lg font-bold"
              >
                {enviando ? "Enviando..." : cooldown > 0 ? `Reenviar em ${cooldown} segundos` : "Reenviar e-mail"}
              </Button>
              <Button
                type="button"
                onClick={() => navigate({ to: "/login" })}
                className="w-full h-12 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold"
              >
                Voltar para o login
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <p className="mt-10 text-[10px] text-neutral-400 font-medium uppercase tracking-[0.2em]">
        © {new Date().getFullYear()} NOX FIANÇA - Todos os direitos reservados.
      </p>
    </div>
  );
}
