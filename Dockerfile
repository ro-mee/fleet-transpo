# FleetOps web — HostForge "Use my own Dockerfile" mode.
#
# Why this exists: the platform-generated Dockerfile ships the full ~700MB
# node_modules plus a ~12-minute interactive-session setup step, and the
# resulting ~1GB image then spends ~13 minutes in export/unpack — together
# they exceed the 2400s build limit on a slow node. This file builds the
# Next.js standalone server instead (~150MB runtime) and skips the
# platform setup step, so a cold build fits comfortably in the limit.
#
# Contract with the platform (see their Build Configuration docs):
# - Build env: NEXT_PUBLIC_* values must be present at build time (the app's
#   own next.config.mjs fails the build without NEXT_PUBLIC_SUPABASE_URL).
#   No ARG/ENV is declared for them here on purpose — like the generated
#   Dockerfile, this file reads whatever the platform makes available to the
#   build. If a custom-mode build ever reports them missing, add matching
#   ARG lines (or set them as build args in the UI) rather than hardcoding.
# - Runtime env: PORT and HOSTNAME are read by the standalone server
#   (defaults 3000 / 0.0.0.0 below are fallback only — never hardcode the
#   platform's PORT). All other secrets arrive as container env, exactly
#   like the generated image; nothing secret is COPYd in (.dockerignore
#   excludes .env* and the standalone server never reads .env files).
# - Health: HostForge infers nothing from a custom Dockerfile, so the
#   probe path (/api/health) and this HEALTHCHECK are both explicit.
#   The app listens on 0.0.0.0 (HOSTNAME) so the edge can reach it.
#
# Base is node:24-alpine (not 22): geoip-lite@2.0.3 declares
# engines { node: ">=24" }, and local dev runs Node 26.

# ---- dependencies (rebuilt only when the lockfile changes) ----
FROM docker.io/library/node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build (needs NEXT_PUBLIC_* in the build environment) ----
FROM docker.io/library/node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime (standalone server + static assets only) ----
FROM docker.io/library/node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health | grep -q '"ok":true' || exit 1
CMD ["node", "server.js"]
