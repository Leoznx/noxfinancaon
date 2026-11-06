import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, ShieldCheck, Trash2 } from "lucide-react";

export const Route = createFileRoute("/excluir-conta")({
  component: ExcluirContaPage,
});

function ExcluirContaPage() {
  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-16 sm:py-20">
      <main className="container mx-auto max-w-3xl">
        <Link
          to="/"
          className="mb-10 inline-flex items-center gap-2 text-sm font-bold text-neutral-500 transition-colors hover:text-neutral-900"
        >
          <ArrowLeft size={18} />
          Voltar para a página inicial
        </Link>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-100 bg-neutral-950 px-6 py-8 text-white sm:px-10">
            <div className="mb-5 inline-flex size-12 items-center justify-center rounded-2xl bg-white/10">
              <Trash2 aria-hidden="true" size={24} />
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              Exclusão de conta e dados
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-300 sm:text-base">
              Você pode solicitar a exclusão da sua conta NOX Fiança diretamente pelo aplicativo ou
              pelos nossos canais de atendimento.
            </p>
          </div>

          <div className="space-y-9 px-6 py-8 text-neutral-600 sm:px-10 sm:py-10">
            <section>
              <h2 className="text-xl font-black text-neutral-900">Excluir pelo aplicativo</h2>
              <ol className="mt-4 list-decimal space-y-2 pl-5 leading-relaxed">
                <li>Entre na sua conta no aplicativo NOX Fiança.</li>
                <li>
                  Acesse <strong>Perfil</strong> e localize a seção <strong>Zona de Perigo</strong>.
                </li>
                <li>
                  Toque em <strong>Encerrar conta</strong>.
                </li>
                <li>
                  Digite <strong>EXCLUIR</strong> e confirme a exclusão.
                </li>
              </ol>
            </section>

            <section>
              <h2 className="text-xl font-black text-neutral-900">Solicitar pela web</h2>
              <p className="mt-3 leading-relaxed">
                Se você não consegue entrar no aplicativo, envie a solicitação usando o mesmo e-mail
                cadastrado na conta. Nossa equipe poderá pedir informações adicionais para confirmar
                sua identidade e proteger seus dados contra uma exclusão indevida.
              </p>
              <a
                href="mailto:contato@noxfianca.com.br?subject=Solicita%C3%A7%C3%A3o%20de%20exclus%C3%A3o%20de%20conta"
                className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-black text-white transition-colors hover:bg-neutral-800"
              >
                Solicitar exclusão por e-mail
                <ExternalLink aria-hidden="true" size={16} />
              </a>
              <p className="mt-3 text-sm">
                E-mail de atendimento:{" "}
                <strong className="text-neutral-900">contato@noxfianca.com.br</strong>
              </p>
            </section>

            <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
              <div className="flex gap-3">
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-emerald-700"
                  size={22}
                />
                <div>
                  <h2 className="font-black text-emerald-950">O que acontece com os dados</h2>
                  <p className="mt-2 text-sm leading-relaxed text-emerald-900">
                    Após a confirmação, o acesso à conta e os dados pessoais vinculados ao cadastro
                    são excluídos ou anonimizados. Registros que precisem ser mantidos para cumprir
                    obrigações legais, regulatórias, fiscais, contratuais ou para prevenir fraudes
                    permanecem protegidos e com acesso restrito pelo prazo aplicável.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-black text-neutral-900">Antes de excluir</h2>
              <p className="mt-3 leading-relaxed">
                A exclusão pode ser bloqueada enquanto existirem faturas, apólices, saques ou
                mudanças contratuais em andamento. Nessa situação, resolva as pendências ou fale com
                o suporte. Depois de concluída, a exclusão da conta não pode ser desfeita.
              </p>
            </section>

            <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-neutral-100 pt-6 text-sm font-bold">
              <Link to="/privacidade" className="text-neutral-700 hover:text-neutral-950">
                Política de Privacidade
              </Link>
              <Link to="/contato" className="text-neutral-700 hover:text-neutral-950">
                Fale com a NOX
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
