# 日志路径统一 TODO

## 需求描述

将 cc-power 服务的所有日志写入路径统一改到用户目录下的 `~/.cc-power/tmp/logs`，避免在项目根目录创建日志文件，保持项目目录整洁。

**目标日志目录结构：**
```
~/.cc-power/tmp/logs/
├── cc-power.log              # 主服务日志
└── messages/                 # 消息日志目录
    ├── project1.jsonl
    ├── project2.jsonl
    └── ...
```

---

## 当前状态分析

### 1. 主日志配置（已符合要求）
- **文件：** `config.yaml`、`config.example.yaml`
- **当前配置：** `file: "~/.cc-power/tmp/logs/cc-power.log"`
- **状态：** ✅ 已正确配置

### 2. 消息日志目录（需要修改）

**默认值：** `'./logs/messages'`

**使用位置：**
- `cli.ts:178` - 主服务启动时创建
- `cli.ts:720` - logs 命令创建
- `router.ts:48` - Router 构造函数默认值
- `index.ts:25` - main 函数默认值

**状态：** ❌ 需要修改为 `~/.cc-power/tmp/logs/messages`

---

## 改动点清单

### 1. MessageLogger 默认路径修改

**文件：** `cc-power-service/core/message-logger.ts`

- [ ] 修改构造函数默认参数
  ```typescript
  // 当前
  constructor(logDir: string = './logs/messages', maxEntriesPerProject: number = 1000)

  // 修改为
  constructor(logDir: string = path.join(homedir(), '.cc-power/tmp/logs/messages'), maxEntriesPerProject: number = 1000)
  ```

- [ ] 在文件顶部添加 `homedir` 导入
  ```typescript
  import { homedir } from 'os';
  ```

### 2. Router 中的 MessageLogger 创建

**文件：** `cc-power-service/core/router.ts`

- [ ] 修改 Router 构造函数中的 MessageLogger 默认值
  ```typescript
  // 当前
  this.messageLogger = messageLogger || new MessageLogger('./logs/messages');

  // 修改为
  this.messageLogger = messageLogger || new MessageLogger(path.join(homedir(), '.cc-power/tmp/logs/messages'));
  ```

- [ ] 确保导入了 `path` 和 `os` 模块（如果尚未导入）

### 3. CLI 主服务启动时的日志器创建

**文件：** `cc-power-service/cli.ts`

- [ ] 修改 start 命令中的 MessageLogger 创建（约第 178 行）
  ```typescript
  // 当前
  const messageLogger = new MessageLogger('./logs/messages');

  // 修改为
  const logDir = path.join(process.env.HOME || homedir(), '.cc-power/tmp/logs/messages');
  const messageLogger = new MessageLogger(logDir);
  ```

- [ ] 添加 `homedir` 导入（如果尚未导入）

### 4. CLI logs 命令中的日志器创建

**文件：** `cc-power-service/cli.ts`

- [ ] 修改 logs 命令中的 MessageLogger 创建（约第 720 行）
  ```typescript
  // 当前
  const messageLogger = new MessageLogger('./logs/messages');

  // 修改为
  const logDir = path.join(process.env.HOME || homedir(), '.cc-power/tmp/logs/messages');
  const messageLogger = new MessageLogger(logDir);
  ```

### 5. index.ts 中的日志器创建

**文件：** `cc-power-service/index.ts`

- [ ] 修改 main 函数中的 MessageLogger 创建（约第 25 行）
  ```typescript
  // 当前
  const messageLogger = new MessageLogger('./logs/messages');

  // 修改为
  const messageLogger = new MessageLogger(path.join(homedir(), '.cc-power/tmp/logs/messages'));
  ```

- [ ] 添加 `path` 和 `homedir` 导入

### 6. 卸载脚本中的日志目录清理

**文件：** `cc-power-service/cli.ts` (uninstall 命令)

- [ ] 添加清理 `~/.cc-power/tmp/logs` 目录的逻辑
  ```typescript
  // 在清理逻辑中添加
  const logsDir = path.join(process.env.HOME || '', '.cc-power', 'tmp', 'logs');
  try {
    await fs.rm(logsDir, { recursive: true, force: true });
    console.log(`Removed logs directory: ${logsDir}`);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not remove logs directory: ${error.message}`);
    }
  }
  ```

### 7. 测试文件处理（可选）

**文件：** 所有 `e2e-test/*.mjs` 文件

- [ ] 评估测试日志是否也需要统一
  - 测试日志可以保持使用 `./logs/`，因为它们是临时的测试文件
  - 如果需要统一，可以修改所有测试文件中的日志路径

**建议：** 保持测试日志使用 `./logs/`，因为：
1. 测试是临时的
2. 便于开发过程中快速查看
3. `.gitignore` 已配置忽略 `logs/` 目录

### 8. .gitignore 更新（可选）

- [ ] 确认 `.gitignore` 中已包含：
  ```
  *.log
  logs/
  .cc-power/
  ```
  - 已有 `*.log` 和 `logs/` 条目
  - 已有 `.cc-power/` 条目（需要确认）

### 9. 文档更新

**文件：** `cc-power-service/README.md`

- [ ] 更新快速开始部分的日志路径说明
  ```markdown
  # 日志配置
  logging:
    level: "info"
    file: "~/.cc-power/tmp/logs/cc-power.log"  # 主服务日志

  # 消息日志存储在 ~/.cc-power/tmp/logs/messages/
  ```

**文件：** `README.md`

- [ ] 更新架构说明中的日志路径

### 10. 迁移现有日志（可选）

- [ ] 考虑是否提供迁移脚本，将旧的 `./logs/` 日志移动到 `~/.cc-power/tmp/logs/`

---

## 实施计划建议

1. **先修改核心类** (`message-logger.ts`) - 设置正确的默认路径
2. **更新所有创建点** - 修改所有创建 MessageLogger 实例的地方
3. **更新卸载逻辑** - 确保卸载时清理新路径
4. **更新文档** - 保持文档与代码同步
5. **验证测试** - 运行测试确保功能正常
6. **（可选）清理旧日志** - 提供清理旧日志目录的方法

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 现有日志丢失 | 低 | 用户可手动备份后迁移 |
| 路径权限问题 | 中 | `~/.cc-power` 目录已有使用，权限应正常 |
| 代码遗漏修改位置 | 中 | 仔细搜索所有 MessageLogger 使用位置 |
| 测试失败 | 低 | 测试日志路径可保持不变 |

---

## 备注

- 主日志配置已正确使用 `~/.cc-power/tmp/logs/cc-power.log`
- `Logger` 类已支持 `~` 路径展开，无需修改
- 测试日志可保持使用 `./logs/`，便于开发和调试
- 建议在修改前备份现有日志（如有重要内容）
- 修改后需要完整测试日志写入、读取、清理等功能