FROM node:24.17.0-bookworm-slim

ENV NODE_ENV=production \
    SHARDS_TASK_STORE_PATH=/data/tasks.json
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /data \
    && chown node:node /data \
    && chmod 0700 /data

USER node
CMD ["npm", "start"]
