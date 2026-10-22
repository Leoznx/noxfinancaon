-- The legacy Playwright process also polls cancellation and self-repair queues.
-- Keep every queued row for audit/rollback, but stop those auxiliary claims so
-- the retired browser automation remains fully idle.

CREATE OR REPLACE FUNCTION public.claim_next_loft_proposal_cancellation(p_worker_id text)
RETURNS SETOF public.loft_proposal_cancellations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_loft_proposal_cancellation(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_loft_proposal_cancellation(text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_next_repair_job(p_worker_id text)
RETURNS SETOF public.repair_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_repair_job(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_repair_job(text) TO service_role;
