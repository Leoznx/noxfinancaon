export type BillingAccountRole = "imobiliaria" | "corretor" | "proprietario";

export type BillingAccountCopy = {
  role: BillingAccountRole;
  title: "Imobiliária" | "Corretor" | "Proprietário";
  subject: "A imobiliária" | "O corretor" | "O proprietário";
  dataOwner: "da imobiliária" | "do corretor" | "do proprietário";
};

const COPY_BY_ROLE: Record<BillingAccountRole, BillingAccountCopy> = {
  imobiliaria: {
    role: "imobiliaria",
    title: "Imobiliária",
    subject: "A imobiliária",
    dataOwner: "da imobiliária",
  },
  corretor: {
    role: "corretor",
    title: "Corretor",
    subject: "O corretor",
    dataOwner: "do corretor",
  },
  proprietario: {
    role: "proprietario",
    title: "Proprietário",
    subject: "O proprietário",
    dataOwner: "do proprietário",
  },
};

export function billingAccountCopy(role: unknown): BillingAccountCopy {
  if (role === "corretor" || role === "proprietario") return COPY_BY_ROLE[role];
  return COPY_BY_ROLE.imobiliaria;
}
