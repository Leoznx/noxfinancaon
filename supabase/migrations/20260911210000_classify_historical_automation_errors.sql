-- Reclassifica somente incidentes importados que ainda estao sem categoria.
-- O raw_response e usado apenas na expressao de classificacao e nunca e
-- copiado para a central, preservando a sanitizacao dos dados administrativos.

UPDATE public.automation_errors AS error
SET category = CASE
      WHEN concat_ws(' ', credit.error_message, credit.mensagem, credit.raw_response::text)
        ~* 'sess[aã]o.*expir|login.*expir' THEN 'SESSION_EXPIRED'
      WHEN concat_ws(' ', credit.error_message, credit.mensagem, credit.raw_response::text)
        ~* 'captcha|otp|autentica' THEN 'AUTHENTICATION_ERROR'
      WHEN concat_ws(' ', credit.error_message, credit.mensagem, credit.raw_response::text)
        ~* 'selector|seletor|n[aã]o encontrad' THEN 'SELECTOR_NOT_FOUND'
      WHEN concat_ws(' ', credit.error_message, credit.mensagem, credit.raw_response::text)
        ~* 'timeout|tempo limite|exceeded' THEN 'PLAYWRIGHT_TIMEOUT'
      WHEN concat_ws(' ', credit.error_message, credit.mensagem, credit.raw_response::text)
        ~* 'network|gateway|econn|enotfound|fetch failed' THEN 'NETWORK_ERROR'
      WHEN concat_ws(' ', credit.error_message, credit.mensagem, credit.raw_response::text)
        ~* 'browser|chromium|page.*closed|target.*closed' THEN 'BROWSER_CRASH'
      ELSE error.category
    END,
    updated_at = clock_timestamp()
FROM public.consultas_credito AS credit
WHERE error.simulation_id = credit.id
  AND error.metadata ->> 'historicalImport' = 'true'
  AND error.category = 'UNKNOWN_ERROR';
