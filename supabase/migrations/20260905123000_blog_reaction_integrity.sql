-- Blog voting remains anonymous, but clients must not be able to overwrite the
-- aggregate counters or enumerate/delete other visitors' vote identifiers.

CREATE OR REPLACE FUNCTION public._consume_internal_rate_limit(
  p_scope text,
  p_identifier text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_hash text;
  v_row public.security_rate_limits%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF char_length(p_scope) NOT BETWEEN 2 AND 80
     OR char_length(p_identifier) NOT BETWEEN 1 AND 512
     OR p_limit NOT BETWEEN 1 AND 10000
     OR p_window_seconds NOT BETWEEN 1 AND 86400
     OR p_block_seconds NOT BETWEEN 1 AND 604800 THEN
    RETURN false;
  END IF;

  v_hash := encode(extensions.digest(lower(trim(p_identifier)), 'sha256'), 'hex');
  INSERT INTO public.security_rate_limits(scope, identifier_hash, request_count)
  VALUES (p_scope, v_hash, 0)
  ON CONFLICT (scope, identifier_hash) DO NOTHING;

  SELECT * INTO v_row
  FROM public.security_rate_limits
  WHERE scope = p_scope AND identifier_hash = v_hash
  FOR UPDATE;

  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN false;
  END IF;

  IF v_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now THEN
    v_row.window_started_at := v_now;
    v_row.request_count := 0;
    v_row.blocked_until := NULL;
  END IF;

  v_row.request_count := v_row.request_count + 1;
  IF v_row.request_count > p_limit THEN
    v_row.blocked_until := v_now + make_interval(secs => p_block_seconds);
  END IF;

  UPDATE public.security_rate_limits
  SET window_started_at = v_row.window_started_at,
      request_count = v_row.request_count,
      blocked_until = v_row.blocked_until,
      updated_at = v_now
  WHERE scope = p_scope AND identifier_hash = v_hash;

  RETURN v_row.blocked_until IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._consume_internal_rate_limit(text, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_blog_reaction_state(
  p_post_slug text,
  p_session_id text
)
RETURNS TABLE(like_count integer, dislike_count integer, my_vote text, accepted boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_post_slug IS NULL
     OR p_post_slug !~ '^[a-z0-9][a-z0-9_-]{0,159}$'
     OR p_session_id IS NULL
     OR p_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Parâmetros inválidos.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    coalesce(reaction.like_count, 0),
    coalesce(reaction.dislike_count, 0),
    vote.vote_type,
    true
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.blog_post_reactions AS reaction
    ON reaction.post_slug = p_post_slug
  LEFT JOIN public.blog_post_votes AS vote
    ON vote.post_slug = p_post_slug
   AND vote.session_id = p_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_blog_vote(
  p_post_slug text,
  p_session_id text,
  p_vote_type text
)
RETURNS TABLE(like_count integer, dislike_count integer, my_vote text, accepted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_likes integer;
  v_dislikes integer;
  v_vote text;
  v_allowed boolean;
BEGIN
  IF p_post_slug IS NULL
     OR p_post_slug !~ '^[a-z0-9][a-z0-9_-]{0,159}$'
     OR p_session_id IS NULL
     OR p_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_vote_type IS NOT NULL AND p_vote_type NOT IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'Parâmetros inválidos.' USING ERRCODE = '22023';
  END IF;

  v_allowed := public._consume_internal_rate_limit(
    'public-blog-vote-global', 'global', 5000, 3600, 900
  );
  IF v_allowed THEN
    v_allowed := public._consume_internal_rate_limit(
      'public-blog-vote-session', p_session_id, 60, 3600, 900
    );
  END IF;

  IF NOT v_allowed THEN
    SELECT
      coalesce(reaction.like_count, 0),
      coalesce(reaction.dislike_count, 0),
      vote.vote_type
    INTO v_likes, v_dislikes, v_vote
    FROM (SELECT 1) AS singleton
    LEFT JOIN public.blog_post_reactions AS reaction
      ON reaction.post_slug = p_post_slug
    LEFT JOIN public.blog_post_votes AS vote
      ON vote.post_slug = p_post_slug
     AND vote.session_id = p_session_id;

    RETURN QUERY SELECT v_likes, v_dislikes, v_vote, false;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_post_slug, 0));

  IF p_vote_type IS NULL THEN
    DELETE FROM public.blog_post_votes
    WHERE post_slug = p_post_slug AND session_id = p_session_id;
  ELSE
    INSERT INTO public.blog_post_votes(post_slug, session_id, vote_type, updated_at)
    VALUES (p_post_slug, p_session_id, p_vote_type, clock_timestamp())
    ON CONFLICT (post_slug, session_id)
    DO UPDATE SET vote_type = EXCLUDED.vote_type, updated_at = EXCLUDED.updated_at;
  END IF;

  SELECT
    count(*) FILTER (WHERE vote_type = 'like')::integer,
    count(*) FILTER (WHERE vote_type = 'dislike')::integer
  INTO v_likes, v_dislikes
  FROM public.blog_post_votes
  WHERE post_slug = p_post_slug;

  INSERT INTO public.blog_post_reactions(post_slug, like_count, dislike_count, updated_at)
  VALUES (p_post_slug, v_likes, v_dislikes, clock_timestamp())
  ON CONFLICT (post_slug)
  DO UPDATE SET
    like_count = EXCLUDED.like_count,
    dislike_count = EXCLUDED.dislike_count,
    updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT v_likes, v_dislikes, p_vote_type, true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_blog_reaction_state(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cast_blog_vote(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_blog_reaction_state(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cast_blog_vote(text, text, text) TO anon, authenticated;

DROP POLICY IF EXISTS "blog_reactions_insert_all" ON public.blog_post_reactions;
DROP POLICY IF EXISTS "blog_reactions_update_all" ON public.blog_post_reactions;
DROP POLICY IF EXISTS "blog_votes_read_all" ON public.blog_post_votes;
DROP POLICY IF EXISTS "blog_votes_insert_all" ON public.blog_post_votes;
DROP POLICY IF EXISTS "blog_votes_update_all" ON public.blog_post_votes;
DROP POLICY IF EXISTS "blog_votes_delete_all" ON public.blog_post_votes;

REVOKE INSERT, UPDATE, DELETE ON public.blog_post_reactions FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.blog_post_votes FROM anon, authenticated;
