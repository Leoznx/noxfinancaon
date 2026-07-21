-- Important, actionable notifications by role.
-- Every notification inserted here reuses the existing notificacoes -> Expo
-- push trigger, so the same alert appears in the app and on registered devices.

CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS lembrete_agenda boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS novos_leads boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS documentos_pendentes boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contratos_fechados boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS aprovacoes_pendentes boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS chamados_importantes boolean NOT NULL DEFAULT true;

-- A single event can target several users, but each user receives it only once.
CREATE TABLE IF NOT EXISTS public.important_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES public.notificacoes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_key, user_id)
);

CREATE INDEX IF NOT EXISTS important_notification_events_created_idx
  ON public.important_notification_events(created_at DESC);

ALTER TABLE public.important_notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.important_notification_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.important_notification_events TO service_role;

CREATE OR REPLACE FUNCTION public.important_notification_recipients(p_roles text[])
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id
  FROM public.profiles p
  WHERE p.role::text = ANY(p_roles)
    AND COALESCE(p.status::text, 'ativo') = 'ativo'
  UNION
  SELECT u.auth_user_id
  FROM public.internal_users u
  WHERE u.auth_user_id IS NOT NULL
    AND u.role::text = ANY(p_roles)
    AND COALESCE(u.status::text, 'ativo') = 'ativo';
$$;

REVOKE ALL ON FUNCTION public.important_notification_recipients(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.important_notification_recipients(text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_important_notification(
  p_event_key text,
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text,
  p_color text,
  p_link text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
  v_notification_id uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.important_notification_events (event_key, user_id)
  VALUES (p_event_key, p_user_id)
  ON CONFLICT (event_key, user_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
  VALUES (p_user_id, p_title, p_message, p_type, p_color, p_link)
  RETURNING id INTO v_notification_id;

  UPDATE public.important_notification_events
  SET notification_id = v_notification_id
  WHERE id = v_event_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_important_notification(text, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_important_notification(text, uuid, text, text, text, text, text)
  TO service_role;

-- Seller appointments: dispatch the reminder chosen in the agenda.
CREATE OR REPLACE FUNCTION public.process_due_seller_appointment_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment record;
  v_delivered integer := 0;
  v_message text;
BEGIN
  FOR v_appointment IN
    SELECT
      appointment.id,
      appointment.title,
      appointment.scheduled_at,
      appointment.reminder_minutes,
      internal_user.auth_user_id,
      lead.full_name AS lead_name
    FROM public.seller_appointments appointment
    JOIN public.internal_users internal_user ON internal_user.id = appointment.seller_id
    LEFT JOIN public.sales_leads lead ON lead.id = appointment.lead_id
    WHERE appointment.reminder_minutes IS NOT NULL
      AND appointment.reminder_minutes >= 0
      AND appointment.status::text IN ('agendado', 'confirmado', 'remarcado')
      AND appointment.scheduled_at >= now() - interval '5 minutes'
      AND appointment.scheduled_at
            - make_interval(mins => appointment.reminder_minutes) <= now()
      AND internal_user.auth_user_id IS NOT NULL
      AND COALESCE(internal_user.status::text, 'ativo') = 'ativo'
      AND NOT EXISTS (
        SELECT 1
        FROM public.notification_preferences preference
        WHERE preference.user_id = internal_user.auth_user_id
          AND preference.lembrete_agenda = false
      )
    ORDER BY appointment.scheduled_at
    LIMIT 500
  LOOP
    v_message := CASE
      WHEN v_appointment.reminder_minutes = 0
        THEN 'Seu compromisso "' || v_appointment.title || '" comeÃ§a agora.'
      ELSE 'Seu compromisso "' || v_appointment.title || '" serÃ¡ Ã s ' ||
        to_char(v_appointment.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') || '.'
    END;

    IF v_appointment.lead_name IS NOT NULL THEN
      v_message := v_message || ' Cliente: ' || v_appointment.lead_name || '.';
    END IF;

    IF public.enqueue_important_notification(
      'agenda:' || v_appointment.id || ':' ||
        extract(epoch FROM v_appointment.scheduled_at)::bigint || ':' ||
        v_appointment.reminder_minutes,
      v_appointment.auth_user_id,
      CASE WHEN v_appointment.reminder_minutes = 0
        THEN 'Compromisso agora'
        ELSE 'Lembrete de compromisso'
      END,
      v_message,
      'agenda_lembrete',
      'azul',
      '/vendedor/agenda'
    ) THEN
      v_delivered := v_delivered + 1;
    END IF;
  END LOOP;

  DELETE FROM public.important_notification_events
  WHERE created_at < now() - interval '180 days';

  RETURN v_delivered;
END;
$$;

REVOKE ALL ON FUNCTION public.process_due_seller_appointment_reminders()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_seller_appointment_reminders() TO service_role;

SELECT cron.schedule(
  'nox-dispatch-appointment-reminders',
  '* * * * *',
  'SELECT public.process_due_seller_appointment_reminders();'
);

-- A verification document submitted by a new professional requires admin action.
CREATE OR REPLACE FUNCTION public.notify_admin_document_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient record;
  v_name text;
  v_role text;
  v_document text;
  v_submission_key text;
BEGIN
  IF NEW.verification_status::text NOT IN ('enviado', 'em_analise') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status
       AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT COALESCE(NULLIF(trim(profile.nome), ''), 'Novo usuÃ¡rio'), profile.role::text
  INTO v_name, v_role
  FROM public.profiles profile
  WHERE profile.id = NEW.user_id;

  v_document := CASE lower(COALESCE(NEW.document_type::text, 'documento'))
    WHEN 'cnh' THEN 'CNH'
    WHEN 'rg' THEN 'RG'
    ELSE replace(COALESCE(NEW.document_type::text, 'documento'), '_', ' ')
  END;
  v_submission_key := COALESCE(NEW.submitted_at, NEW.created_at, now())::text;

  FOR v_recipient IN
    SELECT user_id
    FROM public.important_notification_recipients(ARRAY['admin', 'admin_master'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_preferences preference
      WHERE preference.user_id = v_recipient.user_id
        AND preference.documentos_pendentes = false
    ) THEN
      PERFORM public.enqueue_important_notification(
        'documento:' || NEW.id || ':' || v_submission_key,
        v_recipient.user_id,
        'Novo documento para aprovaÃ§Ã£o',
        v_name || ' enviou ' || v_document || ' e aguarda aprovaÃ§Ã£o' ||
          CASE WHEN v_role IS NULL THEN '.' ELSE ' como ' || replace(v_role, '_', ' ') || '.' END,
        'documento_pendente',
        'amarelo',
        '/admin/verificacoes'
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_document_submitted ON public.verificacoes_documento;
CREATE TRIGGER trg_notify_admin_document_submitted
AFTER INSERT OR UPDATE OF verification_status, submitted_at ON public.verificacoes_documento
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_document_submitted();

-- Contract activation is important to admins and finance. The message names
-- both who closed it and the tenant whose contract became active.
CREATE OR REPLACE FUNCTION public.notify_staff_contract_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient record;
  v_tenant_name text;
  v_closer_name text;
  v_message text;
BEGIN
  IF lower(COALESCE(NEW.status::text, '')) NOT IN ('ativa', 'ativo', 'active') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF lower(COALESCE(OLD.status::text, '')) IN ('ativa', 'ativo', 'active') THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT
    COALESCE(NULLIF(trim(credit.tenant_name), ''), 'cliente nÃ£o informado'),
    COALESCE(NULLIF(trim(profile.nome), ''), 'Um parceiro')
  INTO v_tenant_name, v_closer_name
  FROM public.consultas_credito credit
  LEFT JOIN public.profiles profile ON profile.id = credit.profile_id_solicitante
  WHERE credit.id = NEW.consulta_id;

  v_message := v_closer_name || ' fechou o contrato de ' || v_tenant_name ||
    CASE WHEN NULLIF(trim(COALESCE(NEW.numero::text, '')), '') IS NULL
      THEN '.' ELSE ' (nÂº ' || NEW.numero::text || ').' END;

  FOR v_recipient IN
    SELECT user_id
    FROM public.important_notification_recipients(ARRAY['admin', 'admin_master'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_preferences preference
      WHERE preference.user_id = v_recipient.user_id
        AND preference.contratos_fechados = false
    ) THEN
      PERFORM public.enqueue_important_notification(
        'contrato-fechado:' || NEW.id,
        v_recipient.user_id,
        'Novo contrato fechado',
        v_message,
        'contrato_fechado',
        'verde',
        '/admin/contratos'
      );
    END IF;
  END LOOP;

  FOR v_recipient IN
    SELECT user_id
    FROM public.important_notification_recipients(ARRAY['financeiro'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_preferences preference
      WHERE preference.user_id = v_recipient.user_id
        AND preference.contratos_fechados = false
    ) THEN
      PERFORM public.enqueue_important_notification(
        'contrato-financeiro:' || NEW.id,
        v_recipient.user_id,
        'Novo contrato ativo',
        v_message,
        'contrato_fechado',
        'verde',
        '/admin/financeiro'
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_staff_contract_closed ON public.apolices;
CREATE TRIGGER trg_notify_staff_contract_closed
AFTER INSERT OR UPDATE OF status ON public.apolices
FOR EACH ROW EXECUTE FUNCTION public.notify_staff_contract_closed();

-- Leads are actionable for the assigned seller and for marketing.
CREATE OR REPLACE FUNCTION public.notify_important_sales_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient record;
  v_seller_user_id uuid;
  v_lead_name text := COALESCE(NULLIF(trim(NEW.full_name), ''), 'Novo contato');
  v_assignment_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_assignment_changed := true;
  ELSE
    v_assignment_changed := NEW.assigned_seller_id IS DISTINCT FROM OLD.assigned_seller_id;
  END IF;

  IF NEW.assigned_seller_id IS NOT NULL AND v_assignment_changed THEN
    SELECT internal_user.auth_user_id INTO v_seller_user_id
    FROM public.internal_users internal_user
    WHERE internal_user.id = NEW.assigned_seller_id
      AND COALESCE(internal_user.status::text, 'ativo') = 'ativo';

    IF v_seller_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.notification_preferences preference
      WHERE preference.user_id = v_seller_user_id
        AND preference.novos_leads = false
    ) THEN
      PERFORM public.enqueue_important_notification(
        'lead-vendedor:' || NEW.id || ':' || NEW.assigned_seller_id,
        v_seller_user_id,
        'Novo lead atribuÃ­do',
        v_lead_name || ' estÃ¡ aguardando seu atendimento.',
        'lead_novo',
        'amarelo',
        '/vendedor/leads'
      );
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    FOR v_recipient IN
      SELECT user_id
      FROM public.important_notification_recipients(ARRAY['marketing'])
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notification_preferences preference
        WHERE preference.user_id = v_recipient.user_id
          AND preference.novos_leads = false
      ) THEN
        PERFORM public.enqueue_important_notification(
          'lead-marketing:' || NEW.id,
          v_recipient.user_id,
          'Novo lead recebido',
          v_lead_name || ' entrou na base de atendimento.',
          'lead_novo',
          'azul',
          '/admin/leads'
        );
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_important_sales_lead ON public.sales_leads;
CREATE TRIGGER trg_notify_important_sales_lead
AFTER INSERT OR UPDATE OF assigned_seller_id ON public.sales_leads
FOR EACH ROW EXECUTE FUNCTION public.notify_important_sales_lead();

-- Complementary documents sent for a credit decision require legal/admin action.
CREATE OR REPLACE FUNCTION public.notify_staff_approval_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient record;
  v_tenant_name text := COALESCE(NULLIF(trim(NEW.tenant_name), ''), 'Cliente nÃ£o informado');
BEGIN
  IF NEW.status::text NOT IN ('pendente', 'em_analise')
     OR NEW.substatus::text <> 'documentacao_complementar_enviada' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.substatus IS NOT DISTINCT FROM OLD.substatus THEN
      RETURN NEW;
    END IF;
  END IF;

  FOR v_recipient IN
    SELECT user_id
    FROM public.important_notification_recipients(ARRAY['admin', 'admin_master', 'juridico'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_preferences preference
      WHERE preference.user_id = v_recipient.user_id
        AND preference.aprovacoes_pendentes = false
    ) THEN
      PERFORM public.enqueue_important_notification(
        'aprovacao-pendente:' || NEW.id || ':' || NEW.substatus::text,
        v_recipient.user_id,
        'Nova anÃ¡lise aguardando decisÃ£o',
        'A documentaÃ§Ã£o de ' || v_tenant_name || ' estÃ¡ pronta para revisÃ£o.',
        'aprovacao_pendente',
        'amarelo',
        '/admin/aprovacoes'
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_staff_approval_pending ON public.consultas_credito;
CREATE TRIGGER trg_notify_staff_approval_pending
AFTER INSERT OR UPDATE OF status, substatus ON public.consultas_credito
FOR EACH ROW EXECUTE FUNCTION public.notify_staff_approval_pending();

-- The requester is notified when the automated or manual credit result is final.
CREATE OR REPLACE FUNCTION public.notify_credit_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result text;
  v_old_result text;
  v_tenant_name text := COALESCE(NULLIF(trim(NEW.tenant_name), ''), 'seu cliente');
BEGIN
  IF NEW.profile_id_solicitante IS NULL THEN RETURN NEW; END IF;
  v_result := lower(COALESCE(NULLIF(NEW.resultado::text, ''), NULLIF(NEW.status::text, ''), ''));
  IF v_result NOT IN ('aprovado', 'recusado', 'reprovado', 'em_analise') THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_result := lower(COALESCE(NULLIF(OLD.resultado::text, ''), NULLIF(OLD.status::text, ''), ''));
    IF v_result = v_old_result THEN RETURN NEW; END IF;
  END IF;

  IF v_result = 'aprovado' AND EXISTS (
    SELECT 1 FROM public.notification_preferences preference
    WHERE preference.user_id = NEW.profile_id_solicitante
      AND preference.consulta_pre_aprovada = false
  ) THEN RETURN NEW; END IF;

  PERFORM public.enqueue_important_notification(
    'consulta-resultado:' || NEW.id || ':' || v_result,
    NEW.profile_id_solicitante,
    CASE
      WHEN v_result = 'aprovado' THEN 'Consulta aprovada'
      WHEN v_result IN ('recusado', 'reprovado') THEN 'Consulta recusada'
      ELSE 'Consulta em anÃ¡lise'
    END,
    CASE
      WHEN v_result = 'aprovado' THEN 'A consulta de ' || v_tenant_name || ' foi aprovada.'
      WHEN v_result IN ('recusado', 'reprovado') THEN 'A consulta de ' || v_tenant_name || ' nÃ£o foi aprovada.'
      ELSE 'A consulta de ' || v_tenant_name || ' precisa de anÃ¡lise complementar.'
    END,
    CASE
      WHEN v_result = 'aprovado' THEN 'consulta_aprovada'
      WHEN v_result IN ('recusado', 'reprovado') THEN 'consulta_recusada'
      ELSE 'consulta_em_analise'
    END,
    CASE WHEN v_result = 'aprovado' THEN 'verde'
         WHEN v_result IN ('recusado', 'reprovado') THEN 'vermelho'
         ELSE 'amarelo' END,
    '/consulta/' || NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_credit_result ON public.consultas_credito;
CREATE TRIGGER trg_notify_credit_result
AFTER INSERT OR UPDATE OF status, resultado ON public.consultas_credito
FOR EACH ROW EXECUTE FUNCTION public.notify_credit_result();

-- New support tickets alert support; only meaningful resolution changes alert the requester.
CREATE OR REPLACE FUNCTION public.notify_important_support_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient record;
  v_requester_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(NULLIF(trim(profile.nome), ''), 'UsuÃ¡rio') INTO v_requester_name
    FROM public.profiles profile WHERE profile.id = NEW.user_id;

    FOR v_recipient IN
      SELECT user_id
      FROM public.important_notification_recipients(ARRAY['suporte'])
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notification_preferences preference
        WHERE preference.user_id = v_recipient.user_id
          AND preference.chamados_importantes = false
      ) THEN
        PERFORM public.enqueue_important_notification(
          'chamado-novo:' || NEW.id,
          v_recipient.user_id,
          CASE WHEN NEW.priority::text = 'urgente' THEN 'Novo chamado urgente' ELSE 'Novo chamado' END,
          COALESCE(v_requester_name, 'UsuÃ¡rio') || ': ' || NEW.subject::text,
          'chamado_novo',
          CASE WHEN NEW.priority::text = 'urgente' THEN 'vermelho' ELSE 'azul' END,
          '/suporte'
        );
      END IF;
    END LOOP;
  ELSIF NEW.status IS DISTINCT FROM OLD.status
        AND NEW.status::text IN ('encaminhado', 'resolvido', 'fechado') THEN
    PERFORM public.enqueue_important_notification(
      'chamado-status:' || NEW.id || ':' || NEW.status::text,
      NEW.user_id,
      'Chamado atualizado',
      'Seu chamado "' || NEW.subject::text || '" foi ' || replace(NEW.status::text, '_', ' ') || '.',
      'chamado_atualizado',
      CASE WHEN NEW.status::text IN ('resolvido', 'fechado') THEN 'verde' ELSE 'amarelo' END,
      '/suporte'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_important_support_ticket ON public.support_tickets;
CREATE TRIGGER trg_notify_important_support_ticket
AFTER INSERT OR UPDATE OF status ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.notify_important_support_ticket();
