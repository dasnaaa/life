const express = require("express");
const { getFrequentContacts } = require("../lib/state");

const router = express.Router();
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

router.get("/contacts/frequent", (req, res) => {
  const limit = Number(req.query.limit) || 30;
  res.json({ contacts: getFrequentContacts(THIRTY_DAYS_MS, limit) });
});

module.exports = router;
