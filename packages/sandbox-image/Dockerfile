# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Raltic Sandbox Container
# ─────────────────────────────────────────────────────────────────────────────
# One image per Agent. Holds the OS toolchain the agent needs + a thin RPC
# daemon (@raltic/sandbox-daemon). NO AI CLI is preinstalled — the agent
# loop runs in RalticAgent DO (Worker side), this container only executes
# tool calls dispatched over HTTP.
#
# Target size: ~350 MB. Track with `docker images raltic-sandbox:*`.

# ── Stage 1: build the daemon (bundle into a single file) ───────────────────
FROM node:20-alpine AS daemon-build
WORKDIR /build

# Copy only what the daemon needs — keeps build cache hot on workspace-level edits.
COPY packages/sandbox-daemon/package.json packages/sandbox-daemon/tsconfig.json ./
COPY packages/sandbox-daemon/src ./src

RUN npm install --omit=dev --silent \
  && npm install --save-dev typescript@5.8 --silent \
  && npx tsc \
  && rm -rf node_modules \
  && npm install --omit=dev --silent

# ── Stage 2: runtime image ──────────────────────────────────────────────────
FROM node:20-alpine

# tini handles PID-1 signal forwarding so SIGTERM from CF Containers
# actually kills the daemon (and its bash children). Without tini, node
# becomes PID 1 and signals get silently ignored.
RUN apk add --no-cache \
      tini \
      bash \
      git \
      github-cli \
      curl \
      ca-certificates \
      jq \
      ripgrep \
      python3 \
      py3-pip \
      build-base \
  && rm -rf /var/cache/apk/*

# Non-root user — agents shouldn't run as root even inside a container.
# The /workspace mount will be chowned to this user by the container runtime.
RUN addgroup -S -g 10001 raltic \
  && adduser  -S -G raltic -u 10001 -h /home/raltic -s /bin/bash raltic

# ── Daemon binary ──────────────────────────────────────────────────────────
WORKDIR /opt/raltic/daemon
COPY --from=daemon-build /build/dist ./dist
COPY --from=daemon-build /build/node_modules ./node_modules
COPY --from=daemon-build /build/package.json ./package.json

# ── Workspace mount point ──────────────────────────────────────────────────
RUN mkdir -p /workspace && chown -R raltic:raltic /workspace /opt/raltic

USER raltic
WORKDIR /workspace

ENV NODE_ENV=production
ENV RALTIC_SANDBOX_WORKSPACE=/workspace
ENV RALTIC_SANDBOX_PORT=8080
# RALTIC_SANDBOX_TOKEN is injected at container start by the DO; refusal
# to start if missing is enforced in src/server.ts.

EXPOSE 8080

# Liveness probe: the daemon exposes /health for CF Container health checks.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/opt/raltic/daemon/dist/server.js"]
