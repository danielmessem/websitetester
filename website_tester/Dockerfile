ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apk add --no-cache \
    nodejs \
    npm \
    bash \
    coreutils \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY runner.js ./

ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV CHROME_BIN=/usr/bin/chromium-browser

RUN npm install playwright@1.62.1

CMD ["node", "/app/runner.js"]
