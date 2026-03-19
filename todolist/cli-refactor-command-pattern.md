# CLI 命令模式重构 TODO

## 需求描述

将 cc-power-service/cli.ts 中的所有命令改造为命令模式，将每个命令拆分到独立文件中，提高代码的可维护性和可测试性。

**当前问题：**
- cli.ts 文件过大（超过 1000 行）
- 所有命令逻辑混在一起
- 难以测试单个命令
- 添加新命令需要修改主文件

**目标架构：**
```
cc-power-service/
├── cli.ts                    # 主入口，仅负责命令注册
├── commands/                 # 命令目录
│   ├── index.ts             # 命令导出
│   ├── base.command.ts      # 命令基类
│   ├── start.command.ts     # start 命令
│   ├── init.command.ts      # init 命令
│   ├── validate.command.ts  # validate 命令
│   ├── run.command.ts       # run 命令
│   ├── logs.command.ts      # logs 命令
│   ├── status.command.ts    # status 命令
│   ├── setup-hooks.command.ts # setup-hooks 命令
│   └── uninstall.command.ts # uninstall 命令
```

---

## 改动点清单

### 1. 创建命令基类

**文件：** `cc-power-service/commands/base.command.ts`

```typescript
import { Command } from 'commander';

/**
 * 命令基类
 * 所有 CLI 命令都继承此类
 */
export abstract class BaseCommand {
  protected program: Command;

  constructor(program: Command) {
    this.program = program;
  }

  /**
   * 注册命令到 commander
   */
  abstract register(): void;

  /**
   * 执行命令
   */
  abstract execute(...args: any[]): Promise<void> | void;

  /**
   * 获取命令名称
   */
  abstract getName(): string;

  /**
   * 获取命令描述
   */
  abstract getDescription(): string;
}
```

### 2. 重构 Start 命令

**文件：** `cc-power-service/commands/start.command.ts`

- [ ] 创建 StartCommand 类继承 BaseCommand
- [ ] 将 startService 函数迁移到类方法
- [ ] 实现 register 和 execute 方法
- [ ] 处理配置加载、服务启动、信号处理

### 3. 重构 Init 命令

**文件：** `cc-power-service/commands/init.command.ts`

- [ ] 创建 InitCommand 类继承 BaseCommand
- [ ] 将 initProject 函数迁移到类方法
- [ ] 实现 register 和 execute 方法
- [ ] 处理模板读取、配置创建

### 4. 重构 Validate 命令

**文件：** `cc-power-service/commands/validate.command.ts`

- [ ] 创建 ValidateCommand 类继承 BaseCommand
- [ ] 将 validateConfig 函数迁移到类方法
- [ ] 实现 register 和 execute 方法

### 5. 重构 Run 命令

**文件：** `cc-power-service/commands/run.command.ts`

- [ ] 创建 RunCommand 类继承 BaseCommand
- [ ] 将 runProject 和相关函数迁移到类方法
- [ ] 实现 register 和 execute 方法
- [ ] 处理 tmux 会话管理、信号文件处理

### 6. 重构 Logs 命令

**文件：** `cc-power-service/commands/logs.command.ts`

- [ ] 创建 LogsCommand 类继承 BaseCommand
- [ ] 将 showLogs 函数迁移到类方法
- [ ] 实现 register 和 execute 方法
- [ ] 处理日志显示、监视模式

### 7. 重构 Status 命令

**文件：** `cc-power-service/commands/status.command.ts`

- [ ] 创建 StatusCommand 类继承 BaseCommand
- [ ] 将 showStatus 函数迁移到类方法
- [ ] 实现 register 和 execute 方法

### 8. 重构 Setup-Hooks 命令

**文件：** `cc-power-service/commands/setup-hooks.command.ts`

- [ ] 创建 SetupHooksCommand 类继承 BaseCommand
- [ ] 将 setupHooks 函数迁移到类方法
- [ ] 实现 register 和 execute 方法

### 9. 重构 Uninstall 命令

**文件：** `cc-power-service/commands/uninstall.command.ts`

- [ ] 创建 UninstallCommand 类继承 BaseCommand
- [ ] 将 uninstallCCPower 函数迁移到类方法
- [ ] 实现 register 和 execute 方法

### 10. 创建命令导出文件

**文件：** `cc-power-service/commands/index.ts`

```typescript
export { BaseCommand } from './base.command.js';
export { StartCommand } from './start.command.js';
export { InitCommand } from './init.command.js';
export { ValidateCommand } from './validate.command.js';
export { RunCommand } from './run.command.js';
export { LogsCommand } from './logs.command.js';
export { StatusCommand } from './status.command.js';
export { SetupHooksCommand } from './setup-hooks.command.js';
export { UninstallCommand } from './uninstall.command.js';
```

### 11. 重构 cli.ts 主入口

**文件：** `cc-power-service/cli.ts`

- [ ] 导入所有命令类
- [ ] 创建 commander 程序实例
- [ ] 实例化所有命令并调用 register()
- [ ] 删除所有命令函数实现
- [ ] 保留必要的常量和导入

---

## 实施计划建议

1. **创建命令基类** - 定义统一的命令接口
2. **实现简单命令** - init, validate, status（依赖少）
3. **实现复杂命令** - start, run（依赖多）
4. **实现功能命令** - logs, setup-hooks, uninstall
5. **重构主入口** - 简化 cli.ts，仅保留注册逻辑
6. **测试验证** - 确保所有命令功能正常
7. **清理代码** - 删除冗余代码和注释

---

## 设计考虑

### 依赖注入

考虑在命令构造函数中注入依赖，便于测试：

```typescript
export class InitCommand extends BaseCommand {
  constructor(
    program: Command,
    private fs: typeof import('fs/promises') = fs,
    private path: typeof import('path') = path
  ) {
    super(program);
  }
}
```

### 共享工具函数

将跨命令使用的工具函数提取到单独文件：

```
cc-power-service/
├── utils/
│   ├── config.ts        # 配置工具
│   ├── tmux.ts          # tmux 工具
│   ├── signals.ts       # 信号处理
│   └── logger.ts        # 日志工具
```

### 错误处理

统一错误处理机制，在基类中提供错误处理方法。

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 重构过程中功能遗漏 | 中 | 逐个命令迁移，充分测试 |
| 依赖关系复杂 | 高 | 分析依赖，先迁移依赖少的命令 |
| 测试覆盖不足 | 中 | 为每个命令编写单元测试 |

---

## 备注

- 保持命令接口不变，用户使用方式不受影响
- 重构过程中注意保留所有功能
- 代码风格保持一致
- 添加适当的注释和文档