# Public deployment. The Playwright image already has Chromium and its system
# libraries; its version must match the "playwright" package in package.json.
FROM mcr.microsoft.com/playwright:v1.64.0-noble

ENV NODE_ENV=production \
    PORT=8000 \
    CACHE_DIR=/app/.cache
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
# The cat list snapshot and the icon cache are rewritten at runtime.
RUN mkdir -p .cache && chown -R pwuser:pwuser data .cache

USER pwuser
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
