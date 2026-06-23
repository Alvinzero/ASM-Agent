interface ChipPlatformPanelProps {
  chipId: string;
}

const lockedItems = ['指令集固定', '寄存器表固定', 'ASM 语法固定'];

export function ChipPlatformPanel({ chipId }: ChipPlatformPanelProps) {
  return (
    <aside className="panel platform-panel" aria-label="芯片平台">
      <div className="panel-kicker">目标平台</div>
      <h1>{chipId}</h1>
      <p className="panel-subtitle">公司内置规范库</p>

      <div className="status-card">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>规范源已锁定</strong>
          <span>面向固定 HK8S8100X 指令、寄存器和语法约束。</span>
        </div>
      </div>

      <ul className="lock-list" aria-label="规范锁定状态">
        {lockedItems.map((item) => (
          <li key={item}>
            <span className="lock-mark" aria-hidden="true">
              ✓
            </span>
            {item}
          </li>
        ))}
      </ul>
    </aside>
  );
}
