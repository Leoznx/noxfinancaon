import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Vote = "like" | "dislike" | null;

const STORAGE_KEY = "nox_blog_session_id";

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = (crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
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
      const [{ data: r }, { data: v }] = await Promise.all([
        supabase.from("blog_post_reactions" as never).select("like_count,dislike_count").eq("post_slug", slug).maybeSingle(),
        supabase.from("blog_post_votes" as never).select("vote_type").eq("post_slug", slug).eq("session_id", session).maybeSingle(),
      ]);
      if (!alive) return;
      setLikes((r as any)?.like_count ?? 0);
      setDislikes((r as any)?.dislike_count ?? 0);
      setMyVote(((v as any)?.vote_type as Vote) ?? null);
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
      // Atualiza voto (upsert ou delete)
      if (nVote === null) {
        await supabase.from("blog_post_votes" as never).delete().eq("post_slug", slug).eq("session_id", session);
      } else {
        await supabase.from("blog_post_votes" as never).upsert(
          { post_slug: slug, session_id: session, vote_type: nVote, updated_at: new Date().toISOString() } as never,
          { onConflict: "post_slug,session_id" } as never,
        );
      }
      // Atualiza contadores: lê os atuais e grava
      const { data: cur } = await supabase.from("blog_post_reactions" as never).select("like_count,dislike_count").eq("post_slug", slug).maybeSingle();
      const baseL = (cur as any)?.like_count ?? 0;
      const baseD = (cur as any)?.dislike_count ?? 0;
      let dl = 0, dd = 0;
      if (prev === "like") dl--;
      if (prev === "dislike") dd--;
      if (nVote === "like") dl++;
      if (nVote === "dislike") dd++;
      await supabase.from("blog_post_reactions" as never).upsert(
        { post_slug: slug, like_count: Math.max(0, baseL + dl), dislike_count: Math.max(0, baseD + dd), updated_at: new Date().toISOString() } as never,
        { onConflict: "post_slug" } as never,
      );
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
