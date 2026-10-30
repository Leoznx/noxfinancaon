-- A tabela inquilinos nao armazena telefone; o contato canonico fica em
-- consultas_credito.tenant_telefone e ja faz parte do snapshot. Corrige a
-- funcao publicada sem recriar todo o contrato SQL nesta migration curta.
DO $migration$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_consultation_finalization_snapshot(uuid)'::regprocedure
  ) INTO v_definition;

  IF position('tenant.telefone' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      $pattern$'razao_social', tenant.razao_social,
        'telefone', tenant.telefone$pattern$,
      $replacement$'razao_social', tenant.razao_social$replacement$
    );

    IF position('tenant.telefone' IN v_definition) > 0 THEN
      RAISE EXCEPTION 'Nao foi possivel corrigir o snapshot de finalizacao.';
    END IF;

    EXECUTE v_definition;
  END IF;
END;
$migration$;
