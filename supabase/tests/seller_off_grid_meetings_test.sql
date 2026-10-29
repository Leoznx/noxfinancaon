BEGIN;

SELECT plan(6);

SELECT has_function(
  'public',
  'is_seller_manual_shared_start_within_business_hours',
  ARRAY['timestamp with time zone', 'integer'],
  'fallback de horario quebrado existe'
);

SELECT ok(
  public.is_seller_manual_shared_start_within_business_hours(
    timestamptz '2026-10-29 14:17:00-03',
    30
  ),
  'aceita minuto exato fora da grade oficial'
);

SELECT ok(
  public.is_seller_manual_shared_start_within_business_hours(
    timestamptz '2026-10-29 11:30:00-03',
    30
  ),
  'aceita o ultimo inicio da janela da manha'
);

SELECT ok(
  public.is_seller_manual_shared_start_within_business_hours(
    timestamptz '2026-10-29 17:30:00-03',
    30
  ),
  'aceita o ultimo inicio da janela da tarde'
);

SELECT ok(
  NOT public.is_seller_manual_shared_start_within_business_hours(
    timestamptz '2026-10-29 12:15:00-03',
    30
  ),
  'continua recusando o intervalo de almoco'
);

SELECT ok(
  position(
    'is_seller_manual_shared_start_within_business_hours'
    IN pg_get_functiondef('public.prepare_sdr_closer_meeting()'::regprocedure)
  ) > 0,
  'trigger de entrega usa o fallback de minuto exato'
);

SELECT * FROM finish();

ROLLBACK;
