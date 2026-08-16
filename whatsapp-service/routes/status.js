const express = require("express");
const { state } = require("../lib/state");

const router = express.Router();

router.get("/status", (_req, res) => {
  res.json({
    status: state.status, // 'starting' | 'qr' | 'connected' | 'disconnected'
    connected: state.status === "connected",
    qr: state.status === "qr" ? state.qrDataUrl : null,
    phoneNumber: state.phoneNumber,
    lastSyncAt: state.lastSyncAt,
    cachedMessageCount: state.messages.size,
  });
});

module.exports = router;
