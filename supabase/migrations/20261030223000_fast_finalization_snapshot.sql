-- A etapa de finalizacao era montada por varias consultas PostgREST com
-- relacionamentos embutidos. Alem de repetir a avaliacao das politicas RLS,
-- isso fazia propostas com muitos documentos/historico ultrapassarem o
-- statement_timeout. Entregue somente o recorte necessario em uma unica
-- funcao autorizada e indexe as leituras por proposta.

CREATE INDEX IF NOT EXISTS documentos_proposta_consulta_created_idx
  ON public.documentos_proposta (consulta_id, created_at DESC);

CREATE INDEX IF NOT EXISTS asaas_payments_consultation_created_idx
  ON public.asaas_payments (consultation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS faturas_inquilino_consulta_created_idx
  ON public.faturas_inquilino (consulta_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_consultation_finalization_snapshot(
  p_consultation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_snapshot jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Acesso nao autorizado.';
  END IF;

  SELECT profile.email
  INTO v_user_email
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id;

  SELECT jsonb_build_object(
    'consulta', jsonb_build_object(
      'id', consultation.id,
      'status', consultation.status,
      'substatus', consultation.substatus,
      'created_at', consultation.created_at,
      'updated_at', consultation.updated_at,
      'tenant_name', consultation.tenant_name,
      'tenant_document', consultation.tenant_document,
      'documento', consultation.documento,
      'tenant_email', consultation.tenant_email,
      'tenant_telefone', consultation.tenant_telefone,
      'tenant_data_nascimento', consultation.tenant_data_nascimento,
      'tenant_user_id', consultation.tenant_user_id,
      'profile_id_solicitante', consultation.profile_id_solicitante,
      'rent_value', consultation.rent_value,
      'valor_aluguel', consultation.valor_aluguel,
      'valor_condominio', consultation.valor_condominio,
      'valor_taxas', consultation.valor_taxas,
      'valor_premio_mensal', consultation.valor_premio_mensal,
      'valor_anual', consultation.valor_anual,
      'contract_period_months', consultation.contract_period_months,
      'documentos', consultation.documentos,
      'commission_enabled', consultation.commission_enabled,
      'insurance_coverages', consultation.insurance_coverages,
      'insurance_assistance', consultation.insurance_assistance,
      'insurance_commission_pct', consultation.insurance_commission_pct,
      'insurance_payment_method', consultation.insurance_payment_method,
      'insurance_payment_method_label', consultation.insurance_payment_method_label,
      'fire_insurance_payment_mode', consultation.fire_insurance_payment_mode,
      'billing_due_day', consultation.billing_due_day,
      'payment_type', consultation.payment_type,
      'billing_responsible_role', consultation.billing_responsible_role,
      'billing_responsible_user_id', consultation.billing_responsible_user_id,
      'terms_accepted', consultation.terms_accepted,
      'terms_accepted_at', consultation.terms_accepted_at,
      'proposta_enviada_em', consultation.proposta_enviada_em,
      'imovel_subtipo', consultation.imovel_subtipo,
      'imovel_cep', consultation.imovel_cep,
      'imovel_endereco', consultation.imovel_endereco,
      'imovel_numero', consultation.imovel_numero,
      'imovel_complemento', consultation.imovel_complemento,
      'imovel_bairro', consultation.imovel_bairro,
      'imovel_cidade', consultation.imovel_cidade,
      'imovel_estado', consultation.imovel_estado,
      'inquilinos', CASE WHEN tenant.id IS NULL THEN NULL ELSE jsonb_build_object(
        'nome', tenant.nome,
        'cpf', tenant.cpf,
        'cnpj', tenant.cnpj,
        'razao_social', tenant.razao_social
      ) END,
      'imoveis', CASE WHEN property.id IS NULL THEN NULL ELSE jsonb_build_object(
        'valor_aluguel', property.valor_aluguel,
        'valor_condominio', property.valor_condominio,
        'valor_taxas', property.valor_taxas,
        'cep', property.cep,
        'tipo', property.tipo,
        'endereco', property.endereco,
        'numero', property.numero,
        'complemento', property.complemento,
        'bairro', property.bairro,
        'cidade', property.cidade,
        'estado', property.estado
      ) END,
      'planos', CASE WHEN plan.id IS NULL THEN NULL ELSE jsonb_build_object(
        'nome', plan.nome,
        'cobertura_multiplicador', plan.cobertura_multiplicador,
        'custo_saida', plan.custo_saida
      ) END,
      'responsavel_profile', CASE WHEN responsible.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', responsible.id,
        'role', responsible.role
      ) END
    ),
    'documentos', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', document.id,
          'file_name', document.file_name,
          'file_url', document.file_url,
          'file_type', document.file_type,
          'document_type', document.document_type,
          'document_subtype', document.document_subtype
        )
        ORDER BY document.created_at DESC, document.id
      )
      FROM public.documentos_proposta AS document
      WHERE document.consulta_id = consultation.id
    ), '[]'::jsonb),
    'historico', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', history.id,
          'tipo_evento', history.tipo_evento,
          'descricao', history.descricao,
          'created_at', history.created_at
        )
        ORDER BY history.created_at, history.id
      )
      FROM public.proposta_historico AS history
      WHERE history.consulta_id = consultation.id
    ), '[]'::jsonb)
  )
  INTO v_snapshot
  FROM public.consultas_credito AS consultation
  LEFT JOIN public.inquilinos AS tenant ON tenant.id = consultation.inquilino_id
  LEFT JOIN public.imoveis AS property ON property.id = consultation.imovel_id
  LEFT JOIN public.planos AS plan ON plan.id = consultation.plano_id
  LEFT JOIN public.profiles AS responsible ON responsible.id = consultation.profile_id_solicitante
  WHERE consultation.id = p_consultation_id
    AND (
      consultation.profile_id_solicitante = v_user_id
      OR consultation.tenant_user_id = v_user_id
      OR consultation.billing_responsible_user_id = v_user_id
      OR (
        v_user_email IS NOT NULL
        AND consultation.tenant_email IS NOT NULL
        AND lower(trim(consultation.tenant_email)) = lower(trim(v_user_email))
      )
      OR public.eh_dono_ou_imobiliaria_da_consulta(consultation.profile_id_solicitante)
      OR public.eh_staff_interno_consultas()
    );

  IF v_snapshot IS NULL AND EXISTS (
    SELECT 1 FROM public.consultas_credito WHERE id = p_consultation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Acesso nao autorizado.';
  END IF;

  RETURN v_snapshot;
END;
$$;

COMMENT ON FUNCTION public.get_consultation_finalization_snapshot(uuid) IS
  'Retorna o recorte autorizado e enxuto usado pela finalizacao no site e no aplicativo.';

REVOKE ALL ON FUNCTION public.get_consultation_finalization_snapshot(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_consultation_finalization_snapshot(uuid)
  TO authenticated, service_role;
