-- Controle de ponto compartilhado pelo site e aplicativo NOX.
-- As marcacoes sao append-only, usam exclusivamente o relogio do banco e
-- preservam a foto em bucket privado. A tolerancia segue o art. 58, §1º da CLT:
-- ate 5 minutos por marcacao, observado o limite de 10 minutos no dia.

ALTER TABLE public.internal_users
  ADD COLUMN IF NOT EXISTS time_clock_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.time_clock_punches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE RESTRICT,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  punch_type text NOT NULL CHECK (punch_type IN ('entrada', 'inicio_intervalo', 'fim_intervalo', 'saida')),
  punched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expected_at timestamptz NOT NULL,
  deviation_minutes integer NOT NULL,
  classification text NOT NULL CHECK (classification IN ('no_horario', 'atrasado', 'adiantado', 'saida_antecipada', 'hora_extra')),
  photo_path text NOT NULL,
  client_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT time_clock_punches_employee_day_type_key UNIQUE (employee_id, work_date, punch_type),
  CONSTRAINT time_clock_punches_photo_path_key UNIQUE (photo_path)
);

CREATE INDEX IF NOT EXISTS time_clock_punches_employee_date_idx
  ON public.time_clock_punches (employee_id, work_date DESC, punched_at);
CREATE INDEX IF NOT EXISTS time_clock_punches_auth_date_idx
  ON public.time_clock_punches (auth_user_id, work_date DESC);

COMMENT ON TABLE public.time_clock_punches IS
  'Marcacoes imutaveis de ponto. O horario oficial e sempre clock_timestamp() do banco.';
COMMENT ON COLUMN public.time_clock_punches.deviation_minutes IS
  'Diferenca assinada entre horario real e previsto; positivo significa depois do previsto.';

ALTER TABLE public.time_clock_punches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.time_clock_punches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.time_clock_punches TO authenticated;
GRANT ALL ON public.time_clock_punches TO service_role;

DROP POLICY IF EXISTS "time clock employee reads own" ON public.time_clock_punches;
CREATE POLICY "time clock employee reads own"
  ON public.time_clock_punches FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master')
  );

-- Registro de envio para tornar a notificacao por e-mail idempotente e auditavel.
CREATE TABLE IF NOT EXISTS public.time_clock_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  punch_id uuid NOT NULL UNIQUE REFERENCES public.time_clock_punches(id) ON DELETE RESTRICT,
  recipient text NOT NULL,
  provider_message_id text,
  status text NOT NULL CHECK (status IN ('enviado', 'falhou')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.time_clock_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.time_clock_email_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.time_clock_email_deliveries TO service_role;

-- Fotos nao sao publicas e ficam limitadas a 5 MB em formatos de imagem usuais.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'time-clock-photos',
  'time-clock-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "time clock upload own photo" ON storage.objects;
CREATE POLICY "time clock upload own photo"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'time-clock-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.internal_users employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.role = 'vendedor'
        AND employee.status = 'ativo'
        AND employee.time_clock_enabled
    )
  );

DROP POLICY IF EXISTS "time clock read authorized photos" ON storage.objects;
CREATE POLICY "time clock read authorized photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'time-clock-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin(auth.uid())
      OR public.has_internal_role(auth.uid(), 'admin_master')
    )
  );

DROP POLICY IF EXISTS "time clock delete unattached own photo" ON storage.objects;
CREATE POLICY "time clock delete unattached own photo"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'time-clock-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT EXISTS (
      SELECT 1 FROM public.time_clock_punches punch WHERE punch.photo_path = name
    )
  );

-- Resumo canônico de um dia. O saldo só é fechado com as quatro marcações.
CREATE OR REPLACE FUNCTION public.time_clock_day_summary(
  p_employee_id uuid,
  p_work_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_iso_day integer := extract(isodow FROM p_work_date)::integer;
  v_scheduled_minutes integer;
  v_entry timestamptz;
  v_lunch_start timestamptz;
  v_lunch_end timestamptz;
  v_exit timestamptz;
  v_punch_count integer := 0;
  v_worked_minutes integer;
  v_raw_bank integer;
  v_bank integer;
  v_abs_deviation integer := 0;
  v_max_deviation integer := 0;
  v_late integer := 0;
  v_early_departure integer := 0;
  v_punches jsonb := '[]'::jsonb;
  v_status text;
BEGIN
  v_scheduled_minutes := CASE WHEN v_iso_day BETWEEN 1 AND 4 THEN 540 WHEN v_iso_day = 5 THEN 510 ELSE 0 END;

  SELECT
    max(punched_at) FILTER (WHERE punch_type = 'entrada'),
    max(punched_at) FILTER (WHERE punch_type = 'inicio_intervalo'),
    max(punched_at) FILTER (WHERE punch_type = 'fim_intervalo'),
    max(punched_at) FILTER (WHERE punch_type = 'saida'),
    count(*)::integer,
    coalesce(sum(abs(deviation_minutes)), 0)::integer,
    coalesce(max(abs(deviation_minutes)), 0)::integer,
    coalesce(sum(CASE WHEN punch_type IN ('entrada', 'fim_intervalo') AND deviation_minutes > 5 THEN deviation_minutes ELSE 0 END), 0)::integer,
    coalesce(sum(CASE WHEN punch_type IN ('inicio_intervalo', 'saida') AND deviation_minutes < -5 THEN abs(deviation_minutes) ELSE 0 END), 0)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'type', punch_type,
          'punched_at', punched_at,
          'expected_at', expected_at,
          'deviation_minutes', deviation_minutes,
          'classification', classification,
          'photo_path', photo_path
        ) ORDER BY CASE punch_type
          WHEN 'entrada' THEN 1 WHEN 'inicio_intervalo' THEN 2
          WHEN 'fim_intervalo' THEN 3 ELSE 4 END
      ),
      '[]'::jsonb
    )
  INTO
    v_entry, v_lunch_start, v_lunch_end, v_exit, v_punch_count,
    v_abs_deviation, v_max_deviation, v_late, v_early_departure, v_punches
  FROM public.time_clock_punches
  WHERE employee_id = p_employee_id AND work_date = p_work_date;

  IF v_punch_count = 4 THEN
    v_worked_minutes := round(
      extract(epoch FROM ((v_lunch_start - v_entry) + (v_exit - v_lunch_end))) / 60
    )::integer;
    v_raw_bank := v_worked_minutes - v_scheduled_minutes;
    v_bank := CASE
      WHEN v_max_deviation <= 5 AND v_abs_deviation <= 10 THEN 0
      ELSE v_raw_bank
    END;
    v_status := 'completo';
  ELSIF v_punch_count > 0 THEN
    v_status := 'em_andamento';
  ELSIF p_work_date < (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date AND v_iso_day BETWEEN 1 AND 5 THEN
    v_status := 'sem_registro';
  ELSE
    v_status := 'pendente';
  END IF;

  RETURN jsonb_build_object(
    'work_date', p_work_date,
    'weekday', v_iso_day,
    'scheduled_minutes', v_scheduled_minutes,
    'worked_minutes', v_worked_minutes,
    'bank_minutes', v_bank,
    'raw_bank_minutes', v_raw_bank,
    'late_minutes', v_late,
    'early_departure_minutes', v_early_departure,
    'tolerance_applied', v_punch_count = 4 AND v_max_deviation <= 5 AND v_abs_deviation <= 10,
    'status', v_status,
    'punches', v_punches
  );
END;
$$;
REVOKE ALL ON FUNCTION public.time_clock_day_summary(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_clock_day_summary(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.register_time_clock_punch(
  p_punch_type text,
  p_photo_path text,
  p_client_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_employee public.internal_users%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_work_date date;
  v_iso_day integer;
  v_expected_time time;
  v_expected_at timestamptz;
  v_deviation integer;
  v_classification text;
  v_expected_type text;
  v_existing_count integer;
  v_punch_id uuid;
  v_title text;
  v_message text;
BEGIN
  SELECT employee.* INTO v_employee
  FROM public.internal_users employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.role = 'vendedor'
    AND employee.status = 'ativo'
  LIMIT 1;

  IF v_employee.id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem registrar o ponto.';
  END IF;
  IF NOT v_employee.time_clock_enabled THEN
    RAISE EXCEPTION 'O controle de ponto ainda não foi ativado para o seu cadastro.';
  END IF;
  IF p_punch_type NOT IN ('entrada', 'inicio_intervalo', 'fim_intervalo', 'saida') THEN
    RAISE EXCEPTION 'Tipo de marcação inválido.';
  END IF;
  IF nullif(trim(coalesce(p_photo_path, '')), '') IS NULL
     OR p_photo_path NOT LIKE auth.uid()::text || '/%' THEN
    RAISE EXCEPTION 'A foto obrigatória não pertence ao usuário autenticado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects object
    WHERE object.bucket_id = 'time-clock-photos' AND object.name = p_photo_path
  ) THEN
    RAISE EXCEPTION 'Envie a foto antes de confirmar o registro.';
  END IF;

  v_work_date := (v_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_iso_day := extract(isodow FROM v_work_date)::integer;
  IF v_iso_day NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'A jornada cadastrada funciona de segunda a sexta-feira.';
  END IF;

  SELECT count(*)::integer INTO v_existing_count
  FROM public.time_clock_punches
  WHERE employee_id = v_employee.id AND work_date = v_work_date;
  v_expected_type := (ARRAY['entrada', 'inicio_intervalo', 'fim_intervalo', 'saida'])[v_existing_count + 1];
  IF v_existing_count >= 4 THEN
    RAISE EXCEPTION 'As quatro marcações de hoje já foram concluídas.';
  END IF;
  IF p_punch_type <> v_expected_type THEN
    RAISE EXCEPTION 'A próxima marcação obrigatória é %.', replace(v_expected_type, '_', ' ');
  END IF;

  v_expected_time := CASE p_punch_type
    WHEN 'entrada' THEN time '08:00'
    WHEN 'inicio_intervalo' THEN time '12:00'
    WHEN 'fim_intervalo' THEN time '13:00'
    WHEN 'saida' THEN CASE WHEN v_iso_day = 5 THEN time '17:30' ELSE time '18:00' END
  END;
  v_expected_at := (v_work_date::timestamp + v_expected_time) AT TIME ZONE 'America/Sao_Paulo';
  v_deviation := round(extract(epoch FROM (v_now - v_expected_at)) / 60)::integer;
  v_classification := CASE
    WHEN abs(v_deviation) <= 5 THEN 'no_horario'
    WHEN p_punch_type IN ('entrada', 'fim_intervalo') AND v_deviation > 5 THEN 'atrasado'
    WHEN p_punch_type IN ('entrada', 'fim_intervalo') AND v_deviation < -5 THEN 'adiantado'
    WHEN p_punch_type IN ('inicio_intervalo', 'saida') AND v_deviation < -5 THEN 'saida_antecipada'
    ELSE 'hora_extra'
  END;

  INSERT INTO public.time_clock_punches (
    employee_id, auth_user_id, work_date, punch_type, punched_at, expected_at,
    deviation_minutes, classification, photo_path, client_metadata
  ) VALUES (
    v_employee.id, auth.uid(), v_work_date, p_punch_type, v_now, v_expected_at,
    v_deviation, v_classification, p_photo_path, coalesce(p_client_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_punch_id;

  v_title := CASE v_classification
    WHEN 'atrasado' THEN 'Ponto registrado com atraso'
    WHEN 'adiantado' THEN 'Parabéns pelo empenho!'
    WHEN 'saida_antecipada' THEN 'Saída antecipada registrada'
    WHEN 'hora_extra' THEN 'Tempo adicional registrado'
    ELSE 'Ponto registrado'
  END;
  v_message := CASE v_classification
    WHEN 'atrasado' THEN format('Registro confirmado às %s, com %s minuto(s) após o horário previsto.', to_char(v_now AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'), abs(v_deviation))
    WHEN 'adiantado' THEN format('Registro confirmado %s minuto(s) antes do horário. Parabéns pelo empenho!', abs(v_deviation))
    WHEN 'saida_antecipada' THEN format('Registro confirmado %s minuto(s) antes do horário previsto.', abs(v_deviation))
    WHEN 'hora_extra' THEN format('Registro confirmado %s minuto(s) após o horário previsto; o saldo será calculado no fechamento do dia.', abs(v_deviation))
    ELSE format('Registro confirmado às %s dentro da tolerância da jornada.', to_char(v_now AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'))
  END;

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
  VALUES (auth.uid(), v_title, v_message, 'controle_ponto', 'amarelo', '/vendedor/ponto');

  RETURN jsonb_build_object(
    'punch_id', v_punch_id,
    'classification', v_classification,
    'deviation_minutes', v_deviation,
    'message', v_message,
    'email_notification_required', v_classification <> 'no_horario',
    'day', public.time_clock_day_summary(v_employee.id, v_work_date)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.register_time_clock_punch(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_time_clock_punch(text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_time_clock_dashboard(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee public.internal_users%ROWTYPE;
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_from date;
  v_to date;
  v_day date;
  v_history jsonb := '[]'::jsonb;
  v_today_summary jsonb;
  v_next_type text;
  v_count integer;
  v_balance integer := 0;
BEGIN
  SELECT employee.* INTO v_employee
  FROM public.internal_users employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.role = 'vendedor'
    AND employee.status = 'ativo'
  LIMIT 1;
  IF v_employee.id IS NULL THEN
    RAISE EXCEPTION 'Cadastro de vendedor ativo não encontrado.';
  END IF;

  v_to := least(coalesce(p_to, v_today), v_today);
  v_from := greatest(coalesce(p_from, date_trunc('month', v_to)::date), v_to - 62);
  IF v_from > v_to THEN RAISE EXCEPTION 'Período inválido.'; END IF;

  FOR v_day IN
    SELECT day::date FROM generate_series(v_from, v_to, interval '1 day') day
    WHERE extract(isodow FROM day) BETWEEN 1 AND 5
    ORDER BY day DESC
  LOOP
    v_history := v_history || jsonb_build_array(public.time_clock_day_summary(v_employee.id, v_day));
  END LOOP;

  v_today_summary := public.time_clock_day_summary(v_employee.id, v_today);
  v_count := jsonb_array_length(v_today_summary -> 'punches');
  v_next_type := CASE WHEN extract(isodow FROM v_today) BETWEEN 1 AND 5 AND v_count < 4
    THEN (ARRAY['entrada', 'inicio_intervalo', 'fim_intervalo', 'saida'])[v_count + 1]
    ELSE NULL END;

  SELECT coalesce(sum((summary ->> 'bank_minutes')::integer), 0)::integer INTO v_balance
  FROM (
    SELECT public.time_clock_day_summary(v_employee.id, dates.work_date) AS summary
    FROM (SELECT DISTINCT work_date FROM public.time_clock_punches WHERE employee_id = v_employee.id) dates
  ) totals
  WHERE summary ->> 'bank_minutes' IS NOT NULL;

  RETURN jsonb_build_object(
    'enabled', v_employee.time_clock_enabled,
    'employee', jsonb_build_object('id', v_employee.id, 'name', v_employee.full_name, 'seller_type', v_employee.seller_type),
    'timezone', 'America/Sao_Paulo',
    'tolerance', jsonb_build_object('per_punch_minutes', 5, 'daily_minutes', 10),
    'schedule', jsonb_build_object(
      'monday_thursday', jsonb_build_array('08:00', '12:00', '13:00', '18:00'),
      'friday', jsonb_build_array('08:00', '12:00', '13:00', '17:30')
    ),
    'bank_balance_minutes', v_balance,
    'next_punch_type', v_next_type,
    'today', v_today_summary,
    'history', v_history
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_time_clock_dashboard(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_time_clock_dashboard(date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_admin_time_clock_history(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_from date;
  v_to date;
  v_employee record;
  v_day date;
  v_summary jsonb;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master')) THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar o histórico de ponto.';
  END IF;
  v_to := least(coalesce(p_to, v_today), v_today);
  v_from := greatest(coalesce(p_from, date_trunc('month', v_to)::date), v_to - 62);
  IF v_from > v_to THEN RAISE EXCEPTION 'Período inválido.'; END IF;

  FOR v_employee IN
    SELECT id, full_name, email, seller_type, status, time_clock_enabled
    FROM public.internal_users
    WHERE role = 'vendedor' AND status <> 'excluido'
      AND (p_employee_id IS NULL OR id = p_employee_id)
    ORDER BY full_name
  LOOP
    FOR v_day IN
      SELECT day::date FROM generate_series(v_from, v_to, interval '1 day') day
      WHERE extract(isodow FROM day) BETWEEN 1 AND 5
      ORDER BY day DESC
    LOOP
      v_summary := public.time_clock_day_summary(v_employee.id, v_day);
      IF v_employee.time_clock_enabled OR jsonb_array_length(v_summary -> 'punches') > 0 THEN
        v_rows := v_rows || jsonb_build_array(v_summary || jsonb_build_object(
          'employee_id', v_employee.id,
          'employee_name', v_employee.full_name,
          'employee_email', v_employee.email,
          'seller_type', v_employee.seller_type,
          'employee_status', v_employee.status,
          'time_clock_enabled', v_employee.time_clock_enabled
        ));
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('from', v_from, 'to', v_to, 'rows', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_time_clock_history(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_time_clock_history(date, date, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_seller_time_clock_enabled(
  p_employee_id uuid,
  p_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before boolean;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master')) THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar o controle de ponto.';
  END IF;
  SELECT time_clock_enabled INTO v_before
  FROM public.internal_users WHERE id = p_employee_id AND role = 'vendedor';
  IF NOT FOUND THEN RAISE EXCEPTION 'Vendedor não encontrado.'; END IF;

  UPDATE public.internal_users SET time_clock_enabled = p_enabled, updated_at = clock_timestamp()
  WHERE id = p_employee_id AND role = 'vendedor';

  INSERT INTO public.internal_audit_logs (
    actor_user_id, actor_role, action, table_name, record_id, before, after
  ) VALUES (
    auth.uid(), coalesce(public.get_internal_role(auth.uid())::text, 'admin'),
    'alterar_controle_ponto', 'internal_users', p_employee_id,
    jsonb_build_object('time_clock_enabled', v_before),
    jsonb_build_object('time_clock_enabled', p_enabled)
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_seller_time_clock_enabled(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_seller_time_clock_enabled(uuid, boolean) TO authenticated, service_role;

