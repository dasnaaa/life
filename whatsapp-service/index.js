require("dotenv").config();

const path = require("path");
const express = require("express");

const { requireApiKey } = require("./lib/auth");
const { createWhatsAppClient } = require("./lib/whatsappClient");
const { state } = require("./lib/state");

const statusRouter = require("./routes/status");
const messagesRouter = require("./routes/messages");
const contactsRouter = require("./routes/contacts");

const PORT = process.env.PORT || 3001;
const SESSION_PATH = process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, ".wwebjs_auth");

const app = express();
app.use(express.json());

// Unauthentifizierter Liveness-Check (z.B. fuer Uptime-Monitoring/VPS-Setup).
app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(requireApiKey);
app.use(statusRouter);
app.use(messagesRouter);
app.use(contactsRouter);

app.listen(PORT, () => {
  console.log(`Daily Brief WhatsApp-Service laeuft auf Port ${PORT}`);
});

const client = createWhatsAppClient({
  sessionPath: SESSION_PATH,
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
});
app.locals.whatsappClient = client;

client.initialize().catch((error) => {
  console.error("WhatsApp-Client konnte nicht initialisiert werden:", error);
  state.status = "disconnected";
});

process.on("SIGINT", async () => {
  console.log("\nBeende WhatsApp-Service...");
  try {
    await client.destroy();
  } catch {
    // ignore
  }
  process.exit(0);
});
