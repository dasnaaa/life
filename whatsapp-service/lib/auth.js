// Simples Bearer-Token-Gate fuer die REST-API. Wird vor allem relevant,
// wenn der Service auf einem VPS mit oeffentlicher IP laeuft (Paket 10) -
// die sync-whatsapp Edge Function schickt denselben Key als Authorization-
// Header.
function requireApiKey(req, res, next) {
  const expected = process.env.WHATSAPP_SERVICE_API_KEY;
  if (!expected) {
    res.status(500).json({ error: "WHATSAPP_SERVICE_API_KEY ist auf dem Server nicht konfiguriert." });
    return;
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (token !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

module.exports = { requireApiKey };
