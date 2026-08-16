// Gemeinsames Redirect-Ende fuer alle OAuth-Callbacks (Google, Slack, ...):
// native ueber den dailybrief://-Scheme-Redirect, web ueber eine kleine
// HTML-Seite, die sich selbst schliesst.
const APP_SCHEME = "dailybrief";

export function finishOAuth(
  platform: "web" | "native",
  status: "success" | "error",
  message: string,
  accountId?: string
): Response {
  if (platform === "native") {
    const target = new URL(`${APP_SCHEME}://oauth-callback`);
    target.searchParams.set("status", status);
    target.searchParams.set("message", message);
    if (accountId) target.searchParams.set("account_id", accountId);
    return new Response(null, { status: 302, headers: { Location: target.toString() } });
  }

  const safeMessage = escapeHtml(message);
  const color = status === "success" ? "#4ADE80" : "#F87171";
  const accountIdLiteral = accountId ? `"${accountId}"` : "null";
  const body = `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Daily Brief</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#0F172A; color:#F8FAFC; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
  <div style="text-align:center; padding:24px; max-width:360px;">
    <p style="color:${color}; font-size:18px; font-weight:600;">${safeMessage}</p>
    <p style="color:#94A3B8; font-size:14px;">Dieses Fenster kann geschlossen werden.</p>
  </div>
  <script>
    try {
      window.opener && window.opener.postMessage(
        { source: "daily-brief-oauth", status: "${status}", accountId: ${accountIdLiteral} },
        "*"
      );
    } catch (e) {}
    setTimeout(function () { window.close(); }, 1200);
  </script>
</body>
</html>`;

  return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
