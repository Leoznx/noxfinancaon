-- 20260712000000_sales_leads_canal_organico_pago.sql recriou distribuir_sales_lead()
-- com um parametro a mais (p_canal). CREATE OR REPLACE FUNCTION só substitui a
-- função existente quando a lista de tipos dos parâmetros é idêntica — como mudou
-- (9 parâmetros em vez de 8), o Postgres criou uma SEGUNDA sobrecarga em vez de
-- substituir a antiga. Resultado: qualquer chamada com os 8 parâmetros originais
-- (como a que o painel "Distribuição de Leads" faz) ficava ambígua pro Postgres
-- ("Could not choose the best candidate function"), quebrando silenciosamente toda
-- distribuição manual/em lista feita pelo admin — confirmado ao testar o painel
-- ao vivo (nenhum lead era criado, sem nenhum erro visível além do toast).
DROP FUNCTION IF EXISTS public.distribuir_sales_lead(text, text, text, text, text, text, text, text);
