
-- Alinhar políticas de leitura/escrita com o resto do app (que usa auth local, não Supabase Auth)
CREATE POLICY "App reads apolices" ON public.apolices FOR SELECT USING (true);
CREATE POLICY "App inserts apolices" ON public.apolices FOR INSERT WITH CHECK (true);
CREATE POLICY "App updates apolices" ON public.apolices FOR UPDATE USING (true);

CREATE POLICY "App reads mensalidades" ON public.mensalidades FOR SELECT USING (true);
CREATE POLICY "App inserts mensalidades" ON public.mensalidades FOR INSERT WITH CHECK (true);
CREATE POLICY "App updates mensalidades" ON public.mensalidades FOR UPDATE USING (true);

CREATE POLICY "App reads documentos_contrato" ON public.documentos_contrato FOR SELECT USING (true);
CREATE POLICY "App inserts documentos_contrato" ON public.documentos_contrato FOR INSERT WITH CHECK (true);
CREATE POLICY "App updates documentos_contrato" ON public.documentos_contrato FOR UPDATE USING (true);

GRANT SELECT, INSERT, UPDATE ON public.apolices TO anon;
GRANT SELECT, INSERT, UPDATE ON public.mensalidades TO anon;
GRANT SELECT, INSERT, UPDATE ON public.documentos_contrato TO anon;
