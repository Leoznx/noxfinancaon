CREATE OR REPLACE FUNCTION public.ensure_nox_demo_auth_user(
  p_email text,
  p_password text,
  p_nome text,
  p_role public.user_role,
  p_telefone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
    AND deleted_at IS NULL
  ORDER BY created_at NULLS LAST
  LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      phone_change,
      phone_change_token,
      email_change_token_current,
      email_change_confirm_status,
      reauthentication_token,
      is_sso_user,
      is_anonymous
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      lower(trim(p_email)),
      extensions.crypt(p_password, extensions.gen_salt('bf')),
      v_now,
      '',
      '',
      '',
      '',
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('role', p_role::text, 'nome', p_nome, 'name', p_nome, 'email_verified', true),
      v_now,
      v_now,
      '',
      '',
      '',
      0,
      '',
      false,
      false
    );
  ELSE
    UPDATE auth.users
    SET instance_id = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'),
        aud = 'authenticated',
        role = 'authenticated',
        encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, v_now),
        confirmation_token = coalesce(confirmation_token, ''),
        recovery_token = coalesce(recovery_token, ''),
        email_change_token_new = coalesce(email_change_token_new, ''),
        email_change = coalesce(email_change, ''),
        phone_change = coalesce(phone_change, ''),
        phone_change_token = coalesce(phone_change_token, ''),
        email_change_token_current = coalesce(email_change_token_current, ''),
        email_change_confirm_status = coalesce(email_change_confirm_status, 0),
        reauthentication_token = coalesce(reauthentication_token, ''),
        raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_role::text, 'nome', p_nome, 'name', p_nome, 'email_verified', true),
        is_sso_user = false,
        is_anonymous = false,
        created_at = coalesce(created_at, v_now),
        updated_at = v_now
    WHERE id = v_user_id;
  END IF;

  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at,
    id
  ) VALUES (
    v_user_id::text,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', lower(trim(p_email)), 'email_verified', true, 'phone_verified', false),
    'email',
    v_now,
    v_now,
    v_now,
    gen_random_uuid()
  ) ON CONFLICT (provider_id, provider) DO UPDATE SET
    user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = v_now;

  INSERT INTO public.profiles (id, nome, email, role, telefone, status, updated_at)
  VALUES (v_user_id, p_nome, lower(trim(p_email)), p_role, p_telefone, 'ativo', v_now)
  ON CONFLICT (id) DO UPDATE SET
    nome = excluded.nome,
    email = excluded.email,
    role = excluded.role,
    telefone = excluded.telefone,
    status = 'ativo',
    updated_at = v_now;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_nox_demo_auth_user(text, text, text, public.user_role, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_nox_demo_auth_user(text, text, text, public.user_role, text) TO service_role;