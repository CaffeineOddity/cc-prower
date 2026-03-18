# cc-power

基于 MCP 的轻量级 Claude Code 与聊天平台桥接服务。

## 快速开始

### 1. 安装

```bash
npm install
npm run build
npm link  # 全局安装 ccpower 命令
```

### 2. 配置全局服务

编辑 `config.yaml`（全局配置，只需配置一次）：

```yaml
# MCP 服务器配置
mcp:
  transport: "stdio"

# 日志配置
logging:
  level: "info"
  file: "./logs/cc-power.log"

# Provider 配置（仅启用/禁用）
providers:
  feishu:
    enabled: true
  telegram:
    enabled: false
  whatsapp:
    enabled: false
```

### 3. 在项目目录中配置

在项目目录（如 `projects/test-project`）创建配置文件：

```bash
cd projects/test-project
cat > .cc-power.yaml << 'EOF'
provider: feishu

feishu:
  app_id: "cli_a1234567890"
  app_secret: "your-secret-here"
  bot_name: "Claude Bot"
  allowed_users:
    - "ou_xxx1"
    - "ou_xxx2"
EOF
```

### 4. 使用方式

**终端1（后台运行 MCP 服务器）：**

```bash
cd /path/to/cc-power
ccpower start
```

**终端2（运行 Claude Code）：**

```bash
cd projects/test-project
claude
```

当 Claude Code 启动时，会自动检测项目配置并通过 MCP 注册项目。退出时自动取消注册。

## 架构说明

```
┌─────────────────────────────────────────────────────────────────┐
│                    cc-power (终端1)                              │
│                        MCP 服务器                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Router                                │  │
│  │  - 接收 MCP 消息 (来自 Claude Code)                     │  │
│  │  - 接收 Provider 消息 (来自聊天平台)                     │  │
│  │  - 心跳检查和自动清理                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│         │                                              │       │
│         ▼                                              ▼       │
│  ┌──────────────────┐                        ┌──────────────┐ │
│  │  MCP Server      │                        │  Provider    │ │
│  │  (stdio)         │                        │  Manager     │ │
│  │                  │                        │              │ │
│  │  Tools:          │                        │  ┌────────┐  │ │
│  │  - send_message  │                        │  │ Feishu │  │ │
│  │  - list_chats    │                        │  └────────┘  │ │
│  │  - get_status    │                        │              │ │
│  │  - register_project  ← 项目注册                │              │ │
│  │  - unregister_project                        │              │ │
│  │  - send_heartbeat    ← 心跳                 │              │ │
│  └──────────────────┘                        └──────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                                ▲
                                │ stdio / MCP
                                │
┌───────────────────────────────┴─────────────────────────────────┐
│                    Claude Code (终端2)                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              项目检测和自动注册                           │  │
│  │  1. 启动时读取 .cc-power.yaml                            │  │
│  │  2. 调用 register_project MCP 工具                       │  │
│  │  3. 定期发送 heartbeat                                   │  │
│  │  4. 退出时调用 unregister_project                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## MCP 工具

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `send_message` | 发送消息到聊天平台 | `provider`, `chat_id`, `content` |
| `list_chats` | 列出可用聊天列表 | `provider` |
| `get_status` | 获取 Provider 状态 | `provider` |
| `register_project` | 注册项目（传递完整配置） | `project_id`, `provider`, `config` |
| `unregister_project` | 取消注册项目 | `project_id` |
| `send_heartbeat` | 发送心跳 | `project_id` |
| `get_heartbeat_status` | 获取心跳状态 | `project_id` |

## 配置文件

### 全局配置 (config.yaml)

仅包含 MCP 服务器配置和 Provider 启用状态：

```yaml
mcp:
  transport: "stdio"

logging:
  level: "info"
  file: "./logs/cc-power.log"

providers:
  feishu:
    enabled: true
  telegram:
    enabled: false
```

### 项目配置 (.cc-power.yaml 或 config.yaml)

包含具体的 Provider 配置（由项目目录管理）：

```yaml
provider: feishu

feishu:
  app_id: "cli_a1234567890"
  app_secret: "your-secret-here"
  bot_name: "Claude Bot"
  allowed_users:
    - "ou_xxx1"
```

## 心跳机制

- 项目注册时初始化心跳时间
- 客户端定期发送心跳（30秒间隔）
- 如果 60 秒内没有收到心跳，自动注销项目
- 服务关闭时自动清理所有项目

## 设计理念

- **极简架构**：核心代码简洁
- **MCP 协议**：利用 Claude Code 原生 MCP 支持
- **项目本地配置**：每个项目独立管理 Provider 配置
- **自动注册**：Claude Code 启动时自动检测并注册
- **心跳机制**：自动清理已断开的客户端

## License

MIT