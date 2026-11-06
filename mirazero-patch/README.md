# MiraZero → DSH 第三方插件接口

新版 MiraZero 的“第三方接入”创建的是**模型绑定的专用 Key**（`mzi_...`），标准入口是
`/api/integrations/v1`（用于调用该模型）。这组补丁在同一套 Key 上增加
**提供方侧**的完整待回复接口，让 DSH 角色可以接住公开请求：

```text
GET  /api/plugin/dsh/status
GET  /api/plugin/dsh/requests?limit=10
POST /api/plugin/dsh/reply   { id, response, finish }
```

鉴权使用模型设置 → 第三方接入 → Agent 平台创建的专用 Key：

```http
Authorization: Bearer mzi_...
```

也接受 `X-API-Key`。补丁调用 `verifyIntegrationKey`，只允许访问 Key 绑定的那个模型；
Key 一撤销，DSH 桥接立即失效，不影响其他模型或普通用户 Key。

## 安装

补丁是 **MiraZero 服务端文件**，必须放到 MiraZero 服务器，不是放到 DSH 电脑上。

### 方法 A：上传脚本并执行（推荐）

在本地仓库目录执行：

```bash
scp -r mirazero-patch root@122.228.216.95:/opt/dsh-mirazero-patch
ssh root@122.228.216.95
```

登录服务器后：

```bash
# 确认 MiraZero 实际目录（示例是 /opt/mirazero）
ls /opt/mirazero/package.json

sudo systemctl stop mirazero
bash /opt/dsh-mirazero-patch/install.sh /opt/mirazero
sudo systemctl restart mirazero
sudo systemctl status mirazero --no-pager
```

`install.sh` 会：复制 `server/api/plugin/dsh` → `pnpm install` →
重建 `better-sqlite3` → `pnpm build`。它不会自动停服务，所以上面先 stop。

如果服务用 PM2：

```bash
pm2 stop mirazero
bash /opt/dsh-mirazero-patch/install.sh /opt/mirazero
pm2 restart mirazero
```

### 方法 B：手动复制

```bash
cd /opt/mirazero
sudo systemctl stop mirazero
mkdir -p server/api/plugin/dsh
cp -a /opt/dsh-mirazero-patch/server/api/plugin/dsh/. server/api/plugin/dsh/
pnpm install --frozen-lockfile
npm_config_build_from_source=true pnpm rebuild better-sqlite3
pnpm run build
sudo systemctl restart mirazero
```

### 方法 C：Docker

如果 MiraZero 跑在 Docker 里，补丁必须进镜像，不能只复制到容器：

```bash
# 在 Dockerfile 的源码层加入 server/api/plugin/dsh/ 后
docker compose build --no-cache
docker compose up -d
```

## 验证

```bash
curl -H "Authorization: Bearer mzi_xxx" \
  https://your-mirazero.example/api/plugin/dsh/status
```

返回 JSON 即生效：

```json
{"ok":true,"pending":0,"fullContext":true,"modelId":"...","modelName":"..."}
```

如果仍然返回 `<!DOCTYPE html>`，说明服务还在跑旧的 `.output`，或者补丁没有进镜像；
检查是否执行了 `pnpm build` 并重启了服务。

已在 `origin/dev` 的 `deb295d`（Nuxt 4.4.8）上构建并通过完整链路验证：
公开请求 → 模型绑定 Key 读取完整 pending（含图片）→ 回复 → 客户端收到 200。

## 为什么需要补丁

新版 MiraZero 只提供客户端调用接口；`/api/integrations/v1` 不暴露待回复 payload。
DSH 插件需要完整 `payload`（含图片）才能在本地开 Session，因此提供方侧需要这三个
只读/回复端点。

补丁不修改现有路由，也不改变计费、历史或工作台行为。
