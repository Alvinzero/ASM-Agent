# ASM Agent

ASM Agent 是一个 Windows-first local desktop app，用于从自然语言需求生成公司芯片 ASM 工程。用户描述 ASM 工程目标后，应用基于内置固定 HK64S8x spec library 生成计划、工程树和 ASM 项目文件。

## MVP

当前 MVP 覆盖：

- built-in HK64S8x spec library
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

## Auto Update via GitHub Releases

桌面版已经接入 Electron 自动更新链路，目标发布形态是 `NSIS` 安装版，而不是 `win-unpacked` 解压版。

实施步骤：

1. 把仓库放到 GitHub。
2. 每次发布前修改 `package.json` 里的 `version`。
3. 推送形如 `v0.0.3` 的 tag：

```bash
git tag v0.0.3
git push origin main
git push origin v0.0.3
```

4. GitHub Actions 会在 Windows runner 上执行 `.github/workflows/release.yml`，自动生成：
   - Windows 安装包 `.exe`
   - `latest.yml`
   - 对应 release 附件

运行要求：

- Actions 里会自动注入：
  - `GH_TOKEN`
  - `GH_RELEASE_OWNER`
  - `GH_RELEASE_REPO`
- Electron 客户端启动后会自动检查更新，也可以在“设置 -> 关于”里手动点击“检查更新”。
- 下载完成后，设置页会显示“重启安装更新”。

注意：

- 自动更新只在安装版 Electron 应用中可用；开发模式和 `win-unpacked` 目录不会走正式更新链路。
- GitHub Release 需要是可见发布，不能一直保持 draft。
