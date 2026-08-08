---
title: Docker 部署
description: 使用 Docker 容器快速部署 DocsKit 文档站点，支持数据挂载、环境变量配置和 Docker Compose。
order: 2
icon: container
---

# Docker 部署

DocsKit 提供预构建的 Docker 镜像 `zhuhanxin/docskit`，基于 Node.js 24 Alpine 构建，包含完整的运行环境和示例文档。容器化部署无需安装 Node.js，适合生产环境、CI/CD 流水线和团队协作。

## 快速启动

拉取镜像并启动容器：

```bash
docker run --rm -p 3000:3000 zhuhanxin/docskit
```

启动后访问 `http://127.0.0.1:3000` 查看文档站点。`--rm` 参数会在容器停止后自动清理，适合临时测试。

> [!NOTE]
> 上面的命令使用镜像内置的 `docs/` 内容。容器关闭后内容就会丢失。如需持久化文档，请参考[挂载文档目录](#挂载文档目录)。

## 挂载文档目录

将宿主机的文档目录挂载到容器内，实现文档持久化和实时编辑：

```bash
docker run --rm -p 3000:3000 \
  -v "$PWD/docs:/app/docs" \
  zhuhanxin/docskit
```

挂载后，修改宿主机 `docs/` 下的 Markdown 文件、目录结构或 `docs.config.json`，刷新浏览器即可看到变化。服务会监听文件变化并自动刷新索引。

Windows PowerShell：

```powershell
docker run --rm -p 3000:3000 `
  -v "${PWD}/docs:/app/docs" `
  zhuhanxin/docskit
```

### 只读挂载

如果只需要展示文档、不允许容器内修改，可以添加 `:ro` 标志：

```bash
docker run --rm -p 3000:3000 \
  -v "$PWD/docs:/app/docs:ro" \
  zhuhanxin/docskit
```

## 环境变量

通过 `-e` 参数传递环境变量，覆盖默认配置：

```bash
docker run --rm -p 3000:3000 \
  -v "$PWD/docs:/app/docs" \
  -e PORT=8080 \
  -e NODE_ENV=production \
  -p 8080:8080 \
  zhuhanxin/docskit
```

支持的环境变量：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 容器内监听端口 | `3000` |
| `HOST` | 容器内监听地址 | `0.0.0.0` |
| `NODE_ENV` | 运行环境 | `production` |
| `DOCS_DIR` | 文档目录路径（容器内路径） | `docs` |
| `DOCS_CONFIG` | 配置文件路径（容器内路径） | 文档目录下的 `docs.config.json` |

修改 `PORT` 时，需要同步调整 `-p` 端口映射。例如将服务端口改为 8080：

```bash
docker run --rm \
  -e PORT=8080 \
  -p 8080:8080 \
  -v "$PWD/docs:/app/docs" \
  zhuhanxin/docskit
```

## Docker Compose

对于需要持久运行的场景，推荐使用 Docker Compose。在项目根目录创建 `docker-compose.yml`：

```yaml
services:
  docskit:
    image: zhuhanxin/docskit:latest
    container_name: docskit
    ports:
      - "3000:3000"
    volumes:
      - ./docs:/app/docs
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 5s
      retries: 3
```

启动和管理：

```bash
# 后台启动
docker compose up -d

# 查看日志
docker compose logs -f docskit

# 停止
docker compose down

# 更新镜像
docker compose pull && docker compose up -d
```

## 健康检查

镜像内置了健康检查，Docker 和容器编排平台可以自动探测服务状态：

| 端点 | 说明 | 用途 |
| --- | --- | --- |
| `GET /healthz` | 返回服务健康状态 | 存活探针（Liveness） |
| `GET /readyz` | 检查文档目录和索引是否可读 | 就绪探针（Readiness） |

手动验证：

```bash
curl http://127.0.0.1:3000/healthz
# {"status":"ok","service":"docs-kit"}

curl http://127.0.0.1:3000/readyz
# {"status":"ready","service":"docs-kit","documents":5}
```

在 Kubernetes 中使用：

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 30
readinessProbe:
  httpGet:
    path: /readyz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

## 自定义镜像

如果需要在镜像中内置自定义文档或修改配置，可以基于官方镜像构建：

```dockerfile
FROM zhuhanxin/docskit:latest

# 复制自定义文档
COPY docs/ /app/docs/

# 复制自定义配置
COPY docs/docs.config.json /app/docs/docs.config.json
```

构建和运行：

```bash
docker build -t my-docskit .
docker run --rm -p 3000:3000 my-docskit
```

### 从源码构建

如果需要修改服务端代码或添加自定义功能，可以从源码构建镜像：

```bash
docker build -t my-docskit:dev .
docker run --rm -p 3000:3000 my-docskit:dev
```

项目根目录的 `Dockerfile` 基于 Node.js 24 Alpine，包含完整的依赖安装和文件复制。构建时会自动排除 `.git`、`node_modules`、`test` 等目录。

## 反向代理

在生产环境中，通常需要在 Nginx 或 Caddy 等反向代理后面运行：

```nginx
server {
    listen 80;
    server_name docs.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配合 HTTPS 和域名访问时，确保在 `docs.config.json` 的 `site.seo.canonical` 中配置完整的站点地址，以便生成正确的 sitemap 和 robots.txt。

## 常见问题

### 容器启动后立即退出

检查文档目录是否正确挂载：

```bash
docker run --rm -p 3000:3000 \
  -v "$PWD/docs:/app/docs" \
  zhuhanxin/docskit
```

如果 `docs/` 目录不存在或缺少 Markdown 文件，服务会启动但导航为空。确保目录中包含至少一个 `.md` 文件。

### 端口冲突

如果 3000 端口被占用，使用其他端口映射：

```bash
docker run --rm -p 8080:3000 zhuhanxin/docskit
```

访问地址变为 `http://127.0.0.1:8080`。

### 文件权限问题

容器以 `node` 用户（UID 1000）运行。如果挂载的文档目录权限不足，可能无法读取文件。调整宿主机目录权限：

```bash
chmod -R 755 docs/
```

### 镜像更新

拉取最新镜像并重建容器：

```bash
docker pull zhuhanxin/docskit:latest
docker stop docskit && docker rm docskit
docker run -d --name docskit -p 3000:3000 \
  -v "$PWD/docs:/app/docs" \
  zhuhanxin/docskit:latest
```

使用 Docker Compose 时只需：

```bash
docker compose pull && docker compose up -d
```
