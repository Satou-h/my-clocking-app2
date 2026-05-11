import { useState } from 'react';
import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import {
  calcWorkMinutes, calcOvertimeMinutes, calcLateNightMinutes,
  isLateArrival, isEarlyDeparture, formatMinutes,
} from '../utils/storage';
import { printMonthlyAttendance } from '../utils/pdf';
import { getHolidayName } from '../utils/holidays';

interface Props {
  records: AttendanceRecord[];
  workSettings: WorkSettings;
  onEdit: (record: AttendanceRecord) => void;
  onDelete: (id: string) => void;
}

type DayRow =
  | { kind: 'record'; record: AttendanceRecord }
  | { kind: 'off'; date: string; label: string }
  | { kind: 'empty'; date: string };

export default function AttendanceList({ records, workSettings, onEdit, onDelete }: Props) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [filterYear, setFilterYear] = useState(currentYear);
  const [filterMonth, setFilterMonth] = useState(currentMonth);

  const prefix = `${filterYear}-${String(filterMonth).padStart(2, '0')}`;

  const filtered = records
    .filter((r) => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 月次集計（実際の登録レコードのみ）
  const summary = filtered.reduce(
    (acc, r) => {
      if (r.type !== 'work' || !r.clockIn || !r.clockOut) return acc;
      const work = calcWorkMinutes(r.clockIn, r.clockOut, r.breakMinutes ?? 0);
      const ot = calcOvertimeMinutes(work);
      const ln = calcLateNightMinutes(r.clockIn, r.clockOut);
      const late = isLateArrival(r.clockIn, workSettings.standardStartTime);
      const early = isEarlyDeparture(r.clockOut, workSettings.standardEndTime);
      return {
        workDays: acc.workDays + 1,
        workMins: acc.workMins + work,
        overtimeMins: acc.overtimeMins + ot,
        lateNightMins: acc.lateNightMins + ln,
        lateCount: acc.lateCount + (late ? 1 : 0),
        earlyCount: acc.earlyCount + (early ? 1 : 0),
      };
    },
    { workDays: 0, workMins: 0, overtimeMins: 0, lateNightMins: 0, lateCount: 0, earlyCount: 0 }
  );
  const paidDays = filtered.filter((r) => r.type === 'paid_leave').length;

  // 当月の全日を生成
  const daysInMonth = new Date(filterYear, filterMonth, 0).getDate();
  const recordByDate = new Map(filtered.map((r) => [r.date, r]));

  const dayRows: DayRow[] = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const dateStr = `${filterYear}-${String(filterMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const record = recordByDate.get(dateStr);
    if (record) return { kind: 'record', record };

    const dow = new Date(dateStr + 'T00:00:00').getDay();
    if (dow === 0 || dow === 6) return { kind: 'off', date: dateStr, label: '' };

    const holiday = getHolidayName(dateStr);
    if (holiday) return { kind: 'off', date: dateStr, label: holiday };

    return { kind: 'empty', date: dateStr };
  });

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  function formatDay(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDate();
    const dow = DOW[d.getDay()];
    const isSun = d.getDay() === 0;
    const isSat = d.getDay() === 6;
    return (
      <span className="day-cell">
        {day}日
        <span className={`dow-label ${isSun ? 'dow-sun' : isSat ? 'dow-sat' : ''}`}>
          ({dow})
        </span>
      </span>
    );
  }

  function confirmDelete(id: string, date: string) {
    if (window.confirm(`${date} の記録を削除しますか？`)) onDelete(id);
  }

  return (
    <div className="attendance-list">
      <h2>勤怠一覧</h2>

      <div className="list-filter">
        <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))}>
          {months.map((m) => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button
          className="btn btn-pdf"
          onClick={() => printMonthlyAttendance(records, workSettings, filterYear, filterMonth)}
          title={`${filterYear}年${filterMonth}月をPDF出力`}
        >
          PDF出力
        </button>
      </div>

      <div className="monthly-summary">
        <div className="summary-item">
          <span className="s-label">出勤</span>
          <span className="s-value">{summary.workDays}日</span>
        </div>
        <div className="summary-item">
          <span className="s-label">有給</span>
          <span className="s-value">{paidDays}日</span>
        </div>
        <div className="summary-item">
          <span className="s-label">総労働</span>
          <span className="s-value">{formatMinutes(summary.workMins)}</span>
        </div>
        <div className="summary-item overtime">
          <span className="s-label">残業</span>
          <span className="s-value">{formatMinutes(summary.overtimeMins)}</span>
        </div>
        <div className="summary-item latenight">
          <span className="s-label">深夜</span>
          <span className="s-value">{formatMinutes(summary.lateNightMins)}</span>
        </div>
        <div className="summary-item late">
          <span className="s-label">遅刻</span>
          <span className="s-value">{summary.lateCount}回</span>
        </div>
        <div className="summary-item early">
          <span className="s-label">早退</span>
          <span className="s-value">{summary.earlyCount}回</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>日付</th>
              <th>種別</th>
              <th>出勤</th>
              <th>退勤</th>
              <th>休憩</th>
              <th>労働時間</th>
              <th>残業</th>
              <th>深夜</th>
              <th>状態</th>
              <th>備考</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {dayRows.map((row) => {
              if (row.kind === 'off') {
                return (
                  <tr key={row.date} className="row-off">
                    <td>{formatDay(row.date)}</td>
                    <td><span className="badge badge-holiday">休日</span></td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td></td>
                    <td className="note-holiday">{row.label}</td>
                    <td></td>
                  </tr>
                );
              }

              if (row.kind === 'empty') {
                return (
                  <tr key={row.date} className="row-empty">
                    <td>{formatDay(row.date)}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                );
              }

              const r = row.record;
              const hasTime = r.type === 'work' && r.clockIn && r.clockOut;
              const workMin = hasTime
                ? calcWorkMinutes(r.clockIn!, r.clockOut!, r.breakMinutes ?? 0)
                : null;
              const otMin = workMin !== null ? calcOvertimeMinutes(workMin) : null;
              const lnMin = hasTime ? calcLateNightMinutes(r.clockIn!, r.clockOut!) : null;
              const late = hasTime ? isLateArrival(r.clockIn!, workSettings.standardStartTime) : false;
              const early = hasTime ? isEarlyDeparture(r.clockOut!, workSettings.standardEndTime) : false;

              return (
                <tr key={r.id} className={`row-${r.type}`}>
                  <td>{formatDay(r.date)}</td>
                  <td>
                    <span className={`badge badge-${r.type}`}>
                      {ATTENDANCE_TYPE_LABELS[r.type]}
                    </span>
                  </td>
                  <td>{r.clockIn ?? '-'}</td>
                  <td>{r.clockOut ?? '-'}</td>
                  <td>{r.type === 'work' ? (r.breakMinutes ?? 0) : '-'}</td>
                  <td>{workMin !== null ? formatMinutes(workMin) : '-'}</td>
                  <td className={otMin && otMin > 0 ? 'text-overtime' : ''}>
                    {otMin !== null ? (otMin > 0 ? formatMinutes(otMin) : '-') : '-'}
                  </td>
                  <td className={lnMin && lnMin > 0 ? 'text-latenight' : ''}>
                    {lnMin !== null ? (lnMin > 0 ? formatMinutes(lnMin) : '-') : '-'}
                  </td>
                  <td>
                    <div className="status-badges">
                      {late && <span className="badge badge-late">遅刻</span>}
                      {early && <span className="badge badge-early">早退</span>}
                    </div>
                  </td>
                  <td>{r.notes ?? ''}</td>
                  <td className="actions">
                    <button className="btn-icon btn-edit" onClick={() => onEdit(r)}>編集</button>
                    <button className="btn-icon btn-delete" onClick={() => confirmDelete(r.id, r.date)}>削除</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
