# CC-Power Features Document

## 项目概述

CC-Power 是一个基于 MCP (Model Context Protocol) 的消息路由系统，允许 Claude Code 通过 MCP 工具与多个聊天平台（飞书、Telegram、WhatsApp）进行双向通信。

## 一、需求点

### 1.1 核心需求

| 需求 ID | 需求描述 | 优先级 |
|---------|---------|--------|
| REQ-001 | 支持 MCP stdio 和 HTTP/SSE 两种传输模式 | P0 |
| REQ-002 | 支持飞书、Telegram、WhatsApp 三个聊天平台 | P0 |
| REQ-003 | 实现消息双向通信（入站/出站） | P0 |
| REQ-004 | 支持多项目同时连接，通过 project_id 区分 | P0 |
| REQ-005 | 提供项目自动注册/取消注册机制 | P1 |
| REQ-006 | 实现心跳机制保持项目存活 | P1 |
| REQ-007 | 实现入站消息通知（HTTP 模式） | P1 |
| REQ-008 | 支持入站消息队列查询 | P1 |
| REQ-009 | 提供消息日志记录 | P2 |
| REQ-010 | 支持项目状态监控 | P2 |

### 1.2 功能需求

#### 1.2.1 MCP 工具集
- `send_message`: 发送消息到聊天平台
- `list_chats`: 列出可用的聊天会话
- `get_status`: 获取 Provider 状态
- `register_project`: 注册项目配置
- `unregister_project`: 取消注册项目
- `send_heartbeat`: 发送心跳保持项目存活
- `get_heartbeat_status`: 获取项目心跳状态
- `get_incoming_messages`: 获取入站消息
- `auto_discover_projects`: 自动发现并注册项目

#### 1.2.2 Provider 功能
- 连接管理（connect/disconnect）
- 消息发送（sendMessage）
- 消息监听（onMessage）
- 健康检查（isHealthy）

### 1.3 非功能需求

| 需求项 | 要求 |
|--------|------|
| 可靠性 | 项目超时后自动清理（60秒心跳超时） |
| 可维护性 | 模块化设计，Provider 可插拔 |
| 可扩展性 | 支持添加新的 Provider 类型 |
| 日志 | 支持多级别日志记录（debug/info/warn/error） |
| 配置 | 支持 YAML 配置文件，支持热加载 |

## 二、交互方式

### 2.1 架构交互图

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Claude Code    │         │   MCP Server    │         │     Router      │
│                 │         │                 │         │                 │
│  ┌───────────┐  │         │  ┌───────────┐  │         │  ┌───────────┐  │
│  │ MCP Client│  │◄────────┤  │   Server  │  │◄────────┤  │ Providers │  │
│  └───────────┘  │ stdio/  │  └───────────┘  │ Backend │  └───────────┘  │
│  ┌───────────┐  │ HTTP    │  ┌───────────┐  │ Service │  ┌───────────┐  │
│  │  Tools    │  ├────────►│  │   Tools   │  ├────────►│  │ Feishu    │  │
│  └───────────┘  │         │  └───────────┘  │         │  └───────────┘  │
│                 │         │  ┌───────────┐  │         │  ┌───────────┐  │
│                 │         │  │ Notifications│         │  │ Telegram  │  │
│                 │         │  └───────────┘  │         │  └───────────┘  │
└─────────────────┘         └─────────────────┘         └─────────────────┘
                                                               │
         ┌─────────────────┐                                  │
         │ Claude Hooks    │                                  │
         │                 │                                  ▼
         │ SessionStart    │    ┌─────────────────┐    ┌─────────────────┐
         │ SessionEnd      │───►│  Signal Files   │───►│ Chat Platforms  │
         └─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 2.2 通信流程

#### 2.2.1 Stdio 模式（默认）

```
Claude Code ──[stdio]──► MCP Server ──[BackendService]──► Router
                                │
                                ◄──[Response]──────────────────────┘
```

#### 2.2.2 HTTP/SSE 模式

```
Claude Code ──[HTTP POST]──► Express ──[StreamableHTTP]──► MCP Server
                                                    │
                               SSE ◄────────────────┘
                               (Notifications)
```

### 2.3 MCP 工具调用示例

#### 发送消息
```json
{
  "method": "tools/call",
  "params": {
    "name": "send_message",
    "arguments": {
      "provider": "feishu",
      "chat_id": "oc_xxx",
      "content": "Hello from Claude Code!",
      "project_id": "test-project"
    }
  }
}
```

#### 获取状态
```json
{
  "method": "tools/call",
  "params": {
    "name": "get_status",
    "arguments": {
      "provider": "telegram"
    }
  }
}
```

#### 自动发现项目
```json
{
  "method": "tools/call",
  "params": {
    "name": "auto_discover_projects",
    "arguments": {}
  }
}
```

### 2.4 消息流

#### 出站消息（Claude → 聊天平台）
```
Claude Code
  ├─ send_message 工具
  └─ MCP Server
     └─ backend.sendMessage()
        └─ Router.handleSendMessage()
           └─ Provider.sendMessage()
              └─ 聊天平台 API
```

#### 入站消息（聊天平台 → Claude）
```
聊天平台
  ├─ Provider 监听
  └─ Router.handleIncomingMessage()
     ├─ 消息日志记录
     ├─ 路由信息缓存
     ├─ 消息队列入队
     └─ 通知发送器 (HTTP 模式)
        └─ StreamableHTTPServerTransport
           └─ Claude Code (SSE)
```

## 三、技术实现方案

### 3.1 核心组件

#### 3.1.1 MCP Server (`cc-power-mcp/src/mcp/index.ts`)

| 组件 | 职责 |
|------|------|
| MCPServer | MCP 服务器主类 |
| defineTools() | 定义 MCP 工具清单 |
| setupHandlers() | 设置 MCP 请求处理器 |
| startStdio() | 启动 stdio 模式 |
| startHTTP() | 启动 HTTP/SSE 模式 |
| processSignalFiles() | 处理信号文件（自动发现） |

#### 3.1.2 Router (`cc-power/core/router.ts`)

| 组件 | 职责 |
|------|------|
| providers | Map: projectId → Provider 实例 |
| projectRoutes | Map: chatId → MessageRoute |
| heartbeats | Map: projectId → lastHeartbeat |
| incomingMessageQueue | Map: projectId → IncomingMessage[] |
| registerProject() | 注册项目并创建 Provider |
| unregisterProject() | 取消注册并清理资源 |
| handleIncomingMessage() | 处理入站消息 |
| _sendMessageToProvider() | 发送消息到 Provider |

#### 3.1.3 Provider 抽象层

```
IProvider (接口)
  ├─ connect(config): Promise<void>
  ├─ disconnect(): Promise<void>
  ├─ sendMessage(chatId, content): Promise<void>
  ├─ onMessage(callback): void
  └─ isHealthy(): boolean

FeishuProvider
TelegramProvider
WhatsAppProvider
```

### 3.2 关键技术实现

#### 3.2.1 自动发现机制（信号文件模式）

```
┌─────────────────────────────────────────────────────────────┐
│                        自动发现流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Claude Code 启动 SessionStart Hook                      │
│     └─ 读取项目配置 (.cc-power.yaml)                         │
│     └─ 写入 ~/.cc-power/signals/register-{projectId}.json   │
│                                                             │
│  2. 用户调用 auto_discover_projects 工具                    │
│     └─ MCP Server 扫描 ~/.cc-power/signals/                 │
│     └─ 读取所有信号文件                                      │
│     └─ 调用 backend.registerProject() / unregisterProject() │
│     └─ 删除已处理的信号文件                                  │
│                                                             │
│  3. Claude Code 结束 SessionEnd Hook                       │
│     └─ 写入 ~/.cc-power/signals/unregister-{projectId}.json │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 3.2.2 心跳机制

```
┌─────────────────────────────────────────────────────────────┐
│                       心跳机制配置                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  客户端发送间隔：    30 秒（建议）                          │
│  服务器超时阈值：    60 秒                                   │
│  服务器检查间隔：    10 秒                                   │
│                                                             │
│  流程：                                                       │
│                                                             │
│  Client              Router               Heartbeat Checker │
│    │                    │                       │           │
│    ├─ send_heartbeat ──►│                       │           │
│    │                    ├─ 更新 heartbeats     │           │
│    │                    │     [timestamp]      │           │
│    │                    │                       │           │
│    │                    │          ◄────────────┤           │
│    │                    │        每10秒检查      │           │
│    │                    │                       │           │
│    │                    │     if (now - last > 60s)          │
│    │                    ├─ unregisterProject()  │           │
│    │                    │                       │           │
└─────────────────────────────────────────────────────────────┘
```

#### 3.2.3 入站消息通知（HTTP/SSE 模式）

```
┌─────────────────────────────────────────────────────────────┐
│                   HTTP/SSE 通知流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  聊天平台                                                    │
│    │                                                        │
│    ├─ 新消息                                                 │
│    ▼                                                        │
│  Provider.onMessage()                                       │
│    │                                                        │
│    ├─ Router.handleIncomingMessage()                        │
│    │   ├─ 记录日志                                          │
│    │   ├─ 缓存路由                                          │
│    │   ├─ 队列入队                                          │
│    │   └─ 发送通知                                          │
│    │                                                        │
│    ▼                                                        │
│  Router.notificationSender                                  │
│    │                                                        │
│    ├─ StreamableHTTPServerTransport.send()                  │
│    │   └─ JSON-RPC 2.0 Notification                         │
│    │       {                                                 │
│    │         "method": "notifications/message",             │
│    │         "params": { ... }                              │
│    │       }                                                │
│    │                                                        │
│    ▼                                                        │
│  Claude Code (SSE 接收)                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 配置文件结构

#### 3.3.1 全局配置 (`config.yaml`)
```yaml
mcp:
  transport: stdio  # 或 http
  port: 8080        # http 模式使用

logging:
  level: debug
  file: logs/cc-power.log

providers:
  feishu:
    enabled: true
  telegram:
    enabled: true
  whatsapp:
    enabled: false
```

#### 3.3.2 项目配置 (`.cc-power.yaml`)
```yaml
provider: feishu
feishu:
  app_id: cli_xxx
  app_secret: xxx
  bot_name: Claude Bot
  allowed_users:
    - ou_xxx

session:
  max_history: 100
  timeout_minutes: 30
```

### 3.4 目录结构

```
cc-prower/
├── cc-power/                    # 核心包
│   ├── cli.ts                   # CLI 入口
│   ├── config.ts                # 配置管理
│   ├── core/
│   │   ├── router.ts            # 路由器
│   │   ├── logger.ts            # 日志器
│   │   └── message-logger.ts    # 消息日志
│   ├── providers/               # Provider 实现
│   │   ├── feishu.ts
│   │   ├── telegram.ts
│   │   └── whatsapp.ts
│   └── types/
│       └── index.ts             # 类型定义
│
├── cc-power-mcp/                # MCP 包
│   └── src/
│       ├── mcp/
│       │   └── index.ts         # MCP 服务器
│       └── index.ts             # 包入口
│
├── projects/                    # 示例项目
│   └── test-project/
│       ├── .cc-power.yaml       # 项目配置
│       └── .claude/
│           └── hooks/           # Claude Code Hooks
│               ├── session-start.js
│               └── session-end.js
│
└── config.yaml                  # 全局配置
```

## 四、测试过程

### 4.1 环境准备

#### 4.1.1 前置条件
```bash
# 打包 cc-power服务
sh setup.sh 

# 给项目安装mcp
sh setup-project-mcp.sh ./projects/test-project
```

#### 4.1.2 验证安装
```bash
# 启动cc-power服务
cc-power start

#进入项目目录
cd ./projects/test-project && claude

```

### 4.2 功能测试

#### 4.2.1 测试用例清单

| 用例 ID | 测试场景 | 预期结果 |
|---------|---------|---------|
| TC-001 | MCP 服务器启动 | 成功启动，工具列表正常 |
| TC-002 | 手动注册项目 | 项目注册成功，Provider 连接 |
| TC-003 | 发送消息 | 消息成功发送到聊天平台 |
| TC-004 | 获取状态 | 返回正确的项目状态 |
| TC-005 | 列出聊天 | 返回活跃的聊天会话列表 |
| TC-006 | 发送心跳 | 心跳时间戳更新 |
| TC-007 | 心跳超时 | 项目自动取消注册 |
| TC-008 | 获取心跳状态 | 返回正确的存活状态 |
| TC-009 | 获取入站消息 | 返回待处理的入站消息 |
| TC-010 | 自动发现项目 | 信号文件被处理 |
| TC-011 | 自动取消注册 | 结束信号被处理 |
| TC-012 | 取消注册项目 | 项目正常清理 |

#### 4.2.2 详细测试步骤

##### TC-001: MCP 服务器启动

**步骤：**
1. 启动 MCP 服务器：`npm start`
2. 调用 `list_tools` MCP 方法

**验证点：**
- 服务器正常启动
- 返回 9 个工具
- 工具包含：send_message, list_chats, get_status, register_project, unregister_project, send_heartbeat, get_heartbeat_status, get_incoming_messages, auto_discover_projects

**日志验证：**
```
[INFO] MCP server started (stdio mode)
[INFO] Router initialized
[DEBUG] Heartbeat checker started
```

---

##### TC-002: 手动注册项目

**步骤：**
1. 准备飞书应用凭证
2. 调用 `register_project` 工具：
```json
{
  "project_id": "test-project",
  "provider": "feishu",
  "config": {
    "app_id": "cli_xxx",
    "app_secret": "xxx"
  }
}
```

**验证点：**
- 返回 success: true
- Provider 连接成功
- 心跳已初始化

**日志验证：**
```
[INFO] Registering project: test-project (feishu)
[DEBUG] FeishuProvider connecting...
[INFO] Project test-project registered successfully
[DEBUG] Heartbeat received from project test-project
```

---

##### TC-003: 发送消息

**步骤：**
1. 先发送一条测试消息到飞书（获取 chat_id）
2. 调用 `send_message` 工具：
```json
{
  "provider": "feishu",
  "chat_id": "oc_xxx",
  "content": "Hello from CC-Power!",
  "project_id": "test-project"
}
```

**验证点：**
- 返回 success: true
- 消息出现在聊天平台

**日志验证：**
```
[DEBUG] Tool call: send_message
[INFO] Message sent to feishu:oc_xxx
[DEBUG] Outgoing message logged
```

---

##### TC-004: 获取状态

**步骤：**
1. 注册至少一个项目
2. 调用 `get_status` 工具：
```json
{
  "provider": "feishu"
}
```

**验证点：**
- 返回已注册的项目列表
- 每个项目包含 provider 和 healthy 状态

**日志验证：**
```
[DEBUG] Tool call: get_status
[INFO] Retrieved status for 1 projects
```

---

##### TC-005: 列出聊天

**步骤：**
1. 确保有活跃的聊天
2. 调用 `list_chats` 工具：
```json
{
  "provider": "feishu",
  "project_id": "test-project"
}
```

**验证点：**
- 返回活跃的聊天会话列表
- 包含 chat_id, project_id, user_id

**日志验证：**
```
[DEBUG] Tool call: list_chats
[DEBUG] Found 1 active chats
```

---

##### TC-006: 发送心跳

**步骤：**
1. 注册一个项目
2. 每 30 秒调用一次 `send_heartbeat`：
```json
{
  "project_id": "test-project"
}
```

**验证点：**
- 每次返回 success: true
- get_heartbeat_status 返回 is_alive: true

**日志验证：**
```
[DEBUG] Tool call: send_heartbeat
[DEBUG] Heartbeat received from project test-project
```

---

##### TC-007: 心跳超时

**步骤：**
1. 注册一个项目
2. 停止发送心跳（超过 60 秒）
3. 等待 10-20 秒让心跳检查器运行

**验证点：**
- 项目被自动取消注册
- 日志显示心跳超时

**日志验证：**
```
[WARN] Project test-project heartbeat timeout (62.3s), unregistering
[INFO] Unregistering project: test-project
[INFO] Project test-project unregistered
```

---

##### TC-008: 获取心跳状态

**步骤：**
1. 注册一个项目
2. 调用 `get_heartbeat_status`：
```json
{
  "project_id": "test-project"
}
```

**验证点：**
- 返回 last_heartbeat 时间戳
- 返回 is_alive 状态
- 返回 time_since_last 耗时

**日志验证：**
```
[DEBUG] Tool call: get_heartbeat_status
[DEBUG] Heartbeat status retrieved for test-project
```

---

##### TC-009: 获取入站消息

**步骤：**
1. 在聊天平台发送一条消息
2. 等待 Provider 接收
3. 调用 `get_incoming_messages`：
```json
{
  "project_id": "test-project"
}
```

**验证点：**
- 返回入站消息列表
- 消息包含 content, user_id, timestamp 等

**日志验证：**
```
[DEBUG] Incoming message: {"type":"incoming",...}
[INFO] Incoming message queued for test-project: Hello
[DEBUG] Notification sent for message from oc_xxx
[DEBUG] Retrieved 1 incoming messages for test-project
```

---

##### TC-010: 自动发现项目

**步骤：**
1. 配置 `.cc-power.yaml` 并放入项目目录
2. 手动创建注册信号（或通过 SessionStart Hook）
3. 调用 `auto_discover_projects`：
```json
{}
```

**验证点：**
- 返回 registered 数组包含项目 ID
- 项目被成功注册
- 信号文件被删除

**日志验证：**
```
[INFO] Auto-discovering projects from signal files...
[INFO] Auto-registered project: test-project (feishu)
[INFO] Auto-discovery complete: 1 registered, 0 unregistered
```

---

##### TC-011: 自动取消注册

**步骤：**
1. 创建取消注册信号文件
2. 调用 `auto_discover_projects`

**验证点：**
- 返回 unregistered 数组包含项目 ID
- 项目被成功取消注册

**日志验证：**
```
[INFO] Auto-unregistered project: test-project
[INFO] Auto-discovery complete: 0 registered, 1 unregistered
```

---

##### TC-012: 取消注册项目

**步骤：**
1. 注册一个项目
2. 调用 `unregister_project`：
```json
{
  "project_id": "test-project"
}
```

**验证点：**
- 返回 success: true
- 项目从已注册列表中移除
- Provider 被断开连接

**日志验证：**
```
[INFO] Unregistering project via MCP: test-project
[INFO] Project test-project unregistered successfully via MCP
```

### 4.3 集成测试

#### 4.3.1 完整消息流测试

**场景：** 从 Claude 发送消息到飞书，用户回复，Claude 接收回复

**步骤：**
1. 启动 MCP 服务器
2. 注册项目
3. 发送消息到飞书
4. 在飞书中回复消息
5. 获取入站消息
6. 发送回复

**验证点：**
- 完整消息链路正常
- 消息日志正确记录

#### 4.3.2 多项目并发测试

**场景：** 同时运行多个项目

**步骤：**
1. 注册多个项目（test-project-1, test-project-2, test-project-3）
2. 为每个项目发送不同的消息
3. 监控消息路由

**验证点：**
- 消息正确路由到对应项目
- 项目间互不干扰

### 4.4 性能测试

#### 4.4.1 消息吞吐量测试

```bash
# 并发发送 100 条消息
for i in {1..100}; do
  echo "Message $i" | send_message ...
done
```

**验证点：**
- 无消息丢失
- 处理时间 < 2s/消息

#### 4.4.2 长时间运行测试

运行 24 小时，监控：
- 内存使用
- 心跳稳定性
- 日志文件大小

### 4.5 错误场景测试

| 场景 | 预期行为 |
|------|---------|
| Provider 未启用 | 返回错误提示 |
| 项目未注册 | 返回错误提示 |
| 心跳超时 | 自动取消注册 |
| 无效的 chat_id | 返回错误提示 |
| 网络断开 | Provider 返回 unhealthy |

## 五、日志验证

### 5.1 日志级别说明

| 级别 | 用途 | 示例场景 |
|------|------|---------|
| DEBUG | 详细调试信息 | 消息内容、心跳时间戳 |
| INFO | 正常操作信息 | 项目注册、消息发送 |
| WARN | 警告信息 | 心跳超时、未注册项目 |
| ERROR | 错误信息 | 连接失败、发送失败 |

### 5.2 关键日志点

#### 5.2.1 启动日志
```
[INFO] CC-Power starting...
[DEBUG] Config loaded from /path/to/config.yaml
[INFO] Router initialized
[DEBUG] Heartbeat checker started
[INFO] MCP server started (stdio mode)
```

#### 5.2.2 项目注册日志
```
[INFO] Registering project: {projectId} ({provider})
[DEBUG] {Provider}Provider connecting...
[INFO] Project {projectId} registered successfully
[DEBUG] Heartbeat received from project {projectId}
```

#### 5.2.3 消息发送日志
```
[DEBUG] Tool call: send_message {args}
[DEBUG] Project route found: {projectId}
[INFO] Message sent to {provider}:{chatId}
[DEBUG] Outgoing message logged to {path}
```

#### 5.2.4 入站消息日志
```
[DEBUG] Incoming message: {message}
[INFO] Incoming message queued for {projectId}: {content}
[DEBUG] Message route cached: chatId → projectId
[DEBUG] Notification sent for message from {chatId}
```

#### 5.2.5 心跳日志
```
[DEBUG] Heartbeat received from project {projectId}
[WARN] Project {projectId} heartbeat timeout ({timeout}s), unregistering
[INFO] Unregistering project: {projectId}
```

#### 5.2.6 自动发现日志
```
[INFO] Auto-discovering projects from signal files...
[INFO] Auto-registered project: {projectId} ({provider})
[INFO] Auto-unregistered project: {projectId}
[INFO] Auto-discovery complete: {n} registered, {m} unregistered
```

### 5.3 日志文件位置

```
logs/
├── cc-power.log              # 主日志
├── messages/                 # 消息日志
│   ├── test-project/
│   │   ├── incoming-2024-03-17.log
│   │   └── outgoing-2024-03-17.log
│   └── another-project/
│       └── ...
```

### 5.4 日志配置示例

```yaml
logging:
  level: debug      # 开发环境使用 debug
  file: logs/cc-power.log
  max_size: 10M     # 单文件最大 10MB
  max_files: 5      # 保留 5 个历史文件
```

### 5.5 日志查询命令

```bash
# 查看所有错误
grep ERROR logs/cc-power.log

# 查看特定项目的日志
grep "test-project" logs/cc-power.log

# 查看消息日志
tail -f logs/messages/test-project/incoming-*.log

# 统计心跳超时次数
grep "heartbeat timeout" logs/cc-power.log | wc -l
```

## 六、部署指南

### 6.1 开发环境

```bash
# 1. 克隆仓库
git clone <repo-url>
cd cc-prower

# 2. 安装依赖
npm install

# 3. 启动开发模式
npm run dev
```

### 6.2 生产环境

```bash
# 1. 构建
npm run build

# 2. 使用 PM2 管理
pm2 start dist/cli.js --name cc-power

# 3. 配置日志轮转
pm2 install pm2-logrotate
```

### 6.3 Claude Code 配置

在 `~/.claude/settings.json` 中添加：

```json
{
  "mcpServers": {
    "cc-power": {
      "command": "node",
      "args": ["/path/to/cc-power-mcp/dist/index.js"]
    }
  }
}
```

## 七、故障排查

| 问题 | 可能原因 | 解决方法 |
|------|---------|---------|
| MCP 工具不可用 | 服务器未启动 | 检查进程状态 |
| 项目注册失败 | Provider 未启用 | 检查 config.yaml |
| 消息发送失败 | chat_id 无效 | 确认 chat_id 正确 |
| 项目自动注销 | 心跳超时 | 检查客户端心跳逻辑 |
| 入站消息未通知 | HTTP 模式未配置 | 使用 stdio 模式或配置 SSE |

## 附录

### A. MCP 协议版本

- MCP SDK: `@modelcontextprotocol/sdk@1.0.4`
- JSON-RPC: 2.0

### B. 支持的平台

- Node.js >= 18
- macOS / Linux / Windows

### C. 相关链接

- [MCP 规范](https://modelcontextprotocol.io/)
- [Claude Code 文档](https://docs.anthropic.com/claude/code)
- 项目仓库: [待添加]