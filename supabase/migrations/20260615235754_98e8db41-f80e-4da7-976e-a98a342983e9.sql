
CREATE TABLE public.blog_post_reactions (
  post_slug text PRIMARY KEY,
  like_count integer NOT NULL DEFAULT 0,
  dislike_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.blog_post_reactions TO anon, authenticated;
GRANT ALL ON public.blog_post_reactions TO service_role;

ALTER TABLE public.blog_post_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blog_reactions_read_all" ON public.blog_post_reactions FOR SELECT USING (true);
CREATE POLICY "blog_reactions_insert_all" ON public.blog_post_reactions FOR INSERT WITH CHECK (true);
CREATE POLICY "blog_reactions_update_all" ON public.blog_post_reactions FOR UPDATE USING (true) WITH CHECK (true);

CREATE TABLE public.blog_post_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_slug text NOT NULL,
  session_id text NOT NULL,
  vote_type text NOT NULL CHECK (vote_type IN ('like','dislike')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_slug, session_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_post_votes TO anon, authenticated;
GRANT ALL ON public.blog_post_votes TO service_role;

ALTER TABLE public.blog_post_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blog_votes_read_all" ON public.blog_post_votes FOR SELECT USING (true);
CREATE POLICY "blog_votes_insert_all" ON public.blog_post_votes FOR INSERT WITH CHECK (true);
CREATE POLICY "blog_votes_update_all" ON public.blog_post_votes FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "blog_votes_delete_all" ON public.blog_post_votes FOR DELETE USING (true);

CREATE INDEX idx_blog_votes_slug ON public.blog_post_votes(post_slug);
CREATE INDEX idx_blog_votes_session ON public.blog_post_votes(session_id);
