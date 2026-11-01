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

把 `server/api/plugin/dsh/` 整个目录复制到 MiraZero 仓库同路径：

```bash
cp -r mirazero-patch/server/api/plugin/dsh \
      /path/to/mirazero/server/api/plugin/dsh
```

然后重新构建并重启站点：

```bash
pnpm build
node .output/server/index.mjs
```

## 验证

```bash
curl -H "Authorization: Bearer mzi_xxx" \
  https://your-mirazero.example/api/plugin/dsh/status
```

返回 `{"ok":true,"pending":0,"fullContext":true,"modelId":"...","modelName":"..."}` 即生效。

已在 `origin/dev` 的 `deb295d`（Nuxt 4.4.8）上构建并通过完整链路验证：
公开请求 → 模型绑定 Key 读取完整 pending（含图片）→ 回复 → 客户端收到 200。

## 为什么需要补丁

新版 MiraZero 只提供客户端调用接口；`/api/integrations/v1` 不暴露待回复 payload。
DSH 插件需要完整 `payload`（含图片）才能在本地开 Session，因此提供方侧需要这三个
只读/回复端点。

补丁不修改现有路由，也不改变计费、历史或工作台行为。
