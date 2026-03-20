# TODO: 应用自定义连接 Claude Code 通用方案

## 需求概述

设计一个通用方案，让外部应用能够通过 CCPower 服务连接到 Claude Code：

1. **入站路径**: 应用 → CCPower (WebSocket) → tmux → Claude Code
2. **出站路径**: Claude Code → hook → CCPower (WebSocket) → 应用
3. **WebSocket 实时通信**: 基于 WebSocket 的双向消息通道
4. **API Key 认证**: 简单安全的鉴权方式
5. **支持定时发送**: 应用定时向 Claude 发送任务

---

## 架构设计

```
┌─────────────────┐    1. WebSocket 连接    ┌─────────────────┐
│                 │ ◄────────────────────── │                 │
│   外部应用       │                        │  CCPower 服务   │
│   (WebSocket    │    2. 发送消息          │  (Custom        │
│    Client)      │ ──────────────────────▶ │   Provider)     │
│                 │                        └────────┬────────┘
└─────────────────┘                                 │
                                                         │ 3. 注入消息
                                                         ▼
                                                  ┌─────────────┐
                                                  │   tmux      │
                                                  │  session    │
                                                  └─────────────┘
                                                         │
                                                         │ 4. 处理消息
                                                         ▼
                                                  ┌─────────────┐
                                                  │ Claude Code │
                                                  └─────────────┘
                                                         │
                                                         │ 5. 发送 hook
                                                         ▼
                                                  ┌─────────────┐
                                                  │ stop-hook   │
                                                  └─────────────┘
                                                         │
                                                         │ 6. 回传响应
                                                         ▼
                                                  ┌─────────────┐
                                                  │  CCPower    │
                                                  │  Custom     │
                                                  │  Provider   │
                                                  └─────────────┘
                                                         │
                                                         │ 7. WebSocket 推送
                                                         ▼
                                                  ┌─────────────────┐
                                                  │   外部应用       │
                                                  └─────────────────┘
```

---

## 实现方案

### 1. 新增 Custom Provider

| 文件 | 说明 |
|------|------|
| `cc-power-service/providers/custom.ts` | WebSocket Provider 实现 |
| `cc-power-service/providers/templates/custom-template.yaml` | 配置模板 |
| `package.json` | 添加 `ws` 依赖 |

### 2. 配置模板

#### `providers/templates/custom-template.yaml`

```yaml
# Custom Provider Configuration
project_name: My Custom App  # Optional: Project name for display and tmux session

provider:
  name: custom
  app_id: "my-app-v1"           # 应用标识，用于 WebSocket 握手和路由
  api_key: "your_api_key_here"  # 认证密钥，用于 WebSocket 握手
  priority: 10
  keyword: ""                   # Optional: only trigger if message contains this keyword

session:
  max_history: 50
  timeout_minutes: 30
```

**端口配置**:
- WebSocket 端口从 CCPower 配置文件 (`~/.cc-power/config.yaml`) 中的 `WebSocket.port` 读取
- 客户端会自动读取配置文件获取 WebSocket 地址
- 启动时 CCPower 会自动 kill 掉占用该端口的进程

---

### 3. 消息协议定义

#### 通用消息结构

所有 WebSocket 消息都遵循统一的格式：

```typescript
interface WebSocketMessage<T = Record<string, any>> {
  type: Message_type;          // 消息类型
  app_id?: string;             // 应用标识（某些消息类型不需要）
  data?: T;                    // 消息数据（负载）
  timestamp: number;           // 时间戳
}

// 消息类型枚举
type Message_type =
  | 'heartbeat'   // 心跳消息
  | 'connected'   // 连接确认
  | 'llm'         // LLM 请求/响应
  | 'error'       // 错误消息;
```

#### 消息类型详情

##### 1. heartbeat（心跳）

用于保持连接活跃：

```typescript
// Server → Client
{
  "type": "heartbeat",
  "data": {
    "action": "ping"        // ping 或 pong
  },
  "timestamp": 1234567890
}

// Client → Server (pong 响应)
{
  "type": "heartbeat",
  "data": {
    "action": "pong"
  },
  "timestamp": 1234567891
}
```

##### 2. connected（连接确认）

连接建立成功后的确认消息：

```typescript
// Server → Client
{
  "type": "connected",
  "data": {
    "app_id": "my-app-v1",
    "server_version": "1.0.0"
  },
  "timestamp": 1234567890
}
```

##### 3. llm（LLM 请求/响应）

与 Claude Code 的交互消息：

```typescript
// Client → Server（请求）
{
  "type": "llm",
  "app_id": "my-app-v1",
  "data": {
    "content": "帮我分析最近的错误日志",
    "metadata": {
      "timeout": 300,           // 超时时间（秒）
      "context": {
        "file": "/var/log/app.log",
        "line": 100
      }
    }
  },
  "timestamp": 1234567890
}

// Server → Client（响应）
{
  "type": "llm",
  "data": {
    "success": true,
    "content": "日志分析结果：...",
    "metadata": {
      "duration": 45,           // 处理耗时（秒）
      "transcript_path": "/path/to/transcript.json"
    }
  },
  "timestamp": 1234567935
}
```

##### 4. error（错误消息）

错误通知：

```typescript
// Server → Client
{
  "type": "error",
  "data": {
    "code": "INVALID_SIGNATURE",   // 错误码
    "message": "Invalid message signature",
    "details": {}
  },
  "timestamp": 1234567890
}

// Client → Server（客户端错误报告）
{
  "type": "error",
  "app_id": "my-app-v1",
  "data": {
    "code": "CLIENT_ERROR",
    "message": "Failed to process response"
  },
  "timestamp": 1234567890,
  "signature": "..."
}
```

**错误码定义**：

| 错误码 | 说明 |
|-------|------|
| `UNAUTHORIZED` | 认证失败 |
| `TIMEOUT` | 请求超时 |
| `INTERNAL_ERROR` | 服务器内部错误 |
| `INVALID_MESSAGE` | 消息格式错误 |

#### 顺序匹配模式说明

本方案采用**顺序匹配模式**：

- 应用发送 LLM 请求后，等待下一个到达的 LLM 响应
- 响应自动关联到最近发送的请求
- 应用应**一次只发送一个 LLM 请求**，确保顺序正确

```
应用发送: {type: 'llm', data: {content: "检查系统状态"}}
    ↓ (等待)
Claude 响应: {type: 'llm', data: {content: "系统正常运行..."}}
    ↓ (返回给应用)
```

**限制**：不支持并发请求。如需并发，应用端应自行排队。

#### 内部消息转换

接收到 WebSocket 消息后，转换为 CCPower 内部的 `IncomingMessage`：

```typescript
// WebSocket llm 请求 → IncomingMessage
const incomingMessage: IncomingMessage = {
  type: 'incoming',
  provider: 'custom',
  projectId: this.getProjectId(),
  chatId: message.app_id,    // 使用 app_id 作为 chatId
  userId: message.app_id,     // 使用 app_id 作为 userId
  content: message.data.content,
  timestamp: message.timestamp,
  metadata: {
    project_name: this.projectName,
    ...message.data.metadata,
  },
};
```

---

### 4. CustomProvider 实现

```typescript
import { BaseProvider } from './base.js';
import type { IncomingMessage } from '../types/index.js';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage as HttpIncomingMessage } from 'http';

// 通用 WebSocket 消息结构
interface WebSocketMessage<T = Record<string, any>> {
  type: 'heartbeat' | 'connected' | 'llm' | 'error';
  app_id?: string;
  data?: T;
  timestamp: number;
}

// WebSocket 客户端连接信息
interface ClientConnection {
  app_id: string;
  ws: WebSocket;
  connectedAt: number;
  lastHeartbeat: number;
}

export class CustomProvider extends BaseProvider {
  private server: WebSocketServer | null = null;
  private port: number;
  private apiKey: string;
  private clients = new Map<string, ClientConnection>();  // app_id → connection
  private configManager: ConfigManager;

  // 心跳配置
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000;  // 30 秒
  private readonly CLIENT_TIMEOUT = 90000;      // 90 秒无心跳则断开

  constructor(configManager: ConfigManager) {
    super('custom');
    this.configManager = configManager;
  }

  async connect(config: CustomTemplateConfig): Promise<void> {
    this.config = config;
    this.projectName = config.project_name;
    const { provider } = config;
    this.apiKey = provider.api_key;

    // 从全局配置读取 WebSocket 端口
    const globalConfig = this.configManager.getGlobalConfig();
    this.port = globalConfig.WebSocket?.port || 8080;

    // 启动前 kill 掉占用该端口的进程
    await this.killPortProcess(this.port);

    await this.startWebSocketServer();
    this.startHeartbeat();
    this.connected = true;

    console.log(`Custom provider started: ws://127.0.0.1:${this.port}`);
  }

  /**
   * 杀掉占用指定端口的进程
   */
  private async killPortProcess(port: number): Promise<void> {
    try {
      // macOS/Linux: lsof -ti :port | xargs kill -9
      const { exec } = await import('child_process');
      await new Promise<void>((resolve, reject) => {
        const command = `lsof -ti :${port} 2>/dev/null | xargs kill -9 2>/dev/null || true`;
        exec(command, (error) => {
          if (error) {
            // 端口未被占用是正常情况，不报错
            resolve();
          } else {
            resolve();
          }
        });
      });
      console.log(`Checked and cleared port ${port}`);
    } catch (error) {
      console.warn(`Failed to kill process on port ${port}:`, error);
    }
  }

  private async startWebSocketServer(): Promise<void> {
    this.server = new WebSocketServer({ port: this.port });

    this.server.on('connection', (ws: WebSocket, req: HttpIncomingMessage) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const apiKey = url.searchParams.get('api_key');
      if (apiKey !== this.apiKey) {
        ws.close(1008, 'Unauthorized');
        return;
      }
      const app_id = url.searchParams.get('app_id') || 'unknown';
      this.handleClientConnect(app_id, ws);
    });
  }

  private handleClientConnect(app_id: string, ws: WebSocket): void {
    const connection: ClientConnection = {
      app_id,
      ws,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    this.clients.set(app_id, connection);
    console.log(`Client connected: ${app_id}`);

    // 发送连接确认
    this.sendToClient(app_id, {
      type: 'connected',
      data: {
        app_id,
        server_version: '1.0.0'
      },
      timestamp: Date.now(),
    });

    ws.on('message', (rawMessage: Buffer) => {
      this.handleClientMessage(ws, rawMessage);
    });

    ws.on('close', () => {
      this.handleClientDisconnect(ws);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for ${app_id}:`, error);
    });
  }

  private handleClientMessage(ws: WebSocket, rawMessage: Buffer): void {
    try {
      const message: WebSocketMessage = JSON.parse(rawMessage.toString());

      // 处理不同类型的消息
      switch (message.type) {
        case 'llm':
          this.handleLLMMessage(message);
          break;
        case 'heartbeat':
          // 客户端发送 pong
          if (message.data?.action === 'pong') {
            const client = this.clients.get(message.app_id!);
            if (client) {
              client.lastHeartbeat = Date.now();
            }
          }
          break;
        default:
          console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Failed to handle client message:', error);
    }
  }

  private handleLLMMessage(message: WebSocketMessage): void {
    const incomingMessage: IncomingMessage = {
      type: 'incoming',
      provider: 'custom',
      projectId: this.getProjectId(),
      chatId: message.app_id!,
      userId: message.app_id!,
      content: message.data?.content || '',
      timestamp: message.timestamp,
      metadata: {
        project_name: this.projectName,
        ...message.data?.metadata,
      },
    };

    this.messageCallback(incomingMessage);
    console.log(`LLM message received from ${message.app_id}: ${incomingMessage.content.substring(0, 50)}...`);
  }

  private sendToClient(app_id: string, message: WebSocketMessage): void {
    const client = this.clients.get(app_id);
    if (client && client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(message));
    }
  }

  private sendError(app_id: string, code: string, message: string): void {
    this.sendToClient(app_id, {
      type: 'error',
      data: {
        code,
        message,
      },
      timestamp: Date.now(),
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.CLIENT_TIMEOUT;

      for (const [app_id, connection] of this.clients.entries()) {
        if (now - connection.lastHeartbeat > timeout) {
          console.log(`Client timeout, disconnecting: ${app_id}`);
          connection.ws.close();
          this.clients.delete(app_id);
          continue;
        }

        if (connection.ws.readyState === 1) {
          connection.ws.send(JSON.stringify({
            type: 'heartbeat',
            data: { action: 'ping' },
            timestamp: now,
          }));
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  async sendMessage(chatId: string, content: string, metadata?: any): Promise<void> {
    const app_id = chatId;
    this.sendToClient(app_id, {
      type: 'llm',
      data: {
        success: true,
        content,
        metadata: {
          duration: metadata?.duration,
          transcript_path: metadata?.transcript_path,
        },
      },
      timestamp: Date.now(),
    });
    console.log(`LLM response sent to ${app_id}`);
  }

  getProjectId(): string {
    return `${this.config?.provider?.app_id || 'custom'}-${this.projectName}`;
  }

  async disconnect(): Promise<void> {
    for (const [app_id, connection] of this.clients.entries()) {
      connection.ws.close();
    }
    this.clients.clear();

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.server?.close();
    this.connected = false;
    console.log('Custom provider disconnected');
  }
}
```

---

### 5. 类型定义更新

#### `types/provider.config.ts`

```typescript
// 新增 Custom Provider 类型
export type ProviderType = 'feishu' | 'telegram' | 'whatsapp' | 'custom';

export interface CustomConfig extends ProviderConfig {
  name: 'custom';
  app_id: string;           // 应用标识
  api_key: string;          // 认证密钥
}

export interface CustomTemplateConfig extends TemplateProviderConfig {
  provider: CustomConfig;
}

// 更新 get_project_id 函数
export function get_project_id(template: TemplateProviderConfig): string {
  if (template.provider.name === 'feishu') {
    return `${template.provider.app_id}-${template.provider.chat_id}`;
  }
  if (template.provider.name === 'telegram') {
    return `${template.provider.bot_token}-${template.provider.chat_id}`;
  }
  if (template.provider.name === 'whatsapp') {
    return `${template.provider.phone_number}-${template.provider.chat_id}`;
  }
  if (template.provider.name === 'custom') {
    return `${template.provider.app_id}-${template.project_name}`;
  }
  return template.project_name;
}
```

---

### 6. package.json 依赖

```json
{
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.12"
  }
}
```

---

### 7. Router 集成

Router 无需修改，CustomProvider 完全兼容现有的 Provider 架构。

---

## 使用示例

### 1. 配置项目

```yaml
# .cc-power.yaml
project_name: my-custom-app

provider:
  name: custom
  app_id: "my-app-v1"
  api_key: "my_secret_key_123"
  priority: 10
  keyword: ""
```

### 2. 启动服务

```bash
# 终端 1: 启动 CCPower 服务
ccpower start

# 终端 2: 运行项目
ccpower run /path/to/project
```

启动后，CCPower 会输出 WebSocket 连接地址，例如：
```
Custom provider started: ws://127.0.0.1:8080
```

### 3. 客户端连接方式

客户端可以通过以下方式获取 WebSocket 地址：

1. **配置文件**: 客户端可读取 `~/.cc-power/config.yaml` 中的 `WebSocket` 配置自动获取地址
2. **环境变量**: 可通过 `CCPOWER_WS_URL` 环境变量指定
3. **命令行参数**: 客户端启动时通过 `--url` 参数指定

### 4. Python 客户端

#### 安装依赖

```bash
pip install websockets asyncio pyyaml
```

#### 完整客户端实现

```python
"""
CCPower Custom Provider Python Client
连接到 CCPower WebSocket 服务，发送消息到 Claude Code
"""

import asyncio
import websockets
import json
import time
from typing import Optional, Dict, Any


class ClaudeClient:
    """Claude Code WebSocket 客户端（顺序匹配模式）"""

    def __init__(
        self,
        api_key: str,
        app_id: str,
        ws_url: Optional[str] = None,
        config_path: str = "~/.cc-power/config.yaml"
    ):
        self.api_key = api_key
        self.app_id = app_id
        # 优先使用指定的 ws_url，否则从配置文件读取
        self.ws_url = ws_url or self._load_ws_url_from_config(config_path)
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.response_queue: asyncio.Queue = None

    def _load_ws_url_from_config(self, config_path: str) -> str:
        """从配置文件读取 WebSocket 地址"""
        import os
        import yaml

        # 展开路径中的 ~
        config_path = os.path.expanduser(config_path)

        try:
            with open(config_path, 'r') as f:
                config = yaml.safe_load(f)

            # 读取 WebSocket 配置
            ws_config = config.get('WebSocket', {})
            port = ws_config.get('port', 9000)
            host = ws_config.get('host', '127.0.0.1')

            return f"ws://{host}:{port}/ws"
        except Exception as e:
            print(f"Warning: Failed to load config from {config_path}: {e}")
            return "ws://127.0.0.1:8080/ws"  # 默认地址

    async def connect(self) -> None:
        """建立 WebSocket 连接"""
        url = f"{self.ws_url}?api_key={self.api_key}&app_id={self.app_id}"
        self.ws = await websockets.connect(url)
        self.response_queue = asyncio.Queue()
        print(f"Connected to CCPower: {self.app_id}")

        # 启动消息接收协程
        asyncio.create_task(self._receive_messages())

    async def _receive_messages(self) -> None:
        """接收并处理服务器消息"""
        if not self.ws:
            return

        try:
            async for message in self.ws:
                data = json.loads(message)
                await self._handle_message(data)
        except websockets.exceptions.ConnectionClosed:
            print("Connection closed")
        except Exception as e:
            print(f"Error receiving messages: {e}")

    async def _handle_message(self, data: Dict[str, Any]) -> None:
        """处理接收到的消息"""
        msg_type = data.get('type')

        # 处理心跳
        if msg_type == 'heartbeat':
            action = data.get('data', {}).get('action')
            if action == 'ping':
                await self._send_pong()
            return

        # 处理连接确认
        if msg_type == 'connected':
            print(f"Connection confirmed")
            return

        # 处理 LLM 响应
        if msg_type == 'llm':
            if self.response_queue:
                await self.response_queue.put(data)
            return

    async def _send_pong(self) -> None:
        """发送心跳响应"""
        if self.ws:
            await self.ws.send(json.dumps({
                'type': 'heartbeat',
                'data': {'action': 'pong'},
                'timestamp': int(time.time())
            }))

    async def send(
        self,
        content: str,
        timeout: int = 300,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        发送消息到 Claude Code

        注意：此方法使用顺序匹配模式，应用应一次只发送一个消息。

        Args:
            content: 发送给 Claude 的内容
            timeout: 超时时间（秒）
            metadata: 附加元数据

        Returns:
            Claude 的响应

        Raises:
            TimeoutError: 超时
            Exception: 其他错误
        """
        if not self.ws:
            raise Exception("Not connected")

        timestamp = int(time.time())
        message_data = {
            'content': content,
            'metadata': {
                'timeout': timeout,
                **(metadata or {})
            }
        }

        payload = {
            "type": "llm",
            "app_id": self.app_id,
            "data": message_data,
            "timestamp": timestamp
        }

        # 发送消息
        await self.ws.send(json.dumps(payload))
        print(f"Sent: {content[:50]}...")

        # 等待响应
        try:
            response = await asyncio.wait_for(self.response_queue.get(), timeout=timeout)
            return response
        except asyncio.TimeoutError:
            raise TimeoutError(f"Response timeout after {timeout} seconds")

    async def close(self) -> None:
        """关闭连接"""
        if self.ws:
            await self.ws.close()
            print("Connection closed")


# ============ 使用示例 ============

async def example_single_task():
    """示例：发送单个任务"""
    client = ClaudeClient(
        api_key="my_secret_key_123",
        app_id="my-app-v1"
    )

    try:
        await client.connect()
        response = await client.send("帮我分析最近的错误日志并给出修复建议")
        print(f"Response: {response.get('data', {}).get('content', '')[:100]}...")
    finally:
        await client.close()


async def example_scheduled_task():
    """示例：定时发送任务"""
    client = ClaudeClient(
        api_key="my_secret_key_123",
        app_id="my-app-v1"
    )

    try:
        await client.connect()

        while True:
            print("\n" + "=" * 50)
            print("Sending scheduled task to Claude...")
            try:
                response = await client.send("检查系统状态")
                print(f"Response: {response.get('data', {}).get('content', '')[:100]}...")
            except Exception as e:
                print(f"Error: {e}")

            print("Waiting 10 minutes...")
            await asyncio.sleep(600)

    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        await client.close()


# ============ 命令行工具 ============

async def cli_send(args):
    """命令行发送消息"""
    client = ClaudeClient(
        api_key=args.api_key,
        app_id=args.app_id,
        ws_url=args.url,
        config_path=args.config_path
    )

    try:
        await client.connect()
        response = await client.send(
            args.content,
            timeout=args.timeout
        )
        print("\n" + "=" * 50)
        print("Claude Response:")
        print("=" * 50)
        content = response.get('data', {}).get('content', 'No content')
        print(content)
        if response.get('data', {}).get('metadata', {}).get('transcript_path'):
            print(f"\nTranscript: {response['data']['metadata']['transcript_path']}")
    except TimeoutError:
        print(f"\nError: Request timeout after {args.timeout} seconds")
    except Exception as e:
        print(f"\nError: {e}")
    finally:
        await client.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="CCPower Custom Client")
    parser.add_argument("--api-key", required=True, help="API Key")
    parser.add_argument("--app-id", default="my-app-v1", help="App ID")
    parser.add_argument("--url", help="WebSocket URL (如果指定，将覆盖配置文件中的地址)")
    parser.add_argument("--config-path", default="~/.cc-power/config.yaml", help="CCPower 配置文件路径")
    parser.add_argument("--content", help="Content to send to Claude")
    parser.add_argument("--timeout", type=int, default=300, help="Timeout in seconds")

    args = parser.parse_args()

    if args.content:
        asyncio.run(cli_send(args))
    else:
        # 默认运行定时任务示例
        print("Running scheduled task example...")
        print("Press Ctrl+C to stop\n")
        asyncio.run(example_scheduled_task())
```

---

## WebSocket 协议细节

### 握手参数

| 参数 | 说明 | 必需 |
|------|------|------|
| `api_key` | 认证密钥（对应配置中的 `provider.api_key`） | 是 |
| `app_id` | 应用标识（对应配置中的 `provider.app_id`） | 是 |

### 通用消息格式

```typescript
interface WebSocketMessage {
  type: 'heartbeat' | 'connected' | 'llm' | 'event' | 'error' | 'ack';
  app_id?: string;
  data?: any;
  timestamp: number;
  signature?: string;
}
```

### 消息类型说明

| 类型 | 方向 | 说明 | 需要签名 |
|------|------|------|---------|
| `heartbeat` | 双向 | 心跳检测（ping/pong） | 否 |
| `connected` | Server → Client | 连接确认 | 否 |
| `llm` | 双向 | LLM 请求/响应 | 请求需要 |
| `event` | Server → Client | 事件通知 | 否 |
| `error` | 双向 | 错误消息 | 客户端需要 |
| `ack` | 双向 | 确认消息 | 否 |

### 签名规则

需要签名的消息：`llm`（请求）、`error`（客户端）

```typescript
const data_str = `${app_id}${type}${JSON.stringify(data)}${timestamp}`;
const signature = HMAC-SHA256(api_key, data_str);
```

---

## 安全考虑

1. **API Key 鉴权**: WebSocket 握手时验证
2. **消息签名**: HMAC-SHA256 防止篡改
3. **心跳超时**: 90 秒无心跳自动断开
4. **本地监听**: 默认只监听 `127.0.0.1`

---

## 实现步骤

| 阶段 | 任务 |
|------|------|
| Phase 1 | 添加 `ws` 依赖到 package.json |
| Phase 2 | 创建 custom-template.yaml 配置模板 |
| Phase 3 | 更新类型定义（CustomConfig） |
| Phase 4 | 创建 CustomProvider 基础结构 |
| Phase 5 | 实现 WebSocket 服务器（基于 ws） |
| Phase 6 | 实现心跳检测机制 |
| Phase 7 | 实现响应匹配和推送 |
| Phase 8 | 编写 Python 客户端示例 |
| Phase 9 | 编写测试和文档 |

---

**等待确认后开始实现。**