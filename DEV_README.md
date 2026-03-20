# CC-Power Developer Guide

## 信号文件相关

### 写信号文件的函数

| 函数 | 文件 | 描述 |
|------|------|------|
| `createRegisterSignal(tmuxSession, projectDir, projectConfig)` | `utils/signals.ts:59-91` | 创建注册信号文件，位于 `~/.cc-power/signals/register-{projectName}.json` |
| `createUnregisterSignal(projectConfig)` | `utils/signals.ts:96-122` | 创建注销信号文件，位于 `~/.cc-power/signals/unregister-{projectName}.json` |

**信号文件位置**: `~/.cc-power/signals/`

**信号类型**:
```typescript
// 注册信号
interface RegisterSignal {
  type: 'register';
  projectId?: string;
  projectName?: string;
  tmuxPane: string;
  timestamp: number;
  projectDirectory: string;
  provider: string;
  config: any;
}

// 注销信号
interface UnregisterSignal {
  type: 'unregister';
  projectId?: string;
  projectName?: string;
  timestamp: number;
  config: any;
}
```

## Hook 信号处理

### Hook 信号处理函数

| 函数 | 文件 | 描述 |
|------|------|------|
| `processHookSignal(filePath)` | `commands/start.command.ts:233-261` | 监听和处理 hook 信号文件 (`send-*.json`) |
| `handleNewHookSignal(signal)` | `commands/start.command.ts:268-361` | 处理新格式 hook 信号，发送消息到 IM |

**Hook 信号文件位置**: `~/.cc-power/hooks/`

**Hook 信号格式**:
```typescript
// Stop 事件
{
  hook_event_name: 'Stop'
}

// 新格式 (带 provider 和 project_name)
{
  transcript_path?: string;
  last_assistant_message?: string;
  cwd?: string;
  provider?: any;
  project_name?: string;
}
```

## IM 消息处理

### 收到 IM 消息入口

| 函数 | 文件 | 描述 |
|------|------|------|
| `handleWsMessage(data, config)` | `providers/feishu.ts:96-106` | Feishu WebSocket 消息入口，解析消息并分发 |
| `handleIncomingMessage(message, sender, config)` | `providers/feishu.ts:108-161` | Feishu 处理入站消息，构造 `IncomingMessage` 并触发回调 |
| `handleIncomingMessage(message)` | `core/router.ts:274-324` | Router 处理入站消息，存入队列并通过 Tmux 注入到 Claude Code |
| `onMessage(callback)` | `providers/base.ts:42-45` | Provider 基类，注册消息回调函数 |

**消息流**:
```
WebSocket Message
  ↓
FeishuProvider.handleWsMessage()
  ↓
FeishuProvider.handleIncomingMessage()
  ↓
Router.handleIncomingMessage()
  ↓
Tmux send-keys → Claude Code
```

### 发送消息到 IM 入口

| 函数 | 文件 | 描述 |
|------|------|------|
| `sendMessage(chatId, content)` | `providers/feishu.ts:163-188` | Feishu 发送消息到指定 chat_id |
| `sendMessage(chatId, content)` | `providers/telegram.ts` | Telegram 发送消息 |
| `sendMessage(chatId, content)` | `providers/whatsapp.ts` | WhatsApp 发送消息 |
| `_sendMessageToProvider(message)` | `core/router.ts:501-524` | Router 内部方法，调用 Provider 的 sendMessage |

**发送消息流**:
```
Claude Code / Hook Signal
  ↓
Router._sendMessageToProvider()
  ↓
Provider.sendMessage()
  ↓
IM Platform API
```

## 目录结构

```
cc-power-service/
├── commands/
│   └── start.command.ts          # 启动命令，包含信号文件监听和处理
├── core/
│   └── router.ts                 # 路由器，管理 Provider 和消息路由
├── providers/
│   ├── feishu.ts                 # 飞书 Provider
│   ├── telegram.ts               # Telegram Provider
│   ├── whatsapp.ts               # WhatsApp Provider
│   └── feishu-connection-manager.ts  # 飞书连接管理器
├── utils/
│   ├── signals.ts                # 信号文件工具函数
│   └── logger.ts                 # 日志工具
└── types/
    └── provider.config.ts        # Provider 配置类型定义
```