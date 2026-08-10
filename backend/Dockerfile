# Multi-stage Dockerfile for WhatsApp to Bitrix24 Backend Middleware

# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests and Prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY . .

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built application and dependencies
COPY --from=builder /app ./

# Run as non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 9191

# Sync database schema seamlessly and start production server
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node src/server.js"]

