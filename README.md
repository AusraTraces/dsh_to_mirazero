# dsh-to-mirazero

把 **DeepSeek Harness** 里跑的角色卡接到 **MiraZero** 站点，作为一个公开可调用、自动回复的模型；每个公开请求在独立的 MiraZero 工作区会话中处理，没有本机工具面。

> 适配新版 MiraZero（`origin/dev`，`deb295d` / Nuxt 4.4.8）：**模型绑定的第三方接入 Key（`mzi_`）** + `/api/integrations/v1`。

## 目录

| 路径 | 作用 |
|---|---|
| [`dsh-mirazero-bridge/`](dsh-mirazero-bridge/) | DSH Host 插件：轮询、Session 编排、角色卡、图片、隔离墙 |
| [`mirazero-patch/`](mirazero-patch/) | MiraZero 提供方补丁：用同一模型绑定 Key 暴露完整 pending 与回复接口 |

插件详细说明见 [dsh-mirazero-bridge/README.md](dsh-mirazero-bridge/README.md)，
安全契约见 [dsh-mirazero-bridge/ISOLATION.md](dsh-mirazero-bridge/ISOLATION.md)。

## 它怎么工作

```text
公开客户端
   │  OpenAI / Claude / Responses 兼容请求（可带图片）
   ▼
MiraZero 站点
   ├─ 标准接入：/api/integrations/v1/*（模型绑定 mzi_ Key）
   └─ 提供方补丁：/api/plugin/dsh/*（完整 pending + 历史 + 图片）
   │
   ▼
dsh-mirazero-bridge
   ├─ baseUrl + 模型绑定 Key（mzi_...）
   ├─ DSH 设置 → MiraZero：可视化连接与角色卡开关
   ├─ MiraZero 工作区：每个请求新建一个 DSH Session
   ├─ 角色卡作为 system prompt section（interpolate: false）
   ├─ 图片作为 Session 的 image part
   ├─ tools.restrict({ allow: [] }) + per-Session guard
   ├─ 可选自动检索 ctx.web.search()
   └─ 回复 → /api/plugin/dsh/reply
   │
   ▼
MiraZero 按原协议返回角色文本
```

## 快速开始

### 1. 在 MiraZero 创建模型绑定 Key

打开站点 **设置 → LLM 管理 → 模型设置 → 第三方接入 → Agent 平台**，为要公开的模型创建专用 Key：

```text
Base URL: https://你的站点/api/integrations/v1
API Key:  mzi_...
```

这个 Key **只绑定当前模型**，只能读取和回复该模型的请求；撤销后桥接立即失效。

### 2. 安装提供方补丁

新版 MiraZero 只提供客户端调用接口，因此需要把
[`mirazero-patch/server/api/plugin/dsh/`](mirazero-patch/server/api/plugin/dsh/)
复制到 MiraZero 仓库同路径，然后重新构建并重启站点：

```bash
pnpm build
node .output/server/index.mjs
```

补丁使用与 `/api/integrations/v1` 相同的 **模型绑定 Key** 验证（`verifyIntegrationKey`），
只返回该模型的 pending；撤销 Key 后桥接立即失效。

### 3. 安装 DSH 插件

把 `dsh-mirazero-bridge` 装进当前 profile：

```powershell
powershell -ExecutionPolicy Bypass -File .\dsh-mirazero-bridge\install.ps1
```

或在 DSH 中 **plugin → 添加插件**，选择 `dsh-mirazero-bridge` 目录。

重启 DSH，打开 **设置 → MiraZero**，填入：

```text
站点地址：https://你的站点
第三方接入 Key：mzi_...
自动开始轮询：开
```

也可以直接编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`：

```yaml
- id: dsh-mirazero-bridge
  name: 'dsh-mirazero-bridge'
  config:
    baseUrl: 'https://你的站点'
    apiKey: 'mzi_...'
    autoStart: true
```

设置页里的连接和角色卡设置会保存到 `$DSH_HOME/mirazero-bridge/`，优先于 YAML 默认值。

然后在对话中：

```text
mirazero_status
mirazero_start
```

设置页会显示运行状态、完整上下文、可用模型和上次错误；`api.fullContext` 为 `true`
表示新版模型绑定 Key + 补丁链路已就绪。

## 隔离墙

- 每个公开请求新建一个独立 Session，集中在 `$DSH_HOME/mirazero` 工作区；
- `tools.restrict({ allow: [] })` 移除全局工具面；
- `tools.guard()` 作为第二道墙，剩余工具调用在执行前被拦截；
- 文本保留 markdown/换行，图片作为 image part，不做纯文本归一化；
- 出站只允许配置站点的 `/api/plugin/*` 与 `/api/integrations/*`；
- 远程图片先解析 DNS，拒绝 loopback、RFC1918、链路本地、ULA、CGNAT；
- 审计默认不记正文。

完整残余风险与验证清单见 [ISOLATION.md](dsh-mirazero-bridge/ISOLATION.md)。

## 验证

```powershell
cd dsh-mirazero-bridge
node --test
```

34 项测试覆盖角色卡开关、lorebook、图片、私网拦截、模型绑定 Key、DSH 补丁缺失错误、
每个请求独立 Session、`allow: []`、guard、system prompt 注入、图片 part、设置页读写与
`settings.section` 注册。

已在新版 MiraZero（`origin/dev`，Nuxt 4.4.8）+ 补丁上跑通真实链路：
公开请求（含图片）→ 模型绑定 Key 读取完整 pending → 回复 → 客户端收到 `200`。

## 许可

MIT，见 [LICENSE](LICENSE)。
