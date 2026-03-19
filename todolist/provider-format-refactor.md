# Provider 配置格式重构 TODO

## 需求描述

将项目中所有 template 模板和项目 config.yaml 中的 provider 格式从分离式改为嵌套式：

**旧格式：**
```yaml
provider: feishu
feishu:
  app_id: "xxx"
  app_secret: "xxx"
```

**新格式：**
```yaml
provider:
  name: feishu
  app_id: "xxx"
  app_secret: "xxx"
```

---

## 改动点清单

### 1. 模板文件修改

| 文件 | 状态 | 说明 |
|------|------|------|
| `cc-power-service/providers/templates/feishu-template.yaml` | ✅ 已符合新格式 | 已使用 `provider: { name: feishu }` 格式 |
| `cc-power-service/providers/templates/telegram-template.yaml` | ❌ 需要修改 | 当前使用旧格式 |
| `cc-power-service/providers/templates/whatsapp-template.yaml` | ❌ 需要修改 | 当前使用旧格式 |

### 2. 项目配置文件修改

| 文件 | 状态 | 说明 |
|------|------|------|
| `projects/fly-pig/.cc-power.yaml` | ❌ 需要修改 | 当前使用旧格式 |
| `projects/hack-a-mole/.cc-power.yaml` | ❌ 需要修改 | 当前使用旧格式 |

### 3. 类型定义修改

**文件：** `cc-power-service/types/config.ts`

- [ ] 修改 `ProjectConfig` 接口的 `provider` 字段类型
  - 当前：`provider: ProviderType` (string)
  - 修改为：`provider: ProviderConfigBase` (object)

- [ ] 添加新的 `ProviderConfigBase` 接口
  ```typescript
  export interface ProviderConfigBase {
    name: ProviderType;
    [key: string]: any; // 其他 provider 特定配置
  }
  ```

- [ ] 更新 `ProviderConfig` 接口，确保与新的嵌套格式兼容

### 4. Router 逻辑修改

**文件：** `cc-power-service/core/router.ts`

- [ ] 修改 `registerProject` 方法中的配置提取逻辑
  - 当前：从 `config[providerType]` 提取 provider 特定配置
  - 修改为：直接使用 `config.provider` 对象

- [ ] 更新 `providerConfig` 的构建逻辑
  - 当前：合并 `config` 和 `config[providerType]`
  - 修改为：使用 `config.provider` 并添加 `projectId`



### 6. Provider 类修改

**文件：** `cc-power-service/providers/feishu.ts` (以及 telegram.ts, whatsapp.ts)

- [ ] 更新 `connect` 方法中配置参数的解构方式
  - 当前：`const { app_id: appId, app_secret: appSecret } = feishuConfig;`
  - 修改为：直接从 config 对象解构（确保兼容性）

### 7. 测试文件修改

| 文件 | 说明 |
|------|------|
| `cc-power-service/tests/config.test.ts` | 更新测试用例使用新格式 |
| `cc-power-service/tests/router.test.ts` | 更新项目注册测试用例 |

### 8. 文档更新

| 文件 | 说明 |
|------|------|
| `README.md` | 更新配置示例为新格式 |
| `cc-power-service/README.md` | 更新快速开始部分的配置示例 |
| `cc-power-service/config.example.yaml` | 更新为新的配置格式示例 |

### 9. 后向兼容性（可选）

- [ ] 考虑是否需要支持旧格式的自动迁移
  - 如果需要，在 ConfigManager 中添加格式检测和转换逻辑

---

## 实施计划建议

1. **先修改类型定义** (`types/config.ts`) - 建立新的数据结构
2. **更新 Router 逻辑** (`core/router.ts`) - 适配新的配置结构
3. **修改所有模板文件** - 确保新项目使用新格式
4. **更新现有项目配置** - 迁移 fly-pig 和 hack-a-mole
5. **修改 MCP Server** - 确保 MCP 协议层面支持新格式
6. **更新测试用例** - 确保所有测试通过
7. **更新文档** - 保持文档与代码同步
8. **验证端到端流程** - 确保从注册到消息收发的完整流程正常

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 现有项目配置失效 | 高 | 提供迁移脚本或文档 |
| 测试用例大量失败 | 低 | 优先修改测试用例 |

---

## 备注

- feishu-template.yaml 已符合新格式，无需修改
- 建议在修改前先备份现有配置文件
- 修改完成后需要完整测试注册、消息收发等核心功能