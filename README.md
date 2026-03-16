# cc-connect-carry

基于 MCP 和 WebSocket 的轻量级 Claude Code 与聊天平台桥接服务。

## 快速开始

### 1. 安装

```bash
npm install
npm run build
npm link  # 全局安装 cc-carry 命令
```

### 2. 配置 MCP 服务器

使用 Claude Code CLI 添加 MCP 服务器：

```bash
claude mcp add chat-provider -- cc-carry start
```

验证配置：

```bash
claude mcp list
```

### 3. 启动 Claude Code

```bash
claude
```

详细的 MCP 配置说明请查看 [docs/mcp-setup.md](docs/mcp-setup.md)

## 设计理念

- **极简架构**：核心代码 < 2000 行
- **MCP 协议**：利用 Claude Code 原生 MCP 支持
- **WebSocket 通信**：实时双向消息流
- **项目本地配置**：每个项目独立管理 Provider 配置
- **无状态设计**：消息流式处理，无复杂会话管理

## 项目结构

```
cc-connect-carry/
├── src/
│   ├── core/              # 核心功能
│   │   ├── mcp.ts         # MCP 服务器
│   │   ├── router.ts      # 消息路由器
│   │   ├── config.ts      # 配置管理
│   │   └── logger.ts      # 日志工具
│   ├── providers/         # 平台适配器
│   │   ├── base.ts        # Provider 基类
│   │   ├── feishu.ts      # 飞书适配器
│   │   ├── telegram.ts    # Telegram 适配器
│   │   └── whatsapp.ts    # WhatsApp 适配器
│   ├── types/             # 类型定义
│   │   ├── index.ts       # 导出所有类型
│   │   ├── message.ts     # 消息类型
│   │   ├── config.ts      # 配置类型
│   │   └── mcp.ts         # MCP 类型
│   ├── cli.ts             # CLI 入口
│   └── index.ts           # 主入口
├── e2e/                   # 测试文件
├── config/                # 配置示例
│   └── example.yaml       # 配置文件示例
├── dist/                  # 编译输出
├── node_modules/
├── package.json
├── tsconfig.json
└── README.md
```

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                    cc-connect-carry                              │
│                      (Node.js + TypeScript)                      │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                       CLI                                 │  │
│  │  cc-carry start [--port 8080] [--config ./config.yaml]   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                    │
│                           ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Router                                │  │
│  │  - 接收 MCP 消息 (来自 Claude Code)                     │  │
│  │  - 接收 Provider 消息 (来自聊天平台)                     │  │
│  │  - 路由消息到目标                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│         │                                              │       │
│         ▼                                              ▼       │
│  ┌──────────────────┐                        ┌──────────────┐ │
│  │  MCP Server      │                        │  Provider    │ │
│  │  (WebSocket/     │                        │  Manager     │ │
│  │   stdio)         │                        │              │ │
│  │                  │                        │  ┌────────┐  │ │
│  │  Tools:          │                        │  │ Feishu │  │ │
│  │  - send_message  │                        │  │  WS     │  │ │
│  │  - list_chats    │                        │  └────────┘  │ │
│  │  - get_status    │                        │  ┌────────┐  │ │
│  └──────────────────┘                        │  │Telegram│  │ │
│                                               │  │  Poll  │  │ │
│  ┌──────────────────────────────────────────│  └────────┘  │ │
│  │              Project Config Store        │              │ │
│  │  {                                      │  ┌────────┐  │ │
│  │    "project-a": {                       │  │WhatsApp│  │ │
│  │      "provider": "feishu",              │  │  API   │  │ │
│  │      "app_id": "xxx"                   │  └────────┘  │ │
│  │    },                                   │              │ │
│  │    "project-b": {                       │              │ │
│  │      "provider": "whatsapp"            │              │ │
│  │    }                                    │              │ │
│  │  }                                      │              │ │
│  └──────────────────────────────────────────┴──────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. MCP Server

提供 MCP 工具供 Claude Code 调用：

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `send_message` | 发送消息到聊天平台 | `provider`, `chat_id`, `content` |
| `list_chats` | 列出可用聊天列表 | `provider` |
| `get_status` | 获取 Provider 状态 | `provider` |

### 2. Router

消息路由核心：

```typescript
// 路由逻辑
class Router {
  // 注册项目配置
  registerProject(projectId: string, config: ProviderConfig): void

  // 路由消息
  route(message: Message): Promise<void>

  // 处理来自 Claude Code 的消息
  handleMCPMessage(message: MCPMessage): Promise<void>

  // 处理来自 Provider 的消息
  handleProviderMessage(message: ProviderMessage): Promise<void>
}
```

### 3. Provider 基类

所有 Platform 适配器的统一接口：

```typescript
abstract class BaseProvider {
  // 连接到平台
  abstract connect(config: ProviderConfig): Promise<void>

  // 发送消息
  abstract sendMessage(chatId: string, content: string): Promise<void>

  // 接收消息（通过事件）
  abstract onMessage(callback: (message: IncomingMessage) => void): void

  // 健康检查
  abstract isHealthy(): boolean

  // 断开连接
  abstract disconnect(): Promise<void>
}
```

## 消息流转

### 用户 → Claude Code

```
1. 用户在 Feishu 发消息
2. FeishuProvider 接收消息
3. Router 路由到对应项目
4. MCP Server 通过工具调用通知 Claude Code
5. Claude Code 收到消息，在终端显示
```

### Claude Code → 用户

```
1. Claude Code 在终端处理消息
2. 调用 MCP 工具 send_message
3. Router 接收 MCP 消息
4. 路由到对应 Provider
5. Provider 发送消息到平台
```

## 配置设计

### 全局配置 (config.yaml)

```yaml
# MCP 服务器配置
mcp:
  port: 8080
  transport: "stdio"  # stdio 或 websocket

# 项目配置目录
projects_dir: "./projects"

# 日志配置
logging:
  level: "info"
  file: "./logs/cc-carry.log"

# Provider 配置
providers:
  feishu:
    enabled: true
  telegram:
    enabled: true
  whatsapp:
    enabled: false
```

### 项目配置 (projects/project-a/config.yaml)

```yaml
provider: "feishu"

feishu:
  app_id: "cli_a1234567890"
  app_secret: "your-secret-here"
  bot_name: "Claude Bot"
  allowed_users:
    - "ou_xxx1"
    - "ou_xxx2"

# 可选：会话配置
session:
  max_history: 50
  timeout_minutes: 30
```

### 项目配置 (projects/project-b/config.yaml)

```yaml
provider: "telegram"

telegram:
  bot_token: "your-bot-token-here"
  allowed_chats:
    - 123456789
    - 987654321
```

## Claude Code 集成

### 启动 Claude Code

```bash
# 在项目目录下
claude --mcp "chat-provider=stdio:cc-carry"
```

### MCP 工具使用

```
# 在 Claude Code 中
> 向 Feishu 发送消息
Tool: send_message
{
  "provider": "feishu",
  "chat_id": "oc_xxx",
  "content": "Hello from Claude!"
}

# 列出可用聊天
Tool: list_chats
{
  "provider": "feishu"
}
```

## 安装和使用

### 安装

```bash
# 克隆项目
git clone https://github.com/your-username/cc-connect-carry.git
cd cc-connect-carry

# 安装依赖
npm install

# 构建
npm run build

# 全局安装（可选）
npm link
```

### 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start

# 指定配置文件
cc-carry start --config ./my-config.yaml
```

### 配置项目

```bash
# 在项目目录下创建配置
mkdir -p .claude

# 创建 MCP 配置文件
cat > .claude/mcp.json << 'EOF'
{
  "mcpServers": {
    "chat-provider": {
      "command": "cc-carry",
      "args": ["start"],
      "transport": "stdio"
    }
  }
}
EOF

# 创建项目配置
mkdir -p projects/myproject
cat > projects/myproject/config.yaml << 'EOF'
provider: "feishu"
feishu:
  app_id: "cli_xxx"
  app_secret: "xxx"
EOF

# 启动 Claude Code
claude
```

详细的 MCP 配置说明请查看 [docs/mcp-setup.md](docs/mcp-setup.md)

## 开发指南

### 添加新 Provider

1. 继承 `BaseProvider`
2. 实现抽象方法
3. 在 `config.yaml` 中启用
4. 在 `types/config.ts` 中添加配置类型

示例：

```typescript
// src/providers/custom.ts
import { BaseProvider, ProviderConfig, IncomingMessage } from '../types/index.js';

export class CustomProvider extends BaseProvider {
  private client: any;

  async connect(config: ProviderConfig): Promise<void> {
    // 连接逻辑
  }

  async sendMessage(chatId: string, content: string): Promise<void> {
    // 发送逻辑
  }

  onMessage(callback: (message: IncomingMessage) => void): void {
    // 设置消息监听
  }

  isHealthy(): boolean {
    return this.client?.connected ?? false;
  }

  async disconnect(): Promise<void> {
    // 断开逻辑
  }
}
```

## 测试

```bash
# 运行测试
npm test

# 测试覆盖率
npm run test:coverage
```

## 贡献

欢迎提交 Issue 和 Pull Request！

## License

MIT