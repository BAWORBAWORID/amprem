# ============================================================
# AM Premium Creator — Docker Image (Ubuntu 22.04)
# Railway-compatible
#
# Build : docker build -t am-creator .
# Run   : docker run -d --name am -p 5000:5000 am-creator
#
# Persistence:
#   Railway Volume -> /root/data
#
# CHROME_PATH:
#   /usr/bin/google-chrome
# ============================================================

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_MAJOR=22 \
    PORT=5000 \
    NODE_ENV=production \
    CHROME_PATH=/usr/bin/google-chrome

# ------------------------------------------------------------
# 1) Base packages + Node.js 22
# ------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        tzdata \
    && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && node -v \
    && npm -v \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------
# 2) Google Chrome + runtime dependencies
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

RUN curl -fsSL \
        -o /tmp/google-chrome.deb \
        "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb" \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        /tmp/google-chrome.deb \
    && rm -f /tmp/google-chrome.deb \
    && rm -rf /var/lib/apt/lists/* \
    && google-chrome --version

# ------------------------------------------------------------
# 3) Application
# ------------------------------------------------------------
WORKDIR /root

# Copy dependency manifests first for Docker layer caching
COPY package.json package-lock.json ./

# Install production dependencies
RUN npm ci --omit=dev \
    && npm cache clean --force

# ------------------------------------------------------------
# 4) Copy application source
# ------------------------------------------------------------
COPY server.js index.js ./
COPY src ./src
COPY services ./services
COPY public ./public

# ------------------------------------------------------------
# 5) Runtime data directory
#
# IMPORTANT:
# Do NOT use Docker VOLUME here.
# Railway Volume must be mounted to /root/data.
# ------------------------------------------------------------
RUN mkdir -p /root/data/sessions

# ------------------------------------------------------------
# 6) Railway / container configuration
# ------------------------------------------------------------
EXPOSE 5000

# Health check
HEALTHCHECK \
    --interval=30s \
    --timeout=5s \
    --start-period=20s \
    --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/').then(r => process.exit(r.status >= 200 && r.status < 400 ? 0 : 1)).catch(() => process.exit(1))"

# ------------------------------------------------------------
# 7) Start application
# ------------------------------------------------------------
CMD ["node", "server.js"]