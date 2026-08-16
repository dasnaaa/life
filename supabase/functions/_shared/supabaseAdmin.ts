import { createClient } from "npm:@supabase/supabase-js@2";

// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY sind in jeder Edge Function
// automatisch als Env-Vars vorhanden - kein manuelles Secret-Setzen noetig.
// Der Service-Role-Key umgeht RLS vollstaendig, darf also nur innerhalb von
// Edge Functions verwendet werden, nie im Client.
export function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nicht gesetzt.");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
