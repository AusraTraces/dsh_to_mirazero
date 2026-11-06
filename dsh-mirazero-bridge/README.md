# dsh-mirazero-bridge

把 DeepSeek Harness 里跑的角色卡接到 MiraZero 站点，作为一个**公开可调用、自动回复**的模型。

每个公开请求都会在 **MiraZero 工作区**里新建一个独立的 DSH 会话；会话可以收发文字和图片，但**没有任何可执行工具**。回复通过 MiraZero 的第三方插件 API 和 Key 发回。

> `https://dev.huahouse.asia/Ausra/mirazero` 是 MiraZero 的源码仓库（需要登录）。插件连接的是**部署后的 MiraZero 站点**，例如 `https://mira.example.com`。

## 工作流

```text
公开客户端
   │  OpenAI / Claude / Responses 兼容请求（可带图片）
   ▼
MiraZero 站点（新版：模型绑定 mzi_ Key + /api/integrations/v1）
   ├─ 客户端调用：/api/integrations/v1/*（仅绑定模型）
   └─ DSH 提供方接口：/api/plugin/dsh/*（完整 payload + 历史 + 图片）
   │
   ▼
dsh-mirazero-bridge
   ├─ 用 baseUrl + 模型绑定 Key 调用提供方接口
   ├─ DSH 设置 → MiraZero：连接、启用角色卡、角色卡可视化编辑
   ├─ MiraZero 工作区：每个请求新建一个 Session
   ├─ 角色卡作为 system prompt section（interpolate: false）
   ├─ 图片作为 Session prompt 的 image part
   ├─ 工具面清零：tools.restrict({ allow: [] }) + per-Session guard
   ├─ 可选自动检索：ctx.web.search()（只发查询词）
   └─ 回复 → /api/plugin/dsh/reply
   │
   ▼
MiraZero 按原协议返回角色文本
```

## 快速开始（两步）

### 1. 在 MiraZero 上创建模型绑定 Key

新版 MiraZero 的第三方接入入口在 **模型设置 → 第三方接入 → Agent 平台**：

1. 先保存要公开的模型；
2. 在该模型下创建专用 Key（`mzi_...`），复制出来；
3. 复制 Base URL（`https://站点/api/integrations/v1`）与模型 ID。

这个 Key **只绑定当前模型**，同时用于标准 `/api/integrations/v1` 和 DSH 提供方接口；
撤销 Key 后桥接立即失效，不影响其他模型或普通用户 Key。

DSH 提供方接口由 MiraZero 站点运维启用。站点没有启用时，插件会明确报
`DSH_PATCH_MISSING`，不会静默空转。

### 2. 在 DSH 设置里填连接

安装插件：

```text
plugin → 添加插件 → E:\dshtomirazero\dsh-mirazero-bridge
```

或在命令行：

```powershell
powershell -ExecutionPolicy Bypass -File E:\dshtomirazero\dsh-mirazero-bridge\install.ps1
```

重启 DSH，打开 **设置 → MiraZero**：

- **站点地址**：`https://你的站点`（也可粘贴 `/api/integrations/v1` 结尾的 Base URL）；
- **第三方接入 Key**：`mzi_...`；
- **自动开始轮询**：打开；
- **检查连接**：验证 Key 并读取绑定模型；
- **角色卡**：一个“启用角色卡”开关，以及名字、简介、性格、说话方式。

设置页固定使用中文，不跟随 DSH 的英文界面切换。

保存后立即生效；正在轮询时，连接变化会自动重启桥接。设置写入
`$DSH_HOME/mirazero-bridge/connection.json` 与 `character.json`，优先于 YAML 默认值。

也可以直接编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`：

```yaml
- id: dsh-mirazero-bridge
  name: 'dsh-mirazero-bridge'
  config:
    baseUrl: 'https://你的站点'
    apiKey: 'mzi_...'
    autoStart: true
```

然后在对话中：

```text
mirazero_status
mirazero_start
```

看到 `running: true`，且 `api.fullContext: true`，就表示每个公开请求都会在
MiraZero 工作区里开一个独立会话。

公开调用示例：

```bash
curl https://mira.example.com/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_SITE_KEY' \
  -d '{"model":"mira","stream":false,"messages":[{"role":"user","content":"你好"}]}'
```

## 角色卡

角色卡是结构化的，不再是单一 `persona` 字符串。默认字段：

| 字段 | 作用 |
|---|---|
| `enabled` | 角色卡总开关；关掉后是中性文字端点 |
| `name` | 角色名 |
| `description` | 简介 |
| `personality` | 性格 |
| `scenario` | 当前场景 |
| `speechStyle` | 说话方式 |
| `relationship` | 对对方的态度 |
| `likes` / `boundaries` | 喜好与边界 |
| `exampleDialogue` | few-shot 语气示例 |
| `firstMessage` | 角色开场（可选） |
| `authorNote` | 作者注 |
| `postHistory` | 本轮附加要求 |
| `lorebook` | `[{ keys, content, enabled }]`，命中关键词才注入 |

这些结构参考了当前 DSH 角色卡项目的做法：

- [dsh-persona-L](https://github.com/ShiLaiM/dsh-persona-L)：结构化自我认知、运行时场景/心情/关系、长期记忆；
- [dsh-cosplay](https://github.com/liceses/dsh-cosplay)：角色卡作为 system prompt section 注入，`interpolate: false`，尾部回声明；
- [dsh-companion](https://github.com/suis077/dsh-companion)：人设卡 + 跨会话记忆 + 好感度。

本插件取的是**卡片结构、注入位置、尾部回声明、lorebook、示例对话、作者注**这些
对公开端点稳定有用的部分；没有引入跨会话记忆与好感度，因为 MiraZero 每个请求
本身就是一个独立 Session。

### 唯一的开关：启用角色卡

设置页只保留一个功能开关：

| 开关 | 默认 | 作用 |
|---|---|---|
| `enabled` | 开 | 开：注入完整角色卡；关：使用中性助手回复 |

图片、站点历史、lorebook、示例对话、自动检索等能力作为固定行为保留，
不再暴露成开关。运行时可以改角色卡内容：

```text
mirazero_character { patch: { "enabled": false } }
mirazero_character { patch: { "personality": "更温和一些", "lorebook": [] } }
```

修改会写到 `$DSH_HOME/mirazero-bridge/character.json`。

## 配置参考

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | 空 | 站点根地址；`/api/integrations/v1` 结尾会自动归一化 |
| `apiKey` | 空 | 模型绑定第三方接入 Key（`mzi_...`）；也可用环境变量 `MIRAZERO_INTEGRATION_KEY` |
| `autoStart` | `false` | 插件加载后自动轮询 |
| `models` | `[]` | 只回复这些模型；空 = 全部 |
| `workspacePath` | `$DSH_HOME/mirazero` | MiraZero 工作区目录 |
| `workspaceTitle` | `MiraZero` | 工作区显示名 |
| `pollIntervalMs` | `3000` | 轮询间隔 |
| `replyTimeoutMs` | `180000` | 单请求生成超时 |
| `maxInputChars` | `24000` | 文本上限 |
| `maxHistoryMessages` | `40` | 消息条数上限 |
| `maxReplyChars` | `6000` | 回复上限 |
| `maxAttempts` | `3` | 单请求失败重试次数 |
| `answerTitles` | `true` | 本地规则回答 ChatBox 标题请求 |
| `provider` / `model` | 空 | 指定 Session 模型；留空用 DSH 默认 |
| `response.pov` | `first` | `first` / `third` |
| `response.length` | `medium` | `short` / `medium` / `long` |
| `response.format` | `chat` | `chat` / `novel` / `rp` |
| `media.maxImages` | `4` | 单请求图片上限 |
| `media.maxImageBytes` | `8388608` | 单图字节上限 |
| `media.fetchTimeoutMs` | `10000` | 公网图片抓取超时 |
| `search.mode` | `auto` | `off` / `auto` / `always` |
| `search.maxResults` | `5` | 检索来源上限 |
| `isolation.audit` | `true` | 写 `audit.jsonl` |
| `isolation.auditContent` | `false` | 审计是否记正文预览 |

## 工具

这些工具只给**本机 DSH 用户/agent**；MiraZero 请求进入的是隔离 Session，不经过这里。

| 工具 | 作用 |
|---|---|
| `mirazero_status` | API 模式、是否全量上下文、工作区、会话数、角色卡状态 |
| `mirazero_start` / `mirazero_stop` | 启停轮询 |
| `mirazero_pending` | 查看待回复请求 |
| `mirazero_answer` | 人工回复并完成一条 |
| `mirazero_models` | 查看站点模型 |
| `mirazero_character` | 读取/修改结构化角色卡，含“启用角色卡”开关 |
| `mirazero_isolation` | 打印隔离墙契约 |

## 诊断路由

前缀 `/.dsh-mirazero-bridge`：

```text
GET  /status
GET  /health
GET  /config
POST /config       { baseUrl, apiKey?, autoStart, clearApiKey? }
GET  /isolation
GET  /pending?limit=20
GET  /audit?limit=50
GET  /models
GET  /character
POST /character
POST /start
POST /stop
POST /answer       { id, response }
```

## 隔离墙

每个 MiraZero 请求对应一个新建 Session：

- `tools.restrict({ allow: [] })` 移除全局工具面；
- `tools.guard(() => '...')` 作为第二道墙，任何剩余的（含 Session 自有）工具调用在执行前被拒绝；
- 角色卡通过 `agent.ctx.systemPrompt.section({ interpolate: false })` 注入；
- 客户端 system prompt 只作为围栏内的角色资料；
- `tool`/`function` 消息丢弃，图片保留；
- 出站只允许配置 `baseUrl` 的 `/api/plugin/*` 与 `/api/integrations/*`，重定向直接报错；
- 公网图片抓取会先解析 DNS，拒绝 localhost、RFC1918、链路本地、ULA 等地址；
- 审计写 `$DSH_HOME/mirazero-bridge/audit.jsonl`，默认不记正文。

细节与残余风险见 [ISOLATION.md](ISOLATION.md)。

## 验证

```powershell
cd E:\dshtomirazero\dsh-mirazero-bridge
node --check index.js
node --test
```

当前覆盖：**34 项测试**，包括

- 角色卡结构与启用开关、lorebook 命中；
- 图片 data URL / Anthropic base64 / 远程 URL / 私网拒绝；
- 文本格式保留、工具消息丢弃；
- 模型绑定 Key 的 Bearer / `x-api-key`、`/api/integrations/v1/models`、`/api/plugin/dsh/*`；
- 设置页读写、Key 掩码、`settings.section` 注册；
- 缺少 DSH 提供方接口时的可操作错误；
- 每个请求独立 Session、工作区归属、`allow: []`、guard、system prompt 注入、图片 part。

已在新版 MiraZero（`origin/dev`，Nuxt 4.4.8）+ DSH 提供方接口上跑过真实链路：

1. 登录创建模型，并在模型设置中创建 **绑定该模型的接入 Key**（`mzi_...`）；
2. `GET /api/integrations/v1/models` 用该 Key 返回模型；
3. 公开 `POST /v1/chat/completions`（含图片）产生 pending；
4. `GET /api/plugin/dsh/requests` 用同一 Key 取到完整 `payload`，图片存在；
5. `POST /api/plugin/dsh/reply` 回复；
6. 公开调用收到 `200`，内容为回复文本。

## 常见问题

### MiraZero 发消息，DSH 不显示会话也不回复

先看 **设置 → MiraZero** 的“上次错误”，或在对话里运行 `mirazero_status`。

如果站点返回的是 **HTML 页面** 而不是 JSON，说明站点还没有启用 DSH 提供方接口：

```text
MiraZero returned an HTML page for the DSH provider API
```

验证：

```bash
curl -H "Authorization: Bearer mzi_xxx" \
  https://api.huahouse.asia/api/plugin/dsh/status
```

- 返回 `{"ok":true,"pending":...,"fullContext":true,"modelId":"...","modelName":"..."}`：提供方接口已生效；
- 返回 `<!DOCTYPE html>`：提供方接口未启用，请求没有进入桥接。

修复：联系 MiraZero 站点运维启用 DSH 提供方接口，再在设置页点“检查已保存连接”。

### 检查连接显示 Key 无效

- Key 必须是 **模型设置 → 第三方接入 → Agent 平台** 创建的 `mzi_...`；
- 普通用户 API Key（`mz_...`）不能用于这个接口；
- 模型必须已保存、在线，且属于 Key 所属账号。

## 已知限制

- 站点没有启用 DSH 提供方接口时，插件会报 `DSH_PATCH_MISSING`，不会退回预览。
- 提供方接口按模型绑定 Key 过滤 pending；Key 只覆盖绑定的那个模型，撤销立即失效。
- 公开模型必须属于该 Key 对应的站点账号，且 `api.enabled = false`、`public = true`、`status = online`。
- 角色卡不引入跨会话记忆；跨请求连续性由客户端历史与 MiraZero `history` 提供。
