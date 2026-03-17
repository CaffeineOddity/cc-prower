# CC-Power 架构演进待办清单：单服务多项目与Tmux共享会话

本清单旨在将 CC-Power 演进为支持 **一个后台服务管理多个项目**，并通过 **Tmux 共享会话** 实现本地与远程（IM）双向控制 Claude Code 的架构。

## 1. 核心架构演进：主动监听与自动化注册

*目标：通过文件系统信号实现项目的自动注册与生命周期管理，移除对客户端手动调用的依赖。*

- [ ] **服务端引入文件系统监听 (File Watcher)**
  - 在 `cc-power start` 启动的后台服务中，使用 `fs.watch` 或 `chokidar` 持续监听 `~/.cc-power/signals/` 目录。
  - 当检测到 `register-*.json` 信号文件时，自动读取配置并调用底层的 `registerProject` 方法。
  - **配置加载职责**: 收到 `register` 信号后，读取信号中的 `projectDirectory`，主动加载该目录下的 `.cc-power.yaml` 配置文件，而非依赖信号文件携带完整配置。
  - 当检测到 `unregister-*.json` 信号文件时，自动调用 `unregisterProject` 清理资源。
  - 处理完信号文件后，自动将其删除。
- [ ] **移除冗余的 MCP 工具**
  - 从 `cc-power-mcp` 中移除 `auto_discover_projects` 工具，注册逻辑完全由后台服务接管。
  - 从 `cc-power-mcp` 中移除 `send_heartbeat` 和 `get_heartbeat_status` 工具，状态检查逻辑由后台服务的 Tmux 巡检接管。
- [ ] **移除 MCP HTTP/SSE 传输支持**
  - 既然 Claude Code 在 Tmux 模式下只通过 stdio 连接 MCP，后台服务仅需提供 HTTP 接口用于接收 IM Webhook，不再需要支持 MCP 协议的 SSE 传输层。
  - 简化 `MCPServer` 类的启动逻辑，移除 HTTP 传输模式下的 SSE 相关代码。
- [ ] **E2E 测试：自动注册流程**
  - **测试用例 TC-010**: 模拟在 `~/.cc-power/signals/` 生成 `register-test.json`，验证后台服务是否自动加载了项目配置。
  - **测试用例 TC-011**: 模拟生成 `unregister-test.json`，验证后台服务是否正确释放了项目资源。

## 2. 交互模式升级：Tmux 共享会话 (Tmux Shared Session)

*目标：实现“本地用户”和“远程 IM”共享同一个 Claude Code 终端，解决远程无法控制 Claude 输入的问题。*

- [ ] **实现** **`cc-power run`** **命令行工具**
  - **功能定义**：用户通过 `cc-power run <project_path>` 启动项目，而非直接运行 `claude`。
  - **参数支持**：
    - `<project_path>`: 项目目录路径。
    - `--session <name>`: 自定义 tmux session 名称。
    - `--skip-ask`: 启动 Claude 时透传 `--dangerously-skip-permissions`，跳过权限检查（适用于无人值守模式）。
  - **逻辑实现**：
    1. **生成 Project ID**: 使用项目绝对路径的 MD5 哈希（前8位），确保唯一性，避免文件夹重名导致冲突。
    2. 检查是否存在名为 `cc-p-<project_id>` 的 tmux session。
    3. 如果不存在，创建新 session 并在其中启动 `claude`（使用 stdio 模式连接 MCP）。
    3. 生成 `register` 信号文件，告知后台服务该项目的 session 名称。
    4. **记录历史**：将项目路径和配置信息写入 `~/.cc-power/cache/project_history.json`，用于后续的自动唤起。
    5. 执行 `tmux attach` 将当前终端接入该 session。
    6. **退出处理**：当用户退出 session 时，自动生成 `unregister` 信号文件，通知后台服务注销项目。
- [ ] **清理 Hook 机制**
  - 移除 `.claude/hooks` 目录及其中的 `session-start` 和 `session-end` 脚本，将生命周期管理完全收归 `cc-power run` 命令行工具。
- [ ] **后台服务实现消息注入 (Input Injection)**
  - **逻辑实现**：当 HTTP Server 收到 IM 消息时，根据 `project_id` 查找对应的 tmux session 名称。
  - 使用 `tmux send-keys -t <session_name> "<message>" Enter` 将消息注入到 Claude 的标准输入。
- [ ] **后台服务实现自动唤起 (Auto-Wakeup)**
  - **逻辑实现**：当收到 IM 消息但项目未运行时（内存中无 Provider）：
    1. 读取 `~/.cc-power/project_history.json` 查找项目路径。
    2. 如果找到，自动在后台执行 `cc-power run <path>` 启动项目。
    3. 等待 `register` 信号就绪后，继续注入消息。
    4. 如果未找到历史记录，向 IM 回复“无法启动项目：未找到运行记录”。
- [ ] **E2E 测试：Tmux 注入与回传**
  - **测试用例 TC-020**: 启动一个伪造的 tmux session 模拟 Claude。
  - **测试用例 TC-021**: 向后台服务发送 HTTP POST 模拟飞书消息。
  - **验证点**: 检查 tmux session 中是否出现了模拟的消息文本（通过 `tmux capture-pane` 验证）。

## 3. 结果回传闭环 (Loopback)

*目标：Claude Code 完成任务后，主动将结果反馈回 IM。*

- [ ] **Prompt 强制闭环约定**
  - 在注入 IM 消息时，自动附加系统级指令：`"（来自飞书用户 xxx）任务完成后，请务必调用 send_message 工具将结果发回。"`
- [ ] **MCP 工具 `send_message` 增强**
  - 确保 stdio 模式下的 `send_message` 工具能正确将消息路由回后台 HTTP 服务。
  - **实现方式**：MCP Server 收到工具调用后，通过 HTTP POST 请求（`http://127.0.0.1:8888/internal/send`）将消息转发给后台守护进程，由守护进程统一负责推送到外部 Provider。
- [ ] **统一配置与状态路径**
  - 确保 `project_history.json` 存储在 `~/.cc-power/cache/` 目录下，信号文件存储在 `~/.cc-power/signals/` 目录下。
  - **精简 Global Config**: 移除 `projects_dir` 配置项，保留 `providers` 作为全局安全开关（默认允许所有，需显式禁用）。
  - 完善 `ConfigManager`，确保 CLI 和后台服务能正确加载项目级配置（`.cc-power.yaml`）。
- [ ] **CLI `status` 命令增强**
  - 更新 `cc-power status`，展示当前活跃的 Tmux Session、历史项目记录以及后台服务的运行状态。
- [ ] **Webhook 安全验证**
  - 在 HTTP Server 接收 IM 消息的接口增加签名验证逻辑，确保消息来源合法。

## 4. 稳定性与多项目隔离

*目标：确保多个项目并发运行时的稳定性和数据隔离。*

- [ ] **Provider 连接池管理**
  - 优化 `Router` 类，确保多个项目使用相同 Provider（如飞书）但不同凭证时的隔离性。
- [ ] **基于 Tmux 的状态巡检 (Session Polling)**
  - 替代原有的 MCP 心跳机制。后台服务定期（如每分钟）执行 `tmux has-session` 检查项目的 Tmux Session 是否存活。
  - 如果 Session 已结束，自动触发注销流程清理资源。

## 5. 监控与日志

*目标：提供可视化的服务状态监控。*

- [ ] **HTTP 监控面板增强**
  - 更新 `http://127.0.0.1:8888/status`，展示当前活跃的 Tmux Session 列表、关联的项目 ID 以及最近的消息注入时间。
- [ ] **日志路径规范化**
  - 统一将所有日志（系统日志、消息日志）存储在 `~/.cc-power/logs/` 下，避免散落在运行目录。

