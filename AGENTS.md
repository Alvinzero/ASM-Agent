# Project Instructions

- 默认使用中文回复，除非用户明确要求其他语言。
- ASM 相关工作必须把 `src/shared/spec/hk64s8x.v0.1.json` 当作公司指令和寄存器事实源。
- 生成、分析、修改 ASM 时必须把用户需求和 JSON 派生的 `SPEC_DRIVEN_ASM_CONTEXT` 一起交给模型，不能用对话记忆或人工摘要替代规范载荷。
- ASM 中寄存器数字地址、`JMP`/`CALL` 数字地址必须使用 ASMC 的 `H` 后缀，例如 `38H`、`46H`、`20H`；禁止用 `MOV 38,A`、`CALL 46`、`JMP 20` 或 `0x38` 这类裸数字/0x 地址作为成品。
- 禁止在成品 ASM 中使用 JSON 规范未列出的 `ORG`、`END`、`EQU`、`DB`、`DS`、`DW`、`SECTION`、`INCLUDE` 等伪指令；不要把规范语法里的 `R` 当成真实寄存器，也不要发明 `R0/R1/R2` 等寄存器。需要临时计数器时使用 RAM 数字地址并写成 `H` 后缀形式，例如 `80H`。
- PA 彩灯、LED 或闪烁类需求必须用明确灯态掩码写 `PA_PIO(38H)`，例如 `#01H -> #02H -> #04H -> #00H` 或 `#07H -> #00H`，并在每个可见灯态后调用延时；禁止用 `#01H OR 计数器`、计数器直接写端口或其它会让某个 PA 位常亮的计算掩码。
- 软件延时计数器必须使用会回写 RAM 的 `DECSZR/INCSZR`；禁止用 `DECSZ/INCSZ` 做 RAM 延时循环，因为它们只把结果写到 `A`，会导致程序卡在某个灯态。
- 软件延时必须按用户给出的主频估算；16MHz 下三层 `DECSZR` 延时 `#0AH/#FFH/#FFH` 约为 500ms 量级，`#7AH/#FFH/#FFH` 会远超 500ms，不能用于 500ms 闪烁需求。
- 主 ASM 工程生成链路必须让外部模型直接返回可交付的 `main.asm` 代码块；本地只抽取并质检，不得用 `createPlan`、`generateValidatedAsm`、模板生成器或一键规范化把模型输出替换成另一份 ASM。
- 最终展示或写入文件前必须通过 `parseAsm + validateAsm`，或对文件运行 `npm run asm:validate -- <file.asm>`；质检失败时拒绝输出，不保存为成品 ASM。
- 如果改动影响 ASM 生成、解析、验证、编码或文件输出，必须补充能证明 JSON 规范被加载、模型直出被保留、非法模型 ASM 不会被本地重写且质检被执行的测试。

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan.
<!-- SPECKIT END -->
