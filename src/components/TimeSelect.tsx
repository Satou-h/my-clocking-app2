interface Props {
  /** HH:MM 形式 */
  value: string;
  onChange: (value: string) => void;
  /** 分の刻み（既定: 10分） */
  minuteStep?: number;
  className?: string;
  ariaLabel?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 時・分をドロップダウンで選ぶ時刻入力。
 * input type="time" の step は端末によって無視されるため、分の刻みを確実に揃えたい箇所で使う。
 */
export default function TimeSelect({ value, onChange, minuteStep = 10, className, ariaLabel }: Props) {
  const [h = 0, m = 0] = value.split(':').map(Number);
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);
  // 既存の設定値が刻みに合わない場合（例: 08:45）も値を失わないよう候補に含める
  if (!minutes.includes(m)) minutes.push(m);
  minutes.sort((a, b) => a - b);

  return (
    <span className="time-select" role="group" aria-label={ariaLabel}>
      <select
        className={className}
        value={h}
        onChange={(e) => onChange(`${pad(Number(e.target.value))}:${pad(m)}`)}
        aria-label={ariaLabel ? `${ariaLabel}（時）` : '時'}
      >
        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{pad(i)}</option>)}
      </select>
      <span className="time-select-colon">:</span>
      <select
        className={className}
        value={m}
        onChange={(e) => onChange(`${pad(h)}:${pad(Number(e.target.value))}`)}
        aria-label={ariaLabel ? `${ariaLabel}（分）` : '分'}
      >
        {minutes.map((i) => <option key={i} value={i}>{pad(i)}</option>)}
      </select>
    </span>
  );
}
