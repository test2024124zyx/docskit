FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY package.json ./
COPY server.js index.html script.js styles.css ./
COPY docs ./docs

USER node

EXPOSE 3000

# 健康检查只验证 HTTP 服务是否可以正常响应。
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
