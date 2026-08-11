import { supabase } from "@/integrations/supabase/client";

export type ConsolidatedBillingBatch = {
  id: string;
  agency_user_id: string;
  reference_month: number;
  reference_year: number;
  total_value: number;
  received_value: number;
  due_date: string;
  status: "active" | "paid" | "partial" | "cancelled";
  billing_method: "boleto" | "pix" | "undefined";
  invoice_count: number;
  invoice_url: string | null;
  bank_slip_url: string | null;
  identification_field: string | null;
  pix_copy_paste: string | null;
  paid_at: string | null;
};

export type ReissuedPayment = {
  success: boolean;
  method: "boleto" | "pix";
  status: string;
  amount: number;
  dueDate: string;
  boleto: { pdfUrl: string | null; barcode: string | null } | null;
  pix: { qrCodeBase64: string | null; copyPaste: string | null; expiresAt: string | null } | null;
};

export async function fetchOwnConsolidatedBatches() {
  const { data, error } = await (supabase as any)
    .from("consolidated_invoice_batches")
    .select(
      "id, agency_user_id, reference_month, reference_year, total_value, received_value, due_date, status, billing_method, invoice_count, invoice_url, bank_slip_url, identification_field, pix_copy_paste, paid_at",
    )
    .order("reference_year", { ascending: false })
    .order("reference_month", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConsolidatedBillingBatch[];
}

export async function reissuePayment(params: {
  invoiceId?: string;
  batchId?: string;
  method: "boleto" | "pix";
}) {
  const { data, error } = await supabase.functions.invoke("asaas-reissue-payment", {
    body: params,
  });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as ReissuedPayment;
}
