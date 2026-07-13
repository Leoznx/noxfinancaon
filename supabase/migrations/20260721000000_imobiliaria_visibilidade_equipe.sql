-- =============================================================================
-- Imobiliária como "conta mãe": precisa enxergar o que os corretores vinculados
-- fazem (consultas, contratos, sinistros) e ser notificada em tempo real disso.
--
-- Achado importante nesta investigação: apolices.corretor_profile_id/
-- imobiliaria_profile_id/proprietario_profile_id NUNCA são preenchidas pelo
-- fluxo real de criação de apólice (confirmado antes em
-- src/lib/niveis-parceria.ts) — o vínculo de verdade é sempre
-- apolices.consulta_id -> consultas_credito.profile_id_solicitante. A RLS de
-- apolices (can_view_policy, ver 20260719000000_manual_withdrawals_schema.sql)
-- já cobria "o próprio dono da consulta" via q.profile_id_solicitante = _uid,
-- mas não cobria "a imobiliária dona do corretor que solicitou" — só
-- consultas_credito tinha essa regra (eh_dono_ou_imobiliaria_da_consulta, ver
-- 20260709170000_consultas_credito_rls_hardening.sql). Estende can_view_policy
-- pra reaproveitar a mesma função em vez de duplicar a lógica.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_view_policy(_uid uuid, _policy_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.apolices a
    LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
    WHERE a.id = _policy_id
      AND (
        a.corretor_profile_id = _uid
        OR a.imobiliaria_profile_id = _uid
        OR a.proprietario_profile_id = _uid
        OR q.profile_id_solicitante = _uid
        OR q.tenant_user_id = _uid
        OR q.billing_responsible_user_id = _uid
        OR (q.profile_id_solicitante IS NOT NULL AND public.eh_dono_ou_imobiliaria_da_consulta(q.profile_id_solicitante))
        OR public.can_manage_withdrawals(_uid, 'view')
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = _uid AND p.role::text IN ('analista', 'juridico')
        )
        OR public.has_internal_role(_uid, 'juridico'::public.internal_role)
      )
  )
$$;

-- =============================================================================
-- Notificações automáticas pra imobiliária quando um corretor vinculado a ela
-- tem uma consulta aprovada/recusada, fecha um contrato ou abre um sinistro.
-- Feito via trigger (não client-side) de propósito: cobre qualquer caminho que
-- muda esses dados (painel admin, automação CredPago/webhook, etc.), sem
-- depender de cada tela lembrar de notificar. A notificação do próprio
-- corretor continua como já era (ex.: notificarSolicitante em
-- admin.aprovacoes.tsx) — isso aqui só adiciona uma segunda notificação, pra
-- imobiliária, quando aplicável.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.imobiliaria_profile_id_do_corretor(p_profile_id_corretor uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id
  FROM public.corretores c
  JOIN public.imobiliarias i ON i.id = c.imobiliaria_id
  JOIN public.profiles p ON lower(p.email) = lower(i.contato_email)
  WHERE c.profile_id = p_profile_id_corretor
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.notificar_imobiliaria_consulta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_imob_id uuid;
  v_status text;
  v_old_status text;
  v_corretor_nome text;
BEGIN
  v_status := COALESCE(NULLIF(NEW.resultado, ''), NEW.status);
  IF v_status NOT IN ('aprovado', 'recusado', 'reprovado') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_status := COALESCE(NULLIF(OLD.resultado, ''), OLD.status);
    IF v_old_status = v_status THEN RETURN NEW; END IF;
  END IF;

  v_imob_id := public.imobiliaria_profile_id_do_corretor(NEW.profile_id_solicitante);
  IF v_imob_id IS NULL THEN RETURN NEW; END IF;

  SELECT nome INTO v_corretor_nome FROM public.profiles WHERE id = NEW.profile_id_solicitante;

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
  VALUES (
    v_imob_id,
    CASE WHEN v_status = 'aprovado' THEN 'Consulta aprovada' ELSE 'Consulta recusada' END,
    format(
      '%s: consulta de %s (%s) foi %s.',
      COALESCE(v_corretor_nome, 'Seu corretor'),
      COALESCE(NEW.tenant_name, 'cliente'),
      COALESCE(NEW.tenant_document, '—'),
      CASE WHEN v_status = 'aprovado' THEN 'aprovada' ELSE 'recusada' END
    ),
    CASE WHEN v_status = 'aprovado' THEN 'contrato_aprovado' ELSE 'contrato_reprovado' END,
    CASE WHEN v_status = 'aprovado' THEN 'verde' ELSE 'vermelho' END,
    '/consultas/' || NEW.id || '/resultado'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_imobiliaria_consulta ON public.consultas_credito;
CREATE TRIGGER trg_notificar_imobiliaria_consulta
AFTER INSERT OR UPDATE OF status, resultado ON public.consultas_credito
FOR EACH ROW EXECUTE FUNCTION public.notificar_imobiliaria_consulta();

CREATE OR REPLACE FUNCTION public.notificar_imobiliaria_contrato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_solicitante_id uuid;
  v_tenant_name text;
  v_corretor_nome text;
  v_imob_id uuid;
BEGIN
  IF NEW.status <> 'ativa' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'ativa' THEN RETURN NEW; END IF;

  SELECT profile_id_solicitante, tenant_name INTO v_solicitante_id, v_tenant_name
  FROM public.consultas_credito WHERE id = NEW.consulta_id;
  IF v_solicitante_id IS NULL THEN RETURN NEW; END IF;

  v_imob_id := public.imobiliaria_profile_id_do_corretor(v_solicitante_id);
  IF v_imob_id IS NULL THEN RETURN NEW; END IF;

  SELECT nome INTO v_corretor_nome FROM public.profiles WHERE id = v_solicitante_id;

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
  VALUES (
    v_imob_id,
    'Contrato fechado pela equipe',
    format(
      '%s fechou o contrato #%s%s.',
      COALESCE(v_corretor_nome, 'Um corretor da sua equipe'),
      NEW.numero,
      CASE WHEN v_tenant_name IS NOT NULL THEN ' (' || v_tenant_name || ')' ELSE '' END
    ),
    'contrato_aprovado',
    'verde',
    '/apolices/' || NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_imobiliaria_contrato ON public.apolices;
CREATE TRIGGER trg_notificar_imobiliaria_contrato
AFTER INSERT OR UPDATE OF status ON public.apolices
FOR EACH ROW EXECUTE FUNCTION public.notificar_imobiliaria_contrato();

CREATE OR REPLACE FUNCTION public.notificar_imobiliaria_sinistro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_solicitante_id uuid;
  v_corretor_nome text;
  v_imob_id uuid;
  v_numero text;
BEGIN
  SELECT c.profile_id_solicitante, a.numero INTO v_solicitante_id, v_numero
  FROM public.apolices a
  JOIN public.consultas_credito c ON c.id = a.consulta_id
  WHERE a.id = NEW.apolice_id;
  IF v_solicitante_id IS NULL THEN RETURN NEW; END IF;

  v_imob_id := public.imobiliaria_profile_id_do_corretor(v_solicitante_id);
  IF v_imob_id IS NULL THEN RETURN NEW; END IF;

  SELECT nome INTO v_corretor_nome FROM public.profiles WHERE id = v_solicitante_id;

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
  VALUES (
    v_imob_id,
    'Sinistro aberto pela equipe',
    format('%s abriu um sinistro no contrato #%s.', COALESCE(v_corretor_nome, 'Um corretor da sua equipe'), COALESCE(v_numero, '—')),
    'sistema',
    'amarelo',
    '/sinistros'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_imobiliaria_sinistro ON public.sinistros;
CREATE TRIGGER trg_notificar_imobiliaria_sinistro
AFTER INSERT ON public.sinistros
FOR EACH ROW EXECUTE FUNCTION public.notificar_imobiliaria_sinistro();
