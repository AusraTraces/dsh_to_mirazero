# dsh-to-mirazero

DeepSeek Harness（DSH）Host 插件：把 DSH 里运行的角色卡接到 MiraZero 的模型上，作为公开可调用、自动回复的角色。

每个公开请求都会在 **MiraZero 工作区**里新建一个独立的 DSH 会话；会话可以收发文字和图片，但没有可执行工具。

## 说明

- 本仓库只包含 **DSH 端插件**与使用说明。
- 插件通过 MiraZero 的模型绑定第三方接入 Key（`mzi_...`）连接站点。
- 站点需要由运维提供 DSH 提供方接口；插件检测不到时会明确报错，不会静默空转。

## 功能

- 一个公开请求 = 一个独立 DSH 会话，集中在 `$DSH_HOME/mirazero` 工作区；
- 角色卡以 system prompt section 注入（`interpolate: false`）；
- 支持文字与图片，保留 markdown 与换行；
- 命中检索意图时由插件先调用宿主 `ctx.web.search()`；
- 工具面清零：`tools.restrict({ allow: [] })` + 每会话 guard；
- 设置页可视化填写站点地址、接入 Key，检查连接、启停轮询；
- 设置页只保留一个功能开关：**启用角色卡**；
- 中文设置界面；
- 审计写入 `$DSH_HOME/mirazero-bridge/audit.jsonl`，默认不记正文。

## 安装

把 `dsh-mirazero-bridge` 装进当前 profile：

```powershell
powershell -ExecutionPolicy Bypass -File .\dsh-mirazero-bridge\install.ps1
```

或在 DSH 中 **plugin → 添加插件**，选择 `dsh-mirazero-bridge` 目录。

## 配置

重启 DSH，打开 **设置 → MiraZero**：

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

## 使用

```text
mirazero_status
mirazero_start
```

设置页会显示运行状态、完整上下文、绑定模型和上次错误。

## 角色卡

角色卡是结构化字段：

| 字段 | 作用 |
|---|---|
| `enabled` | 是否启用角色卡；关闭后使用中性助手回复 |
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

设置页只暴露“启用角色卡”这一个开关；图片、历史、lorebook、示例、自动检索作为固定行为保留。

## 工具

| 工具 | 作用 |
|---|---|
| `mirazero_status` | API 模式、完整上下文、工作区、会话数、角色卡状态 |
| `mirazero_start` / `mirazero_stop` | 启停轮询 |
| `mirazero_pending` | 查看待回复请求 |
| `mirazero_answer` | 人工回复并完成一条 |
| `mirazero_models` | 查看绑定模型 |
| `mirazero_character` | 读取/修改角色卡与启用开关 |
| `mirazero_isolation` | 打印隔离墙契约 |

## 隔离墙

- 每个公开请求新建一个独立 Session；
- 全局工具面通过 `tools.restrict({ allow: [] })` 移除；
- 每会话 guard 在执行前拦截剩余工具调用；
- 客户端 system prompt 只作为围栏内的角色资料；
- 出站只允许配置站点的 `/api/plugin/*` 与 `/api/integrations/*`；
- 公网图片先解析 DNS，拒绝 loopback、RFC1918、链路本地、ULA、CGNAT；
- 审计默认不记正文。

## 验证

```powershell
cd dsh-mirazero-bridge
node --test
```

34 项测试覆盖角色卡开关、lorebook、图片、私网拦截、模型绑定 Key、缺少提供方接口、
每个请求独立 Session、`allow: []`、guard、system prompt 注入、图片 part、设置页读写与
`settings.section` 注册。

## 许可

MIT，见 [LICENSE](LICENSE)。
