-- Update user_role enum
DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM ('admin', 'imobiliaria', 'corretor', 'proprietario', 'inquilino', 'analista');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Create proprietarios table if not exists
CREATE TABLE IF NOT EXISTS public.proprietarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  cpf_cnpj text NOT NULL,
  banco text,
  agencia text,
  conta text,
  tipo_conta text DEFAULT 'corrente',
  pix text,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.proprietarios ENABLE ROW LEVEL SECURITY;

-- Safely create demo users function
CREATE OR REPLACE FUNCTION public.seed_demo_user(
    p_email TEXT,
    p_password TEXT,
    p_name TEXT,
    p_role TEXT
) RETURNS VOID AS $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
    
    IF v_user_id IS NULL THEN
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

    INSERT INTO public.profiles (id, nome, role, status, email)
    VALUES (v_user_id, p_name, p_role::public.user_role, 'ativo', p_email)
    ON CONFLICT (id) DO UPDATE SET role = p_role::public.user_role, status = 'ativo';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Seed all 4 demo users
SELECT public.seed_demo_user('admin@nox.com', 'nox12345', 'Admin NOX', 'admin');
SELECT public.seed_demo_user('imobiliaria@nox.com', 'nox12345', 'Vértice Imobiliária', 'imobiliaria');
SELECT public.seed_demo_user('corretor@nox.com', 'nox12345', 'Carlos Mendes', 'corretor');
SELECT public.seed_demo_user('proprietario@nox.com', 'nox12345', 'Maria Silva', 'proprietario');

-- Clean up helper function
DROP FUNCTION public.seed_demo_user;
