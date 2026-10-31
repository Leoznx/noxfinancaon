import { createFileRoute } from "@tanstack/react-router";
import { Download, ExternalLink, FileText } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  CONTRACT_CLAUSE_CATEGORIES,
  contractClauseDocumentPath,
  type ContractClauseDocument,
} from "@/lib/contract-clause-documents";

export const Route = createFileRoute("/clausulas-contrato")({
  component: () => (
    <ProtectedRoute roles={["corretor", "proprietario", "imobiliaria"]}>
      <ContractClausesPage />
    </ProtectedRoute>
  ),
});

function ContractClausesPage() {
  return (
    <DashboardLayout>
      <main className="mx-auto w-full max-w-[1180px] pb-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-500">
          Cláusulas Contrato
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-neutral-950">
          Documentos de apoio
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Documentos, termos, cláusulas e modelos para apoiar a gestão dos contratos.
        </p>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-2">
          {CONTRACT_CLAUSE_CATEGORIES.map((category) => (
            <section
              key={category.id}
              className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-7"
            >
              <h2 className="text-xl font-black tracking-tight text-neutral-900 sm:text-2xl">
                {category.title}
              </h2>
              <div className="mt-5 space-y-4">
                {category.documents.map((document) => (
                  <DocumentLink key={document.fileName} document={document} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </DashboardLayout>
  );
}

function DocumentLink({ document }: { document: ContractClauseDocument }) {
  const url = contractClauseDocumentPath(document.fileName);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <FileText aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 text-sm font-medium text-neutral-800 underline decoration-dotted underline-offset-4 transition-colors hover:text-amber-700 sm:text-base"
      >
        {document.title}
      </a>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Visualizar ${document.title}`}
        title="Visualizar PDF"
        className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-amber-50 hover:text-amber-700"
      >
        <ExternalLink aria-hidden="true" className="h-4 w-4" />
      </a>
      <a
        href={url}
        download={document.fileName}
        aria-label={`Baixar ${document.title}`}
        title="Baixar PDF"
        className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-amber-50 hover:text-amber-700"
      >
        <Download aria-hidden="true" className="h-4 w-4" />
      </a>
    </div>
  );
}
