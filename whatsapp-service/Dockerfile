# Fuer Deployment-Option B (kleiner VPS, z.B. Hetzner CX11) aus Paket 10.
# Installiert Google Chrome stable direkt statt Puppeteers eigenen
# Chromium-Download zu nutzen - kleineres, reproduzierbareres Image.
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Sessiondaten auf ein Volume auslagern, damit der QR-Scan einen
# Container-Neustart/-Update ueberlebt: docker run -v whatsapp-session:/app/.wwebjs_auth ...
VOLUME ["/app/.wwebjs_auth"]

EXPOSE 3001

CMD ["node", "index.js"]
