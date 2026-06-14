# Node 24 has the built-in node:sqlite module (no native build needed).
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install production deps using the lockfile for reproducible builds.
COPY package*.json ./
RUN npm ci --omit=dev

# App source.
COPY server ./server
COPY public ./public

# Default runtime config. PORT and JWT_SECRET are typically provided by the
# host; DB_PATH points at a mounted volume so data survives restarts.
ENV PORT=3000
ENV DB_PATH=/data/data.db
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server/index.js"]
