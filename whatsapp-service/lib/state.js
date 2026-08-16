// Bewusst nur In-Memory: Quelle der Wahrheit ist immer die WhatsApp-Web-
// Session selbst (via LocalAuth auf Platte persistiert). Dieser Store ist
// nur ein schneller Cache fuer die REST-API und geht bei jedem Neustart
// verloren - das ist unproblematisch, weil das naechste 'ready'-Event
// automatisch wieder die letzten 7 Tage nachlaedt (siehe whatsappClient.js).
const state = {
  status: "starting", // 'starting' | 'qr' | 'connected' | 'disconnected'
  qrDataUrl: null,
  phoneNumber: null,
  lastSyncAt: null,
  messages: new Map(), // id -> message record
};

function upsertMessage(record) {
  state.messages.set(record.id, record);
}

function getUnreadMessages() {
  return Array.from(state.messages.values())
    .filter((message) => !message.isRead)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function getFrequentContacts(sinceMs, limit = 30) {
  const cutoff = Date.now() - sinceMs;
  const byChat = new Map();

  for (const message of state.messages.values()) {
    if (message.timestamp < cutoff) continue;

    const entry = byChat.get(message.chatId) ?? {
      chatId: message.chatId,
      name: message.chatName,
      isGroup: message.isGroup,
      messageCount: 0,
      lastMessageAt: 0,
    };
    entry.messageCount += 1;
    entry.lastMessageAt = Math.max(entry.lastMessageAt, message.timestamp);
    byChat.set(message.chatId, entry);
  }

  return Array.from(byChat.values())
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, limit);
}

module.exports = { state, upsertMessage, getUnreadMessages, getFrequentContacts };
