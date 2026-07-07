-- Function to create demo user safely
CREATE OR REPLACE FUNCTION public.create_demo_user(
    p_email TEXT,
    p_password TEXT,
    p_name TEXT,
    p_role TEXT,
    p_status TEXT,
    p_telefone TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Check if user exists
    SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
    
    IF v_user_id IS NULL THEN
        -- Create user
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
        VALUES (
            v_user_id,
            p_email,
            crypt(p_password, gen_salt('bf')),
            now(),
            jsonb_build_object('role', p_role)
        );
    END IF;

    -- Upsert profile
    INSERT INTO public.profiles (id, nome, role, status, email, telefone)
    VALUES (v_user_id, p_name, p_role::public.user_role, p_status, p_email, p_telefone)
    ON CONFLICT (id) DO UPDATE SET
        nome = EXCLUDED.nome,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        email = EXCLUDED.email,
        telefone = EXCLUDED.telefone;

    -- Specific logic for corretores
    IF p_role = 'corretor' THEN
        INSERT INTO public.corretores (profile_id, creci, comissao_pct, pix)
        VALUES (v_user_id, '12345-F-SC', 7.0, p_email)
        ON CONFLICT (profile_id) DO NOTHING;
    END IF;

    -- Specific logic for imobiliarias
    IF p_role = 'imobiliaria' THEN
        INSERT INTO public.imobiliarias (razao_social, cnpj, creci, comissao_pct, contato_email, contato_nome)
        VALUES (p_name || ' LTDA', '12.345.678/0001-90', 'J-12345-SC', 3.0, p_email, p_name)
        ON CONFLICT (cnpj) DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Execute for all demo users
SELECT public.create_demo_user('admin@nox.com', 'nox12345', 'Administrador NOX', 'admin', 'ativo');
SELECT public.create_demo_user('corretor@nox.com', 'nox12345', 'Carlos Mendes', 'corretor', 'ativo', '(48) 99999-1111');
SELECT public.create_demo_user('imobiliaria@nox.com', 'nox12345', 'Vértice Imobiliária', 'imobiliaria', 'ativo', '(48) 99999-2222');

-- Cleanup function (optional but good practice)
DROP FUNCTION IF EXISTS public.create_demo_user;
