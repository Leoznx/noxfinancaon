-- This migration-only helper can write directly to auth.users. It must never be
-- callable by an end-user JWT, even if an older default privilege granted it.
REVOKE ALL ON FUNCTION public.ensure_nox_demo_auth_user(
  text,
  text,
  text,
  public.user_role,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_nox_demo_auth_user(
  text,
  text,
  text,
  public.user_role,
  text
) TO service_role;
