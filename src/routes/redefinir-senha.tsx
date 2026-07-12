import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Lock, Eye, EyeOff, CheckCircle2, XCircle, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LogoNox } from "@/components/LogoNox";
import { checarRequisitosSenha, senhaAtendeRequisitos } from "@/lib/senha";

export const Route = createFileRoute("/redefinir-senha")({
  component: RedefinirSenha,
});

type Estado = "validando" | "pronto" | "invalido" | "atualizando" | "concluido";

/**
 * O link de recuperação do Supabase pode chegar de duas formas: fluxo PKCE
 * (`?code=...`, precisa exchangeCodeForSession) ou fluxo implícito (`#access_token=...
 * &type=recovery`, o client já processa sozinho ao inicializar). Também trata o caso
 * de o GoTrue já ter marcado o link como expirado/inválido antes mesmo de chegar aqui
 * (`?error=...&error_description=...`, em query OU hash).
 */
function lerParametrosRecuperacao() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const errorDescription = url.searchParams.get("error_description") || hashParams.get("error_description");
  const code = url.searchParams.get("code");
  const temHashRecovery = hashParams.get("type") === "recovery" && !!hashParams.get("access_token");
  return { errorDescription, code, temHashRecovery };
}

function RedefinirSenha() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado>("validando");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [mostrarConfirmar, setMostrarConfirmar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let ativo = true;

    const validar = async () => {
      const { errorDescription, code, temHashRecovery } = lerParametrosRecuperacao();

      if (errorDescription) {
        window.history.replaceState({}, "", window.location.pathname);
        if (ativo) setEstado("invalido");
        return;
      }

      // Sem nenhum parâmetro de recuperação na URL: não veio de um link de e-mail de
      // verdade (ex.: alguém digitou a rota direto) — nunca reaproveita uma sessão
      // comum já ativa no navegador pra liberar a troca de senha por essa tela.
      if (!code && !temHashRecovery) {
        if (ativo) setEstado("invalido");
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        window.history.replaceState({}, "", window.location.pathname);
        if (!ativo) return;
        setEstado(error ? "invalido" : "pronto");
        return;
      }

      // Fluxo implícito: o client já deve ter processado o hash ao inicializar.
      const { data } = await supabase.auth.getSession();
      window.history.replaceState({}, "", window.location.pathname);
      if (!ativo) return;
      setEstado(data.session ? "pronto" : "invalido");
    };

    validar();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && ativo) setEstado("pronto");
    });

    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  const requisitos = checarRequisitosSenha(novaSenha);
  const senhasIguais = novaSenha.length > 0 && novaSenha === confirmarSenha;
  const podeConfirmar = senhaAtendeRequisitos(novaSenha) && senhasIguais && estado === "pronto";

  const confirmarNovaSenha = async () => {
    if (!senhaAtendeRequisitos(novaSenha)) {
      setErro("A senha deve possuir pelo menos 8 caracteres e conter ao menos uma letra e um número.");
      return;
    }
    if (novaSenha !== confirmarSenha) {
      setErro("As senhas informadas não são iguais.");
      return;
    }
    setErro(null);
    setEstado("atualizando");
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) {
        setErro(error.message || "Não foi possível atualizar sua senha agora. Tente novamente.");
        setEstado("pronto");
        return;
      }
      setNovaSenha("");
      setConfirmarSenha("");
      // Encerra a sessão temporária de recuperação — o usuário faz login de novo,
      // já com a senha nova, em vez de ficar "logado por acidente" nesta aba.
      await supabase.auth.signOut().catch(() => {});
      setEstado("concluido");
      redirectTimer.current = setTimeout(() => {
        navigate({ to: "/login" });
      }, 3000);
    } catch (e: any) {
      setErro(e?.message || "Não foi possível concluir a solicitação. Verifique sua conexão e tente novamente.");
      setEstado("pronto");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6">
      <div className="mb-10 flex items-center gap-3 cursor-pointer" onClick={() => navigate({ to: "/" })}>
        <LogoNox variant="claro" size="xl" />
      </div>

      <Card className="w-full max-w-md bg-white shadow-2xl border border-neutral-100 rounded-xl overflow-hidden">
        {estado === "validando" && (
          <CardContent className="p-10 flex flex-col items-center text-center gap-4">
            <Settings className="w-10 h-10 text-yellow-500 animate-spin" strokeWidth={1.5} style={{ animationDuration: "2.5s" }} />
            <p className="text-neutral-600 font-semibold">Validando seu link de recuperação...</p>
          </CardContent>
        )}

        {estado === "invalido" && (
          <CardContent className="p-8 pt-10 pb-10 text-center">
            <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-5">
              <XCircle className="w-7 h-7 text-red-600" strokeWidth={1.5} />
            </div>
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Link inválido ou expirado</h1>
            <p className="text-neutral-600 font-medium mt-3 leading-relaxed">
              Este link de recuperação não é mais válido. Solicite um novo link para redefinir sua senha.
            </p>
            <div className="mt-8 space-y-3">
              <Button
                type="button"
                onClick={() => navigate({ to: "/recuperar-acesso" })}
                className="w-full h-12 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold"
              >
                Solicitar novo link
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate({ to: "/login" })} className="w-full h-12 rounded-lg font-bold">
                Voltar para o login
              </Button>
            </div>
          </CardContent>
        )}

        {estado === "concluido" && (
          <CardContent className="p-8 pt-10 pb-10 text-center">
            <div className="w-14 h-14 rounded-full bg-green-50 border border-green-200 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-7 h-7 text-green-600" strokeWidth={1.5} />
            </div>
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Senha atualizada com sucesso!</h1>
            <p className="text-neutral-600 font-medium mt-3 leading-relaxed">
              Agora você já pode entrar no Portal Institucional utilizando sua nova senha.
            </p>
            <Button
              type="button"
              onClick={() => navigate({ to: "/login" })}
              className="w-full h-12 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold mt-8"
            >
              Ir para o login
            </Button>
          </CardContent>
        )}

        {(estado === "pronto" || estado === "atualizando") && (
          <>
            <CardHeader className="text-center pt-10 px-8">
              <CardTitle className="text-2xl font-bold text-neutral-900 tracking-tight">Crie uma nova senha</CardTitle>
              <CardDescription className="text-neutral-500 font-medium mt-2">
                Digite e confirme sua nova senha para recuperar o acesso à sua conta.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8 pb-10">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  confirmarNovaSenha();
                }}
                className="space-y-5"
              >
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-neutral-700">Nova senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3.5 text-neutral-400" size={18} strokeWidth={1.5} />
                    <Input
                      type={mostrarSenha ? "text" : "password"}
                      value={novaSenha}
                      onChange={(e) => {
                        setNovaSenha(e.target.value);
                        if (erro) setErro(null);
                      }}
                      placeholder="••••••••••••"
                      className="h-12 pl-10 pr-10 rounded-lg border-neutral-300 focus:ring-neutral-900"
                      disabled={estado === "atualizando"}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarSenha((v) => !v)}
                      aria-label={mostrarSenha ? "Esconder senha" : "Mostrar senha"}
                      className="absolute right-3 top-3.5 text-neutral-400 hover:text-neutral-700"
                    >
                      {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-neutral-700">Confirmar nova senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3.5 text-neutral-400" size={18} strokeWidth={1.5} />
                    <Input
                      type={mostrarConfirmar ? "text" : "password"}
                      value={confirmarSenha}
                      onChange={(e) => {
                        setConfirmarSenha(e.target.value);
                        if (erro) setErro(null);
                      }}
                      placeholder="••••••••••••"
                      className="h-12 pl-10 pr-10 rounded-lg border-neutral-300 focus:ring-neutral-900"
                      disabled={estado === "atualizando"}
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarConfirmar((v) => !v)}
                      aria-label={mostrarConfirmar ? "Esconder senha" : "Mostrar senha"}
                      className="absolute right-3 top-3.5 text-neutral-400 hover:text-neutral-700"
                    >
                      {mostrarConfirmar ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {confirmarSenha.length > 0 && !senhasIguais && (
                    <p className="text-xs font-semibold text-red-600" aria-live="polite">
                      As senhas informadas não são iguais.
                    </p>
                  )}
                </div>

                <ul className="space-y-1 text-xs font-medium" aria-live="polite">
                  <RequisitoItem ok={requisitos.minLength} texto="Pelo menos 8 caracteres" />
                  <RequisitoItem ok={requisitos.hasLetter} texto="Pelo menos uma letra" />
                  <RequisitoItem ok={requisitos.hasNumber} texto="Pelo menos um número" />
                </ul>

                {erro && (
                  <p className="text-xs font-semibold text-red-600" aria-live="polite">
                    {erro}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={!podeConfirmar}
                  className="w-full h-14 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg font-bold text-lg mt-2 shadow-lg shadow-neutral-100 transition-all disabled:opacity-50"
                >
                  {estado === "atualizando" ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Atualizando senha...
                    </span>
                  ) : (
                    "Confirmar nova senha"
                  )}
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

function RequisitoItem({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? "text-green-600" : "text-neutral-400"}`}>
      <CheckCircle2 size={14} strokeWidth={ok ? 2.4 : 1.5} />
      {texto}
    </li>
  );
}
