# Claude Code Hooks 信号文件格式调整 TODO

## 需求描述

调整 Claude Code hooks 的脚本名和信号文件格式，使其适配新的字段结构。

**新脚本名称：** `stop-hook.sh`（原 `on-response.sh`）

**新信号文件格式：**
```json
{
  "session_id": "4121246d-e581-4989-a5bc-a611fa989e86",
  "transcript_path": "/Users/yy.inc/.claude/projects/-Users-yy-inc-Downloads-cc-connect-cc-prower-projects-fly-pig/4121246d-e581-4989-a5bc-a611fa989e86.jsonl",
  "cwd": "/Users/yy.inc/Downloads/cc-connect/cc-prower/projects/fly-pig",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": false,
  "last_assistant_message": "33",
  "provider": "feishu",
  "project_id": "hack-a-mole"
}
```

**旧信号文件格式：**
```json
{
  "type": "send_message",
  "provider": "feishu",
  "projectId": "hack-a-mole",
  "chatId": "oc_xxx",
  "content": "...",
  "timestamp": 1234567890
}
```

---

## 改动点清单

### 1. setup-hooks 命令脚本名调整

**文件：** `cc-power-service/cli.ts`

- [ ] 修改 setup-hooks 命令中的脚本路径（约第 915 行）
  ```typescript
  // 当前
  const hookTemplatePath = path.join(__dirname, 'claude-code-hooks', 'on-response.sh');
  const hookDestPath = path.join(hooksDir, 'on-response.sh');

  // 修改为
  const hookTemplatePath = path.join(__dirname, 'claude-code-hooks', 'stop-hook.sh');
  const hookDestPath = path.join(hooksDir, 'stop-hook.sh');
  ```

- [ ] 更新日志输出信息（约第 922 行）
  ```typescript
  // 当前
  console.log(`✓ Created hook script: ${hookDestPath}`);

  // 修改为（可选，保持动态即可）
  ```

### 2. settings.json 模板文件更新

**文件：** `cc-power-service/claude-code-hooks/settings.json`

- [ ] 修改 hook 脚本命令（当前已正确）
  ```json
  {
    "hooks": {
      "Stop": [
        {
          "matcher": "",
          "hooks": [
            {
              "type": "command",
              "command": "bash .claude/hooks/stop-hook.sh"
            }
          ]
        }
      ]
    }
  }
  ```
  - 状态：✅ 已使用 `stop-hook.sh`

### 3. processHookSignal 函数信号格式调整

**文件：** `cc-power-service/cli.ts`

**当前逻辑（第 976-989 行）：**
```typescript
const signal = JSON.parse(fileContent);
logger.info(`Received hook signal: ${JSON.stringify(signal)}`);
if (signal.type === 'send_message') {
  const { provider, projectId, chatId, content } = signal;

  const providerInstance = router.getProvider(projectId);
  if (!providerInstance) {
    logger.error(`Provider not found for project: ${projectId}`);
    return;
  }

  await providerInstance.sendMessage(chatId, content);
  logger.info(`Hook message sent to ${provider}:${chatId}`);
}
```

**需要修改为：**
- [ ] 从新格式中提取字段
  - 使用 `provider` 字段（直接从 signal 获取）
  - 使用 `project_id` 字段（注意下划线格式）
  - `chatId` 需要从项目历史中获取（没有直接提供）
  - `content` 需要从 `transcript_path` 或 `last_assistant_message` 中获取

**新实现建议：**
```typescript
const signal = JSON.parse(fileContent);
logger.info(`Received hook signal: ${JSON.stringify(signal)}`);

// 从新格式提取必要信息
const { provider, project_id: projectId, transcript_path: transcriptPath, last_assistant_message: lastAssistantMessage } = signal;

// 如果 signal 中已有完整的发送消息格式，直接使用
if (signal.type === 'send_message' && signal.chatId && signal.content) {
  const providerInstance = router.getProvider(projectId || signal.projectId);
  if (!providerInstance) {
    logger.error(`Provider not found for project: ${projectId || signal.projectId}`);
    return;
  }

  await providerInstance.sendMessage(signal.chatId, signal.content);
  logger.info(`Hook message sent to ${provider || signal.provider}:${signal.chatId}`);
} else {
  // 新格式：需要从历史和 transcript 获取信息
  const providerInstance = router.getProvider(projectId);
  if (!providerInstance) {
    logger.error(`Provider not found for project: ${projectId}`);
    return;
  }

  // 从项目历史获取 chat_id
  const historyPath = path.join(process.env.HOME || '', '.cc-power', 'cache', 'project_history.json');
  let chatId: string | null = null;

  try {
    const historyContent = await fs.readFile(historyPath, 'utf-8');
    const history = JSON.parse(historyContent);
    chatId = history[projectId]?.config?.chat_id || history[projectId]?.config?.feishu?.chat_id;
  } catch (error) {
    logger.error(`Failed to read history for project ${projectId}:`, error);
  }

  if (!chatId) {
    logger.error(`No chat_id found for project: ${projectId}`);
    return;
  }

  // 获取响应内容（从 transcript 或 last_assistant_message）
  let content = lastAssistantMessage;
  if (transcriptPath) {
    try {
      const transcriptLines = await fs.readFile(transcriptPath, 'utf-8');
      // 解析 jsonl 获取最后一条助手消息
      const lines = transcriptLines.trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const entry = JSON.parse(lines[i]);
        if (entry.role === 'assistant') {
          content = entry.content;
          break;
        }
      }
    } catch (error) {
      logger.warn(`Failed to read transcript, using last_assistant_message:`, error);
    }
  }

  if (!content) {
    logger.warn(`No content found for hook signal`);
    return;
  }

  await providerInstance.sendMessage(chatId, content);
  logger.info(`Hook message sent to ${provider}:${chatId}`);
}
```

### 4. 新格式兼容性处理

**可选功能：**

- [ ] 支持新旧两种信号格式
  - 检测 `signal.type === 'send_message'` 使用旧格式
  - 否则使用新格式（从历史和 transcript 获取）

- [ ] 添加格式版本检测
  ```typescript
  // 在 signal 对象中添加 version 字段
  // 或根据字段结构自动判断
  const isNewFormat = signal.hook_event_name !== undefined;
  ```

### 5. 错误处理增强

- [ ] 添加更详细的错误日志
- [ ] 处理 transcript 文件不存在的情况
- [ ] 处理历史文件中找不到 chat_id 的情况

### 6. 测试验证

- [ ] 创建测试用例验证新格式处理
- [ ] 验证从 transcript 获取内容的逻辑
- [ ] 验证从历史获取 chat_id 的逻辑
- [ ] 测试向后兼容性（旧格式是否仍可工作）

### 7. 文档更新

- [ ] 更新 hooks 使用说明
- [ ] 说明新的信号文件格式
- [ ] 更新迁移指南（如果需要）

---

## 实施计划建议

1. **先修改 setup-hooks 命令** - 使用新脚本名
2. **更新 processHookSignal** - 支持新信号格式
3. **添加向后兼容** - 确保旧格式仍可工作（可选）
4. **测试验证** - 完整测试新的消息流程
5. **更新文档** - 反映新的信号格式

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 旧格式信号文件失效 | 中 | 添加向后兼容处理 |
| transcript 文件读取失败 | 中 | 使用 last_assistant_message 作为备选 |
| chat_id 获取失败 | 高 | 确保项目历史正确保存 |
| 内容解析错误 | 低 | 添加详细的错误日志和降级处理 |

---

## 备注

- 新信号文件包含更多上下文信息（session_id, transcript_path 等）
- `last_assistant_message` 字段可能只包含消息 ID，实际内容需要从 transcript 获取
- chat_id 不再直接提供，需要从项目历史中获取
- `provider` 和 `project_id` 使用 snake_case 格式（project_id）
- `hook_event_name` 可用于区分不同的事件类型（当前只有 "Stop"）