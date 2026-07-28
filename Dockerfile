FROM node:24.4.1-alpine3.21

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
# 复制服务端拆分模块、Markdown 解析器和媒体类型规则，保证生产镜像与源码运行链路一致。
COPY server.js server-assets.js markdown.js media-types.js server-config.js server-filesystem.js server-lifecycle.js index.html script.js styles.css ./
COPY docs ./docs

USER node

EXPOSE 3000

# 就绪检查同时验证文档目录和索引是否可以读取。
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

STOPSIGNAL SIGTERM

CMD ["node", "server.js"]
