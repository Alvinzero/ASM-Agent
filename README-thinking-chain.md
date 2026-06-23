# 思维链工作流集成指南

## 📋 概述

这套方案让你的 AI 智能体像 Claude Code 一样实时展示思维过程和工作流，包含：

1. **流式思维输出** - 实时显示 AI 的思考过程
2. **工具执行追踪** - 可视化每个工具调用的状态
3. **用户友好界面** - 折叠式步骤列表，避免信息过载

---

## 🚀 快速开始

### 1. 查看演示效果

直接在浏览器中打开 `thinking-chain-demo.html`：

```bash
# Windows
start thinking-chain-demo.html

# macOS
open thinking-chain-demo.html

# Linux
xdg-open thinking-chain-demo.html
```

这个演示展示了完整的 UI 效果，包括：
- 实时打字效果的思维过程
- 工具执行步骤的动态展示
- 折叠/展开功能

---

## 🏗️ 集成到你的项目

### 方案 A: 纯前端演示版（已完成）

适用场景：快速原型、UI 测试、向团队展示

文件：`thinking-chain-demo.html`
- ✅ 无需后端
- ✅ 直接运行
- ✅ 模拟完整流程

### 方案 B: 完整 Electron 集成（推荐）

适用场景：实际生产环境

#### 步骤 1: 安装依赖

```bash
npm install @anthropic-ai/sdk
```

#### 步骤 2: 集成核心代码

参考 `thinking-chain-integration.ts`，包含 4 个模块：

```
1. ThinkingChainAgent        - Agent 执行引擎
2. setupAgentIPC              - Electron IPC 桥接
3. ThinkingChainWorkspace     - React UI 组件
4. Electron Preload           - 安全通信层
```

#### 步骤 3: 在主进程中启用

```typescript
// main.ts
import { setupAgentIPC } from './thinking-chain-integration';

app.whenReady().then(() => {
  const mainWindow = createWindow();
  setupAgentIPC(mainWindow); // 注册 IPC 处理器
});
```

#### 步骤 4: 在渲染进程中使用

```tsx
// App.tsx
import { ThinkingChainWorkspace } from './thinking-chain-integration';
import './thinking-chain-styles.css';

export default function App() {
  return (
    <div className="app">
      <ThinkingChainWorkspace />
    </div>
  );
}
```

---

## 🔧 核心技术原理

### 1. 流式响应 (Streaming)

```typescript
const stream = await anthropic.messages.stream({
  model: 'claude-3-5-sonnet-20241022',
  stream: true,  // 关键！启用流式输出
  thinking: {
    type: 'enabled',      // 启用思维模式
    budget_tokens: 5000   // 分配给思考的 token
  },
  // ...
});

// 实时处理每个数据块
for await (const event of stream) {
  if (event.type === 'content_block_delta') {
    // 立即推送到 UI
    emitToUI('thinking:delta', event.delta.text);
  }
}
```

### 2. 事件驱动架构

```
用户输入
    ↓
ThinkingChainAgent (执行任务)
    ↓ (emit events)
IPC Main Process (转发事件)
    ↓ (webContents.send)
React Component (更新 UI)
```

事件类型：
- `thinking:delta` - 思考内容增量更新
- `tool:start` - 工具开始执行
- `tool:complete` - 工具执行完成
- `task:complete` - 任务完成

### 3. UI 状态管理

```tsx
const [thinkingText, setThinkingText] = useState('');  // 累积文本
const [steps, setSteps] = useState<ToolStep[]>([]);    // 步骤列表

useEffect(() => {
  window.electronAPI.onAgentEvent((event) => {
    if (event.type === 'thinking:delta') {
      // 增量追加，不是替换
      setThinkingText(prev => prev + event.data.text);
    }
  });
}, []);
```

---

## 📊 事件流示例

真实执行流程：

```
1. [task:start]
   → UI 显示 "正在处理任务..."

2. [thinking:delta] "我需要先搜索代码..."
   → UI 实时显示思考文本 (打字效果)

3. [tool:start] { tool: 'grep', args: { pattern: 'model-picker' } }
   → UI 添加新步骤，状态 "运行中"

4. [tool:complete] { result: '找到 3 个匹配项' }
   → UI 更新步骤状态为 "完成"，显示结果

5. [thinking:delta] "找到了！现在修改文件..."
   → UI 继续追加思考文本

6. [tool:start] { tool: 'edit_file', ... }
   → UI 添加新步骤

... 循环直到任务完成

7. [task:complete]
   → UI 移除加载状态，显示最终结果
```

---

## 🎨 UI 定制

### 修改颜色主题

编辑 `thinking-chain-styles.css` 中的 CSS 变量：

```css
:root {
  --color-accent: #3b82f6;      /* 主色调 */
  --color-success: #10b981;     /* 成功状态 */
  --color-warning: #f59e0b;     /* 执行中状态 */
  --color-bg-thinking: #fef3c7; /* 思考区背景 */
}
```

### 调整动画速度

```css
/* 打字光标闪烁速度 */
@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
/* 改为 2s 让闪烁更慢 */

/* 步骤出现动画 */
@keyframes stepAppear {
  from { opacity: 0; transform: translateX(-10px); }
  to { opacity: 1; transform: translateX(0); }
}
/* 调整 duration 为 0.5s 让动画更慢 */
```

### 修改思考区打字速度

在 `thinking-chain-demo.html` 中：

```javascript
const typeText = () => {
  if (charIndex < step.content.length) {
    setThinkingText(step.content.slice(0, charIndex + 1));
    charIndex++;
    timeoutRef.current = setTimeout(typeText, 30); // 改为 50 更慢
  }
};
```

---

## 🔌 扩展工具

### 添加新工具

在 `ThinkingChainAgent` 中：

```typescript
// 1. 在 tools 数组中定义
{
  name: 'run_test',
  description: '运行测试用例',
  input_schema: {
    type: 'object',
    properties: {
      test_file: { type: 'string' }
    },
    required: ['test_file']
  }
}

// 2. 在 executeTool 中实现
case 'run_test':
  result = await this.runTest(args.test_file);
  break;

// 3. 添加实际执行方法
private async runTest(testFile: string): Promise<string> {
  const { execSync } = require('child_process');
  const result = execSync(`npm test ${testFile}`, { encoding: 'utf-8' });
  return result;
}

// 4. 在 formatToolDescription 中添加显示文案
case 'run_test':
  return `运行测试: ${args.test_file}`;
```

---

## ⚡ 性能优化

### 1. 限制步骤列表长度

```tsx
const MAX_STEPS = 20;

setSteps(prev => {
  const newSteps = [...prev, newStep];
  // 只保留最近 20 个步骤
  return newSteps.slice(-MAX_STEPS);
});
```

### 2. 节流思维文本更新

```tsx
import { debounce } from 'lodash';

const updateThinkingText = debounce((text: string) => {
  setThinkingText(text);
}, 50); // 每 50ms 最多更新一次
```

### 3. 虚拟滚动（大量步骤时）

```bash
npm install react-window
```

```tsx
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={400}
  itemCount={steps.length}
  itemSize={80}
>
  {({ index, style }) => (
    <div style={style}>
      <StepItem step={steps[index]} />
    </div>
  )}
</FixedSizeList>
```

---

## 🐛 常见问题

### Q1: 思考文本不显示？

检查 Anthropic API 调用是否启用了 `thinking` 参数：

```typescript
thinking: {
  type: 'enabled',
  budget_tokens: 5000
}
```

### Q2: 事件没有到达 UI？

确认 Preload 脚本已正确配置：

```typescript
// main.ts
const mainWindow = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'), // 确保路径正确
    contextIsolation: true,
    nodeIntegration: false
  }
});
```

### Q3: 工具执行没有结果？

检查 `executeTool` 方法是否正确返回字符串：

```typescript
private async executeTool(toolName: string, args: any): Promise<string> {
  try {
    const result = await this.bash(args.command);
    return result; // 必须返回字符串
  } catch (error) {
    return `Error: ${error.message}`; // 错误也要返回字符串
  }
}
```

### Q4: 界面卡顿？

- 减少 DOM 更新频率（使用 debounce）
- 限制步骤列表长度
- 使用虚拟滚动

---

## 📦 文件清单

```
thinking-chain-demo.html          - 纯前端演示版（可直接运行）
thinking-chain-integration.ts     - 完整集成代码（4 个模块）
thinking-chain-styles.css         - UI 样式表
README.md                         - 本文档
```

---

## 🎯 下一步

1. **立即体验**：打开 `thinking-chain-demo.html` 查看效果
2. **集成到项目**：按照上面的步骤集成到你的 Electron 应用
3. **定制化**：修改颜色、动画、文案适配你的产品风格
4. **添加工具**：根据你的需求扩展更多工具类型

---

## 💡 最佳实践

### 1. 思考文本的粒度

```typescript
// ❌ 不好 - 太碎片化
"我"
"需要"
"先"
"搜索"

// ✅ 好 - 按语义单元输出
"我需要先搜索代码..."
"找到了！现在分析结构..."
"明白了，问题在于..."
```

### 2. 工具描述的清晰度

```typescript
// ❌ 不好
"执行命令"

// ✅ 好
"运行测试: npm test ModelPicker.test.tsx"
```

### 3. 结果展示的简洁性

```typescript
// ❌ 不好
"Command executed successfully. Found 127 lines of code..."

// ✅ 好
"✓ 找到 3 个匹配项"
```

---

## 📞 技术支持

遇到问题？检查顺序：

1. 查看浏览器/Electron 控制台错误
2. 确认 Anthropic API Key 配置正确
3. 验证事件流是否正常（添加 console.log）
4. 参考本文档的「常见问题」部分

---

## 🎉 效果预览

运行演示后，你将看到：

```
🤖 正在分析并修复 model-picker 组件问题...

💭 思考中
我需要分析 model-picker 组件的问题。让我先搜索相关代码...|

📋 已运行 2 条命令 ▼

  ✓ Grep
    搜索 "model-picker" 相关代码
    → 找到 3 个匹配项

  ⏳ Read
    读取 src/renderer/styles/app.css
```

干净、清晰、实时！用户不再干等，而是看到 AI 的完整思考过程。

---

**祝你集成顺利！🚀**
