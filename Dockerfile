# ============================================================
# AM Premium Creator — Docker Image (Ubuntu 22.04)
#
# Build : docker build -t am-creator .
# Run   : docker run -d --name am \
#           -p 5000:5000 \
#           -v am-data:/app/data \
#           am-creator
#
# Catatan:
#  - App berjalan sebagai root di dalam container agar mudah
#    mount folder data lokal (mis. -v /root/am/data:/app/data).
#  - CHROME_PATH otomatis mengarah ke Google Chrome yang
#    diinstall, dipakai services/bulk.js (puppeteer-core).
#  - Semua state (users, sessions, chat, dll) ada di /app/data
#    -> WAJIB di-mount sebagai volume agar tidak hilang.
# ============================================================

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_MAJOR=22 \
    PORT=5000 \
    NODE_ENV=production \
    CHROME_PATH=/usr/bin/google-chrome

# ------------------------------------------------------------
# 1) Base packages + Node.js 22 (via NodeSource)
#    Ubuntu 22.04 bawaan cuma punya Node 12 (terlalu tua),
#    jadi gunakan repo resmi NodeSource.
# ------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        tzdata \
    && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && node -v && npm -v

# ------------------------------------------------------------
# 2) Google Chrome stable — dibutuhkan puppeteer-core
#    (fitur Auto Generator / email bulk di services/bulk.js)
# ------------------------------------------------------------
# ------------------------------------------------------------
# 2) Google Chrome stable — dibutuhkan puppeteer-core
#    (fitur Auto Generator / email bulk di services/bulk.js)
#    + library runtime yang sering kurang di image minimal
# ------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        xdg-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/google-chrome.deb \
        "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb" \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
    && rm -f /tmp/google-chrome.deb \
    && rm -rf /var/lib/apt/lists/* \
    && google-chrome --version

# ------------------------------------------------------------
# 3) Install dependency aplikasi (deterministik via lockfile)
# ------------------------------------------------------------
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

# ------------------------------------------------------------
# 4) Salin source aplikasi
#    server.js  -> shim yang import ./index.js
#    index.js   -> entry point (HTTP server + HMR watcher)
#    src/       -> app engine, routes, utils (inti aplikasi)
#    services/  -> auth native AM + bulk workers (puppeteer-core)
#    public/    -> frontend + security.js
# ------------------------------------------------------------
COPY server.js index.js ./
COPY src ./src
COPY services ./services
COPY public ./public

# Folder state runtime — jadikan volume agar data persisten
RUN mkdir -p /app/data/sessions
VOLUME ["/app/data"]

# ------------------------------------------------------------
# 5) Jalankan
# ------------------------------------------------------------
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
