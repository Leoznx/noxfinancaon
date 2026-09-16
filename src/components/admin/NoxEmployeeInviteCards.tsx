import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, ExternalLink, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  buildRegistrationLink,
  NOX_INTERNAL_ACCOUNT_TYPES,
  noxInternalAccounts,
  type NoxInternalAccountType,
} from "@/lib/nox-internal-accounts";
import { createNoxEmployeeInvite } from "@/lib/nox-employees.functions";

export function NoxEmployeeInviteCards() {
  const createInvite = useServerFn(createNoxEmployeeInvite);
  const [loading, setLoading] = useState<NoxInternalAccountType | null>(null);
  const [copied, setCopied] = useState<NoxInternalAccountType | null>(null);
  const [links, setLinks] = useState<Partial<Record<NoxInternalAccountType, string>>>({});

  const generate = async (type: NoxInternalAccountType) => {
    setLoading(type);
    try {
      const result = await createInvite({ data: { accountType: type } });
      const link = buildRegistrationLink(type, result.token);
      setLinks((current) => ({ ...current, [type]: link }));
      return link;
    } finally {
      setLoading(null);
    }
  };

  const copy = async (type: NoxInternalAccountType) => {
    try {
      await navigator.clipboard.writeText(await generate(type));
      setCopied(type);
      toast.success("Link protegido copiado.");
      window.setTimeout(() => setCopied(null), 2200);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível gerar o convite.");
    }
  };

  const open = async (type: NoxInternalAccountType) => {
    try {
      window.open(await generate(type), "_blank", "noopener,noreferrer");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível gerar o convite.");
    }
  };

  return (
    <div className="mb-5 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-yellow-600" />
        <div>
          <h2 className="font-black">Contas e acessos da equipe</h2>
          <p className="text-xs text-muted-foreground">
            Gere um convite protegido para cada novo colaborador.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {NOX_INTERNAL_ACCOUNT_TYPES.map((type) => (
          <Card key={type} className="border-neutral-200">
            <CardContent className="space-y-3 p-4">
              <div>
                <p className="text-sm font-black">{noxInternalAccounts[type].label}</p>
                <p className="mt-1 min-h-10 text-[11px] leading-4 text-neutral-500">
                  {noxInternalAccounts[type].cardDescription}
                </p>
              </div>
              <p className="truncate rounded-lg bg-neutral-50 px-2 py-1.5 text-[10px] text-neutral-500">
                {links[type] || "Link gerado ao copiar ou abrir"}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={loading === type}
                  onClick={() => void copy(type)}
                >
                  {copied === type ? (
                    <Check className="mr-1 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1 h-3.5 w-3.5" />
                  )}
                  {loading === type ? "Gerando" : copied === type ? "Copiado" : "Copiar"}
                </Button>
                <Button
                  size="icon"
                  className="h-9 w-9 bg-neutral-950"
                  disabled={loading === type}
                  onClick={() => void open(type)}
                  aria-label={`Abrir cadastro ${noxInternalAccounts[type].label}`}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
