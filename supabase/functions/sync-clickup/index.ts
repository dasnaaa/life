// Synct ClickUp-Tasks (mir zugewiesen, faellig in 7 Tagen ODER heute
// aktualisiert) sowie Kommentare, die mich in diesen Tasks erwaehnen, fuer
// einen connected_accounts-Eintrag.
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  classifyUrgency,
  fetchAssignedTasksDueWithin,
  fetchAssignedTasksUpdatedToday,
  fetchClickUpTeamId,
  fetchMentioningComments,
  getClickUpAccessToken,
  type ClickUpTaskInfo,
} from "../_shared/clickup.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    const admin = supabaseAdmin();

    const body = await req.json().catch(() => ({}));
    const accountId = body.account_id as string | undefined;
    if (!accountId) {
      return json({ error: "account_id ist erforderlich" }, 400);
    }

    const { data: account, error: accountError } = await admin
      .from("connected_accounts")
      .select("id, user_id, provider, is_active, credentials")
      .eq("id", accountId)
      .maybeSingle();

    if (accountError || !account) {
      return json({ error: "Account nicht gefunden." }, 404);
    }

    const isServiceRoleCall = jwt.length > 0 && jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!isServiceRoleCall) {
      const { data: userData, error: userError } = await admin.auth.getUser(jwt);
      if (userError || !userData?.user || userData.user.id !== account.user_id) {
        return json({ error: "Nicht autorisiert fuer diesen Account." }, 403);
      }
    }

    if (account.provider !== "clickup") {
      return json({ error: "Account ist kein ClickUp-Account." }, 400);
    }
    if (!account.is_active) {
      return json({ error: "Account ist deaktiviert." }, 400);
    }

    const clickUpUserId = account.credentials?.provider_account_id as string | undefined;
    const clickUpUsername = account.credentials?.provider_email as string | undefined;
    if (!clickUpUserId || !clickUpUsername) {
      return json({ error: "ClickUp-Nutzerdaten fehlen auf diesem Account (bitte neu verbinden)." }, 400);
    }

    const token = await getClickUpAccessToken(accountId);
    const teamId = await fetchClickUpTeamId(token);

    const [dueSoon, updatedToday] = await Promise.all([
      fetchAssignedTasksDueWithin(token, teamId, Number(clickUpUserId), 7),
      fetchAssignedTasksUpdatedToday(token, teamId, Number(clickUpUserId)),
    ]);

    const taskMap = new Map<string, ClickUpTaskInfo>();
    for (const task of [...dueSoon, ...updatedToday]) taskMap.set(task.id, task);
    const tasks = Array.from(taskMap.values());

    const mentions = await fetchMentioningComments(token, tasks, clickUpUsername);

    const taskRows = tasks.map((task) => ({
      account_id: accountId,
      platform: "clickup",
      sender_name: task.listName ?? "ClickUp",
      sender_id: task.id,
      content_preview: task.name,
      received_at: new Date(task.updatedAt).toISOString(),
      is_read: false,
      external_id: `task-${task.id}`,
      raw_data: {
        kind: "task",
        url: task.url,
        status: task.status,
        priority: task.priority,
        list_name: task.listName,
        due_date: task.dueDate,
        urgency: classifyUrgency(task.dueDate),
      },
      synced_at: new Date().toISOString(),
    }));

    const commentRows = mentions.map((mention) => ({
      account_id: accountId,
      platform: "clickup",
      sender_name: mention.authorName,
      sender_id: null,
      content_preview: mention.text.slice(0, 500),
      received_at: new Date(mention.createdAt).toISOString(),
      is_read: false,
      external_id: `comment-${mention.id}`,
      raw_data: { kind: "comment_mention", task_id: mention.taskId, task_name: mention.taskName },
      synced_at: new Date().toISOString(),
    }));

    const allRows = [...taskRows, ...commentRows];
    if (allRows.length > 0) {
      const { error } = await admin.from("messages_cache").upsert(allRows, { onConflict: "account_id,external_id" });
      if (error) throw new Error(`messages_cache upsert fehlgeschlagen: ${error.message}`);
    }

    await admin.rpc("touch_connected_account_sync", { p_account_id: accountId });

    return json({
      ok: true,
      account_id: accountId,
      summary: { tasks: taskRows.length, mentioning_comments: commentRows.length },
    });
  } catch (error) {
    console.error("sync-clickup error:", error);
    return json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
