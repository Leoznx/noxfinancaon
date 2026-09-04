-- Restringe dados pessoais de profiles a usuários relacionados e mantém a
-- consulta pública de indicação limitada somente ao primeiro nome.

CREATE OR REPLACE FUNCTION public.can_view_profile(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT _viewer IS NOT NULL
    AND _target IS NOT NULL
    AND _viewer = auth.uid()
    AND (
      _viewer = _target
      OR public.is_admin(_viewer)
      OR public.is_internal(_viewer)
      OR public.eh_dono_ou_imobiliaria_da_consulta(_target)
      OR EXISTS (
        SELECT 1
        FROM public.referrals r
        WHERE (r.referrer_user_id = _viewer AND r.referred_user_id = _target)
           OR (r.referred_user_id = _viewer AND r.referrer_user_id = _target)
      )
      OR EXISTS (
        SELECT 1
        FROM public.consultas_credito q
        LEFT JOIN public.profiles target_profile ON target_profile.id = _target
        WHERE (
          q.profile_id_solicitante = _target
          OR q.tenant_user_id = _target
          OR q.billing_responsible_user_id = _target
          OR (
            target_profile.email IS NOT NULL
            AND q.tenant_email IS NOT NULL
            AND lower(trim(q.tenant_email)) = lower(trim(target_profile.email))
          )
        )
        AND (
          public.eh_dono_ou_imobiliaria_da_consulta(q.profile_id_solicitante)
          OR q.tenant_user_id = _viewer
          OR q.billing_responsible_user_id = _viewer
          OR q.tenant_email = (SELECT viewer_profile.email FROM public.profiles viewer_profile WHERE viewer_profile.id = _viewer)
          OR public.eh_staff_interno_consultas()
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.apolices a
        LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
        LEFT JOIN public.imoveis im ON im.id = q.imovel_id
        LEFT JOIN public.proprietarios prop ON prop.id = im.proprietario_id
        WHERE (
          a.corretor_profile_id = _target
          OR a.imobiliaria_profile_id = _target
          OR a.proprietario_profile_id = _target
          OR prop.profile_id = _target
          OR q.profile_id_solicitante = _target
          OR q.tenant_user_id = _target
          OR q.billing_responsible_user_id = _target
        )
        AND public.can_view_policy(_viewer, a.id)
      )
    )
$$;
REVOKE ALL ON FUNCTION public.can_view_profile(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid, uuid) TO authenticated, service_role;
DROP POLICY IF EXISTS "App reads profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authorized users read related profiles" ON public.profiles;
CREATE POLICY "Authorized users read related profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.can_view_profile(auth.uid(), id));
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
CREATE OR REPLACE FUNCTION public.get_referrer_public_name(p_referral_code text)
RETURNS TABLE(first_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
ROWS 1
AS $$
  SELECT nullif(split_part(trim(coalesce(p.nome, '')), ' ', 1), '') AS first_name
  FROM public.profiles p
  WHERE p_referral_code IS NOT NULL
    AND char_length(trim(p_referral_code)) BETWEEN 4 AND 80
    AND lower(trim(p.referral_code)) = lower(trim(p_referral_code))
    AND p.status = 'ativo'
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_referrer_public_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referrer_public_name(text) TO anon, authenticated, service_role;
