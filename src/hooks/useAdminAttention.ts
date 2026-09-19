import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";

type AdminAttention = {
  documents: number;
  errors: number;
};

const EMPTY_ATTENTION: AdminAttention = { documents: 0, errors: 0 };

export function useAdminAttention() {
  const { user } = useAuth();
  const isAdmin =
    user?.role === "admin" ||
    user?.role === "admin_master" ||
    user?.internalRole === "admin_master";
  const [attention, setAttention] = useState<AdminAttention>(EMPTY_ATTENTION);

  const load = useCallback(async () => {
    if (!isAdmin || !user?.id) {
      setAttention(EMPTY_ATTENTION);
      return;
    }

    const { data } = await supabase
      .from("notificacoes")
      .select("tipo")
      .eq("user_id", user.id)
      .eq("lida", false)
      .in("tipo", ["documento_pendente", "erro_automacao"]);

    const rows = (data ?? []) as Array<{ tipo: string | null }>;
    setAttention({
      documents: rows.filter((row) => row.tipo === "documento_pendente").length,
      errors: rows.filter((row) => row.tipo === "erro_automacao").length,
    });
  }, [isAdmin, user?.id]);

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
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, load, user?.id]);

  return attention;
}
