-- Refresh the copy of commission reminders already visible in the in-app
-- notification center. This is an UPDATE, so the INSERT-only push trigger is
-- not fired and users do not receive duplicate mobile notifications.

WITH personalized AS (
  SELECT
    notification.id,
    get_byte(decode(md5(notification.id::text), 'hex'), 0) % 6 AS variant
  FROM public.notificacoes notification
  WHERE notification.tipo = 'lembrete_comissoes'
    AND notification.titulo = 'Mais contratos, mais comissões'
)
UPDATE public.notificacoes notification
SET
  titulo = CASE personalized.variant
    WHEN 0 THEN 'Bora vender! 🚀'
    WHEN 1 THEN 'Vamos fechar mais um?'
    WHEN 2 THEN 'Tem oportunidade esperando'
    WHEN 3 THEN 'Seu próximo contrato começa hoje'
    WHEN 4 THEN 'Mais negócios, mais conquistas'
    ELSE 'Bora pra cima!'
  END,
  mensagem = CASE personalized.variant
    WHEN 0 THEN 'Seu próximo contrato pode começar agora. Chame um cliente e avance com a NOX!'
    WHEN 1 THEN 'Cada novo contrato fortalece sua carteira e aumenta suas comissões. Vamos avançar?'
    WHEN 2 THEN 'Uma conversa hoje pode virar contrato e comissão. Retome seus contatos e faça acontecer!'
    WHEN 3 THEN 'Aproveite o dia para criar novas oportunidades e continuar crescendo com a NOX.'
    WHEN 4 THEN 'Cada contrato soma no seu resultado. Mantenha o ritmo e conquiste sua próxima comissão!'
    ELSE 'Uma nova oportunidade pode estar a uma mensagem de distância. Conte com a NOX!'
  END
FROM personalized
WHERE notification.id = personalized.id;
