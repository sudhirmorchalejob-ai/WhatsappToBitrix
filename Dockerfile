# Multi-stage Dockerfile for WhatsApp to Bitrix24 Middleware

# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency definitions and Prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies including devDependencies for Prisma generation
RUN npm ci

# Generate Prisma Client code
RUN npx prisma generate

# Copy application source code
COPY . .

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy dependencies and built application from builder stage
COPY --from=builder /app ./

# Security: run application as a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 9191

# Run database migrations and start production server
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
