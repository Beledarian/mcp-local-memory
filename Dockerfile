FROM node:22-bookworm-slim

# Install minimal build tools for native SQLite addons
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
COPY vendor/ ./vendor/
COPY extensions/ ./extensions/

RUN npm run build

ENV NODE_ENV=production
ENV MEMORY_DB_PATH=/data/memory.db
ENV EXTENSIONS_PATH=/data/extensions
ENV MCP_TRANSPORT=sse
ENV PORT=8320
ENV HOST=0.0.0.0

VOLUME ["/data"]

EXPOSE 8320

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8320/health || exit 1

CMD ["node", "dist/index.js"]
