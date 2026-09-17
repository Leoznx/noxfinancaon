BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(15);

SELECT is(
  public.seller_appointment_effective_duration_minutes('reuniao', 240),
  60,
  'reuniao legada bloqueia somente 60 minutos'
);
SELECT is(
  public.seller_appointment_effective_duration_minutes('follow_up', 30),
  30,
  'outros compromissos preservam a propria duracao'
);
SELECT is(
  tstzrange(
    '2026-09-17 18:00:00+00',
    '2026-09-17 18:00:00+00'::timestamptz
      + make_interval(mins => public.seller_appointment_effective_duration_minutes('reuniao', 240)),
    '[)'
  ) && tstzrange('2026-09-17 19:00:00+00', '2026-09-17 20:00:00+00', '[)'),
  false,
  'uma reuniao das 15h libera o horario das 16h'
);
SELECT is(
  public.format_seller_shared_meeting_title(
    'Simone Ferreira',
    E'Tipo de cliente: Corretor\nSDR responsavel: Camila',
    'Apresentacao NOX'
  ),
  'Corretor — Simone Ferreira',
  'titulo principal combina perfil e nome'
);

CREATE TEMP TABLE seller_agenda_followup_context (
  meeting_id uuid,
  closer_only_meeting_id uuid,
  sdr_id uuid,
  closer_id uuid
) ON COMMIT DROP;

INSERT INTO seller_agenda_followup_context (sdr_id, closer_id)
SELECT
  (SELECT id FROM public.internal_users WHERE role = 'vendedor' AND seller_type = 'sdr' LIMIT 1),
  (SELECT id FROM public.internal_users WHERE role = 'vendedor' AND seller_type = 'closer' LIMIT 1);

SELECT ok(
  (SELECT sdr_id IS NOT NULL AND closer_id IS NOT NULL FROM seller_agenda_followup_context),
  'ambiente possui SDR e Closer para validar o gatilho'
);

WITH inserted AS (
  INSERT INTO public.seller_appointments (
    seller_id,
    sdr_id,
    assigned_closer_id,
    title,
    type,
    status,
    priority,
    scheduled_at,
    reminder_minutes,
    notes,
    source,
    duration_minutes,
    contact_name,
    contact_phone,
    meeting_feedback,
    completed_at
  )
  SELECT
    closer_id,
    sdr_id,
    closer_id,
    'Corretor — Cliente Teste',
    'reuniao',
    'concluido',
    'normal',
    timestamptz '2026-09-17 14:00:00-03',
    5,
    'Tipo de cliente: Corretor',
    'sdr_handoff',
    240,
    'Cliente Teste',
    '(11) 99999-9999',
    'Cliente interessado e cadastro combinado para hoje.',
    timestamptz '2026-09-17 15:00:00-03'
  FROM seller_agenda_followup_context
  RETURNING id
)
UPDATE seller_agenda_followup_context AS context
SET meeting_id = inserted.id
FROM inserted;

SELECT is(
  (SELECT duration_minutes FROM public.seller_appointments WHERE id = context.meeting_id),
  60,
  'nova reuniao e normalizada para uma hora'
)
FROM seller_agenda_followup_context AS context;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.seller_appointments AS follow_up
    WHERE follow_up.origin_appointment_id = context.meeting_id
  ),
  4,
  'conclusao cria uma unica cadencia de quatro follow-ups'
)
FROM seller_agenda_followup_context AS context;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.seller_appointments AS follow_up
    WHERE follow_up.origin_appointment_id = context.meeting_id
      AND follow_up.seller_id = context.sdr_id
      AND follow_up.assigned_closer_id IS NULL
      AND follow_up.follow_up_owner_type = 'sdr'
  ),
  4,
  'todos os follow-ups pertencem somente ao SDR que marcou a reuniao'
)
FROM seller_agenda_followup_context AS context;

SELECT is(
  (
    SELECT array_agg(follow_up.follow_up_offset_days ORDER BY follow_up.follow_up_offset_days)
    FROM public.seller_appointments AS follow_up
    WHERE follow_up.origin_appointment_id = context.meeting_id
  ),
  ARRAY[1, 4, 15, 30],
  'follow-ups usam os prazos de 1, 4, 15 e 30 dias'
)
FROM seller_agenda_followup_context AS context;

SELECT is(
  (
    SELECT array_agg(
      to_char(follow_up.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')
      ORDER BY follow_up.follow_up_offset_days
    )
    FROM public.seller_appointments AS follow_up
    WHERE follow_up.origin_appointment_id = context.meeting_id
  ),
  ARRAY[
    '2026-09-18 10:00',
    '2026-09-21 10:00',
    '2026-10-02 10:00',
    '2026-10-19 10:00'
  ],
  'cadencia fica as 10h e avanca fim de semana para o proximo dia util'
)
FROM seller_agenda_followup_context AS context;

SELECT ok(
  (
    SELECT bool_and(
      extract(isodow FROM follow_up.scheduled_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 1 AND 5
      AND NOT public.is_seller_business_holiday(
        (follow_up.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date
      )
    )
    FROM public.seller_appointments AS follow_up
    WHERE follow_up.origin_appointment_id = context.meeting_id
  ),
  'nenhum follow-up cai em fim de semana ou feriado'
)
FROM seller_agenda_followup_context AS context;

UPDATE public.seller_appointments AS meeting
SET status = 'agendado'
FROM seller_agenda_followup_context AS context
WHERE meeting.id = context.meeting_id;

UPDATE public.seller_appointments AS meeting
SET status = 'concluido'
FROM seller_agenda_followup_context AS context
WHERE meeting.id = context.meeting_id;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.seller_appointments AS follow_up
    WHERE follow_up.origin_appointment_id = context.meeting_id
  ),
  4,
  'nova conclusao nao duplica os lembretes'
)
FROM seller_agenda_followup_context AS context;

WITH inserted AS (
  INSERT INTO public.seller_appointments (
    seller_id,
    assigned_closer_id,
    title,
    type,
    status,
    priority,
    scheduled_at,
    reminder_minutes,
    notes,
    source,
    duration_minutes,
    contact_name,
    contact_phone,
    meeting_feedback,
    completed_at
  )
  SELECT
    closer_id,
    closer_id,
    'Imobiliaria — Cliente Direto',
    'reuniao',
    'concluido',
    'normal',
    timestamptz '2026-09-17 16:00:00-03',
    5,
    'Tipo de cliente: Imobiliaria',
    'manual',
    60,
    'Cliente Direto',
    '(11) 98888-8888',
    'Cliente direto interessado e cadastro combinado.',
    timestamptz '2026-09-17 17:00:00-03'
  FROM seller_agenda_followup_context
  RETURNING id
)
UPDATE seller_agenda_followup_context AS context
SET closer_only_meeting_id = inserted.id
FROM inserted;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.seller_appointments AS follow_up
    WHERE follow_up.origin_appointment_id = context.closer_only_meeting_id
  ),
  4,
  'reuniao direta do Closer tambem cria quatro follow-ups'
)
FROM seller_agenda_followup_context AS context;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.seller_appointments AS follow_up
    WHERE follow_up.origin_appointment_id = context.closer_only_meeting_id
      AND follow_up.seller_id = context.closer_id
      AND follow_up.follow_up_owner_type = 'closer'
  ),
  4,
  'reuniao direta pertence somente ao Closer'
)
FROM seller_agenda_followup_context AS context;

SELECT is(
  (
    SELECT array_agg(follow_up.follow_up_offset_days ORDER BY follow_up.follow_up_offset_days)
    FROM public.seller_appointments AS follow_up
    WHERE follow_up.origin_appointment_id = context.closer_only_meeting_id
  ),
  ARRAY[1, 4, 15, 30],
  'Closer recebe a mesma cadencia de 1, 4, 15 e 30 dias'
)
FROM seller_agenda_followup_context AS context;

SELECT * FROM finish();
ROLLBACK;
