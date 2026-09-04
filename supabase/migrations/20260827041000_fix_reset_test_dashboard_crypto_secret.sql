-- A tabela private.withdrawal_crypto_secrets guarda a chave global de
-- criptografia por versao; ela nao pertence a um saque individual e nunca deve
-- fazer parte da limpeza de dados de teste. Corrige a funcao ja publicada sem
-- alterar ou rotacionar o segredo global.
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.reset_nox_test_dashboards(boolean)'::regprocedure
  )
  INTO v_definition;

  v_definition := replace(
    v_definition,
    E'  DELETE FROM private.withdrawal_crypto_secrets\n  WHERE withdrawal_id IN (SELECT id FROM _nox_test_withdrawals);\n\n',
    ''
  );

  IF v_definition LIKE '%withdrawal_crypto_secrets%withdrawal_id%' THEN
    RAISE EXCEPTION 'Nao foi possivel corrigir reset_nox_test_dashboards com seguranca.';
  END IF;

  EXECUTE v_definition;
END;
$$;
