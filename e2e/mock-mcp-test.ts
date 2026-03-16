#!/usr/bin/env node

/**
 * MCP 服务器测试脚本
 * 测试 cc-connect-carry 的 MCP 工具调用
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  SendMessageArgs,
  ListChatsArgs,
  GetStatusArgs,
} from './types/mcp.js';

/**
 * 模拟的 MCP 客户端测试
 */
class MockMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'mock-test-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // 列出工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'send_message',
            description: 'Send a message to a chat platform',
            inputSchema: {
              type: 'object',
              properties: {
                provider: {
                  type: 'string',
                  enum: ['feishu', 'telegram', 'whatsapp'],
                },
                chat_id: { type: 'string' },
                content: { type: 'string' },
                project_id: { type: 'string' },
              },
              required: ['provider', 'chat_id', 'content'],
            },
          },
          {
            name: 'list_chats',
            description: 'List available chats',
            inputSchema: {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                project_id: { type: 'string' },
              },
              required: ['provider'],
            },
          },
          {
            name: 'get_status',
            description: 'Get provider status',
            inputSchema: {
              type: 'object',
              properties: {
                provider: { type: 'string' },
              },
            },
          },
        ],
      };
    });

    // 调用工具
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      console.log(`\n🔧 Tool Called: ${name}`);
      console.log(`   Arguments:`, JSON.stringify(args, null, 2));

      try {
        let result: any;

        switch (name) {
          case 'send_message':
            result = await this.handleSendMessage(args as SendMessageArgs);
            break;

          case 'list_chats':
            result = await this.handleListChats(args as ListChatsArgs);
            break;

          case 'get_status':
            result = await this.handleGetStatus(args as GetStatusArgs);
            break;

          default:
            result = { error: `Unknown tool: ${name}` };
        }

        console.log(`   Result:`, JSON.stringify(result, null, 2));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(`   Error:`, error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: String(error) }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleSendMessage(args: SendMessageArgs): Promise<any> {
    // 模拟发送消息
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      success: true,
      message: `Message sent to ${args.provider}:${args.chat_id}`,
      content: args.content,
      timestamp: new Date().toISOString(),
    };
  }

  private async handleListChats(args: ListChatsArgs): Promise<any> {
    // 模拟列出聊天
    await new Promise(resolve => setTimeout(resolve, 50));

    const mockChats = [
      {
        chat_id: 'test_chat_1',
        project_id: args.project_id || 'hack-a-mole',
        user_id: 'user_123',
        last_message: 'Hello',
      },
      {
        chat_id: 'test_chat_2',
        project_id: 'hack-a-mole',
        user_id: 'user_456',
        last_message: 'Hi there',
      },
    ];

    return {
      provider: args.provider,
      chats: mockChats,
    };
  }

  private async handleGetStatus(args: GetStatusArgs): Promise<any> {
    // 模拟获取状态
    await new Promise(resolve => setTimeout(resolve, 50));

    const providers: Record<string, any> = {
      feishu: {
        enabled: true,
        connected: true,
        messages_sent: 42,
      },
      telegram: {
        enabled: true,
        connected: true,
        messages_sent: 15,
      },
      whatsapp: {
        enabled: false,
        connected: false,
        messages_sent: 0,
      },
    };

    if (args.provider) {
      return {
        provider: args.provider,
        status: providers[args.provider],
      };
    }

    return {
      providers,
    };
  }

  async startStdio() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('Mock MCP Server started (stdio mode)');
  }
}

async function main() {
  console.log('🧪 Starting Mock MCP Server for Testing...\n');
  console.log('This simulates the cc-connect-carry MCP server behavior.');
  console.log('You can test tools using Claude Code or any MCP client.\n');

  const server = new MockMCPServer();
  await server.startStdio();
}

main();