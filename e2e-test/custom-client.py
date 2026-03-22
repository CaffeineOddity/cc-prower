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
        self.response_queue: Optional[asyncio.Queue] = None

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
            port = ws_config.get('port', 8080)
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
            print("WebSocket not connected")
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
            if not self.response_queue:
                raise Exception("Response queue not initialized")
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