import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Clock3, Link2, LoaderCircle, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import { LogoNox } from "@/components/LogoNox";
import { Button } from "@/components/ui/button";
import {
  acceptBrokerAgencyInvitation,
  inspectBrokerAgencyInvitation,
} from "@/lib/broker-agency-invitations";
import { getBrokerCommissionOption } from "@/lib/broker-commission-policy";

const searchSchema = z.object({ token: z.string().optional() });

export const Route = createFileRoute("/confirmar-vinculo-corretor")({
  validateSearch: (search) => searchSchema.parse(search),
  component: ConfirmarVinculoCorretor,
});

type Invitation = NonNullable<Awaited<ReturnType<typeof inspectBrokerAgencyInvitation>>["invitation"]>;
type PageState = "loading" | "pending" | "confirming" | "accepted" | "invalid";

function ConfirmarVinculoCorretor() {
  const { token = "" } = Route.useSearch();
  const [state, setState] = useState<PageState>("loading");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    setState("loading");
    inspectBrokerAgencyInvitation(token).then(({ invitation: found, error }) => {
      if (!active) return;
      if (!found || error || ["revoked", "expired"].includes(found.status)) {
        setErrorMessage(error || "Este convite não está mais disponível.");
        setState("invalid");
        return;
      }
      setInvitation(found);
      setState(found.status === "accepted" ? "accepted" : "pending");
    });
    return () => {
      active = false;
    };
  }, [token]);

  const handleAccept = async () => {
    if (!token || state !== "pending") return;
    setState("confirming");
    const result = await acceptBrokerAgencyInvitation(token);
    if (!result.ok) {
      setErrorMessage(result.error || "Não foi possível confirmar o vínculo.");
      setState("invalid");
      return;
    }
    setInvitation((current) =>
      current
        ? {
            ...current,
            status: "accepted",
            brokerName: result.brokerName || current.brokerName,
            agencyName: result.agencyName || current.agencyName,
          }
        : current,
    );
    setState("accepted");
  };

  return (
    <main className="min-h-[100dvh] bg-[#f4f4f2] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[620px] overflow-hidden rounded-[28px] border border-neutral-200 bg-white shadow-[0_24px_70px_rgba(0,0,0,0.08)]">
        <header className="flex items-center justify-between border-b border-neutral-100 px-6 py-5 sm:px-9">
          <LogoNox variant="claro" size="sm" />
          <span className="rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-yellow-800">
            Vínculo profissional
          </span>
        </header>

        <section className="px-6 py-9 sm:px-10 sm:py-12">
          {state === "loading" && (
            <StatusBlock
              icon={<LoaderCircle className="animate-spin text-yellow-600" size={42} />}
              title="Conferindo seu convite"
              description="Estamos validando o link seguro enviado ao seu e-mail."
            />
          )}

          {(state === "pending" || state === "confirming") && invitation && (
            <>
              <div className="mb-7 flex h-16 w-16 items-center justify-center rounded-2xl bg-yellow-100 text-yellow-700">
                <Link2 size={34} />
              </div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-yellow-700">Convite para equipe</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-neutral-950">
                {invitation.agencyName} quer vincular você à imobiliária
              </h1>
              <p className="mt-4 text-[15px] leading-7 text-neutral-600">
                Olá, <strong className="text-neutral-900">{invitation.brokerName}</strong>. Confirme somente se reconhece esta imobiliária e concorda com a regra financeira abaixo.
              </p>

              <div className="mt-7 rounded-2xl border border-yellow-200 bg-yellow-50 p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-yellow-800">Comissão dos novos contratos</p>
                <p className="mt-2 text-lg font-black text-neutral-950">
                  {getBrokerCommissionOption(invitation.commissionAllocationMode).label}
                </p>
                <p className="mt-1 text-sm leading-6 text-neutral-600">
                  {getBrokerCommissionOption(invitation.commissionAllocationMode).description}
                </p>
              </div>

              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-6 text-neutral-600">
                <ShieldCheck className="mt-0.5 shrink-0 text-green-600" size={20} />
                O vínculo e a distribuição das comissões só serão ativados depois da sua confirmação.
              </div>

              <Button
                onClick={handleAccept}
                disabled={state === "confirming"}
                className="mt-7 h-14 w-full rounded-xl bg-yellow-400 text-base font-black text-neutral-950 hover:bg-yellow-500"
              >
                {state === "confirming" ? "Ativando vínculo..." : "Confirmo o vínculo"}
              </Button>
              <p className="mt-4 flex items-center justify-center gap-2 text-xs text-neutral-500">
                <Clock3 size={14} /> Válido até {new Date(invitation.expiresAt).toLocaleDateString("pt-BR")}
              </p>
            </>
          )}

          {state === "accepted" && (
            <StatusBlock
              icon={<CheckCircle2 className="text-green-600" size={48} />}
              title="Vínculo ativado com sucesso!"
              description={`Você agora faz parte da equipe ${invitation?.agencyName || "da imobiliária"}. O painel da imobiliária já foi atualizado e os e-mails de confirmação foram enviados.`}
              action={
                <Link
                  to="/login"
                  search={{ perfil: "corretor" }}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-neutral-950 px-7 text-sm font-black text-white hover:bg-neutral-800"
                >
                  Entrar na NOX Fiança
                </Link>
              }
            />
          )}

          {state === "invalid" && (
            <StatusBlock
              icon={<XCircle className="text-red-600" size={48} />}
              title="Convite inválido ou expirado"
              description={errorMessage || "Solicite à imobiliária o envio de um novo convite."}
              action={
                <Link
                  to="/login"
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-neutral-950 px-7 text-sm font-black text-white hover:bg-neutral-800"
                >
                  Voltar para o login
                </Link>
              }
            />
          )}
        </section>
      </div>
    </main>
  );
}

function StatusBlock({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-neutral-50">{icon}</div>
      <h1 className="text-3xl font-black tracking-tight text-neutral-950">{title}</h1>
      <p className="mt-4 max-w-md text-[15px] leading-7 text-neutral-600">{description}</p>
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}
