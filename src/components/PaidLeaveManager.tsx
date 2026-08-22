import { useState } from 'react';
import type { AttendanceRecord, PaidLeaveSettings } from '../types/attendance';

interface Props {
  records: AttendanceRecord[];
  settings: PaidLeaveSettings[];
  onSaveSettings: (settings: PaidLeaveSettings[]) => void;
}

function calcUsed(records: AttendanceRecord[], year: number): number {
  return records
    .filter((r) => r.date.startsWith(String(year)))
    .reduce((acc, r) => {
      if (r.type === 'paid_leave' || r.type === 'planned_paid_leave') return acc + 1;
      if (r.type === 'am_leave' || r.type === 'pm_leave') return acc + 0.5;
      return acc;
    }, 0);
}

export default function PaidLeaveManager({ records, settings, onSaveSettings }: Props) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [input, setInput] = useState('');

  const currentSetting = settings.find((s) => s.year === selectedYear);
  // totalDays は「残日数の初期設定値」として使用
  const initialRemaining = currentSetting?.totalDays ?? 0;
  const usedDays = calcUsed(records, selectedYear);
  const currentRemaining = initialRemaining - usedDays;

  function handleSave() {
    const val = parseFloat(input);
    if (isNaN(val) || val < 0) return;
    const updated = settings.filter((s) => s.year !== selectedYear);
    onSaveSettings([...updated, { year: selectedYear, totalDays: val }]);
    setInput('');
  }

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div className="paid-leave-manager">
      <h2>有給休暇管理</h2>

      <div className="form-row">
        <label>対象年度</label>
        <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
      </div>

      <div className="paid-leave-stats">
        <div className="stat-card">
          <span className="stat-label">残日数（設定値）</span>
          <span className="stat-value">{initialRemaining} 日</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">使用日数</span>
          <span className="stat-value used">{usedDays} 日</span>
        </div>
        <div className={`stat-card ${currentRemaining <= 5 ? 'warning' : ''}`}>
          <span className="stat-label">現在残日数</span>
          <span className="stat-value remaining">{currentRemaining} 日</span>
        </div>
      </div>

      <div className="paid-leave-set">
        <h3>残日数の設定</h3>
        <p className="hint">有給休暇の残日数を直接入力してください。使用日数は勤怠記録から自動集計されます。</p>
        <div className="form-row">
          <label>{selectedYear}年 残日数</label>
          <input
            type="number"
            min={0}
            max={40}
            step={0.5}
            placeholder={String(initialRemaining)}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handleSave}>設定</button>
        </div>
      </div>

      {settings.length > 0 && (
        <div className="paid-leave-history">
          <h3>年度別履歴</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>年度</th>
                <th>残日数（設定値）</th>
                <th>使用日数</th>
                <th>現在残日数</th>
              </tr>
            </thead>
            <tbody>
              {settings
                .sort((a, b) => b.year - a.year)
                .map((s) => {
                  const used = calcUsed(records, s.year);
                  const remaining = s.totalDays - used;
                  return (
                    <tr key={s.year}>
                      <td>{s.year}年</td>
                      <td>{s.totalDays}</td>
                      <td>{used}</td>
                      <td className={remaining <= 5 ? 'text-warning' : ''}>{remaining}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
