# syntax=docker/dockerfile:1.7

# Multi-stage build for the World Monitor web app (frontend only).

# Stage 1: Build the frontend with TypeScript + Vite.
# Only static assets reach nginx. Keep Node native to avoid QEMU crashes during npm ci.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:feb76650b7195319268c59cb2d419c732d6c499b13bf5296f16ab59eb1f0a4f3 AS builder
ARG BUILDKIT_SBOM_SCAN_STAGE=true

WORKDIR /app
ENV npm_config_install_links=true

# Copy source and build.
COPY . .

# Install all dependencies (including devDependencies for tsc, vite, etc.).
# --ignore-scripts matches the sidecar image's proven install: it skips
# node-gyp postinstalls (bufferutil/utf-8-validate have no prebuilt binary for
# every buildx platform and the image carries no compiler toolchain) — those
# are optional ws accelerators the frontend build never loads.
RUN npm ci --include=dev --ignore-scripts

# Build-time configuration. Pass via --build-arg. Other VITE_* vars (e.g. VITE_PMTILES_URL)
# can be added here or via --build-arg for custom builds; see .env.example for the full list.
ARG VITE_VARIANT=full
ARG VITE_WS_API_URL=https://api.worldmonitor.app
# World Monitor Lite deployment profile (docs/engineering/architecture/lite.md). Off by default.
ARG VITE_LITE_PROFILE=

ENV VITE_VARIANT=${VITE_VARIANT}
ENV VITE_WS_API_URL=${VITE_WS_API_URL}
ENV VITE_LITE_PROFILE=${VITE_LITE_PROFILE}

# tsc + vite build directly like the sidecar image's builder. `npm run build`
# would also run the Vite env secrets check, which the
# image does not need.
RUN npx tsc && npx vite build
# The SPA entry point: docker/nginx.conf.template rewrites /lite and its screens
# to it, so without it every app route in the image serves a 404.
RUN test -s dist/lite.html


# Stage 2: Serve the built assets from nginx.
FROM nginx:alpine@sha256:72ba65eb42c10344912a84ff42408db7d34f2feb642204570ab8fc5ffd29f1d3 AS runtime

WORKDIR /usr/share/nginx/html

ENV API_UPSTREAM=https://api.worldmonitor.app

# Copy built assets, nginx template (API_UPSTREAM substituted at startup), and entrypoint.
COPY --from=builder /app/dist/ ./
COPY docker/nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker/nginx-security-headers.conf /etc/nginx/security_headers.conf
COPY docker/nginx-oauth-authorize-security-headers.conf /etc/nginx/oauth_authorize_security_headers.conf
COPY docker/nginx-youtube-embed-security-headers.conf /etc/nginx/youtube_embed_security_headers.conf
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

CMD ["/docker-entrypoint.sh"]
