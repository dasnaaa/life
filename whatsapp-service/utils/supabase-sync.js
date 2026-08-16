// Authentifiziert diesen Service als der Daily-Brief-Nutzer selbst (Anon
// Key + E-Mail/Passwort-Login) - NICHT mit dem Supabase Service-Role-Key.
// Dadurch greift Row Level Security ganz normal, genau wie aus der App
// heraus. Die Session wird lokal in .supabase-session.json zwischengespeichert,
// damit nicht bei jedem Neustart neu eingeloggt werden muss.
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SESSION_FILE = path.join(__dirname, "..", ".supabase-session.json");

function readSessionFile() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
  } catch {
    return {};
  }
}

const fileStorage = {
  getItem: (key) => readSessionFile()[key] ?? null,
  setItem: (key, value) => {
    const data = readSessionFile();
    data[key] = value;
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data), "utf-8");
  },
  removeItem: (key) => {
    const data = readSessionFile();
    delete data[key];
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data), "utf-8");
  },
};

let supabase = null;
let connectedAccountId = null;

function getSupabaseClient() {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY nicht gesetzt (.env pruefen).");
  }

  supabase = createClient(url, anonKey, {
    auth: { storage: fileStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });
  return supabase;
}

async function ensureSignedIn() {
  const client = getSupabaseClient();
  const { data } = await client.auth.getSession();
  if (data.session) return client;

  const email = process.env.SUPABASE_USER_EMAIL;
  const password = process.env.SUPABASE_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("SUPABASE_USER_EMAIL / SUPABASE_USER_PASSWORD nicht gesetzt (.env pruefen).");
  }

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Supabase-Login fehlgeschlagen: ${error.message}`);
  return client;
}

// Legt beim ersten Start einen connected_accounts-Eintrag fuer
// provider='whatsapp' an, falls noch keiner mit diesem Label existiert.
async function ensureConnectedAccount() {
  if (connectedAccountId) return connectedAccountId;

  const client = await ensureSignedIn();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error("Konnte eingeloggten Nutzer nicht ermitteln.");
  }

  const label = process.env.WHATSAPP_ACCOUNT_LABEL || "WhatsApp";

  const { data: existing, error: selectError } = await client
    .from("connected_accounts")
    .select("id")
    .eq("provider", "whatsapp")
    .eq("account_label", label)
    .maybeSingle();

  if (selectError) throw new Error(`connected_accounts Abfrage fehlgeschlagen: ${selectError.message}`);

  if (existing) {
    connectedAccountId = existing.id;
    return connectedAccountId;
  }

  const { data: inserted, error: insertError } = await client
    .from("connected_accounts")
    .insert({
      user_id: userData.user.id,
      provider: "whatsapp",
      account_label: label,
      is_active: true,
      credentials: {},
    })
    .select("id")
    .single();

  if (insertError) throw new Error(`connected_accounts Insert fehlgeschlagen: ${insertError.message}`);

  connectedAccountId = inserted.id;
  return connectedAccountId;
}

// Live-Push-Pfad fuer neue eingehende Nachrichten (das "Webhook zu Supabase"
// aus der Spec). Der Bulk-/Catch-up-Sync laeuft separat ueber die
// sync-whatsapp Edge Function, die GET /messages periodisch abruft.
async function syncNewIncomingMessage(record) {
  try {
    const client = await ensureSignedIn();
    const accountId = await ensureConnectedAccount();

    const { error } = await client.from("messages_cache").upsert(
      {
        account_id: accountId,
        platform: "whatsapp",
        sender_name: record.senderName,
        sender_id: record.senderId,
        content_preview: (record.body ?? "").slice(0, 500),
        received_at: new Date(record.timestamp).toISOString(),
        is_read: record.isRead,
        external_id: record.id,
        raw_data: { chat_id: record.chatId, is_group: record.isGroup },
        synced_at: new Date().toISOString(),
      },
      { onConflict: "account_id,external_id" }
    );

    if (error) {
      console.error("Push nach Supabase fehlgeschlagen:", error.message);
    }
  } catch (error) {
    console.error("syncNewIncomingMessage Fehler:", error.message);
  }
}

module.exports = { ensureSignedIn, ensureConnectedAccount, syncNewIncomingMessage };
