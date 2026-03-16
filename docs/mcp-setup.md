# Claude Code MCP 配置指南

本文档介绍如何将 cc-connect-carry 作为 MCP 服务器集成到 Claude Code 中。

## 什么是 MCP？

MCP (Model Context Protocol) 是 Claude Code 用于扩展功能的协议。通过 MCP，Claude Code 可以调用外部工具和服务。

## 前置要求

- 已安装 Claude Code CLI
- 已安装 cc-connect-carry：`npm link`


## 快速开始

假设你有一个项目 `/Users/yourname/projects/myapp`，完整的配置流程如下：

```bash
# 1. 安装 cc-connect-carry
cd /path/to/cc-connect-carry
npm install
npm run build
npm link

# 2. 进入项目目录
cd /Users/yourname/projects/myapp


# 3. 创建项目配置（如果需要）
mkdir -p projects/myapp
cat > projects/myapp/config.yaml << 'EOF'
provider: "feishu"
feishu:
  app_id: "cli_xxx"
  app_secret: "xxx"
  bot_name: "MyApp Bot"
EOF

# 4. 添加 MCP 服务器
# 项目级生效
claude mcp add chat-provider -- cc-carry start --config config.yaml


# 5. 验证配置
claude mcp list


# 6. 启动 Claude Code
claude


# 7. 如果不想用了，可以移除（移除完后重置，需要执行步骤4）
claude mcp remove chat-provider -s local

```

## 工作流程

### 用户 → Claude Code

```
1. 用户在飞书发送消息
2. cc-connect-carry 接收消息（通过轮询）
3. Claude Code 调用 MCP 工具获取消息
4. Claude Code 处理消息并生成回复
```

### Claude Code → 用户

```
1. Claude Code 处理完成
2. Claude Code 调用 MCP 工具 send_message
3. cc-connect-carry 接收调用
4. cc-connect-carry 发送消息到飞书
```

## 参考链接

- [Claude Code 文档](https://docs.anthropic.com/claude-code)
- [MCP 协议规范](https://modelcontextprotocol.io/)
- [cc-connect-carry 项目](https://github.com/your-username/cc-connect-carry)