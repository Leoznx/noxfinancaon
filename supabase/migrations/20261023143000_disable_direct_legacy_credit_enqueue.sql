-- Cached clients from before the Direct Data rollout must not keep creating
-- legacy Loft queue rows that no worker will claim. The official wrapper stays
-- available to authenticated clients and invokes this internal RPC as owner.

REVOKE ALL ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text
) TO service_role;

COMMENT ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) IS 'Internal atomic enqueue used only by the authenticated official credit wrapper.';

