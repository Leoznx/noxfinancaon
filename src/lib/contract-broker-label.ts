export type ContractBrokerIdentity = {
  directBrokerName?: string | null;
  requesterName?: string | null;
  requesterRole?: string | null;
  requesterProfileId?: string | null;
  agencyProfileId?: string | null;
};

const clean = (value?: string | null) => value?.trim() || null;

/**
 * Identifica quem originou o contrato pela consulta, que é o vínculo canônico.
 * As colunas legadas da apólice nem sempre recebem o corretor responsável.
 */
export function contractBrokerLabel(identity: ContractBrokerIdentity) {
  const requesterRole = clean(identity.requesterRole)?.toLowerCase();
  const requesterProfileId = clean(identity.requesterProfileId);
  const agencyProfileId = clean(identity.agencyProfileId);
  const madeByAgency =
    requesterRole === "imobiliaria" ||
    Boolean(
      requesterProfileId &&
        agencyProfileId &&
        requesterProfileId === agencyProfileId,
    );

  if (madeByAgency) return "Fez pela imobiliária";

  const requesterName = clean(identity.requesterName);
  if (requesterRole === "corretor" && requesterName) return requesterName;

  return clean(identity.directBrokerName) || "Corretor não informado";
}
