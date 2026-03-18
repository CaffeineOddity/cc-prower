# CC-Power 架构演进第三阶段优化待办清单 (TODO3)

本清单基于项目整体代码质量评估与架构分析，旨在提升系统的安全性、扩展性及工程化水平。

## 1. 安全性加固 (Security Hardening) - P0

*目标：消除潜在的安全隐患，确保生产环境下的数据与操作安全。*

- [ ] **Tmux 注入前的“防误触”进程检查 (Process Safety Check)**
  - **现状**：目前仅检查 Tmux Session 是否存在。若 Claude Code 异常退出，Session 回到 Shell 提示符状态，注入的自然语言指令（如 "rm -rf *"）可能被 Shell 直接执行。
  - **优化方案**：在 `injectMessageViaTmux` 中，执行 `tmux list-panes` 检查目标 Pane 的当前前台进程（Foreground Process）。仅当进程名为 `claude` 或 `node` 时才允许注入；否则记录告警并暂停注入。

## 2. 架构与性能优化 (Architecture & Performance) - P1

*目标：提升系统的响应速度、并发处理能力及代码健壮性。*

- [ ] **实现通用的长连接/流式事件接入 (Universal Stream/Socket Architecture)**
  - **现状**：当前架构主要依赖轮询（Polling），存在延迟高、易限流的问题；部分平台 Webhook 模式需要公网 IP，部署门槛高。
  - **通用性分析**：主流企业级 IM 平台均已支持无需公网 IP 的长连接模式，该方案具备高度通用性。
  - **具体方案**：
    1. **飞书 (Feishu)**: 接入官方 WebSocket 网关。
    2. **钉钉 (DingTalk)**: 接入 Stream 模式 (WebSocket)。
    3. **Slack**: 接入 Socket Mode。
    4. **Telegram**: 优化现有的 Long Polling (getUpdates) 机制，实现伪长连接。
    5. **WhatsApp**: 调研 `whatsapp-web.js` (基于 WebSocket 的模拟客户端) 作为官方 API 的替代方案，以支持本地部署。
  - **Polling 策略调整**：实现长连接后，**默认禁用/移除现有的 Polling 逻辑**。仅保留 Polling 作为可选的**灾备降级方案**（例如在 WebSocket 断连且重连失败时临时启用）。
  - **收益**：彻底摆脱对 HTTP Server 和内网穿透的依赖，实现毫秒级消息响应。

- [ ] **类型系统重构 (Type Safety Refactoring)**
  - **现状**：核心逻辑（如 `Router`、`MCPServer`）中存在较多 `any` 类型，削弱了 TypeScript 的静态检查优势。
  - **优化方案**：
    1. 定义严格的 `MCPMessage`、`ProviderConfig` 联合类型。
    2. 使用 Zod 或 TypeBox 进行运行时参数校验。
    3. 逐步替换代码中的 `any` 为具体类型。

## 3. 工程化与体验 (Engineering & Experience) - P2

*目标：提升开发效率、测试覆盖率及系统的自我恢复能力。*

- [ ] **引入单元测试体系 (Unit Testing)**
  - **现状**：目前仅依赖 E2E 测试，缺乏针对核心逻辑的快速单元测试。
  - **优化方案**：
    1. 引入 `Vitest` 测试框架。
    2. 为 `Router` (队列逻辑、TTL)、`ConfigManager` (配置加载)、`Tmux` 工具类编写单元测试。

- [ ] **网络请求重试机制 (Retry Mechanism)**
  - **现状**：Provider 在网络请求失败时缺乏自动重试，导致瞬时网络抖动可能中断服务。
  - **优化方案**：在 `Provider` 基类中封装统一的 HTTP 请求方法，集成 `axios-retry` 或手动实现指数退避（Exponential Backoff）策略。
