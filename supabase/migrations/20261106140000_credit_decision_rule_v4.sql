-- Invalida resultados que possam ter sido calculados pela implementação v3
-- divergente dos limites comerciais: aprovação a partir de 651, análise entre
-- 541 e 650 e reprovação numérica somente abaixo de 539 quando o compromisso
-- também estiver abaixo de 48%. O histórico concluído permanece imutável.
DO $migration$
DECLARE
  v_signature regprocedure := to_regprocedure(
    'public.claim_official_credit_simulation(uuid,text)'
  );
  v_definition text;
  v_previous_rule constant text := 'score_descricao_compromisso_v3';
  v_current_rule constant text := 'score_descricao_compromisso_v4';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'Função claim_official_credit_simulation(uuid,text) não encontrada';
  END IF;

  SELECT pg_get_functiondef(v_signature)
  INTO v_definition;

  IF position(v_previous_rule IN v_definition) > 0
     AND position(v_current_rule IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Marcadores das regras v3 e v4 encontrados juntos no claim oficial';
  ELSIF position(v_previous_rule IN v_definition) > 0 THEN
    v_definition := replace(v_definition, v_previous_rule, v_current_rule);
    EXECUTE v_definition;
  ELSIF position(v_current_rule IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Marcador da regra v3 não encontrado no claim oficial';
  END IF;
END;
$migration$;
