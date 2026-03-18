// MCP Message Types
export interface MCPRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: any;
}

export interface MCPCallRequest extends MCPRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, any>;
  };
}

export interface MCPInitializeRequest extends MCPRequest {
  method: 'initialize';
  params: {
    capabilities: Record<string, any>;
  };
}

export interface MCPResourceRequest extends MCPRequest {
  method: 'resources/list' | 'resources/read';
  params?: Record<string, any>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface MCCToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface MCCToolResult {
  content: string;
  isError?: boolean;
}