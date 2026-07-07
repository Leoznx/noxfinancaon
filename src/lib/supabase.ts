// Alias de conveniência para o client Supabase do app.
// O client real (gerado pelo Lovable) vive em src/integrations/supabase/client.ts —
// este módulo só re-exporta para permitir `import { supabase } from "@/lib/supabase"`.
export { supabase } from "@/integrations/supabase/client";
