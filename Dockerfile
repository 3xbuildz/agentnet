# Base stage with shared configuration
FROM node:18-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies stage for agent-network-protocol
FROM base AS registry-deps
COPY agent-network-protocol/package*.json ./
RUN npm install

# Dependencies stage for chat website
FROM base AS chat-deps
COPY websites/chat/package*.json ./
COPY websites/chat/agents/*/package*.json ./agents/
RUN cd agents && for d in */ ; do cd "$d" && npm install && cd .. ; done
RUN npm install

# Registry server build stage
FROM base AS registry
COPY --from=registry-deps /app/node_modules ./node_modules
COPY agent-network-protocol ./
EXPOSE 3000
CMD ["node", "registryServer.js"]

# Chat website build stage
FROM base AS chat-builder
COPY --from=chat-deps /app/node_modules ./node_modules
COPY --from=chat-deps /app/agents/*/node_modules ./agents/*/node_modules
COPY agent-network-protocol ./agent-network-protocol
WORKDIR /app/agent-network-protocol
RUN npm install

WORKDIR /app
COPY websites/chat .
RUN NEXT_PRIVATE_STANDALONE=true npm run build

# Chat website production stage
FROM base AS chat
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs \
    && chown -R nextjs:nodejs /app

COPY --from=chat-builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=chat-builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=chat-builder --chown=nextjs:nodejs /app/public ./public
COPY --from=chat-builder --chown=nextjs:nodejs /app/agents ./agents

USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV NEXT_TELEMETRY_DISABLED=1

CMD ["node", "server.js"]