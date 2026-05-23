import { useState } from 'react';
import type { AttendanceRecord, WorkSettings, PaidLeaveSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import {
  calcWorkMinutes, calcOvertimeMinutes, calcLateNightMinutes,
  isLateArrival, isEarlyDeparture, formatMinutes, loadUserProfile,
} from '../utils/storage';
import { printMonthlyAttendance } from '../utils/pdf';
import { getHolidayName } from '../utils/holidays';

interface Props {
  records: AttendanceRecord[];
  workSettings: WorkSettings;
  paidLeaveSettings: PaidLeaveSettings[];
  onEdit: (record: AttendanceRecord) => void;
  onDelete: (id: string) => void;
}

type DayRow =
  | { kind: 'record'; record: AttendanceRecord }
  | { kind: 'off'; date: string; label: string }
  | { kind: 'empty'; date: string };

export default function AttendanceList({ records, workSettings, paidLeaveSettings, onEdit, onDelete }: Props) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [filterYear, setFilterYear] = useState(currentYear);
  const [filterMonth, setFilterMonth] = useState(currentMonth);

  const prefix = `${filterYear}-${String(filterMonth).padStart(2, '0')}`;

  const filtered = records
    .filter((r) => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  const isWorkType = (type: string) =>
    type === 'work' || type === 'am_leave' || type === 'pm_leave'
    || type === 'scheduled_holiday_work' || type === 'legal_holiday_work';

  // 月次集計（実際の登録レコードのみ）
  const summary = filtered.reduce(
    (acc, r) => {
      if (!isWorkType(r.type) || !r.clockIn || !r.clockOut) return acc;
      const work = calcWorkMinutes(r.clockIn, r.clockOut, r.breakMinutes ?? 0);
      const ln = calcLateNightMinutes(r.clockIn, r.clockOut);
      const refStart = r.customStartTime ?? workSettings.standardStartTime;
      const refEnd = r.customEndTime ?? workSettings.standardEndTime;
      const isHalf = r.type === 'am_leave' || r.type === 'pm_leave';
      const late = !isHalf && isLateArrival(r.clockIn, refStart);
      const early = !isHalf && isEarlyDeparture(r.clockOut, refEnd, r.clockIn);
      // 所定休日出勤は全時間を残業に加算、法定休日出勤は専用集計
      const ot = r.type === 'scheduled_holiday_work' ? work
        : r.type === 'legal_holiday_work' ? 0
        : calcOvertimeMinutes(work);
      const legalHoliday = r.type === 'legal_holiday_work' ? work : 0;
      return {
        workDays: acc.workDays + (r.type === 'work' ? 1 : 0),
        scheduledHolidayDays: acc.scheduledHolidayDays + (r.type === 'scheduled_holiday_work' ? 1 : 0),
        legalHolidayDays: acc.legalHolidayDays + (r.type === 'legal_holiday_work' ? 1 : 0),
        workMins: acc.workMins + work,
        overtimeMins: acc.overtimeMins + ot,
        legalHolidayMins: acc.legalHolidayMins + legalHoliday,
        lateNightMins: acc.lateNightMins + ln,
        lateCount: acc.lateCount + (late ? 1 : 0),
        earlyCount: acc.earlyCount + (early ? 1 : 0),
      };
    },
    { workDays: 0, scheduledHolidayDays: 0, legalHolidayDays: 0, workMins: 0, overtimeMins: 0, legalHolidayMins: 0, lateNightMins: 0, lateCount: 0, earlyCount: 0 }
  );
  const paidDays = filtered.reduce((acc, r) => {
    if (r.type === 'paid_leave') return acc + 1;
    if (r.type === 'am_leave' || r.type === 'pm_leave') return acc + 0.5;
    return acc;
  }, 0);

  // 有給残日数（年度累計ベース）
  const plSetting = paidLeaveSettings.find((s) => s.year === filterYear);
  const plInitial = plSetting?.totalDays ?? null;
  const plYearUsed = records
    .filter((r) => r.date.startsWith(String(filterYear)))
    .reduce((acc, r) => {
      if (r.type === 'paid_leave') return acc + 1;
      if (r.type === 'am_leave' || r.type === 'pm_leave') return acc + 0.5;
      return acc;
    }, 0);
  const plRemaining = plInitial !== null ? plInitial - plYearUsed : null;

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
          onClick={() => {
            const p = loadUserProfile();
            if (!p.employeeId || !p.lastName) { alert('画面上部に社員番号と苗字を入力してください。'); return; }
            printMonthlyAttendance(records, workSettings, filterYear, filterMonth, plRemaining, p.employeeId, p.lastName);
          }}
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
        <div className="summary-item scheduled-holiday">
          <span className="s-label">所定休日出勤</span>
          <span className="s-value">{summary.scheduledHolidayDays}日</span>
        </div>
        <div className="summary-item legal-holiday">
          <span className="s-label">法定休日出勤</span>
          <span className="s-value">{summary.legalHolidayDays}日</span>
        </div>
        <div className="summary-item">
          <span className="s-label">総労働</span>
          <span className="s-value">{formatMinutes(summary.workMins)}</span>
        </div>
        <div className="summary-item overtime">
          <span className="s-label">残業</span>
          <span className="s-value">{formatMinutes(summary.overtimeMins)}</span>
        </div>
        <div className="summary-item legal-holiday-time">
          <span className="s-label">法定休日</span>
          <span className="s-value">{formatMinutes(summary.legalHolidayMins)}</span>
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
        <div className="summary-break" />
        <div className="summary-item">
          <span className="s-label">有給</span>
          <span className="s-value">{paidDays}日</span>
        </div>
        <div className={`summary-item ${plRemaining !== null && plRemaining <= 5 ? 'paid-leave-low' : 'paid-leave-remaining'}`}>
          <span className="s-label">有給残日数</span>
          <span className="s-value">
            {plRemaining !== null ? `${plRemaining}日` : '未設定'}
          </span>
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
              <th>法定休日</th>
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
                    <td>-</td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                );
              }

              const r = row.record;
              const hasTime = isWorkType(r.type) && r.clockIn && r.clockOut;
              const workMin = hasTime
                ? calcWorkMinutes(r.clockIn!, r.clockOut!, r.breakMinutes ?? 0)
                : null;
              const otMin = workMin !== null
                ? r.type === 'scheduled_holiday_work' ? workMin
                  : r.type === 'legal_holiday_work' ? null
                  : calcOvertimeMinutes(workMin)
                : null;
              const legalHolidayMin = r.type === 'legal_holiday_work' && workMin !== null ? workMin : null;
              const lnMin = hasTime ? calcLateNightMinutes(r.clockIn!, r.clockOut!) : null;
              const rowRefStart = r.customStartTime ?? workSettings.standardStartTime;
              const rowRefEnd = r.customEndTime ?? workSettings.standardEndTime;
              const rowIsHalf = r.type === 'am_leave' || r.type === 'pm_leave';
              const late = hasTime && !rowIsHalf ? isLateArrival(r.clockIn!, rowRefStart) : false;
              const early = hasTime && !rowIsHalf ? isEarlyDeparture(r.clockOut!, rowRefEnd, r.clockIn) : false;

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
                  <td>{isWorkType(r.type) ? (r.breakMinutes ?? 0) : '-'}</td>
                  <td>{workMin !== null ? formatMinutes(workMin) : '-'}</td>
                  <td className={otMin && otMin > 0 ? 'text-overtime' : ''}>
                    {otMin !== null ? (otMin > 0 ? formatMinutes(otMin) : '-') : '-'}
                  </td>
                  <td className={legalHolidayMin !== null && legalHolidayMin > 0 ? 'text-legal-holiday' : ''}>
                    {legalHolidayMin !== null ? formatMinutes(legalHolidayMin) : '-'}
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
