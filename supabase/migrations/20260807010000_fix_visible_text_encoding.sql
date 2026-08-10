-- Corrige textos com UTF-8 interpretado como Windows-1252/Latin-1.
-- A normalização acontece antes do envio de push para que site e app recebam
-- o mesmo título e a mesma mensagem já corrigidos.

CREATE OR REPLACE FUNCTION public.repair_visible_text_encoding(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  repaired text := value;
BEGIN
  IF repaired IS NULL THEN
    RETURN NULL;
  END IF;

  repaired := replace(repaired, 'Ãƒ', 'Ã');
  repaired := replace(repaired, 'Ã¡', 'á');
  repaired := replace(repaired, 'Ã ', 'à');
  repaired := replace(repaired, 'Ã¢', 'â');
  repaired := replace(repaired, 'Ã£', 'ã');
  repaired := replace(repaired, 'Ã©', 'é');
  repaired := replace(repaired, 'Ãª', 'ê');
  repaired := replace(repaired, 'Ã­', 'í');
  repaired := replace(repaired, 'Ã³', 'ó');
  repaired := replace(repaired, 'Ã´', 'ô');
  repaired := replace(repaired, 'Ãµ', 'õ');
  repaired := replace(repaired, 'Ãº', 'ú');
  repaired := replace(repaired, 'Ã§', 'ç');
  repaired := replace(repaired, 'Âº', 'º');
  repaired := replace(repaired, 'Âª', 'ª');
  repaired := replace(repaired, 'Â·', '·');
  repaired := replace(repaired, 'â€¢', '•');
  repaired := replace(repaired, 'â€”', '—');
  repaired := replace(repaired, 'â€“', '–');

  RETURN repaired;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_notification_text_encoding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.titulo := public.repair_visible_text_encoding(NEW.titulo);
  NEW.mensagem := public.repair_visible_text_encoding(NEW.mensagem);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_notification_text_encoding ON public.notificacoes;
CREATE TRIGGER trg_normalize_notification_text_encoding
BEFORE INSERT OR UPDATE OF titulo, mensagem ON public.notificacoes
FOR EACH ROW
EXECUTE FUNCTION public.normalize_notification_text_encoding();

UPDATE public.notificacoes
SET
  titulo = public.repair_visible_text_encoding(titulo),
  mensagem = public.repair_visible_text_encoding(mensagem)
WHERE titulo IS DISTINCT FROM public.repair_visible_text_encoding(titulo)
   OR mensagem IS DISTINCT FROM public.repair_visible_text_encoding(mensagem);

COMMENT ON FUNCTION public.repair_visible_text_encoding(text) IS
  'Repara sequências comuns de mojibake em textos visíveis da NOX.';

COMMENT ON FUNCTION public.normalize_notification_text_encoding() IS
  'Normaliza título e mensagem antes de salvar e enviar notificações.';
