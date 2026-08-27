FROM ghcr.io/home-assistant/base:latest

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
  io.hass.type="app" \
  io.hass.name="Website Tester" \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.arch="amd64|aarch64"

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

COPY package.json ./package.json
RUN npm install --omit=dev

COPY runner.js ./runner.js

ENV CHROME_BIN=/usr/bin/chromium-browser

CMD ["node", "/app/runner.js"]
