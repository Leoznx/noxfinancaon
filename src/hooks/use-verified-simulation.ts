import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { verifySimulationIdentity, type DemoIdentity } from "@/lib/demo-simulation";
export function useVerifiedSimulation(user: DemoIdentity) {
  const { id, email, role } = user;
  const [status, setStatus] = useState<"checking" | "verified" | "denied">("checking");
  useEffect(() => {
    let active = true;
    setStatus("checking");
    void verifySimulationIdentity({ id, email, role }, async () => {
      // getUser validates the token with Auth; local/session-storage markers never authorize this flow.
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user || data.user.id !== id) return null;
      const result = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();
      if (result.error || !result.data) return null;
      return { id: data.user.id, email: data.user.email ?? "", role: String(result.data.role) };
    })
      .then((ok) => {
        if (active) setStatus(ok ? "verified" : "denied");
      })
      .catch(() => {
        if (active) setStatus("denied");
      });
    return () => {
      active = false;
    };
  }, [id, email, role]);
  return status;
}
