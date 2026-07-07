CREATE TABLE public.seller_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'reuniao',
  status text NOT NULL DEFAULT 'agendado',
  priority text NOT NULL DEFAULT 'normal',
  scheduled_at timestamptz NOT NULL,
  reminder_minutes int,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_appointments TO authenticated;
GRANT ALL ON public.seller_appointments TO service_role;
ALTER TABLE public.seller_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendedor gerencia seus compromissos" ON public.seller_appointments
  FOR ALL TO authenticated
  USING (
    seller_id = public.internal_user_id(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master')
  )
  WITH CHECK (
    seller_id = public.internal_user_id(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master')
  );
CREATE INDEX seller_appointments_seller_scheduled_idx
  ON public.seller_appointments(seller_id, scheduled_at);
CREATE TRIGGER seller_appointments_updated_at
  BEFORE UPDATE ON public.seller_appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();