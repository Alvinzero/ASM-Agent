# ASM Agent 项目长期记忆

## 项目定位
ASM Agent = 公司内部 HK64S8x 芯片平台的本地 ASM 工程自动生成桌面工具。Windows-first，Electron+React19+TS+Vite7。MVP 不做编译/仿真/烧录，只交付 ASM 文件 + 静态规范校验。

## 技术栈关键点
- 双运行时: Electron IPC (`window.asmAgent`) + Vite dev-server `/api/*` 中间件（浏览器降级）。
- 规范源: `src/shared/spec/hk64s8x.v0.1.json`，由 `scripts/compileSpec.ts` 从 xlsx 编译，三列一致性自检。
- 认证: `node:sqlite` + scrypt，存 `userData/asm-agent.sqlite`（浏览器开发态存 `output/dev-data/`）。

## AGENTS.md 硬性约束（必须遵守）
- 寄存器/JMP/CALL 数字地址用 ASMC `H` 后缀（如 `38H`），禁裸数字/0x。
- 禁伪指令 ORG/END/EQU/DB/DS/DW/SECTION/INCLUDE 等（规范未列出的）。
- R 是操作数占位符非真实寄存器，禁 R0/R1/R2；临时计数器用 RAM 地址 `80H` 形式。
- PA 彩灯/LED/闪烁必须用明确灯态掩码写 PA_PIO(38H)（如 `#01H->#02H->#04H->#00H`），每灯态后调用延时；禁 `#01H OR 计数器` 这类常亮掩码。
- 软件延时用 DECSZR/INCSZR（回写 RAM），禁 DECSZ/INCSZ（只写 A 会卡死灯态）。
- 16MHz 下三层 DECSZR `#0AH/#FFH/#FFH`≈500ms，`#7AH/#FFH/#FFH` 远超 500ms。
- 主 ASM 工程让外部模型直出 main.asm，本地只抽取+质检，不重写；成品必须过 parseAsm+validateAsm。

## 核心模块路径
- 编排大脑: `src/renderer/state/useAgentSession.ts`（意图分类 + trace 时间线 + 双生成路径）。
- 规范载荷: `src/shared/spec/SpecPromptContext.ts` 的 `appendSpecPromptAttachment`。
- 模型直出质检: `src/shared/asm/ModelAsmCandidate.ts`（抽取代码块 + PA 行为 + 延时估算）。
- 本地模板生成: `src/shared/asm/SingleAsmFileGenerator.ts` / `ProjectGenerator.ts`。
- 质检闸: `AsmParser` → `AsmValidator` → `InstructionEncoder`（mask/value 复检）。

## 已知遗留
- `output/` 历史产物 chipId 不一致问题已于 2026-06-25 维护完成: 28 个 HK8S8100X → HK64S8x，1 个 H 后缀违规已修，38 个文件全部通过质检。
- `output/` 有 4 个 asm 无标准生成器 header（直接以代码/注释开头），属无 chipId 标注非不一致，均通过质检，未补 header。
- `bug-report.md`: AssistantChat/ProjectOutputPanel 多个按钮无 onClick；流式 API 无超时。
