-- A listagem de Faturas Inquilinos percorria todas as apolices visiveis e,
-- em seguida, todas as faturas acessiveis em consultas separadas. Em contas
-- de imobiliaria isso repetia RLS e relacionamentos ate atingir o
-- statement_timeout. Esta RPC entrega somente o resumo dos contratos ativos,
-- preservando can_view_policy como autorizacao canonica.

CREATE INDEX IF NOT EXISTS faturas_inquilino_policy_status_due_idx
  ON public.faturas_inquilino (apolice_id, status, vencimento);

CREATE INDEX IF NOT EXISTS faturas_inquilino_consultation_status_due_idx
  ON public.faturas_inquilino (consulta_id, status, vencimento);

CREATE INDEX IF NOT EXISTS mensalidades_policy_status_due_idx
  ON public.mensalidades (apolice_id, status, data_vencimento);

CREATE OR REPLACE FUNCTION public.get_visible_active_tenant_invoice_summaries()
RETURNS TABLE (
  apolice_id uuid,
  numero text,
  inquilino_nome text,
  inquilino_doc text,
  cidade text,
  valor_parcela numeric,
  proximo_venc date,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  WITH visible_policies AS (
    SELECT
      policy.id AS apolice_id,
      policy.consulta_id,
      policy.numero,
      COALESCE(tenant.nome, tenant.razao_social, consultation.tenant_name, 'Inquilino nao informado') AS inquilino_nome,
      COALESCE(tenant.cpf, tenant.cnpj, consultation.tenant_document, '') AS inquilino_doc,
      COALESCE(property.cidade, consultation.imovel_cidade, 'Cidade nao informada') AS cidade
    FROM public.apolices AS policy
    LEFT JOIN public.consultas_credito AS consultation
      ON consultation.id = policy.consulta_id
    LEFT JOIN public.inquilinos AS tenant
      ON tenant.id = consultation.inquilino_id
    LEFT JOIN public.imoveis AS property
      ON property.id = consultation.imovel_id
    WHERE auth.uid() IS NOT NULL
      AND public.can_view_policy(auth.uid(), policy.id)
      AND lower(COALESCE(policy.status, 'pendente')) NOT IN (
        'cancelada', 'cancelado', 'cancelled', 'canceled',
        'encerrada', 'encerrado', 'closed', 'expired'
      )
  ),
  canonical_rows AS (
    SELECT
      visible.apolice_id,
      invoice.status,
      invoice.valor,
      invoice.vencimento,
      invoice.charge_kind
    FROM visible_policies AS visible
    JOIN public.faturas_inquilino AS invoice
      ON invoice.apolice_id = visible.apolice_id
    UNION ALL
    SELECT
      visible.apolice_id,
      invoice.status,
      invoice.valor,
      invoice.vencimento,
      invoice.charge_kind
    FROM visible_policies AS visible
    JOIN public.faturas_inquilino AS invoice
      ON invoice.apolice_id IS NULL
     AND invoice.consulta_id = visible.consulta_id
  ),
  canonical AS (
    SELECT
      row.apolice_id,
      count(*) FILTER (
        WHERE lower(COALESCE(row.status, 'pending')) NOT IN (
          'cancelled', 'canceled', 'cancelado', 'refunded', 'deleted'
        )
      ) AS active_count,
      COALESCE(
        max(row.valor) FILTER (
          WHERE row.charge_kind = 'monthly'
            AND lower(COALESCE(row.status, 'pending')) NOT IN (
              'cancelled', 'canceled', 'cancelado', 'refunded', 'deleted'
            )
        ),
        max(row.valor) FILTER (
          WHERE lower(COALESCE(row.status, 'pending')) NOT IN (
            'cancelled', 'canceled', 'cancelado', 'refunded', 'deleted'
          )
        ),
        0
      ) AS recurring_value,
      min(row.vencimento) FILTER (
        WHERE lower(COALESCE(row.status, 'pending')) IN (
          'pending', 'created', 'waiting_payment', 'processing', 'risk_analysis',
          'approved', 'confirmed', 'overdue', 'scheduled', 'awaiting_payment'
        )
      ) AS next_due_date,
      bool_or(
        lower(COALESCE(row.status, 'pending')) IN ('overdue', 'vencido', 'atrasado')
        OR (
          row.vencimento < current_date
          AND lower(COALESCE(row.status, 'pending')) IN (
            'pending', 'created', 'waiting_payment', 'processing', 'risk_analysis',
            'approved', 'confirmed', 'scheduled', 'awaiting_payment'
          )
        )
      ) AS has_overdue
    FROM canonical_rows AS row
    GROUP BY row.apolice_id
  ),
  legacy AS (
    SELECT
      visible.apolice_id,
      COALESCE(max(monthly.valor), 0) AS recurring_value,
      min(monthly.data_vencimento) FILTER (
        WHERE lower(COALESCE(monthly.status, 'pendente')) NOT IN (
          'pago', 'paid', 'received', 'confirmed', 'cancelado', 'cancelled', 'canceled'
        )
      ) AS next_due_date,
      bool_or(
        lower(COALESCE(monthly.status, 'pendente')) IN ('overdue', 'vencido', 'atrasado')
        OR (
          monthly.data_vencimento < current_date
          AND lower(COALESCE(monthly.status, 'pendente')) NOT IN (
            'pago', 'paid', 'received', 'confirmed', 'cancelado', 'cancelled', 'canceled'
          )
        )
      ) AS has_overdue
    FROM visible_policies AS visible
    JOIN public.mensalidades AS monthly
      ON monthly.apolice_id = visible.apolice_id
    GROUP BY visible.apolice_id
  )
  SELECT
    visible.apolice_id,
    COALESCE(visible.numero, '')::text AS numero,
    visible.inquilino_nome::text,
    visible.inquilino_doc::text,
    visible.cidade::text,
    CASE
      WHEN COALESCE(canonical.active_count, 0) > 0 THEN canonical.recurring_value
      ELSE COALESCE(legacy.recurring_value, 0)
    END AS valor_parcela,
    CASE
      WHEN COALESCE(canonical.active_count, 0) > 0 THEN canonical.next_due_date
      ELSE legacy.next_due_date
    END AS proximo_venc,
    CASE
      WHEN COALESCE(canonical.active_count, 0) > 0 AND canonical.has_overdue THEN 'vencido'
      WHEN COALESCE(canonical.active_count, 0) = 0 AND COALESCE(legacy.has_overdue, false) THEN 'vencido'
      WHEN (
        CASE
          WHEN COALESCE(canonical.active_count, 0) > 0 THEN canonical.next_due_date
          ELSE legacy.next_due_date
        END
      ) IS NOT NULL THEN 'a_vencer'
      ELSE 'em_dia'
    END::text AS status
  FROM visible_policies AS visible
  LEFT JOIN canonical ON canonical.apolice_id = visible.apolice_id
  LEFT JOIN legacy ON legacy.apolice_id = visible.apolice_id
  ORDER BY proximo_venc NULLS LAST, visible.numero, visible.apolice_id;
$$;

COMMENT ON FUNCTION public.get_visible_active_tenant_invoice_summaries() IS
  'Resumo autorizado e indexado dos contratos ativos para Faturas Inquilinos no site e no aplicativo.';

REVOKE ALL ON FUNCTION public.get_visible_active_tenant_invoice_summaries()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visible_active_tenant_invoice_summaries()
  TO authenticated, service_role;
