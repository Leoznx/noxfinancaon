-- Repara ambientes onde a migracao de notificacoes foi registrada sem que a
-- coluna correspondente permanecesse no schema. O reagendamento atomico usa
-- esta coluna para liberar uma nova confirmacao por e-mail ao SDR e ao Closer.

DO $$
DECLARE
  v_column_existed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'seller_appointments'
      AND column_name = 'creation_notified_at'
  )
  INTO v_column_existed;

  IF NOT v_column_existed THEN
    ALTER TABLE public.seller_appointments
      ADD COLUMN creation_notified_at timestamptz;

    -- Reunioes compartilhadas que ja existiam antes deste reparo nao devem
    -- disparar confirmacoes retroativas. Ao serem reagendadas, a RPC redefine
    -- o campo para NULL e o envio da nova data segue normalmente.
    UPDATE public.seller_appointments
    SET creation_notified_at = now()
    WHERE source = 'sdr_handoff';
  END IF;
END;
$$;

COMMENT ON COLUMN public.seller_appointments.creation_notified_at IS
  'Momento em que SDR e Closer receberam as confirmacoes de criacao ou reagendamento da reuniao.';

NOTIFY pgrst, 'reload schema';
