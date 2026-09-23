FROM node:20-alpine AS build
WORKDIR /workspace

COPY package*.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY shared shared
COPY client client
RUN npm run build --workspace shared && npm run build --workspace client

FROM nginx:1.27-alpine AS runtime
COPY client/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/client/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
