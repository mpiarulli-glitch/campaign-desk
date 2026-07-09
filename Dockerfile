FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN mkdir -p /app/data
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3040
ENV HOSTNAME=0.0.0.0
EXPOSE 3040

# Railway/Render set PORT. Fall back to 3040 locally.
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3040}"]
