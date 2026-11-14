# Сборка TypeScript
FROM node:22-alpine AS build
WORKDIR /app
COPY shared/contracts /shared/contracts
COPY reports-api/package.json reports-api/package-lock.json ./
RUN npm ci
COPY reports-api/tsconfig.json ./
COPY reports-api/src ./src
RUN npm run build

# Запуск: только собранный код и production-зависимости
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY shared/contracts /shared/contracts
COPY reports-api/package.json reports-api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8000
CMD ["node", "dist/index.js"]
