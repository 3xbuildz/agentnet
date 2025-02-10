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
RUN npm install

# Registry server build stage
FROM base AS registry
COPY --from=registry-deps /app/node_modules ./node_modules
COPY agent-network-protocol ./
EXPOSE 3000 
CMD ["node", "registryServer.js"]

# Chat website build stage
FROM base AS chat-builder
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

COPY . /app
WORKDIR /app/agent-network-protocol
RUN npm install

WORKDIR /app/websites/chat
RUN npm install

FROM base AS chat
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=chat-builder --chown=nextjs:nodejs /app/websites/chat ./
COPY --from=chat-builder --chown=nextjs:nodejs /app/agent-network-protocol /app/node_modules/agent-network-protocol

RUN npm install

USER nextjs
EXPOSE 3000
ENV PORT 3000
ENV NEXT_TELEMETRY_DISABLED 1

CMD ["npx", "next", "dev"]