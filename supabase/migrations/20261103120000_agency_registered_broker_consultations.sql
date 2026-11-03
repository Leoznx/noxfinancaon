-- A imobiliaria deve acompanhar as consultas feitas somente pelos corretores
-- atualmente cadastrados nela. A versao anterior repetia a identificacao da
-- agencia por igualdade exata de e-mail dentro da RLS. Isso divergia de
-- current_imobiliaria_id(), que normaliza o e-mail, e fazia a consulta propria
-- aparecer enquanto as consultas da equipe eram ocultadas.

CREATE OR REPLACE FUNCTION public.eh_dono_ou_imobiliaria_da_consulta(
  p_profile_id_solicitante uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT p_profile_id_solicitante IS NOT NULL
    AND (
      p_profile_id_solicitante = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.corretores AS broker
        WHERE broker.profile_id = p_profile_id_solicitante
          AND broker.imobiliaria_id = public.current_imobiliaria_id()
      )
    );
$$;

REVOKE ALL ON FUNCTION public.eh_dono_ou_imobiliaria_da_consulta(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eh_dono_ou_imobiliaria_da_consulta(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.eh_dono_ou_imobiliaria_da_consulta(uuid) IS
  'Autoriza o solicitante, ou a imobiliaria autenticada quando o solicitante e um corretor atualmente vinculado a ela por corretores.imobiliaria_id.';
