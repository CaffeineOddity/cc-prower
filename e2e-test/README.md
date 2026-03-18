# CC-Power E2E Tests

End-to-end tests for CC-Power MCP server.

## 测试文件

| 文件 | 描述 | 超时时间 |
|------|------|----------|
| test-runner.mjs | MCP 服务器启动测试 | 10s |
| test-core.mjs | 核心功能测试 (8项) | 30s |
| test-auto-discovery.mjs | 自动发现测试 (2项) | 30s |
| test-send-message.mjs | 消息发送测试 | 30s |
| test-heartbeat-timeout-fast.mjs | 心跳超时测试 | 90s |
| test-feishu-multi-project.mjs | 飞书多项目 Bot 测试 (3项) | 30s |

## 运行测试

### 运行所有 E2E 测试

```bash
node run-e2e-tests.mjs
```

### 运行单个测试

```bash
npx tsx e2e-test/test-runner.mjs
npx tsx e2e-test/test-core.mjs
npx tsx e2e-test/test-auto-discovery.mjs
npx tsx e2e-test/test-send-message.mjs
npx tsx e2e-test/test-heartbeat-timeout-fast.mjs
npx tsx e2e-test/test-feishu-multi-project.mjs
```

## 测试覆盖

### test-runner.mjs
- MCP 服务器启动 (TC-001)

### test-core.mjs
- 项目注册 (TC-002)
- 获取状态 (TC-004)
- 列出聊天 (TC-005)
- 发送心跳 (TC-006)
- 获取心跳状态 (TC-008)
- 获取入站消息 (TC-009)
- 取消注册 (TC-012)

### test-auto-discovery.mjs
- 自动发现项目 (TC-010)
- 自动注销 (TC-011)

### test-send-message.mjs
- 发送消息路由 (TC-003)

### test-heartbeat-timeout-fast.mjs
- 心跳超时清理 (TC-007)

### test-feishu-multi-project.mjs
- 飞书多项目 Bot 测试 (TC-FS-001/002/003)
  - 场景1: 相同 app_id，不同 chat_id
  - 场景2: 不同 app_id，相同 chat_id，优先级
  - 场景3: 关键词过滤

## 注意事项

- 测试需要在项目根目录运行
- 需要有效的 Feishu API 凭证信息
- 心跳超时测试需要约 90 秒
- 测试会创建临时日志文件在 `logs/` 目录

## 清理

测试完成后可以删除临时日志：

```bash
rm -rf logs/cc-power-test.log logs/cc-power-heartbeat-test.log logs/cc-power-auto-discovery-test.log
```