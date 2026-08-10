# Stage 1: Build the Vite React Frontend
FROM node:20-alpine AS build

WORKDIR /app

# Copy package manifests to cache dependency installation
COPY package*.json ./

# Install frontend dependencies
RUN npm install

# Copy source code and config files
COPY . .

# Build production static assets into /app/dist
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:stable-alpine AS production

WORKDIR /usr/share/nginx/html

# Remove default Nginx static files
RUN rm -rf /usr/share/nginx/html/*

# Copy built frontend assets from Stage 1 (matches outDir in vite.config.js)
COPY --from=build /public /usr/share/nginx/html

# Copy container Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Set proper permissions
RUN chmod -R 755 /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

