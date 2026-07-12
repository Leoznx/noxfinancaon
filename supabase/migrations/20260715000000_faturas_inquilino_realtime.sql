-- Habilita Supabase Realtime em faturas_inquilino (mesmo padrao ja usado em
-- notificacoes/mensalidades - ver 20260623013832_...sql) para que "Minhas
-- Faturas" (inquilino), "Faturas dos Inquilinos" (corretor/imobiliaria) e
-- "Carteira de Cobrancas" reajam automaticamente quando o webhook do Asaas
-- atualizar o status de uma mensalidade, sem precisar recarregar a pagina.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'faturas_inquilino'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.faturas_inquilino';
  END IF;
END $$;

-- REPLICA IDENTITY FULL: garante que o payload do evento UPDATE traga todas
-- as colunas antigas/novas (nao so a PK), necessario pro filtro client-side
-- por tenant_user_id/consulta_id funcionar em cima do payload recebido.
ALTER TABLE public.faturas_inquilino REPLICA IDENTITY FULL;
