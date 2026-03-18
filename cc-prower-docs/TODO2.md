# CC-Power 架构演进第二阶段优化待办清单 (TODO2)

本清单记录了在完成第一阶段架构演进（单服务多项目与Tmux共享会话）后，为了提升系统的工业级质量、架构健壮性、并发安全以及异常处理能力，而梳理出的待优化点。

## 1. 架构与并发安全优化

*目标：解决多实例竞争与文件读写的并发安全问题。*

- [ ] **解决文件监听的竞争条件 (Race Condition)**
  - **现状**：多个 Claude 项目通过 stdio 启动多个 `cc-power start` 实例，导致多个进程同时监听 `~/.cc-power/signals/` 目录，处理同一个信号文件时可能发生 `ENOENT` 错误。
  - **短期方案**：在 `cli.ts` 的 `processSignalFile` 中增强错误捕获，安全忽略 `ENOENT` 错误（表明已被其他进程处理）。
  - **长期方案（架构重构）**：将后台服务彻底单例化，拆分为纯粹的 Daemon 进程和轻量级的 MCP Bridge。

- [ ] **提升文件并发写入的安全风险 (File I/O Safety)**
  - **现状**：在 `recordProjectHistory` 中使用 Read-Modify-Write 模式修改 `project_history.json`，在多项目并发启动时极易发生文件覆盖和内容损坏。
  - **优化方案**：引入文件锁机制（如 `proper-lockfile`）或原子写入库（如 `write-file-atomic`），确保对 `project_history.json` 的更新是原子的。

## 2. 进程与资源管理优化

*目标：提高子进程唤起成功率与内存资源利用率。*

- [ ] **增强安装与依赖检测 (Environment Setup)**
  - **现状**：核心交互严重依赖 `tmux`，但在 `setup.sh` 初始化脚本中未对用户的环境是否安装了 `tmux` 进行检测，这可能导致后续使用 `cc-power run` 时报错。
  - **优化方案**：在 `setup.sh` 脚本中增加 `tmux` 命令的探测。如果未安装，提供明确的安装提示（如 `brew install tmux` 或 `apt-get install tmux`）。

- [ ] **清理废弃的安装配置流程 (Setup Script Refactoring)**
  - **现状**：`setup-project-mcp.sh` 脚本中仍包含大量基于第一阶段架构（HTTP/SSE模式、手动配置 Hooks）的逻辑。例如：
    1. 提供传输模式选择（STDIO 或 HTTP/SSE），而架构已强制要求仅使用 STDIO 模式。
    2. 执行 `setup_claude_code_hooks` 函数，将生命周期脚本注入到 `.claude/hooks` 目录，而该机制已被 `cc-power run` 命令行工具完全取代。
    3. `print_post_instructions` 提示用户使用 `claude` 命令启动，而新架构应提示使用 `cc-power run`。
  - **优化方案**：精简 `setup-project-mcp.sh` 脚本。移除传输模式选择，默认只配置 STDIO；彻底删除 `setup_claude_code_hooks` 相关逻辑；更新使用说明，引导用户使用 `cc-power run` 启动项目。


- [ ] **消除子进程唤起的环境依赖 (Process Execution)**
  - **现状**：`wakeUpProject` 方法中硬编码了 `npx cc-power run`，在某些缺少环境变量的后台环境中可能执行失败。
  - **优化方案**：使用当前 Node.js 进程的执行路径动态启动，例如 `spawn(process.execPath, [process.argv[1], 'run', ...])`。

- [ ] **防范内存泄露隐患 (Memory Leak)**
  - **现状**：如果项目唤起失败或处于僵死状态，`incomingMessageQueue` 队列中的消息会无限堆积，导致内存溢出。
  - **优化方案**：在 `handleIncomingMessage` 中为队列设置最大长度限制（例如 50 条）或 TTL，当队列满时主动丢弃最老的消息并记录告警日志。

## 3. 容错与自愈机制优化

*目标：增强系统对外部环境（如 Tmux Session 异常终止）的感知与恢复能力。*

- [ ] **增强 Tmux 注入的鲁棒性与状态自愈 (Tmux Injection Robustness)**
  - **现状**：`injectMessageViaTmux` 中直接执行 `tmux send-keys`，如果用户手动 kill 掉了 session，系统无法感知，会导致注入报错且项目状态处于假死。
  - **优化方案**：在注入前先执行 `tmux has-session` 进行存活检查。如果 session 已死亡，则捕获异常并主动调用 `unregisterProject` 触发项目的自愈清理逻辑。

- [ ] **实现基于 Tmux 的状态巡检 (Session Polling)**
  - **现状**：目前仅依赖 `cc-power run` 正常退出时生成的注销信号，若进程异常终止（如 `kill -9`），服务端的项目状态会成为孤儿状态。
  - **优化方案**：在 Router 中实现定期轮询（如每 1 分钟），检查所有已注册项目的 Tmux session 是否存活，对已失效的 session 自动执行注销逻辑。
