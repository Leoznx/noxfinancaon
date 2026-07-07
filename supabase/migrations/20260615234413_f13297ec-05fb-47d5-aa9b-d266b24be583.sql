-- Allow demo/public read for inquilino dashboard (matches the existing public read pattern on consultas_credito)
CREATE POLICY "App reads documentos proposta"
  ON public.documentos_proposta FOR SELECT
  USING (true);

CREATE POLICY "App reads faturas inquilino"
  ON public.faturas_inquilino FOR SELECT
  USING (true);

GRANT SELECT ON public.documentos_proposta TO anon;
GRANT SELECT ON public.faturas_inquilino TO anon;