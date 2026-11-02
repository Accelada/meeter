FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
COPY --from=build --chown=node:node /app ./
ENV NODE_ENV=production TLS_TERMINATION=proxy HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "scripts/server.mjs"]
