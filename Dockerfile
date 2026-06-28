FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS frontend
COPY --from=build /app/packages/frontend/dist /app/frontend

FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/backend/dist ./packages/backend/dist
COPY --from=build /app/packages/backend/package.json ./packages/backend/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=frontend /app/frontend ./packages/frontend/dist
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "packages/backend/dist/index.js"]
