# Base stage with shared configuration
FROM node:18-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies stage - optimized for caching
FROM base AS deps
RUN apk add --no-cache python3 make g++ libc6-compat \
    && ln -sf python3 /usr/bin/python

# Pack the agent-network-protocol
COPY agent-network-protocol/package*.json ./agent-network-protocol/
COPY agent-network-protocol/src ./agent-network-protocol/src
COPY agent-network-protocol/tsconfig.json ./agent-network-protocol/
WORKDIR /app/agent-network-protocol
RUN npm install
RUN npm pack

# Install chat and agent dependencies
WORKDIR /app
COPY websites/chat/package*.json ./
COPY websites/chat/agents/*/package*.json ./agents/
RUN cd agents && for d in */ ; do cd "$d" && npm install && cd .. ; done
RUN npm ci && \
    npm install ./agent-network-protocol/agent-network-protocol-*.tgz

# Builder stage
FROM base AS builder
ARG NODE_ENV=production
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NODE_ENV=$NODE_ENV
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/agents/*/node_modules ./agents/*/node_modules
COPY websites/chat .
RUN NEXT_PRIVATE_STANDALONE=true npm run build

# Production stage - minimal final image
FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs \
    && chown -R nextjs:nodejs /app

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/agents ./agents

USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV NEXT_TELEMETRY_DISABLED=1

CMD ["node", "server.js"] 