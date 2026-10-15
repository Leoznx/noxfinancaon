import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";

type AdminAttention = {
  documents: number;
  errors: number;
};

const EMPTY_ATTENTION: AdminAttention = { documents: 0, errors: 0 };
const ATTENTION_CACHE_MS = 60_000;
const attentionCache = new Map<string, { value: AdminAttention; cachedAt: number }>();

export function useAdminAttention() {
  const { user } = useAuth();
  const isAdmin =
    user?.role === "admin" ||
    user?.role === "admin_master" ||
    user?.internalRole === "admin_master";
  const [attention, setAttention] = useState<AdminAttention>(
    () => (user?.id ? attentionCache.get(user.id)?.value : undefined) ?? EMPTY_ATTENTION,
  );

  const load = useCallback(
    async (force = false) => {
      if (!isAdmin || !user?.id) {
        setAttention(EMPTY_ATTENTION);
        return;
      }

      const cached = attentionCache.get(user.id);
      if (!force && cached && Date.now() - cached.cachedAt < ATTENTION_CACHE_MS) {
        setAttention(cached.value);
        return;
      }

      const { data } = await supabase
        .from("notificacoes")
        .select("tipo")
        .eq("user_id", user.id)
        .eq("lida", false)
        .in("tipo", ["documento_pendente", "erro_automacao"]);

      const rows = (data ?? []) as Array<{ tipo: string | null }>;
      const nextAttention = {
        documents: rows.filter((row) => row.tipo === "documento_pendente").length,
        errors: rows.filter((row) => row.tipo === "erro_automacao").length,
      };
      attentionCache.set(user.id, { value: nextAttention, cachedAt: Date.now() });
      setAttention(nextAttention);
    },
    [isAdmin, user?.id],
  );

  useEffect(() => {
    if (!isAdmin || !user?.id) return;
    void load();
    const channel = supabase
      .channel(`admin-attention-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notificacoes",
          filter: `user_id=eq.${user.id}`,
        },
        () => void load(true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, load, user?.id]);

  return attention;
}
