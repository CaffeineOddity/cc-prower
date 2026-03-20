# TODO: projectId 改造 - project_name + 自动生成 projectId

## 需求概述

1. **配置文件改名**: `project_id` → `project_name`（用户可读的名称）
2. **自动生成 projectId**: Provider 新增方法返回基于 `appid_chatid` 的 projectId
3. **移除 MD5 推断逻辑**: 删除 cli.ts 和 router.ts 中的路径哈希推断

---

## 修改点清单

### 1. 配置模板文件

| 文件 | 修改内容 |
|------|----------|
| `cc-power-service/providers/templates/feishu-template.yaml` | `project_id:` → `project_name:` |
| `cc-power-service/providers/templates/telegram-template.yaml` | `project_id:` → `project_name:` |
| `cc-power-service/providers/templates/whatsapp-template.yaml` | `project_id:` → `project_name:` |

### 2. 类型定义

| 文件 | 修改内容 |
|------|----------|
| `cc-power-service/types/config.ts` | 新增 `IProvider.getProjectId()` 方法声明 |
| `cc-power-service/types/config.ts` | `ProjectConfig` 新增可选 `project_name?: string` |
| `cc-power-service/types/config.ts` | `ProviderConfig` `projectId` 字段改为自动生成，不在配置中 |

### 3. Provider 基类

| 文件 | 修改内容 |
|------|----------|
| `cc-power-service/providers/base.ts` | 新增抽象方法 `abstract getProjectId(): string` |
| `cc-power-service/providers/base.ts` | 新增可选属性 `projectName?: string` |

### 4. 各 Provider 实现

#### FeishuProvider
| 文件 | 修改内容 |
|------|----------|
| `cc-power-service/providers/feishu.ts` | 实现 `getProjectId()`: 返回 `${app_id}_${chat_id}` |
| `cc-power-service/providers/feishu.ts` | 从 config 读取 `project_name` 并保存 |
| `cc-power-service/providers/feishu.ts` | `IncomingMessage.projectId` 使用 `getProjectId()` 返回值 |

#### TelegramProvider
| 文件 | 修改内容 |
|------|----------|
| `cc-power-service/providers/telegram.ts` | 实现 `getProjectId()`: 返回 `${bot_token}_${chat_id}` (需处理 token) |
| `cc-power-service/providers/telegram.ts` | 从 config 读取 `project_name` 并保存 |
| `cc-power-service/providers/telegram.ts` | `IncomingMessage.projectId` 使用 `getProjectId()` 返回值 |

#### WhatsAppProvider
| 文件 | 修改内容 |
|------|----------|
| `cc-power-service/providers/whatsapp.ts` | 实现 `getProjectId()`: 返回 `${phone_number}_${chat_id}` |
| `cc-power-service/providers/whatsapp.ts` | 从 config 读取 `project_name` 并保存 |
| `cc-power-service/providers/whatsapp.ts` | `IncomingMessage.projectId` 使用 `getProjectId()` 返回值 |

### 5. Router 核心逻辑

| 文件 | 修改内容 |
|------|----------|
| `cc-power-service/core/router.ts` | 删除 `ensureProjectRegistered()` 中的 MD5 推断逻辑 (176-177行) |
| `cc-power-service/core/router.ts` | 注册时使用 `provider.getProjectId()` 作为 key |
| `cc-power-service/core/router.ts` | `registerProject()` 调整参数：`projectId` 改为可选，未提供时调用 `provider.getProjectId()` |
| `cc-power-service/core/router.ts` | 新增 `projectTmuxSessionsByProjectName` Map: `project_name → tmuxPane` |
| `cc-power-service/core/router.ts` | `injectMessageViaTmux()` 改用 `project_name` 查找 tmux session |
| `cc-power-service/core/router.ts` | 收到 IM 消息时，用 `app_id` + `chat_id` 生成 projectId 来匹配 provider |

### 6. CLI 命令

| 文件 | 修改内容 |
|------|----------|
| `cc-power-service/cli.ts` | 删除 MD5 推断逻辑 (582-584行) |
| `cc-power-service/commands/run.command.ts` | 删除 `--session` 选项，移除 `parseSessionName()` 方法 |
| `cc-power-service/commands/run.command.ts` | sessionName 直接使用 `project_name`（规范化），格式：`cc-p-${projectName}` |
| `cc-power-service/commands/run.command.ts` | 注册信号中增加 `projectName` 字段 |
| `cc-power-service/commands/run.command.ts` | 更新 `validate project_id` 为 `validate project_name` |

### 7. MCP 集成

| 文件 | 修改内容 |
|------|----------|
| `cc-power-mcp/src/mcp/index.ts` | 删除 MD5 推断逻辑 (329-333行) |
| `cc-power-mcp/src/mcp/index.ts` | 工具调用中使用 `provider.getProjectId()` |

---

## projectId 生成规则

### Feishu
```
projectId = ${app_id}_${chat_id}
示例: cli_a93c0992f1399ccd_oc_e113405e179916f79c2f3043ea50d0cf
```

### Telegram
```
projectId = ${bot_token_prefix}_${chat_id}
示例: 123456789:ABCdefGHI_123456789
// token 取前 9 位或使用 hash 简化
```

### WhatsApp
```
projectId = ${phone_number}_${chat_id}
示例: 1234567890_+1234567890
```

---

## 关键设计细节

### 1. Tmux Session 命名规则

使用 `project_name` 作为 tmux session 名称，**不允许用户自定义**：

```typescript
// run.command.ts 中生成 sessionName
const safeProjectName = project_name.replace(/[^a-zA-Z0-9_-]/g, '_');
const sessionName = `cc-p-${safeProjectName}`;  // 固定格式，不能覆盖

// Router 中存储映射
projectTmuxSessionsByProjectName.set(projectName, tmuxPane);
```

**注意**: 删除 `--session` 命令行选项，统一从配置文件读取 `project_name`。

### 2. 消息路由匹配机制

收到 IM 消息时，通过消息中的 `app_id` + `chat_id` 生成 projectId 来查找对应的 Provider：

```typescript
// FeishuProvider 中
handleWsMessage(data) {
  const { message } = data;
  const { app_id, chat_id } = data.metadata;

  // 生成 projectId
  const projectId = `${app_id}_${chat_id}`;

  // 查找对应的 Provider
  const provider = this.providers.get(projectId);
  if (provider) {
    // 处理消息...
  }
}
```

### 3. injectMessageViaTmux 改造

改为使用 `project_name` 查找 tmux session：

```typescript
private async injectMessageViaTmux(message: IncomingMessage): Promise<void> {
  // 从 message metadata 获取 project_name
  const projectName = message.metadata?.project_name;

  if (!projectName) {
    this.logger.warn(`No project_name found in message metadata`);
    return;
  }

  // 使用 project_name 查找 tmux session
  const tmuxPane = this.projectTmuxSessionsByProjectName.get(projectName);

  if (!tmuxPane) {
    this.logger.warn(`No tmux session found for project: ${projectName}`);
    return;
  }

  // ... 原有注入逻辑
}
```

### 4. IncomingMessage 元数据扩展

```typescript
interface IncomingMessage {
  // ... 现有字段
  metadata?: {
    project_name?: string;  // 新增：项目名称，用于查找 tmux session
    app_id?: string;        // Feishu: app_id
    chat_id?: string;       // 所有平台: chat_id
    // ... 其他元数据
  };
}
```

---

## 配置示例更新

### 新格式
```yaml
project_name: Fly Pig Bot  # 可选，用于显示和 sessionName

provider:
  name: feishu
  app_id: "cli_a93c0992f1399ccd"
  app_secret: "xxx"
  chat_id: "oc_e113405e179916f79c2f3043ea50d0cf"
```

### 旧格式不支持
**注意**: 此改动不兼容旧配置格式，用户需要手动更新配置文件。

旧配置中的 `project_id` 字段将被忽略，系统会自动根据 `app_id` 和 `chat_id` 生成新的 projectId。

---

## 迁移指南

用户需要将旧配置迁移到新格式：

1. 删除 `project_id` 字段
2. 添加 `project_name` 字段（可选，推荐）
3. 确保配置中包含必要的字段（`app_id`, `app_secret`, `chat_id` 等）

**迁移前**:
```yaml
project_id: fly-pig
provider: feishu
feishu:
  app_id: "cli_a93c0992f1399ccd"
  app_secret: "xxx"
  chat_id: "oc_e113405e179916f79c2f3043ea50d0cf"
```

**迁移后**:
```yaml
project_name: Fly Pig Bot  # 可选
provider: feishu
feishu:
  app_id: "cli_a93c0992f1399ccd"
  app_secret: "xxx"
  chat_id: "oc_e113405e179916f79c2f3043ea50d0cf"
```

---

**等待用户确认是否执行实现。**