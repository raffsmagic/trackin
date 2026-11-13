# Self-hosted trackin ingest server: POST /events, stored in SQLite.
#   docker build -t trackin .
#   docker run -p 3000:3000 -v trackin-data:/data trackin
FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
ENV PORT=3000 DB_PATH=/data/trackin.sqlite
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun
EXPOSE 3000
CMD ["bun", "run", "src/server.ts"]
