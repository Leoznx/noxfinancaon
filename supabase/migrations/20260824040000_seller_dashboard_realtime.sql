-- Mantem o dashboard comercial sincronizado quando o vendedor movimenta leads
-- ou quando a automacao cria/atualiza sua comissao por contrato e pagamento.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sales_leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_leads;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'seller_commissions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_commissions;
  END IF;
END;
$$;
