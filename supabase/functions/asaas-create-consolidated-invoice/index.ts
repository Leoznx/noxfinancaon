import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  AsaasApiError,
  addBusinessDays,
  asaasFetch,
  corsHeaders,
  jsonResponse,
  mapAsaasStatus,
  normalizeDocumento,
  normalizePhone,
  requireUser,
  sanitizeAsaasResponse,
  toMoney,
} from "../_shared/asaas.ts";

type Body = {
  invoiceIds?: string[];
  referenceMonth?: number;
  referenceYear?: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);

  try {
    const { supabase, user } = await requireUser(req);
    const body = (await req.json()) as Body;
    const invoiceIds = Array.isArray(body.invoiceIds) ? body.invoiceIds.filter(Boolean) : [];
    if (!invoiceIds.length)
      return jsonResponse(req, { ok: false, error: "Selecione ao menos uma fatura para consolidar." }, 400);

    const now = new Date();
    const referenceMonth = body.referenceMonth || now.getMonth() + 1;
    const referenceYear = body.referenceYear || now.getFullYear();

    // Fonte de verdade e o backend: revalida cada fatura, nunca confia
    // cegamente na lista vinda do frontend alem de usa-la como candidata.
    // "Minha carteira" = faturas cujo destinatario (recipient_user_id) sou eu
    // mesmo (o profile autenticado) - mesmo nivel de escopo ja usado hoje em
    // apolices.index.tsx (match direto por profile_id, sem fan-out de
    // imobiliaria->corretores vinculados).
    const { data: candidatas, error: candidatasError } = await supabase
      .from("faturas_inquilino")
      .select("*")
      .in("id", invoiceIds)
      .eq("recipient_user_id", user.id)
      .eq("payment_responsible", "agency")
      .is("consolidated_item_id", null)
      .not("status", "in", "(paid,cancelled,refunded,partially_refunded)");
    if (candidatasError) throw candidatasError;

    const elegiveis = (candidatas ?? []).filter((f: any) => {
      const [ano, mes] = String(f.vencimento).split("-").map(Number);
      return mes === referenceMonth && ano === referenceYear;
    });

    if (!elegiveis.length)
      return jsonResponse(
        req,
        { ok: false, error: "Nenhuma fatura elegivel encontrada (verifique mes, responsavel e se ja nao esta consolidada)." },
        400,
      );

    const { data: profile } = await supabase
      .from("profiles")
      .select("nome, email, telefone, cnpj, role")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.email || !profile?.telefone) {
      return jsonResponse(
        req,
        { ok: false, error: "Complete e-mail e telefone do seu cadastro antes de gerar o boleto consolidado." },
        400,
      );
    }

    const totalValue = toMoney(elegiveis.reduce((sum: number, f: any) => sum + Number(f.valor || 0), 0));
    const dueDate = addBusinessDays(3);
    const cpfCnpj = normalizeDocumento(profile.cnpj) || normalizeDocumento(user.email);

    // Cliente Asaas em nome da imobiliaria/corretor (dados do profile
    // autenticado, nunca do payload do frontend) - reutiliza se ja existir
    // pelo documento cadastrado, pra evitar cliente duplicado.
    let customerId: string | null = null;
    if (profile.cnpj) {
      const found = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(normalizeDocumento(profile.cnpj))}`);
      customerId = Array.isArray(found?.data) && found.data.length ? found.data[0].id : null;
    }
    if (!customerId) {
      const created = await asaasFetch("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: profile.nome,
          cpfCnpj: cpfCnpj || undefined,
          email: profile.email,
          mobilePhone: normalizePhone(profile.telefone),
          phone: normalizePhone(profile.telefone),
        }),
      });
      customerId = created?.id;
    }
    if (!customerId) throw new Error("Nao foi possivel criar/localizar o cliente Asaas da imobiliaria.");

    const externalReference = `nox:lote:${user.id}:${referenceMonth}:${referenceYear}:${Math.round(totalValue * 100)}`;

    let raw: any;
    try {
      raw = await asaasFetch("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: customerId,
          billingType: "BOLETO",
          value: totalValue,
          dueDate,
          description: `NOX Fiança — Boleto consolidado ${String(referenceMonth).padStart(2, "0")}/${referenceYear} (${elegiveis.length} faturas)`,
          externalReference,
        }),
      });
    } catch (error) {
      console.error("[asaas-create-consolidated-invoice] falha ao criar cobranca", {
        agencyUserId: user.id,
        status: error instanceof AsaasApiError ? error.status : "unknown",
      });
      return jsonResponse(req, { ok: false, error: "Nao foi possivel gerar o boleto consolidado agora." }, 502);
    }

    const sanitized = sanitizeAsaasResponse(raw);
    const internalStatus = mapAsaasStatus(raw?.status);

    const { data: batch, error: batchError } = await supabase
      .from("consolidated_invoice_batches")
      .insert({
        agency_user_id: user.id,
        created_by: user.id,
        reference_month: referenceMonth,
        reference_year: referenceYear,
        total_value: totalValue,
        due_date: dueDate,
        status: "active",
        asaas_customer_id: customerId,
        asaas_payment_id: raw?.id || null,
        external_reference: externalReference,
        invoice_url: raw?.invoiceUrl || null,
        bank_slip_url: raw?.bankSlipUrl || null,
        identification_field: raw?.identificationField || raw?.nossoNumero || null,
      })
      .select()
      .maybeSingle();
    if (batchError) throw batchError;

    // Trava transacional contra dupla consolidacao: o indice unico parcial
    // (fatura_id) WHERE status='active' garante no banco que uma fatura
    // nunca entre em dois lotes ativos ao mesmo tempo, mesmo em corrida.
    const itemRows = elegiveis.map((f: any) => ({
      batch_id: batch.id,
      fatura_id: f.id,
      tenant_user_id: f.tenant_user_id,
      consulta_id: f.consulta_id,
      original_value: f.valor,
      status: "active",
    }));
    const { data: itensCriados, error: itemsError } = await supabase
      .from("consolidated_invoice_items")
      .insert(itemRows)
      .select("id, fatura_id");
    if (itemsError) {
      // O indice unico parcial (fatura_id) WHERE status='active' rejeita a
      // insercao se alguma dessas faturas ja entrou em outro lote ativo
      // entre a checagem acima e aqui (corrida). A cobranca no Asaas ja foi
      // criada nesse ponto - marca o lote como cancelado pra nao ficar
      // "active" orfao sem itens (nao tenta cancelar no Asaas aqui pra nao
      // mascarar o erro original; fica sinalizado pra revisao manual).
      console.error("[asaas-create-consolidated-invoice] falha ao gravar itens do lote (possivel corrida)", {
        batchId: batch.id,
        error: itemsError.message,
      });
      await supabase.from("consolidated_invoice_batches").update({ status: "cancelled" }).eq("id", batch.id);
      throw itemsError;
    }

    for (const item of itensCriados ?? []) {
      await supabase
        .from("faturas_inquilino")
        .update({ consolidated_item_id: item.id })
        .eq("id", item.fatura_id);
    }

    return jsonResponse(req, {
      success: true,
      batchId: batch.id,
      totalValue,
      dueDate,
      invoiceCount: elegiveis.length,
      status: internalStatus,
      invoiceUrl: raw?.invoiceUrl || null,
      bankSlipUrl: raw?.bankSlipUrl || null,
      identificationField: raw?.identificationField || raw?.nossoNumero || null,
    });
  } catch (error) {
    console.error("[asaas-create-consolidated-invoice] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(req, { ok: false, error: "Nao foi possivel gerar o boleto consolidado agora." }, 500);
  }
});
