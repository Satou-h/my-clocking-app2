import type { PaidLeaveSettings, AttendanceRecord, WorkSettings } from '../types/attendance';
import { calcPaidLeaveRemaining, formatMinutes } from '../utils/storage';
import { calcMonthlySummary } from '../utils/summary';
import type { SubmitItem } from '../utils/submitStatus';

interface Props {
  year: number;
  month: number;
  records: AttendanceRecord[];
  workSettings: WorkSettings;
  paidLeaveSettings: PaidLeaveSettings[];
  submitItems: SubmitItem[];
  onOpenBulk: () => void;
}

// 勤怠入力画面の横に出す「今月の状況」と「月末の提出まで」
export default function MonthStatus({ year, month, records, workSettings, paidLeaveSettings, submitItems, onOpenBulk }: Props) {
  const summary = calcMonthlySummary(records, workSettings, year, month);
  const plRemaining = calcPaidLeaveRemaining(records, paidLeaveSettings, year, month);

  return (
    <aside className="month-status">
      <section className="status-card">
        <h2>{month}月の状況</h2>
        <div className="status-grid">
          <div className="status-item">
            <span className="status-label">出勤日数</span>
            <span className="status-value">{summary.workDays}日</span>
          </div>
          <div className="status-item">
            <span className="status-label">総労働</span>
            <span className="status-value">{formatMinutes(summary.workMins)}</span>
          </div>
          <div className="status-item">
            <span className="status-label">残業</span>
            <span className={`status-value ${summary.overtimeMins > 0 ? 'is-overtime' : ''}`}>{formatMinutes(summary.overtimeMins)}</span>
          </div>
          <div className="status-item">
            <span className="status-label">有給残</span>
            <span className="status-value">{plRemaining !== null ? `${plRemaining}日` : '未設定'}</span>
          </div>
        </div>
      </section>

      <section className="status-card">
        <h2>月末の提出まで</h2>
        {submitItems.map((item) => (
          <div key={item.label} className={`submit-row ${item.done ? '' : 'is-pending'}`}>
            <span className="submit-dot" />
            {item.label}
            <span className="submit-state">{item.detail}</span>
          </div>
        ))}
        <button type="button" className="btn-link status-link" onClick={onOpenBulk}>
          一括ダウンロードへ →
        </button>
      </section>
    </aside>
  );
}
