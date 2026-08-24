-- Permite remover o acesso de um colaborador sem apagar o histórico financeiro
-- e operacional que ainda referencia o cadastro interno.
ALTER TYPE public.internal_user_status ADD VALUE IF NOT EXISTS 'excluido';

