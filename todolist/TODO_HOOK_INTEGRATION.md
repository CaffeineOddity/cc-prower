# Claude Code Hook 集成方案

## 目标
将 cc-power 与 Claude Code hooks 集成，实现 Claude 响应自动发送到 IM 平台（飞书/Telegram/WhatsApp）。

## 方案设计

### 1. 文件结构
```
cc-power/
└── claude-code-hooks/
│   ├── settings.json         # Hook 配置模板
│   ├── on-response.ts        # 响应完成时触发的 hook 脚本
│   └── send-to-im.ts         # 发送消息到 IM 平台的辅助脚本
└── cc-power-service/
    ├── cmd/
    │   └── setup-hooks.ts     # 增加复制配置到 .claude/ 的脚本
    └── cli.ts                 # 增加复制配置到 .claude/ 的命令： ccpower -s hooks

目标项目/ (运行 cc-power 的目录)
├── config.yaml 或 .cc-power.yaml  # 项目配置，包含 provider/chatId 等信息
└── .claude/
    ├── settings.json         # 合并后的配置（保留原有 hooks，新增/替换 cc-power hooks）
    └── hooks/
        ├── on-response.ts    # 从 claude-code-hooks/ 复制而来
        └── send-to-im.ts     # 从 claude-code-hooks/ 复制而来
```

### 2. Claude Code Hook 机制

Claude Code hooks 允许在特定事件触发时执行自定义脚本。我们需要使用 `Stop` 事件。

**Stop Hook**: 当 Claude 完成响应时触发，脚本通过 stdin 接收 JSON 输入。

**JSON 输入结构**:
```json
{
  "session_id": "...",
  "transcript_path": "/path/to/transcript.json",
  "cwd": "/path/to/project",
  "stop_response": "Claude 的完整响应内容"
}
```

**Hook 配置格式**:
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/your-script.sh"
          }
        ]
      }
    ]
  }
}
```


### 3. 工作流程

```
用户在 IM 发送消息
    ↓
cc-power 接收消息 → 调用 Claude Code API
    ↓
Claude 处理并生成响应
    ↓
Stop hook 触发，通过 stdin 接收响应 JSON
    ↓
hook 脚本提取 stop_response 字段
    ↓
hook 调用 cc-power 发送消息 API
    ↓
消息发送回 IM 平台
```

### 4. 具体实现

#### 4.1 Hook 脚本 (`claude-code-hooks/on-response.ts`)

从 stdin 读取 JSON 输入，提取 `stop_response` 字段，读取项目配置，调用 cc-power 发送。

**脚本结构**:
```typescript
import { readFileSync } from 'fs';

// 从 stdin 读取 JSON 输入
const input = JSON.parse(readFileSync(0, 'utf-8'));

// 提取响应内容
const response = input.stop_response;

// 其他可用字段:
// - input.session_id: 会话 ID
// - input.transcript_path: 完整对话记录路径
// - input.cwd: 当前工作目录
```

**示例**:
```bash
#!/usr/bin/env node
// 从 stdin 读取 JSON 输入
const input = require('fs').readFileSync(0, 'utf-8');
const data = JSON.parse(input);

const response = data.stop_response;
// ... 发送消息逻辑
```

#### 4.2 cc-power 新增 API

在 `Router` 中添加发送消息的方法：

```typescript
class Router {
  async sendMessage(
    provider: string,
    projectId: string,
    chatId: string,
    content: string
  ): Promise<void>
}
```

#### 4.3 Hook 配置模板 (`claude-code-hooks/settings.json`)

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": [".claude/hooks/on-response.ts"]
          }
        ]
      }
    ]
  }
}
```

*注意：ccpower -s hooks 命令要会智能合并配置*
- 如果目标 `.claude/settings.json` 中已存在`node .claude/hooks/on-response.ts`的配置项，则替换为当前脚本
- 如果不存在，则新增
- 保留目标配置中其他非冲突的 hooks

### 5. 元数据传递方案

Hook 脚本读取项目配置文件来获取元数据：

- 读取 `config.yaml` 或 `.cc-power.yaml`（当前工作目录）
- 解析 `projectId`、`chatId`、`provider` 等信息
- 确定发送消息的目标

**配置示例 (config.yaml):**
```yaml
provider:
  type: feishu
  app_id: xxx
  app_secret: xxx
  chat_id: oc_xxx
  project_id: my-project
```

**Hook 脚本逻辑:**
```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

const configPath = join(process.cwd(), 'config.yaml');
const config = loadYaml(configPath);

await sendToIM({
  provider: config.provider.type,
  projectId: config.provider.project_id,
  chatId: config.provider.chat_id,
  content: response
});
```

### 6. CLI 命令更新

**cc-power setup-hooks** - 初始化 hooks 配置

```bash
cc-power setup-hooks
```

执行逻辑：

1. **复制脚本文件**
   - 复制 `claude-code-hooks/on-response.ts` → `.claude/hooks/on-response.ts`
   - 复制 `claude-code-hooks/send-to-im.ts` → `.claude/hooks/send-to-im.ts`
   - 如果文件已存在，提示用户确认是否覆盖

2. **合并 settings.json**
   - 读取 `claude-code-hooks/settings.json` 作为模板
   - 如果目标 `.claude/settings.json` 不存在，直接复制
   - 如果目标文件已存在，智能合并：
     - 遍历模板中的 hooks
     - 如果同名 hook 已存在于目标文件，**替换**配置
     - 如果不存在，**新增**配置
     - 保留目标文件中其他非冲突的配置项（如 permissions、env 等）

3. **输出结果**
   - 显示新增/替换的 hooks
   - 显示保留的 hooks

### 7. 实现步骤

1. 创建 `cc-power/claude-code-hooks/` 目录
2. 创建 `claude-code-hooks/settings.json` hook 配置模板
3. 编写 `claude-code-hooks/on-response.ts` hook 脚本
4. 编写 `claude-code-hooks/send-to-im.ts` 发送消息辅助脚本
5. 在 `Router` 中添加 `sendMessage()` 方法
6. 在 `cli.ts` 中添加 `--setup hooks` 命令：
   - 复制脚本文件到 `.claude/hooks/`
   - 智能合并 `settings.json`（同名替换，异名新增）
7. 测试完整流程

### 9. 注意事项

- Hook 脚本需要异步执行，不能阻塞 Claude 响应
- 需要处理发送失败的情况（重试/日志记录）
- 考虑消息长度限制（各平台有不同限制）
- 敏感信息（app_secret）不要通过 hook 暴露

---

## 待办事项：projectId 统一改进

### 问题现状

目前 `projectId` 的推断逻辑在多处重复实现，且缺乏用户自定义能力：

| 位置 | 代码 | 行号 |
|------|------|------|
| `cli.ts` | MD5 推断 | 582-584 |
| `router.ts` | MD5 推断 | 176-177 |
| `cc-power-mcp/index.ts` | MD5 推断 | 329-333 |

**重复代码**：
```typescript
const normalizedPath = path.resolve(cwd).replace(/\/$/, '');
const projectId = crypto.createHash('md5').update(normalizedPath).digest('hex').substring(0, 8);
```

### 解决方案

**完全由用户在 `config.yaml` 或 `.cc-power.yaml` 中指定 `project_id`**，移除自动推断逻辑。

#### 1. 更新配置文件结构

**配置示例 (config.yaml):**
```yaml
provider: feishu
project_id: fly-pig  # 必填：项目唯一标识

feishu:
  app_id: "cli_a93c0992f1399ccd"
  app_secret: "egnFaEXVpX7XSWenOCgOvzZHqsh51tuO"
  bot_name: "fly-pig"
  chat_id: "oc_e113405e179916f79c2f3043ea50d0cf"
```

#### 2. 代码修改清单

| 文件 | 修改内容 |
|------|----------|
| `cc-power-service/cli.ts` | 删除 582-584 行的 MD5 推断逻辑，改为从配置文件读取 `project_id` |
| `cc-power-service/core/router.ts` | 删除 176-177 行的 MD5 推断逻辑（`ensureProjectRegistered` 方法） |
| `cc-power-service/core/router.ts` | 修改自动注册逻辑：如果 `project_id` 未指定，抛出错误提示用户配置 |
| `cc-power-mcp/src/mcp/index.ts` | 检查并同步修改（如有相关推断逻辑） |

#### 3. 错误处理

当 `project_id` 未配置时，给出明确错误提示：
```
Error: project_id is required in config.yaml. Please add it to your configuration.
Example:
  project_id: my-project-name
```

#### 4. 向后兼容

- 现有使用 MD5 哈希作为 projectId 的用户需要更新配置文件
- 添加迁移提示：检测到旧项目未配置 `project_id` 时，提示用户添加并给出推荐值（使用原有哈希值）

---

**等待用户确认后再执行实现。**