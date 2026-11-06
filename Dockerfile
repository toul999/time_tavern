FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Ship program files and initialization defaults only, never personal data.
COPY --chown=node:node src/ ./src/
COPY --chown=node:node defaults/ ./defaults/
RUN mkdir -p /app/data && chown node:node /app /app/data

# Keep the internal port stable when importing settings from another device.
ENV NODE_ENV=production \
    PORT=3234 \
    TIME_TAVERN_RESTART_MODE=container

USER node
EXPOSE 3234

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3234/',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Skip the Git updater. A data import is applied before settings/state are loaded.
CMD ["node", "src/index.js"]
