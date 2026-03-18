# 飞书多项目 Bot 优化方案

## 核心目标

支持两种场景的灵活配置：
1. **相同 app_id，不同 chat_id** - 多项目共享机器人，各占不同群
2. **不同 app_id，相同 chat_id** - 同一群多个机器人，按优先级/关键词分流

---

## 配置模版

```yaml
# 项目A：高优先级，处理所有消息
feishu:
  app_id: "cli_aaa"
  app_secret: "secret_aaa"
  chat_id: "oc_123"
  priority: 10

# 项目B：低优先级，处理未被匹配的消息
feishu:
  app_id: "cli_bbb"
  app_secret: "secret_bbb"
  chat_id: "oc_123"
  priority: 5

# 项目C：共享连接，不同群
feishu:
  app_id: "cli_aaa"
  app_secret: "secret_aaa"
  chat_id: "oc_456"
  priority: 10

# 项目D：关键词过滤
feishu:
  app_id: "cli_ccc"
  app_secret: "secret_ccc"
  chat_id: "oc_123"
  keyword: "/test"
```

---

## 表现效果

### 场景1：相同 app_id，不同 chat_id

| 项目 | app_id | chat_id | 行为 |
|------|--------|---------|------|
| A | cli_aaa | oc_123 | WebSocket复用，只收到群123的消息 |
| C | cli_aaa | oc_456 | WebSocket复用，只收到群456的消息 |

### 场景2：不同 app_id，相同 chat_id

| 用户消息 | 谁触发 |
|----------|--------|
| `普通消息` | 项目A（priority=10，无关键词限制） |
| `/test xxx` | 项目D（keyword=/test匹配） |
| `/deploy xxx` | 项目A（D不匹配） |

### 冲突处理规则

1. **按 chat_id 查找所有监听该群的 Provider**
2. **按 priority 降序排序**
3. **遍历，第一个匹配的 Provider 触发**
   - 如果配置了 `keyword`，消息必须包含该关键词
   - 如果没有配置 `keyword`，则匹配所有消息
4. **只触发一个，后面的跳过**

---

## 实现任务 (Todo)

### Phase 1: 类型定义

- [x] 更新 `types/index.ts`，`FeishuConfig` 新增字段：
  - `chat_id?: string` - 单个群ID
  - `priority?: number` - 优先级，默认0
  - `keyword?: string` - 关键词匹配

### Phase 2: 连接管理器

- [x] 创建 `cc-power/core/connection-manager.ts`
  - 单例类 `FeishuConnectionManager`
  - `app_id -> WSClient` 映射
  - `chat_id -> FeishuProvider[]` 路由表
  - `getOrConnect(app_id, app_secret)` 方法
  - `register(provider, config)` - 注册Provider
  - `unregister(provider, chat_id)` - 解绑Provider

### Phase 3: 路由逻辑

- [x] 改造 `FeishuProvider.connect()`
  - 调用 `FeishuConnectionManager.getOrConnect()` 获取WSClient
  - 调用 `FeishuConnectionManager.register()` 注册到路由表

- [x] WebSocket消息回调改造
  - 收到消息 → 解析 `chat_id`
  - 调用 `FeishuConnectionManager.routeMessage(chat_id, message)`
  - 路由器按 priority 降序排序 Providers
  - 检查 keyword 匹配，触发第一个匹配的

### Phase 4: 清理逻辑

- [x] 实现 `FeishuProvider.disconnect()`
  - 从路由表移除
  - 检查该 `app_id` 是否还有其他Provider使用
  - 无则关闭WebSocket连接

### Phase 5: 测试

- [x] 场景1测试：相同appid，不同群
- [x] 场景2测试：不同appid，同一群，优先级
- [x] 场景3测试：关键词过滤

---

**状态：✅ 全部完成**

---

## .cc-power.yaml 配置字段变化

### 旧配置

```yaml
providers:
  feishu:
    app_id: "cli_xxxx"
    app_secret: "xxxx"
    # 无其他字段
```

### 新配置

```yaml
providers:
  feishu:
    app_id: "cli_xxxx"
    app_secret: "xxxx"
    chat_id: "oc_123"      # 新增：监听的群ID（单个）
    priority: 10           # 新增：优先级，数字越大优先级越高，默认0
    keyword: "/test"       # 新增：关键词过滤，只有消息包含此关键词才触发（可选）
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `app_id` | string | 是 | 飞书应用ID |
| `app_secret` | string | 是 | 飞书应用密钥 |
| `chat_id` | string | 是 | 监听的飞书群ID |
| `priority` | number | 否 | 优先级，数字越大优先级越高，默认0 |
| `keyword` | string | 否 | 关键词过滤，消息包含此关键词才触发 |

### 配置示例

#### 示例1：简单监听
```yaml
providers:
  feishu:
    app_id: "cli_xxxx"
    app_secret: "xxxx"
    chat_id: "oc_123"
```

#### 示例2：优先级配置（多机器人同一群）
```yaml
# 项目A：主要机器人
providers:
  feishu:
    app_id: "cli_aaa"
    app_secret: "secret_aaa"
    chat_id: "oc_123"
    priority: 10
```

```yaml
# 项目B：备用机器人
providers:
  feishu:
    app_id: "cli_bbb"
    app_secret: "secret_bbb"
    chat_id: "oc_123"
    priority: 5
```

#### 示例3：关键词分流
```yaml
# 项目A：测试命令
providers:
  feishu:
    app_id: "cli_aaa"
    app_secret: "secret_aaa"
    chat_id: "oc_123"
    priority: 10
    keyword: "/test"
```

```yaml
# 项目B：部署命令
providers:
  feishu:
    app_id: "cli_bbb"
    app_secret: "secret_bbb"
    chat_id: "oc_123"
    priority: 10
    keyword: "/deploy"
```

#### 示例4：共享连接
```yaml
# 项目A：群1
providers:
  feishu:
    app_id: "cli_aaa"
    app_secret: "secret_aaa"
    chat_id: "oc_123"
```

```yaml
# 项目B：群2（共享同一个app_id）
providers:
  feishu:
    app_id: "cli_aaa"
    app_secret: "secret_aaa"
    chat_id: "oc_456"
```

### 向后兼容

旧配置（只有 `app_id` 和 `app_secret`）仍然有效，但不会监听任何群。建议添加 `chat_id` 字段。

---

## 配置简化说明

| 原方案 | 新方案 | 原因 |
|--------|--------|------|
| `allowed_chat_ids: string[]` | `chat_id: string` | 一个项目通常只监听一个群 |
| `keyword_regex: string` | `keyword: string` | 简单包含匹配即可 |
| `broadcast_mode: boolean` | 优先级机制 | 用priority控制更直观 |