# 隔离墙契约

MiraZero 请求是**外部输入**。本插件让角色文本与图片可以被公开调用，但请求在结构上
没有可执行工具。隔离墙做在 **Session 边界**，不是靠文本归一化。

## 1. 每个请求一个隔离 Session

```text
MiraZero pending request
   → 新建 DSH Session（MiraZero 工作区）
   → agent/created:
        tools.restrict({ allow: [] })        // 移除全局工具面
        tools.guard(() => '... no tool access') // 第二道墙：执行前一律拒绝
        systemPrompt.section({ interpolate:false, text: 角色卡 })
   → sessionController.prompt({ content: [text, image...] })
   → assistant-stream 收集文本
   → /api/plugin/dsh/reply
```

| 关注点 | 实现 |
|---|---|
| 工具 | `tools.restrict({ allow: [] })` + `tools.guard()`，二者都在 `agent.ctx` 上 |
| Session 归属 | 每个请求新建 Session，加入 `MiraZero` 工作区；不同请求不复用 |
| 角色卡 | `agent.ctx.systemPrompt.section`，`interpolate:false` |
| 图片 | `sessionController.prompt` 的 `image` part；不是文件路径、不是 URL |
| 文本 | 保留 markdown/换行；只清控制字符 |
| 工具消息 | `role: tool/function` 丢弃；不伪造可信工具结果 |
| 客户端 system | 围栏内的“角色资料”，不进入指令层 |
| 出站 | 只允许 `baseUrl` 的 `/api/plugin/*` 与 `/api/integrations/*`；重定向直接报错 |
| 图片抓取 | 只允许公网地址；DNS 解析后拒绝 loopback/RFC1918/链路本地/ULA |
| 审计 | `$DSH_HOME/mirazero-bridge/audit.jsonl`，默认不记正文 |

## 2. 为什么不用文本归一化

旧版本把所有内容压成纯文本，导致图片、markdown、角色卡格式都被丢掉。现在：

- 文本保留原始换行与 markdown；
- 图片进入 Session 前只做 media type / base64 / 大小检查；
- 多模态由 DSH 自己的 `SessionPromptRequest` 支持，不需要插件发明协议；
- 防本机操作靠**工具面归零**，不是靠删字。

## 3. 工具墙的两层

1. **可见性**：`agent.ctx.tools.restrict({ allow: [] })` 让该 Session 看不到任何全局工具。
2. **执行**：`agent.ctx.tools.guard(() => 'MiraZero external request: no tool access')`。
   `guard` 在 `tools/pre-execute` 之后同步执行，任何仍可见的工具调用（包括 Session
   自己注册的）都会被拒绝。

只有一层时，某个 scoped tool 仍可能露出；两层同时存在才算闭环。

## 4. 图片边界

- 接受 OpenAI `image_url`（data URL 或 http(s)）、Anthropic base64/url、Responses
  `input_image`。
- data URL 只接受 `image/png|jpeg|webp|gif`，重新编码为 canonical base64。
- 远程图片默认允许，但抓取前：
  - 只允许 http/https；
  - 解析 DNS，任一地址落在 loopback/私网/链路本地/ULA 就拒绝；
  - 不跟随重定向；
  - 限制 content-type、字节数、超时。
- `features.remoteImages: false` 可完全关闭远程抓取。
- 残余风险：DNS rebinding 在“解析”和“连接”之间仍理论存在；需要绝对严格时关闭
  远程图片，只收 data URL。

## 5. 审计

默认写 `$DSH_HOME/mirazero-bridge/audit.jsonl`：

```json
{"ts":"...","event":"session.created","id":"abc","sessionId":"...","workspace":"mirazero"}
{"ts":"...","event":"request.finished","id":"abc","sessionId":"...","images":1,"replyChars":88}
```

`isolation.auditContent: true` 才会记 120 字预览。

## 6. 残余风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 提示注入 | 请求可以尝试让模型泄露角色卡或系统提示 | 系统提示要求拒绝；不要把密钥写进角色卡 |
| 幻觉 | 模型可能声称“已执行/已打开网页” | 提示词禁止声称执行；实际没有工具 |
| 远程图片 SSRF | 公网 URL 可能指向内网 | DNS + 私网地址拒绝 + 不跟随重定向；可关闭 |
| 检索隐私 | 查询词会发给宿主搜索后端 | `features.autoSearch:false` |
| 站点可见性 | MiraZero 站方与调用方能看到回复全文 | 不要把本机隐私写进角色卡 |
| 运营者工具 | `mirazero_*` 能启停桥接、改角色卡 | 只对本机 DSH agent 开放 |
| 代码演进 | 以后在请求路径加工具或放宽 guard，墙就破了 | 修改 `lib/bridge.js` 必须重读本文件 |

## 7. 验证清单

```powershell
cd E:\dshtomirazero\dsh-mirazero-bridge
node --test
```

`bridge.test.js` 断言：

- 每个请求创建不同 Session；
- Session 带 `workspaceId`；
- `restrict` 收到 `{ allow: [] }`；
- `guard()` 返回拒绝理由；
- system prompt section 含 `隔离墙` 且 `interpolate === false`；
- prompt content 含 image part；
- MiraZero 回复走 `/api/plugin/dsh/reply`。

手工复核：

```powershell
Select-String -Path lib\bridge.js -Pattern "restrict|guard|systemPrompt.section|allow: \[\]"
```

## 8. 部署建议

- 用**独立站点账号**承载公开角色，不要用管理员账号。
- 角色卡里不要放 API Key、本机路径、真实姓名/地址。
- 公开前在 MiraZero 侧设置 API Key 校验、限流与内容审核。
- 需要绝对断网时关闭 `features.autoSearch` 与 `features.remoteImages`。
