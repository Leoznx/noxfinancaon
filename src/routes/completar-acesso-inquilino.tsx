import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";
import { z } from "zod";
import { LogoNox } from "@/components/LogoNox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { resolveTenantAccessReturnTo } from "@/lib/auth-email-links";
import { maskCPF, maskPhone } from "@/utils/validators";

const searchSchema = z.object({ returnTo: z.string().optional() });

export const Route = createFileRoute("/completar-acesso-inquilino")({
  validateSearch: (search) => searchSchema.parse(search),
  component: CompletarAcessoInquilinoPage,
});

type TenantData = {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
};

function CompletarAcessoInquilinoPage() {
  const search = Route.useSearch();
  const returnTo = resolveTenantAccessReturnTo(search.returnTo ?? null);
  const [dados, setDados] = useState<TenantData | null>(null);
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [termos, setTermos] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [concluido, setConcluido] = useState(false);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) {
        window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }
      if (user.user_metadata?.tenant_access_setup_required !== true) {
        window.location.replace(returnTo);
        return;
      }

      const { data: consulta } = await supabase
        .from("consultas_credito")
        .select("tenant_name, tenant_document, tenant_email, tenant_telefone")
        .eq("tenant_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!consulta) {
        if (ativo) setErro("Não foi possível localizar os dados do seu contrato.");
        return;
      }

      if (ativo) {
        setDados({
          nome: consulta.tenant_name || user.user_metadata?.nome || "Inquilino",
          cpf: consulta.tenant_document || user.user_metadata?.cpf || "",
          email: consulta.tenant_email || user.email || "",
          telefone: consulta.tenant_telefone || user.user_metadata?.telefone || "",
        });
      }
    }

    void carregar();
    return () => {
      ativo = false;
    };
  }, [returnTo]);

  const senhaValida = useMemo(
    () => senha.length >= 8 && /[A-Za-z]/.test(senha) && /\d/.test(senha),
    [senha],
  );

  async function criarAcesso() {
    setErro("");
    if (!senhaValida) {
      setErro("A senha deve ter pelo menos 8 caracteres, uma letra e um número.");
      return;
    }
    if (senha !== confirmarSenha) {
      setErro("As senhas não conferem.");
      return;
    }
    if (!termos) {
      setErro("Aceite os Termos de Uso e a Política de Privacidade.");
      return;
    }

    setSalvando(true);
    const { error } = await supabase.auth.updateUser({
      password: senha,
      data: {
        tenant_access_setup_required: false,
        tenant_access_completed_at: new Date().toISOString(),
      },
    });
    setSalvando(false);

    if (error) {
      setErro("Não foi possível criar seu acesso. Tente novamente.");
      return;
    }

    setConcluido(true);
    window.setTimeout(() => window.location.replace(returnTo), 700);
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-5 py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex justify-center">
          <LogoNox variant="claro" size="sm" />
        </div>

        <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-7 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-100 text-yellow-700">
              {concluido ? <CheckCircle2 size={24} /> : <LockKeyhole size={24} />}
            </div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-yellow-700">
              Primeiro acesso
            </p>
            <h1 className="mt-2 text-2xl font-black text-neutral-900">
              Crie seu acesso de inquilino
            </h1>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
              Seus dados vieram do contrato assinado. Defina apenas sua senha para
              acessar documentos e faturas.
            </p>
          </div>

          {!dados && !erro ? (
            <div className="flex items-center justify-center gap-3 py-10 text-sm text-neutral-500">
              <LoaderCircle className="h-5 w-5 animate-spin" />
              Carregando seus dados...
            </div>
          ) : dados ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <ReadonlyField label="Nome completo" value={dados.nome} />
                <ReadonlyField label="CPF" value={maskCPF(dados.cpf)} />
                <ReadonlyField label="E-mail" value={dados.email} />
                <ReadonlyField label="Telefone" value={maskPhone(dados.telefone)} />
              </div>

              <div className="border-t border-neutral-100 pt-5">
                <div className="space-y-2">
                  <Label htmlFor="senha">Crie sua senha</Label>
                  <Input
                    id="senha"
                    type="password"
                    autoComplete="new-password"
                    value={senha}
                    onChange={(event) => setSenha(event.target.value)}
                    disabled={salvando || concluido}
                  />
                  <p className="text-xs text-neutral-500">
                    Mínimo de 8 caracteres, com pelo menos uma letra e um número.
                  </p>
                </div>
                <div className="mt-4 space-y-2">
                  <Label htmlFor="confirmarSenha">Confirme sua senha</Label>
                  <Input
                    id="confirmarSenha"
                    type="password"
                    autoComplete="new-password"
                    value={confirmarSenha}
                    onChange={(event) => setConfirmarSenha(event.target.value)}
                    disabled={salvando || concluido}
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-600">
                <Checkbox
                  checked={termos}
                  onCheckedChange={(checked) => setTermos(checked === true)}
                  disabled={salvando || concluido}
                />
                <span>Aceito os Termos de Uso e a Política de Privacidade.</span>
              </label>

              {erro && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {erro}
                </p>
              )}

              <Button
                className="h-12 w-full bg-neutral-900 font-bold text-white hover:bg-neutral-800"
                onClick={criarAcesso}
                disabled={salvando || concluido}
              >
                {salvando
                  ? "Criando acesso..."
                  : concluido
                    ? "Acesso criado"
                    : "Criar acesso e ver documentos"}
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
              {erro}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="min-h-10 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
        {value || "—"}
      </div>
    </div>
  );
}
