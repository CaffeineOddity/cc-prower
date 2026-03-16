# cc-connect-carry 启动和测试指南

## 服务状态

cc-connect-carry 已成功启动，MCP 服务器正在运行（stdio 模式）。

当前状态：
- MCP 服务器：运行中（stdio 模式）
- 项目数量：1（hack-a-mole）
- Provider 状态：Feishu（需要更新有效的 app_id 和 app_secret）

注意：Feishu 认证失败是因为示例配置中的凭证无效。需要从飞书开放平台获取有效的应用凭证。

## 快速开始

### 1. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

### 2. 配置飞书机器人

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 获取 `app_id` 和 `app_secret`
4. 更新项目配置：
   ```bash
   vim projects/hack-a-mole/config.yaml
   ```
5. 在飞书开放平台配置：
   - 启用机器人能力
   - 添加权限：`contact:user.base:readonly`, `im:message.group:receive`, `im:message.p2p:receive`, `im:message.group_msg:readonly`, `im:message.p2p_msg:readonly`, `im:message:send_as_bot`
   - 配置事件订阅：选择「使用长连接接收事件」
   - 添加订阅事件：`im.message.receive_v1`

### 3. 连接 Claude Code

```bash
# 在 hack-a-mole 项目目录下
cd /path/to/hack-a-mole-project
claude --mcp "chat-provider=stdio:cc-carry"
```

## MCP 工具测试

### 可用工具

| 工具 | 说明 |
|------|------|
| `send_message` | 发送消息到聊天平台 |
| `list_chats` | 列出可用聊天 |
| `get_status` | 获取 Provider 状态 |

### 示例调用

**发送消息：**
```json
{
  "provider": "feishu",
  "chat_id": "oc_xxx",
  "content": "Hello from Claude Code!"
}
```

**列出聊天：**
```json
{
  "provider": "feishu"
}
```

**获取状态：**
```json
{}
```

## 测试流程

### 1. 基础测试

```bash
# 运行测试套件
npx tsx src/test.ts

# 测试模拟 MCP 服务器
npx tsx src/mock-mcp-test.ts
```

### 2. 集成测试

1. 启动 cc-connect-carry 服务：
   ```bash
   npm start
   ```

2. 在飞书中向机器人发送消息：
   ```
   测试消息
   ```

3. 如果配置正确，服务会：
   - 接收到消息
   - 显示入站消息日志
   - 建立路由映射

### 3. MCP 功能测试

使用 Claude Code 测试 MCP 工具：

```
> 列出飞书的聊天列表
Tool: list_chats
{
  "provider": "feishu"
}
```

```
> 发送消息到飞书
Tool: send_message
{
  "provider": "feishu",
  "chat_id": "oc_xxx",
  "content": "测试消息"
}
```

## 日志查看

服务运行时会输出以下日志：

```
[2026-03-16T10:00:00.000Z] [INFO] cc-connect-carry starting...
[2026-03-16T10:00:00.000Z] [INFO] Config: ./config.yaml
[2026-03-16T10:00:00.000Z] [INFO] Found 3 projects
[2026-03-16T10:00:00.000Z] [INFO] Registering project: hack-a-mole (feishu)
[2026-03-16T10:00:00.000Z] [INFO] Feishu provider connected
```

## 故障排查

### 问题：服务启动失败

```bash
# 检查配置文件
npm run validate

# 查看详细日志
npm start -- --verbose
```

### 问题：连接飞书失败

1. 检查 `app_id` 和 `app_secret` 是否正确
2. 确认飞书应用已发布
3. 检查权限是否已批准
4. 验证事件订阅是否已启用

### 问题：接收不到消息

1. 检查用户是否在 `allowed_users` 列表中
2. 确认机器人已添加到聊天
3. 查看服务日志中的错误信息

## 开发模式

使用 `tsx` 进行开发时修改代码：

```bash
# 开发模式下运行
npx tsx src/cli.ts start

# 或使用 watch 模式
npx tsx watch src/cli.ts start
```

## 生产部署

```bash
# 构建
npm run build

# 全局安装
npm link

# 启动
cc-carry start --config /path/to/config.yaml
```

## 系统服务

### macOS (Launchd)

```bash
cat > ~/Library/LaunchAgents/com.cccarry.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cccarry</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/cc-carry</string>
        <string>start</string>
        <string>--config</string>
        <string>/Users/yourname/.cc-connect/config.yaml</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.cccarry.plist
launchctl start com.cccarry
```

### Linux (systemd)

```bash
cat > /etc/systemd/system/cc-carry.service << EOF
[Unit]
Description=cc-connect-carry
After=network.target

[Service]
Type=simple
User=youruser
ExecStart=/usr/local/bin/cc-carry start
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl enable cc-carry
systemctl start cc-carry
```

## 环境变量

可以通过环境变量配置：

```bash
# 设置日志级别
export CC_CARRY_LOG_LEVEL=debug

# 设置配置文件路径
export CC_CARRY_CONFIG=/path/to/config.yaml

# 设置端口（WebSocket 模式）
export CC_CARRY_PORT=8080
```