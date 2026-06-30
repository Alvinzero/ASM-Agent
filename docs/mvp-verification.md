# MVP 端到端验证

本文档定义 ASM Agent MVP 的端到端验证范围、验证映射、执行命令和预期结果。当前 MVP 是 Windows-first 本地桌面应用：用户用自然语言描述 ASM 工程需求，系统基于内置固定 HK64S8x 公司芯片规范生成计划和 ASM 工程。

## 验证范围

MVP 验证应覆盖以下能力：

- 应用可以加载内置 HK64S8x spec library，作为生成计划和 ASM 工程的固定规范来源。
- 用户可以输入自然语言 ASM 工程需求。
- 系统可以根据用户需求生成可读的 generation plan。
- 系统可以生成完整 ASM 工程树，包括工程目录、源文件和必要的项目文件。
- 静态验证可以拒绝 unsupported instructions。
- 静态验证可以拒绝 out-of-range operands。
- UI 展示以 ASM assistant 为中心的 Windows desktop experience，整体风格是 Marvis-inspired 的现代桌面 AI 助手，但不复制品牌素材。
- Windows installer packaging 可以生成 Windows 安装包。

## 不覆盖范围

本 MVP 验证不证明以下能力：

- compile ASM code
- simulate generated program behavior
- burn or flash firmware
- execute code on real hardware
- verify behavior on physical HK64S8x hardware

这些项目是明确的 MVP non-goals。即使下方命令全部退出 0，也只能说明当前应用的 TypeScript、测试、构建和 Windows 打包流程通过；不能把它解释为编译、仿真、烧录或真实硬件验证已经完成。

## 前提条件

在 Windows PowerShell 中执行验证前，需要满足：

- 已安装 Node.js 和 npm，并且 `npm` 在当前 `PATH` 中可用。
- 已在项目根目录执行过 `npm install`。
- 项目根目录存在 `node_modules`，项目依赖已安装完成。
- 可以在 Windows 环境中运行 `npm run package:win`。
- 如果 `electron-builder` 提示缺失签名、权限或构建依赖，应按 `electron-builder` 的实际输出处理后重新运行打包命令。

## 本次执行记录（2026-06-12）

本次使用本地缓存的 Node.js 工具链补齐验证环境：

- Node.js: `v24.14.0`
- npm: `11.9.0`
- 工具链路径: `C:\Users\Admin\.cache\asm-agent-toolchain\node-v24.14.0-win-x64`

本次已在项目根目录完成：

- `npm install`: 退出码 0，生成 `node_modules` 和 `package-lock.json`。
- `npm run lint`: 退出码 0，`tsc --noEmit` 无错误。
- `npm run test`: 退出码 0，9 个测试文件、81 个测试全部通过。
- `npm run build`: 退出码 0，主进程 TypeScript 构建和 renderer Vite 构建完成。
- `npm run package:win`: 退出码 0，`electron-builder.yml` 被加载，`release/ASM Agent Setup 0.1.0.exe` 已生成。
- Renderer 手动检查: `http://127.0.0.1:5173/` 可打开，页面包含 ASM assistant 主界面、`HK64S8x`、`ASM 功能需求`、`生成计划`、`生成工程`，没有“导入规范”入口。
- Electron 启动检查: Electron 桌面进程可启动，窗口标题为 `ASM Agent`。

备注：

- 首次 `npm install` 曾卡在 Electron postinstall 下载；改用 Electron 镜像后安装完成，并通过 `npm rebuild electron` 补齐本地 Electron 二进制。
- `npm install` 报告 4 个依赖审计项（2 high、2 critical）。本次未执行 `npm audit fix`，需单独评估依赖升级影响。

## 验证映射

| 验证范围项 | 自动化验证或手动检查 |
| --- | --- |
| 内置 HK64S8x spec library | 运行 `npm run test`，重点关注 `tests/shared/specRepository.test.ts` 或相关 spec repository 测试。 |
| 自然语言 ASM 需求接收和 generation plan | 运行 `npm run test`，重点关注 `tests/shared/agentService.test.ts`。 |
| ASM 工程树生成 | 运行 `npm run test`，重点关注 `tests/shared/projectGenerator.test.ts`。 |
| 拒绝 unsupported instructions | 运行 `npm run test`，重点关注 `tests/shared/asmValidator.test.ts` 和 `tests/shared/instructionEncoder.test.ts`。 |
| 拒绝 out-of-range operands | 运行 `npm run test`，重点关注 `tests/shared/asmValidator.test.ts` 和 `tests/shared/instructionEncoder.test.ts`。 |
| 桌面 UI 主流程 | 运行 `npm run test`，重点关注 `tests/renderer/assistantFlow.test.tsx`。同时运行 `npm run dev:electron` 做手动检查：确认左/中/右三栏存在；主体验以 ASM assistant 为中心；没有“导入规范”按钮；不出现 compile、simulate、burn 或 hardware verification 入口。 |
| Windows installer packaging | 运行 `npm run package:win` 后检查 `release/` 中是否生成 Windows installer。 |

## 验证命令

在项目根目录执行：

```powershell
npm run lint
npm run test
npm run build
npm run package:win
```

## 预期结果

- `npm run lint` 退出码为 0，TypeScript `tsc --noEmit` 无错误。
- `npm run test` 退出码为 0，Vitest 测试全部通过。
- `npm run build` 退出码为 0，TypeScript Node 配置构建和 Vite 构建完成。
- `npm run package:win` 退出码为 0，并在 `release/` 中生成 Windows installer。

## 验证记录模板

实际验证时建议记录：

```text
Date:
OS:
Node:
npm:

npm install:
npm run lint:
npm run test:
npm run build:
npm run package:win:

release/ installer:
Manual UI check:
Notes:
```
