const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");

const { state, upsertMessage } = require("./state");
const { syncNewIncomingMessage } = require("../utils/supabase-sync");

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function buildMessageRecord(message, chat, contact) {
  const displayName =
    (contact && (contact.pushname || contact.name)) || message._data?.notifyName || chat.id.user;

  return {
    id: message.id._serialized,
    chatId: chat.id._serialized,
    chatName: chat.isGroup ? chat.name : displayName,
    isGroup: chat.isGroup,
    senderName: displayName,
    senderId: message.author || message.from,
    body: message.body,
    timestamp: message.timestamp * 1000,
    fromMe: message.fromMe,
    // Vereinfachung: WhatsApp Web exponiert keinen saubere Lesestatus pro
    // einzelner eingehender Nachricht. Wir markieren eine Nachricht als
    // ungelesen, wenn der gesamte Chat aktuell unreadCount > 0 hat.
    isRead: message.fromMe || chat.unreadCount === 0,
  };
}

function createWhatsAppClient({ sessionPath, puppeteerExecutablePath }) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    puppeteer: {
      headless: true,
      executablePath: puppeteerExecutablePath || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  client.on("qr", async (qr) => {
    state.status = "qr";
    qrcodeTerminal.generate(qr, { small: true });
    try {
      state.qrDataUrl = await QRCode.toDataURL(qr);
    } catch (error) {
      console.error("QR-Code konnte nicht als Data-URL gerendert werden:", error);
    }
    console.log("WhatsApp: QR-Code oben scannen (oder GET /status fuer die Data-URL).");
  });

  client.on("authenticated", () => {
    console.log("WhatsApp: authentifiziert, warte auf vollstaendige Verbindung...");
  });

  client.on("ready", async () => {
    state.status = "connected";
    state.qrDataUrl = null;
    state.phoneNumber = client.info?.wid?.user ?? null;
    console.log(`WhatsApp: verbunden als ${state.phoneNumber ?? "unbekannt"}. Starte 7-Tage-Sync...`);
    await backfillRecentChats(client);
  });

  client.on("disconnected", (reason) => {
    state.status = "disconnected";
    console.warn("WhatsApp: Verbindung getrennt:", reason);
  });

  // Nur eingehende Nachrichten (kein message_create), das ist "neue
  // Nachricht" im Sinn der Spec. Ausgehende Nachrichten (auch vom eigenen
  // Handy aus gesendete) landen ueber den naechsten sync-whatsapp-Poll mit,
  // falls das ueberhaupt relevant ist.
  client.on("message", async (message) => {
    try {
      const chat = await message.getChat();
      const contact = await message.getContact().catch(() => null);
      const record = buildMessageRecord(message, chat, contact);
      upsertMessage(record);
      state.lastSyncAt = new Date().toISOString();
      await syncNewIncomingMessage(record);
    } catch (error) {
      console.error("Fehler beim Verarbeiten einer neuen Nachricht:", error);
    }
  });

  return client;
}

async function backfillRecentChats(client) {
  try {
    const chats = await client.getChats();
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    for (const chat of chats) {
      const messages = await chat.fetchMessages({ limit: 100 });
      for (const message of messages) {
        if (message.timestamp * 1000 < cutoff) continue;
        const contact = message.fromMe ? null : await message.getContact().catch(() => null);
        upsertMessage(buildMessageRecord(message, chat, contact));
      }
    }

    state.lastSyncAt = new Date().toISOString();
    console.log(`WhatsApp: Backfill abgeschlossen (${chats.length} Chats geprueft, letzte 7 Tage gecacht).`);
  } catch (error) {
    console.error("WhatsApp: 7-Tage-Backfill fehlgeschlagen:", error);
  }
}

module.exports = { createWhatsAppClient, buildMessageRecord };
