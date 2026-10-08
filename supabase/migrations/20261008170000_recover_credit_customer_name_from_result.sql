-- Versões antigas do worker identificavam o resultado como aprovado, mas podiam
-- deixar tenant_name vazio mesmo quando o nome já estava no resumo sanitizado da
-- tela do parceiro. O trigger mantém a correção no backend compartilhado e o
-- UPDATE recupera as consultas históricas sem repetir a análise de crédito.

CREATE OR REPLACE FUNCTION public.normalize_credit_customer_name(
  p_value TEXT,
  p_require_full_name BOOLEAN DEFAULT false
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  normalized TEXT;
BEGIN
  normalized := btrim(
    regexp_replace(replace(coalesce(p_value, ''), chr(160), ' '), '\s+', ' ', 'g'),
    E' \t\n\r:;|,.-'
  );

  IF char_length(normalized) < 2
    OR char_length(normalized) > 120
    OR normalized ~ '[0-9]'
    OR normalized !~ '[[:alpha:]]'
    OR normalized ~* '\m(cpf|cnpj|cliente|inquilin[oa]|locat[aá]ri[oa]|proponente|nome|resultado|an[aá]lise|cr[eé]dito|aprovad[oa]|recusad[oa]|valor|aluguel|simula[cç][aã]o|pendente|dados)\M'
    OR (p_require_full_name AND normalized !~ '[[:alpha:]][^[:space:]]*[[:space:]]+[[:alpha:]]')
  THEN
    RETURN NULL;
  END IF;

  RETURN normalized;
END;
$$;

CREATE OR REPLACE FUNCTION public.extract_credit_customer_name(p_raw_response JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  captured TEXT;
  lines TEXT[];
  line TEXT;
  candidate TEXT;
  matched TEXT[];
  idx INTEGER;
BEGIN
  candidate := public.normalize_credit_customer_name(
    coalesce(
      p_raw_response ->> 'clienteNome',
      p_raw_response ->> 'customerName',
      p_raw_response ->> 'nomeCliente'
    )
  );
  IF candidate IS NOT NULL THEN
    RETURN candidate;
  END IF;

  captured := coalesce(
    p_raw_response ->> 'textoCapturado',
    p_raw_response ->> 'texto_capturado',
    p_raw_response ->> 'bodyText',
    p_raw_response ->> 'text'
  );
  IF nullif(btrim(captured), '') IS NULL THEN
    RETURN NULL;
  END IF;

  lines := regexp_split_to_array(replace(captured, chr(160), ' '), E'\\r?\\n');
  IF array_length(lines, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  FOR idx IN 1..array_length(lines, 1) LOOP
    line := btrim(regexp_replace(lines[idx], '\s+', ' ', 'g'));

    matched := regexp_match(
      line,
      '^(?:nome(?:\s+do\s+(?:cliente|inquilino|locat[aá]rio|proponente))?|cliente|inquilino|locat[aá]rio|proponente)\s*[:\-]\s*(.+)$',
      'i'
    );
    IF matched IS NOT NULL THEN
      candidate := public.normalize_credit_customer_name(
        regexp_replace(matched[1], '\s+(?:CPF|CNPJ)\s*:?.*$', '', 'i')
      );
      IF candidate IS NOT NULL THEN
        RETURN candidate;
      END IF;
    END IF;

    IF line ~* '^(?:nome(?:\s+do\s+(?:cliente|inquilino|locat[aá]rio|proponente))?|cliente|inquilino|locat[aá]rio|proponente)\s*:?$'
      AND idx < array_length(lines, 1)
    THEN
      candidate := public.normalize_credit_customer_name(lines[idx + 1]);
      IF candidate IS NOT NULL THEN
        RETURN candidate;
      END IF;
    END IF;

    IF line ~* '(?:CPF|CNPJ)\s*:?|\[DOCUMENT_REDACTED\]' THEN
      candidate := public.normalize_credit_customer_name(
        regexp_replace(
          regexp_replace(line, '(?:CPF|CNPJ)\s*:?.*$|\[DOCUMENT_REDACTED\].*$', '', 'i'),
          '(?:nome|cliente|inquilino|locat[aá]rio|proponente)\s*[:\-]?',
          ' ',
          'gi'
        ),
        true
      );
      IF candidate IS NOT NULL THEN
        RETURN candidate;
      END IF;

      IF idx > 1 THEN
        candidate := public.normalize_credit_customer_name(lines[idx - 1], true);
        IF candidate IS NOT NULL THEN
          RETURN candidate;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fill_credit_customer_name_from_result()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  extracted_name TEXT;
BEGIN
  IF coalesce(NEW.resultado, NEW.status, '') <> 'aprovado'
    OR public.normalize_credit_customer_name(NEW.tenant_name) IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  extracted_name := public.extract_credit_customer_name(NEW.raw_response);
  IF extracted_name IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.tenant_name := extracted_name;
  IF NEW.inquilino_id IS NOT NULL THEN
    UPDATE public.inquilinos
    SET nome = extracted_name
    WHERE id = NEW.inquilino_id
      AND public.normalize_credit_customer_name(nome) IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fill_credit_customer_name_from_result
  ON public.consultas_credito;
CREATE TRIGGER fill_credit_customer_name_from_result
BEFORE INSERT OR UPDATE OF raw_response, resultado, status, tenant_name
ON public.consultas_credito
FOR EACH ROW
EXECUTE FUNCTION public.fill_credit_customer_name_from_result();

UPDATE public.consultas_credito AS consulta
SET tenant_name = public.extract_credit_customer_name(consulta.raw_response)
WHERE coalesce(consulta.resultado, consulta.status, '') = 'aprovado'
  AND public.normalize_credit_customer_name(consulta.tenant_name) IS NULL
  AND public.extract_credit_customer_name(consulta.raw_response) IS NOT NULL;

UPDATE public.inquilinos AS inquilino
SET nome = consulta.tenant_name
FROM public.consultas_credito AS consulta
WHERE consulta.inquilino_id = inquilino.id
  AND coalesce(consulta.resultado, consulta.status, '') = 'aprovado'
  AND public.normalize_credit_customer_name(consulta.tenant_name) IS NOT NULL
  AND public.normalize_credit_customer_name(inquilino.nome) IS NULL;

REVOKE ALL ON FUNCTION public.normalize_credit_customer_name(TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.extract_credit_customer_name(JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fill_credit_customer_name_from_result()
  FROM PUBLIC, anon, authenticated;
