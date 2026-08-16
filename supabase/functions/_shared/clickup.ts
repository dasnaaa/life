import { supabaseAdmin } from "./supabaseAdmin.ts";

const BASE_URL = "https://api.clickup.com/api/v2";

async function clickupFetch(token: string, path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));

  // ClickUp erwartet den persoenlichen API-Token direkt im Authorization-
  // Header, OHNE "Bearer "-Praefix.
  const response = await fetch(url, { headers: { Authorization: token } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickUp API Fehler (${response.status}) fuer ${path}: ${text}`);
  }
  return response.json();
}

// ClickUp Personal Tokens laufen nicht ab - reines Entschluesseln reicht,
// kein Refresh-Flow noetig (anders als bei Google/Slack OAuth-Tokens).
export async function getClickUpAccessToken(accountId: string): Promise<string> {
  const admin = supabaseAdmin();
  const { data: tokens, error } = await admin.rpc("get_connected_account_tokens", {
    p_account_id: accountId,
  });
  if (error || !tokens) {
    throw new Error(`Kein gespeicherter ClickUp-Token fuer Account ${accountId} gefunden.`);
  }
  return (tokens as { access_token: string }).access_token;
}

export async function verifyClickUpToken(token: string): Promise<{ userId: number; username: string; email: string }> {
  const data = await clickupFetch(token, "/user");
  return {
    userId: data.user.id,
    username: data.user.username ?? data.user.email,
    email: data.user.email,
  };
}

export async function fetchClickUpTeamId(token: string): Promise<string> {
  const data = await clickupFetch(token, "/team");
  const team = data.teams?.[0];
  if (!team) throw new Error("Kein ClickUp-Workspace (Team) fuer diesen Token gefunden.");
  return team.id;
}

export type ClickUpTaskInfo = {
  id: string;
  name: string;
  url: string;
  status: string;
  dueDate: number | null; // ms epoch
  priority: string | null;
  listName: string | null;
  updatedAt: number; // ms epoch
};

function mapTask(task: any): ClickUpTaskInfo {
  return {
    id: task.id,
    name: task.name,
    url: task.url,
    status: task.status?.status ?? "unbekannt",
    dueDate: task.due_date ? Number(task.due_date) : null,
    priority: task.priority?.priority ?? null,
    listName: task.list?.name ?? null,
    updatedAt: Number(task.date_updated ?? task.date_created ?? Date.now()),
  };
}

// Tasks, die mir zugewiesen sind und in den naechsten `days` Tagen faellig
// sind - OHNE untere Schranke, damit bereits ueberfaellige Tasks (Spec:
// "rot markiert: ueberfaellig") ebenfalls mitkommen.
export async function fetchAssignedTasksDueWithin(
  token: string,
  teamId: string,
  userId: number,
  days: number
): Promise<ClickUpTaskInfo[]> {
  const dueBefore = Date.now() + days * 24 * 60 * 60 * 1000;
  const tasks: ClickUpTaskInfo[] = [];
  let page = 0;

  while (true) {
    const data = await clickupFetch(token, `/team/${teamId}/task`, {
      "assignees[]": String(userId),
      due_date_lt: String(dueBefore),
      include_closed: "false",
      order_by: "due_date",
      page: String(page),
    });

    const pageTasks = (data.tasks ?? []).filter((task: any) => task.due_date);
    tasks.push(...pageTasks.map(mapTask));

    if (data.last_page !== false || pageTasks.length === 0) break;
    page++;
  }

  return tasks;
}

export async function fetchAssignedTasksUpdatedToday(
  token: string,
  teamId: string,
  userId: number
): Promise<ClickUpTaskInfo[]> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const tasks: ClickUpTaskInfo[] = [];
  let page = 0;

  while (true) {
    const data = await clickupFetch(token, `/team/${teamId}/task`, {
      "assignees[]": String(userId),
      date_updated_gt: String(startOfToday.getTime()),
      include_closed: "true",
      page: String(page),
    });

    const pageTasks = data.tasks ?? [];
    tasks.push(...pageTasks.map(mapTask));

    if (data.last_page !== false || pageTasks.length === 0) break;
    page++;
  }

  return tasks;
}

export type ClickUpCommentMention = {
  id: string;
  taskId: string;
  taskName: string;
  authorName: string;
  text: string;
  createdAt: number; // ms epoch
};

// ClickUps API bietet keine workspace-weite Kommentarsuche - Erwaehnungen
// werden nur fuer die uebergebenen Tasks geprueft (typischerweise die
// faellig-bald / heute-aktualisiert Tasks aus den Funktionen oben).
export async function fetchMentioningComments(
  token: string,
  tasks: { id: string; name: string }[],
  selfUsername: string
): Promise<ClickUpCommentMention[]> {
  const mentions: ClickUpCommentMention[] = [];

  for (const task of tasks) {
    try {
      const data = await clickupFetch(token, `/task/${task.id}/comment`);
      for (const comment of data.comments ?? []) {
        const text = comment.comment_text ?? "";
        const mentionsMe =
          text.includes(`@${selfUsername}`) ||
          (Array.isArray(comment.comment) &&
            comment.comment.some((part: any) => part.type === "tag" && part.text?.includes(selfUsername)));

        if (!mentionsMe) continue;

        mentions.push({
          id: comment.id,
          taskId: task.id,
          taskName: task.name,
          authorName: comment.user?.username ?? "Unbekannt",
          text,
          createdAt: Number(comment.date ?? Date.now()),
        });
      }
    } catch (error) {
      console.warn(`ClickUp: Kommentare fuer Task ${task.id} konnten nicht geladen werden:`, error);
    }
  }

  return mentions;
}

export type TaskUrgency = "overdue" | "due_today" | "this_week" | "later" | "none";

export function classifyUrgency(dueDate: number | null): TaskUrgency {
  if (!dueDate) return "none";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 24 * 60 * 60 * 1000 - 1;
  const endOfWeek = Date.now() + 7 * 24 * 60 * 60 * 1000;

  if (dueDate < startOfToday) return "overdue";
  if (dueDate <= endOfToday) return "due_today";
  if (dueDate <= endOfWeek) return "this_week";
  return "later";
}
