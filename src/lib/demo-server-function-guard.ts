import { createMiddleware } from "@tanstack/react-start";
import { assertNonDemoOperation } from "@/lib/demo-request-guard";

// Client-side safety barrier, not a replacement for server-side authorization.
export const blockDemoServerFunctions = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    assertNonDemoOperation(data.session?.user.email);
    return next();
  },
);
