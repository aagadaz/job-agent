# syntax=docker/dockerfile:1
# Recette de l'image de job-agent, en plusieurs étapes.

# Etape commune : Node.js 22 sur Alpine linux (très léger )

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --1. Installer les dépendances --

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --2. Compiler le site --

FROM deps AS builder
COPY . . 

#Valeurs FACTICES, utilisées seulement pendant la compilation (voir l'explication)

ENV NEXT_OUTPUT=standalone \
    DATABASE_URL=postgresql://build:build@localhost:5342/build \
    AUTH_SECRET=build-only-not-a-secret
RUN npm run build

# --3. Image finale : uniquement le site compilé --
FROM base AS app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -0 /dev/null http://127.0.0.1:3000/login || exit 1
CMD ["node", "server.js"]