const express = require("express");
const { state, getUnreadMessages } = require("../lib/state");

const router = express.Router();

router.get("/messages", (_req, res) => {
  res.json({ messages: getUnreadMessages() });
});

// "fuer spaetere Erweiterung" (Paket 3 Spec) - minimal gehalten.
router.post("/send", async (req, res) => {
  const { to, message } = req.body ?? {};
  if (!to || !message) {
    res.status(400).json({ error: "Felder 'to' und 'message' sind erforderlich." });
    return;
  }

  const client = req.app.locals.whatsappClient;
  if (!client || state.status !== "connected") {
    res.status(503).json({ error: "WhatsApp-Client ist nicht verbunden." });
    return;
  }

  try {
    const chatId = to.includes("@") ? to : `${to.replace(/\D/g, "")}@c.us`;
    const sent = await client.sendMessage(chatId, message);
    res.json({ ok: true, messageId: sent.id._serialized });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Senden fehlgeschlagen." });
  }
});

module.exports = router;
