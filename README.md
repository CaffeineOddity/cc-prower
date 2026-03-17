# CC-Power: Claude Code × Chat Platforms Bridge

A lightweight bridge connecting Claude Code with chat platforms (Feishu, Telegram, WhatsApp) via Model Context Protocol (MCP). This service enables Claude Code to receive and respond to messages from various chat platforms while maintaining secure and organized project isolation.

## Architecture

The CC-Power service implements a unified architecture supporting multiple projects under a single backend service:

### Core Components
- **MCP Server**: Communicates with Claude Code instances via stdio transport
- **Router**: Routes messages between Claude Code instances and multiple chat platforms
- **Provider Adapters**: Connect to individual chat platforms (Feishu, Telegram, WhatsApp)
- **Signal File System**: Implements automatic project registration/unregistration via file system signals
- **Tmux Integration**: Enables shared sessions between local users and remote chat platforms

### New Architecture Features (v2.0)
- **File System Signal Listening**: Projects automatically register by creating signal files in `~/.cc-power/signals/`
- **Tmux Shared Sessions**: Local users and remote IM users share the same Claude Code terminal session
- **Auto-Wakeup**: Dormant projects automatically start when receiving new messages
- **Single Backend**: One CC-Power service manages multiple concurrent projects
- **Reduced MCP Tools**: Removed heartbeat-related tools in favor of Tmux-based session monitoring
- **Enhanced Loopback**: Automatic system prompts to ensure Claude uses send_message tool to respond

## Quick Start

### 1. Install Dependencies
```bash
npm install -g @modelcontextprotocol/cli
pnpm install
```

### 2. Configure Global Settings
Create `config.yaml`:
```yaml
# Global configuration
logging:
  level: info

mcp:
  transport: stdio  # Only stdio mode is supported in v2.0

providers:
  feishu:
    enabled: true
  telegram:
    enabled: true
  whatsapp:
    enabled: true
```

### 3. Start the Service
```bash
# Start the CC-Power service (runs in background)
npx cc-power start

# Or start with stdio mode explicitly (recommended for Claude Code MCP integration)
npx cc-power start --stdio
```

### 4. Create a Project
```bash
# Initialize a new project
npx cc-power init my-project --provider feishu

# Edit the project config at projects/my-project/config.yaml with your credentials
```

### 5. Run a Project with Tmux Integration
```bash
# Use the new run command to start a project in a Tmux session
npx cc-power run /path/to/your/project

# This creates a shared session where both local input and IM messages go to the same Claude instance
```

## Signal-Based Auto-Registration

The new architecture uses a file system signal approach for project lifecycle management:

1. **Register**: Create `~/.cc-power/signals/register-<project_id>.json` with project configuration
2. **Unregister**: Create `~/.cc-power/signals/unregister-<project_id>.json` to clean up resources
3. **Auto-Wakeup**: Dormant projects automatically start when receiving messages

## Tmux Integration

The `cc-power run` command creates shared Tmux sessions:
- Uses MD5 hash of project path as unique project ID
- Allows both local user input and remote IM messages to drive the same Claude instance
- Provides automatic project history tracking for restart capabilities

## Supported Platforms

- **Feishu/Lark**: Full integration with bots and chat groups
- **Telegram**: Bot-based messaging support
- **WhatsApp**: Business API integration

## Commands

```bash
# Start the service
npx cc-power start [--stdio]

# Initialize a new project
npx cc-power init [project-name] --provider [feishu|telegram|whatsapp]

# Run a project with Tmux integration
npx cc-power run <project_path> [--session <name>] [--dangerously-skip-permissions]

# Validate configuration
npx cc-power validate [-c config.yaml]

# Show service status
npx cc-power status [-c config.yaml]

# View message logs
npx cc-power logs [project-name] [-c 50] [-o readable|json] [-w] [--chat <chatId>]
```

## Security

- Provider configurations support allowlists for users/chats
- All connections are validated against global provider settings
- Project isolation maintained through unique project IDs and routing tables
- Signal files are automatically cleaned up after processing

## Message Flow

1. **Incoming**: Chat platform → CC-Power HTTP server → Signal/MCP routing → Tmux injection → Claude Code
2. **Outgoing**: Claude Code MCP tools → CC-Power MCP server → Router → Chat platform response

## Development

```bash
# Build the project
cd cc-power && npm run build

# Run tests
npm test

# Start in development mode
npx cc-power start --stdio
```