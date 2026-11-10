# Build the client and the bundled server, then ship only what runs.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY packages packages
RUN npm run build

# The server bundle inlines everything except socket.io, so production installs need only the server's dependencies.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev --workspace @chalkline/server --include-workspace-root=false

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages/server/dist packages/server/dist
COPY --from=build --chown=node:node /app/packages/client/dist packages/client/dist
USER node
# PORT comes from the environment (Render sets it); the server falls back to 3000.
EXPOSE 3000
CMD ["node", "packages/server/dist/index.cjs"]
