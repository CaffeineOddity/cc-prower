# CC-Power

轻量级桥接服务，连接 Claude Code 和聊天平台（飞书、Telegram、WhatsApp）。

## 功能特性

- 🚀 **轻量级设计** - 基于 MCP (Model Context Protocol) 协议
- 🔄 **多种传输模式** - 支持 STDIO 和 HTTP/SSE 两种模式
- 💬 **多平台支持** - 飞书、Telegram、WhatsApp
- 📊 **监控面板** - HTTP 模式提供实时监控面板
- 🧠 **会话管理** - 自动管理聊天历史和超时

## 安装

### 1. 构建和全局安装

```bash
# 在 cc-prower 根目录运行
./setup.sh
```

### 2. 配置项目

```bash
# 配置你的项目
./setup-project-mcp.sh /path/to/your/project
```

配置脚本会让你选择传输模式：

**选项 1: STDIO 模式** (推荐用于开发)
- MCP 服务器由 Claude Code 自动启动
- 无需手动启动服务
- 简单易用

**选项 2: HTTP/SSE 模式** (推荐用于生产)
- 需要单独启动 HTTP 服务器
- 提供监控面板
- 支持多客户端连接

## 使用方法

### STDIO 模式

```bash
cd /path/to/your/project
claude
```

Claude Code 会自动启动 MCP 服务器，无需额外操作。

### HTTP/SSE 模式

1. **启动 HTTP 服务器**（在一个新终端）：

```bash
cd /path/to/cc-prower
cc-power start
```

服务器默认运行在 `http://127.0.0.1:8888`

2. **监控面板**：

打开浏览器访问 `http://127.0.0.1:8888/status` 查看服务状态

3. **使用 Claude Code**：

```bash
cd /path/to/your/project
claude
```

## 可用工具

| 工具名 | 描述 |
|--------|------|
| `send_message` | 发送消息到聊天平台 |
| `list_chats` | 列出可用的聊天 |
| `get_status` | 获取服务状态 |
| `register_project` | 注册项目配置 |
| `unregister_project` | 取消注册项目 |
| `send_heartbeat` | 发送心跳保持连接 |
| `get_heartbeat_status` | 获取心跳状态 |
| `get_incoming_messages` | 获取入站消息 |
| `auto_discover_projects` | 自动发现项目 |

## 配置文件

### 全局配置 (config.yaml)

```yaml
# MCP 服务器配置
mcp:
  transport: "http"  # stdio 或 http
  port: 8888
  host: "127.0.0.1"

# 项目配置目录
projects_dir: "./projects"

# 日志配置
logging:
  level: "info"
  file: "./logs/cc-power.log"

# Provider 配置
providers:
  feishu:
    enabled: true
  telegram:
    enabled: false
  whatsapp:
    enabled: false
```

### 项目配置

**飞书** (.cc-power.yaml)：

```yaml
provider: "feishu"

feishu:
  app_id: "cli_your_app_id_here"
  app_secret: "your_app_secret_here"
  bot_name: "Claude Bot"

session:
  max_history: 50
  timeout_minutes: 30
```

**Telegram** (cc-power.yaml)：

```yaml
provider: "telegram"

telegram:
  bot_token: "your_bot_token_here"

session:
  max_history: 50
  timeout_minutes: 30
```

## 开发

### 构建项目

```bash
npm run build
```

### 运行服务

```bash
# HTTP 模式
cc-power start

# 强制 STDIO 模式
cc-power start --stdio

# 指定配置文件
cc-power start -c /path/to/config.yaml
```

### 其他命令

```bash
# 初始化项目配置
cc-power init my-project -p feishu

# 验证配置
cc-power validate

# 查看状态
cc-power status

# 查看消息日志
cc-power logs my-project -c 50
```

## 传输模式对比

| 特性 | STDIO | HTTP/SSE |
|------|-------|----------|
| 启动方式 | Claude Code 自动启动 | 手动启动服务器 |
| 配置复杂度 | 简单 | 中等 |
| 监控面板 | 无 | 有 |
| 多客户端 | 否 | 是 |
| 推荐场景 | 开发、单用户 | 生产、多用户 |

## 故障排查

### MCP 服务器连接失败

1. 确认 CLI 已正确安装：
   ```bash
   which cc-power
   cc-power --version
   ```

2. 检查 MCP 配置：
   ```bash
   /mcp list
   ```

3. STDIO 模式：确保使用了 `--stdio` 标志
4. HTTP 模式：确保服务器正在运行

### 查看 MCP 服务器日志

STDIO 模式的日志输出到 Claude Code 的日志中，HTTP 模式的日志在 `./logs/cc-power.log`。

## 许可证

MIT