-- =============================================================================
-- profiles.status fica em 'pendente_aprovacao' desde o cadastro de corretor/
-- imobiliária/proprietário (ver auth-signup.functions.ts) até um admin aprovar
-- a verificação de identidade — mas a aba nova de Aprovações de Documentos
-- (admin.verificacoes.tsx) só atualizava verificacoes_documento.verification_status,
-- nunca profiles.status. Resultado real: contas já aprovadas pelo admin
-- continuavam bloqueadas em toda tela que checa status = 'ativo' (ex.:
-- "Vincular corretor" em corretores-admin.lazy.tsx), mesmo com o documento
-- já revisado e aprovado.
--
-- Corrigido no código (aprovar() agora também vira profiles.status='ativo'
-- quando ainda pendente_aprovacao). Esta migration só corrige o estrago já
-- feito: contas que já foram aprovadas antes do fix existir.
-- =============================================================================

UPDATE public.profiles p
SET
  status = 'ativo',
  aprovado_em = COALESCE(p.aprovado_em, vd.reviewed_at, now()),
  aprovado_por = COALESCE(p.aprovado_por, vd.reviewer_id),
  motivo_reprovacao = NULL
FROM public.verificacoes_documento vd
WHERE vd.user_id = p.id
  AND p.status = 'pendente_aprovacao'
  AND vd.verification_status = 'aprovado';
