-- Garante que cada conta receba o nome cadastrado no login e uma nova
-- mensagem a cada semana, sem alterar o histórico já enviado.

CREATE OR REPLACE FUNCTION public.set_weekly_whatsapp_message_variant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile_seed bigint;
  v_week_index integer;
BEGIN
  IF NEW.is_test OR NEW.recipient_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- O deslocamento semanal torna a variante diferente em semanas consecutivas.
  -- O ciclo de oito mensagens só volta a repetir depois de oito semanas.
  v_profile_seed :=
    ('x' || substr(md5(NEW.recipient_profile_id::text), 1, 8))::bit(32)::bigint % 8;
  v_week_index := (NEW.week_start - DATE '2026-01-05') / 7;
  NEW.message_variant := ((v_profile_seed + v_week_index) % 8)::smallint;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS weekly_whatsapp_followups_message_variant_trigger
  ON public.weekly_whatsapp_followups;

CREATE TRIGGER weekly_whatsapp_followups_message_variant_trigger
BEFORE INSERT OR UPDATE OF recipient_profile_id, week_start, is_test
ON public.weekly_whatsapp_followups
FOR EACH ROW
EXECUTE FUNCTION public.set_weekly_whatsapp_message_variant();

-- Corrige somente a fila ainda planejada desta e de semanas futuras. Enviados
-- permanecem intactos para preservar o histórico real da comunicação.
UPDATE public.weekly_whatsapp_followups AS followup
SET
  message_variant = (
    (
      ('x' || substr(md5(followup.recipient_profile_id::text), 1, 8))::bit(32)::bigint % 8
      + (followup.week_start - DATE '2026-01-05') / 7
    ) % 8
  )::smallint,
  recipient_name = COALESCE(NULLIF(btrim(followup.recipient_name), ''), 'cliente'),
  updated_at = now()
WHERE NOT followup.is_test
  AND followup.recipient_profile_id IS NOT NULL
  AND followup.status = 'planned';

COMMENT ON FUNCTION public.set_weekly_whatsapp_message_variant() IS
  'Usa o nome da conta e avanca a variante do follow-up a cada semana.';
