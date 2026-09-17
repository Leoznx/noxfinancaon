-- Corrige lembretes automaticos pendentes que foram criados pela cadencia
-- anterior. Historico concluido/cancelado e compromissos manuais permanecem
-- intactos.

CREATE TEMP TABLE seller_follow_up_origins_to_reconcile (
  appointment_id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO seller_follow_up_origins_to_reconcile (appointment_id)
SELECT DISTINCT meeting.id
FROM public.seller_appointments AS meeting
JOIN public.seller_appointments AS follow_up
  ON follow_up.origin_appointment_id = meeting.id
 AND follow_up.source = 'meeting_follow_up'
 AND follow_up.status NOT IN ('concluido', 'cancelado')
WHERE meeting.type = 'reuniao'
  AND meeting.status = 'concluido'
  AND (
    (
      meeting.sdr_id IS NOT NULL
      AND (
        follow_up.seller_id IS DISTINCT FROM meeting.sdr_id
        OR follow_up.follow_up_owner_type IS DISTINCT FROM 'sdr'
        OR follow_up.follow_up_offset_days NOT IN (1, 4, 15, 30)
      )
    )
    OR
    (
      meeting.sdr_id IS NULL
      AND (
        follow_up.seller_id IS DISTINCT FROM coalesce(
          meeting.assigned_closer_id,
          meeting.seller_id
        )
        OR follow_up.follow_up_owner_type IS DISTINCT FROM 'closer'
        OR follow_up.follow_up_offset_days NOT IN (1, 4, 15, 30)
      )
    )
  );

DELETE FROM public.seller_appointments AS follow_up
USING seller_follow_up_origins_to_reconcile AS affected
WHERE follow_up.origin_appointment_id = affected.appointment_id
  AND follow_up.source = 'meeting_follow_up'
  AND follow_up.status NOT IN ('concluido', 'cancelado');

DO $$
DECLARE
  v_meeting public.seller_appointments%ROWTYPE;
  v_owner_id uuid;
  v_owner_type text;
  v_offset integer;
BEGIN
  FOR v_meeting IN
    SELECT meeting.*
    FROM public.seller_appointments AS meeting
    JOIN seller_follow_up_origins_to_reconcile AS affected
      ON affected.appointment_id = meeting.id
  LOOP
    IF v_meeting.sdr_id IS NOT NULL THEN
      v_owner_id := v_meeting.sdr_id;
      v_owner_type := 'sdr';
    ELSE
      v_owner_id := coalesce(
        v_meeting.assigned_closer_id,
        v_meeting.seller_id
      );
      v_owner_type := 'closer';
    END IF;

    FOREACH v_offset IN ARRAY ARRAY[1, 4, 15, 30]
    LOOP
      PERFORM public.insert_seller_meeting_follow_up(
        v_meeting,
        v_owner_id,
        v_owner_type,
        v_offset
      );
    END LOOP;
  END LOOP;
END;
$$;

-- Mantem os tres cenarios visuais solicitados para a conta de teste. A quarta
-- etapa continua como parte da cadencia, sem sobrescrever um estado de jornada.
WITH ranked_test_follow_ups AS (
  SELECT
    follow_up.id,
    row_number() OVER (
      ORDER BY follow_up.follow_up_offset_days, follow_up.scheduled_at
    ) AS sequence
  FROM public.seller_appointments AS follow_up
  JOIN public.seller_appointments AS meeting
    ON meeting.id = follow_up.origin_appointment_id
  JOIN public.internal_users AS owner
    ON owner.id = follow_up.seller_id
  WHERE follow_up.source = 'meeting_follow_up'
    AND follow_up.status NOT IN ('concluido', 'cancelado')
    AND meeting.title = 'TESTE — Jornada do cliente no follow-up'
    AND lower(owner.email) = 'vendedornox@nox.com'
    AND owner.exclude_from_commercial_metrics
)
UPDATE public.seller_appointments AS follow_up
SET
  title = CASE ranked.sequence
    WHEN 1 THEN 'TESTE — Cliente sem consultas feitas'
    WHEN 2 THEN 'TESTE — Cliente consultando sem fechamento'
    WHEN 3 THEN 'TESTE — Cliente com contrato fechado'
  END,
  contact_name = CASE ranked.sequence
    WHEN 1 THEN 'Cliente Sem Consulta'
    WHEN 2 THEN 'Cliente Em Consulta'
    WHEN 3 THEN 'Cliente Contrato Fechado'
  END,
  contact_email = CASE ranked.sequence
    WHEN 1 THEN 'sem-consulta-teste@nox.com'
    WHEN 2 THEN 'consulta-teste@nox.com'
    WHEN 3 THEN 'contrato-teste@nox.com'
  END,
  contact_phone = CASE ranked.sequence
    WHEN 1 THEN '(11) 99999-1101'
    WHEN 2 THEN '(11) 99999-1102'
    WHEN 3 THEN '(11) 99999-1103'
  END,
  journey_test_status = CASE ranked.sequence
    WHEN 1 THEN 'no_consultations'
    WHEN 2 THEN 'consultation_in_progress'
    WHEN 3 THEN 'contract_closed'
  END,
  visible_from = now() - interval '1 minute',
  updated_at = now()
FROM ranked_test_follow_ups AS ranked
WHERE follow_up.id = ranked.id
  AND ranked.sequence <= 3;
