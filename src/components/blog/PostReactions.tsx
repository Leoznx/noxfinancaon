import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Vote = "like" | "dislike" | null;

const STORAGE_KEY = "nox_blog_session_id";

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

function firstState(data: unknown) {
  return Array.isArray(data) ? data[0] : data;
}

interface Props {
  slug: string;
  variant?: "card" | "page";
}

export function PostReactions({ slug, variant = "card" }: Props) {
  const [likes, setLikes] = useState(0);
  const [dislikes, setDislikes] = useState(0);
  const [myVote, setMyVote] = useState<Vote>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const session = getSessionId();
      const { data } = await supabase.rpc("get_blog_reaction_state" as never, {
        p_post_slug: slug,
        p_session_id: session,
      } as never);
      if (!alive) return;
      const state = firstState(data) as any;
      setLikes(state?.like_count ?? 0);
      setDislikes(state?.dislike_count ?? 0);
      setMyVote((state?.my_vote as Vote) ?? null);
    })();
    return () => { alive = false; };
  }, [slug]);

  async function vote(next: "like" | "dislike") {
    if (busy) return;
    setBusy(true);
    const session = getSessionId();
    const prev = myVote;

    // Otimista
    let nLikes = likes, nDislikes = dislikes, nVote: Vote = next;
    if (prev === next) {
      // remove voto
      if (next === "like") nLikes--; else nDislikes--;
      nVote = null;
    } else {
      if (prev === "like") nLikes--;
      if (prev === "dislike") nDislikes--;
      if (next === "like") nLikes++; else nDislikes++;
    }
    setLikes(Math.max(0, nLikes));
    setDislikes(Math.max(0, nDislikes));
    setMyVote(nVote);

    try {
      const { data, error } = await supabase.rpc("cast_blog_vote" as never, {
        p_post_slug: slug,
        p_session_id: session,
        p_vote_type: nVote,
      } as never);
      if (error) throw error;
      const state = firstState(data) as any;
      if (!state?.accepted) throw new Error("rate_limited");
      setLikes(state.like_count ?? 0);
      setDislikes(state.dislike_count ?? 0);
      setMyVote((state.my_vote as Vote) ?? null);
    } catch {
      toast.error("Não foi possível registrar seu voto.");
      // Rollback
      setLikes(likes);
      setDislikes(dislikes);
      setMyVote(prev);
    } finally {
      setBusy(false);
    }
  }

  const sz = variant === "page" ? 18 : 14;
  const pad = variant === "page" ? "px-4 py-2 text-sm" : "px-2.5 py-1 text-xs";

  return (
    <div className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); vote("like"); }}
        disabled={busy}
        aria-label="Curtir"
        className={`inline-flex items-center gap-1.5 rounded-full font-bold transition border ${pad} ${
          myVote === "like"
            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : "bg-white border-neutral-200 text-neutral-600 hover:border-emerald-300 hover:text-emerald-700"
        }`}
      >
        <ThumbsUp size={sz} strokeWidth={2.2} /> {likes}
      </button>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); vote("dislike"); }}
        disabled={busy}
        aria-label="Não curtir"
        className={`inline-flex items-center gap-1.5 rounded-full font-bold transition border ${pad} ${
          myVote === "dislike"
            ? "bg-rose-50 border-rose-200 text-rose-700"
            : "bg-white border-neutral-200 text-neutral-600 hover:border-rose-300 hover:text-rose-700"
        }`}
      >
        <ThumbsDown size={sz} strokeWidth={2.2} /> {dislikes}
      </button>
    </div>
  );
}
