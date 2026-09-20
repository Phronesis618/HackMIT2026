FROM node:26.7.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:26.7.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/fixtures ./fixtures
# The whole prompts/ tree, not just prompts/runtime: src/server/generation/exemplars.ts
# readdir()s prompts/exemplars/ on the first live generation. Copying only runtime/ made
# every live request throw ENOENT and silently fall back to a fixture world.
# `node scripts/check-docker-context.mjs` guards this.
COPY --from=build --chown=node:node /app/prompts ./prompts
COPY --from=build --chown=node:node /app/design ./design
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
