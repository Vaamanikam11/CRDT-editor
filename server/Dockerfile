FROM node:20-alpine AS build
WORKDIR /workspace

COPY package*.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY shared shared
COPY server server
RUN npm run build --workspace shared && npm run build --workspace server

FROM node:20-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production

COPY package*.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci --omit=dev

COPY --from=build /workspace/shared/dist shared/dist
COPY --from=build /workspace/server/dist server/dist

EXPOSE 3000
CMD ["node", "server/dist/index.js"]
