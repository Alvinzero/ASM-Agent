# ASM Agent

ASM Agent 是一个 Windows-first local desktop app，用于从自然语言需求生成公司芯片 ASM 工程。用户描述 ASM 工程目标后，应用基于内置固定 HK8S8100X spec library 生成计划、工程树和 ASM 项目文件。

## MVP

当前 MVP 覆盖：

- built-in HK8S8100X spec library
- natural-language planning
- ASM project generation
- static instruction/register validation
- Marvis-inspired desktop assistant UI
- Windows installer packaging

## Non-Goals

MVP does not compile, simulate, burn, or verify code on hardware.

也就是说，当前版本不把 ASM 编译、程序仿真、固件烧录或真实硬件执行结果作为产品能力或验证结论。

## Development

在 Windows PowerShell 中执行：

```powershell
npm install
npm run test
npm run dev:electron
```

常用验证和打包命令：

```powershell
npm run lint
npm run test
npm run build
npm run package:win
```

`npm run package:win` 预期在 `release/` 中生成 Windows installer。完整 MVP 验证范围和当前环境限制见 [docs/mvp-verification.md](docs/mvp-verification.md)。
