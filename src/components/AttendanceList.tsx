import { useState } from 'react';
import type { AttendanceRecord, WorkSettings, PaidLeaveSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS, WORK_LOCATION_LABELS } from '../types/attendance';
import {
  calcWorkMinutes, calcOvertimeMinutes, calcLateNightMinutes,
  isLateArrival, isEarlyDeparture, formatMinutes, loadUserProfile, getEffectiveBreak,
  calcPaidLeaveMonthStatus, findPaidLeaveSetting, getWorkLocation,
} from '../utils/storage';
import { calcMonthlySummary, isWorkType } from '../utils/summary';
import { printMonthlyAttendancePDF } from '../utils/attendancePdf';
import { getHolidayName } from '../utils/holidays';
import { checkMonthCompleteness, formatCompletenessIssue } from '../utils/completeness';
import { loadName, saveName } from '../utils/workReport';

interface Props {
  records: AttendanceRecord[];
  workSettings: WorkSettings;
  paidLeaveSettings: PaidLeaveSettings[];
  filterYear: number;
  filterMonth: number;
  onFilterChange: (year: number, month: number) => void;
  onEdit: (record: AttendanceRecord) => void;
  onDelete: (id: string) => void;
  onSavePaidLeave: (settings: PaidLeaveSettings[]) => void;
}

type DayRow =
  | { kind: 'record'; record: AttendanceRecord }
  | { kind: 'off'; date: string; label: string }
  | { kind: 'empty'; date: string };

export default function AttendanceList({ records, workSettings, paidLeaveSettings, filterYear, filterMonth, onFilterChange, onEdit, onDelete, onSavePaidLeave }: Props) {
  const currentYear = new Date().getFullYear();
  const [plInput, setPlInput] = useState('');
  const [name, setName] = useState(loadName);

  // 氏名は作業報告書・交通費と共通で保存する
  function handleNameChange(value: string) {
    setName(value);
    saveName(value);
  }

  const prefix = `${filterYear}-${String(filterMonth).padStart(2, '0')}`;

  const filtered = records
    .filter((r) => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  const summary = calcMonthlySummary(records, workSettings, filterYear, filterMonth);
  const paidDays = summary.paidDays;

  // 1日分の表示用の値（表とスマホ用カードで共通）
  function rowValues(r: AttendanceRecord) {
    const hasTime = isWorkType(r.type) && r.clockIn && r.clockOut;
    const effBreak = hasTime ? getEffectiveBreak(r.type, r.clockIn!, r.clockOut!, r.breakMinutes ?? 0) : 0;
    const workMin = hasTime ? calcWorkMinutes(r.clockIn!, r.clockOut!, effBreak) : null;
    const otMin = workMin !== null
      ? r.type === 'scheduled_holiday_work' ? workMin
        : r.type === 'legal_holiday_work' ? null
        : calcOvertimeMinutes(workMin)
      : null;
    const legalHolidayMin = r.type === 'legal_holiday_work' && workMin !== null ? workMin : null;
    const lnMin = hasTime ? calcLateNightMinutes(r.clockIn!, r.clockOut!) : null;
    const refStart = r.customStartTime ?? workSettings.standardStartTime;
    const refEnd = r.customEndTime ?? workSettings.standardEndTime;
    const isHalf = r.type === 'am_leave' || r.type === 'pm_leave';
    const late = hasTime && !isHalf ? isLateArrival(r.clockIn!, refStart) : false;
    const early = hasTime && !isHalf ? isEarlyDeparture(r.clockOut!, refEnd, r.clockIn) : false;
    const location = getWorkLocation(r);
    return { effBreak, workMin, otMin, legalHolidayMin, lnMin, late, early, location };
  }

  // 有給残日数（月度ごと。翌月へは繰り越さない）
  const plStatus = calcPaidLeaveMonthStatus(records, paidLeaveSettings, filterYear, filterMonth);
  const plRemaining = plStatus?.remaining ?? null;
  const plMonthSetting = findPaidLeaveSetting(paidLeaveSettings, filterYear, filterMonth);

  // 当月の設定を除いた一覧（旧形式の年度設定は1月分として扱う）
  const otherPaidLeaveSettings = paidLeaveSettings.filter((s) => s !== plMonthSetting);

  function handleSavePaidLeave() {
    const val = parseFloat(plInput);
    if (isNaN(val) || val < 0) return;
    onSavePaidLeave([...otherPaidLeaveSettings, { year: filterYear, month: filterMonth, totalDays: val }]);
    setPlInput('');
  }

  function handleClearPaidLeave() {
    onSavePaidLeave(otherPaidLeaveSettings);
    setPlInput('');
  }

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
        <select value={filterYear} onChange={(e) => onFilterChange(Number(e.target.value), filterMonth)}>
          {years.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={filterMonth} onChange={(e) => onFilterChange(filterYear, Number(e.target.value))}>
          {months.map((m) => <option key={m} value={m}>{m}月</option>)}
        </select>
        <input
          className="list-filter-name"
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="氏名"
          aria-label="氏名"
        />
        <button
          className="btn btn-pdf"
          onClick={() => {
            const p = loadUserProfile();
            if (!p.employeeId || !p.lastName) { alert('「設定」で社員番号と苗字を入力してください。'); return; }
            if (!name.trim()) { alert('氏名を入力してください。'); return; }
            const completeness = checkMonthCompleteness(filterYear, filterMonth, records, [], [], [], workSettings);
            if (!completeness.attendance.complete) {
              alert(formatCompletenessIssue('勤務表', completeness.attendance));
              return;
            }
            printMonthlyAttendancePDF(records, workSettings, filterYear, filterMonth, plRemaining, p.employeeId, p.lastName, name)
              .catch((err: Error) => alert('PDF生成エラー: ' + err.message));
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

      <div className="paid-leave-inline-set">
        <span className="paid-leave-inline-label">{filterYear}年{filterMonth}月 月初の有給残日数</span>
        <input
          type="number"
          min={0}
          max={40}
          step={0.5}
          className="paid-leave-inline-input"
          value={plInput}
          onChange={(e) => setPlInput(e.target.value)}
          placeholder={plStatus ? String(plStatus.start) : '未設定'}
          onKeyDown={(e) => e.key === 'Enter' && handleSavePaidLeave()}
        />
        <span className="paid-leave-inline-unit">日</span>
        <button className="btn btn-primary btn-sm" onClick={handleSavePaidLeave}>設定</button>
        {plMonthSetting && (
          <button className="btn btn-secondary btn-sm" onClick={handleClearPaidLeave}
            title="当月の設定を削除します">
            解除
          </button>
        )}
        <span className="paid-leave-inline-note">
          {!plStatus ? '月初の残日数を設定してください（月ごとに設定が必要です）'
            : `設定値: ${plStatus.start}日 − 当月使用 ${plStatus.used}日 = ${plStatus.remaining}日`}
        </span>
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
              const { effBreak: rowEffBreak, workMin, otMin, legalHolidayMin, lnMin, late, early, location } = rowValues(r);

              return (
                <tr key={r.id} className={`row-${r.type}`}>
                  <td>{formatDay(r.date)}</td>
                  <td>
                    <span className={`badge badge-${r.type}`}>
                      {ATTENDANCE_TYPE_LABELS[r.type]}
                    </span>
                    {r.type === 'transfer_holiday_work' && (
                      <span className="transfer-date-note">振替: {r.transferDate ? formatDay(r.transferDate) : '未設定'}</span>
                    )}
                    {location !== 'site' && <span className="badge badge-kisha">{WORK_LOCATION_LABELS[location]}</span>}
                    {r.noTransport && <span className="badge badge-no-transport" title="交通費なし（在宅勤務・徒歩圏内など）">交通費なし</span>}
                  </td>
                  <td>{r.clockIn ?? '-'}</td>
                  <td>{r.clockOut ?? '-'}</td>
                  <td>{isWorkType(r.type) ? rowEffBreak : '-'}</td>
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

      {/* スマホ用: 1日1行のカード表示（表は横スクロールが必要になるため） */}
      <ul className="day-cards">
        {dayRows.map((row) => {
          if (row.kind !== 'record') {
            const d = new Date(row.date + 'T00:00:00');
            return (
              <li key={row.date} className={`day-card ${row.kind === 'off' ? 'is-off' : 'is-empty'}`}>
                <DayHead date={d} />
                <div className="day-card-body">
                  {row.kind === 'off'
                    ? <><span className="badge badge-holiday">休日</span> <span className="day-card-note">{row.label}</span></>
                    : <span className="day-card-note">未入力</span>}
                </div>
              </li>
            );
          }
          const r = row.record;
          const v = rowValues(r);
          return (
            <li key={r.id} className={`day-card row-${r.type}`}>
              <DayHead date={new Date(r.date + 'T00:00:00')} />
              <button type="button" className="day-card-body day-card-button" onClick={() => onEdit(r)} aria-label={`${r.date} を編集`}>
                <span className="day-card-tags">
                  <span className={`badge badge-${r.type}`}>{ATTENDANCE_TYPE_LABELS[r.type]}</span>
                  {v.location !== 'site' && <span className="badge badge-kisha">{WORK_LOCATION_LABELS[v.location]}</span>}
                  {v.late && <span className="badge badge-late">遅刻</span>}
                  {v.early && <span className="badge badge-early">早退</span>}
                  {r.noTransport && <span className="badge badge-no-transport">交通費なし</span>}
                </span>
                <span className="day-card-time">
                  {r.clockIn && r.clockOut ? `${r.clockIn} 〜 ${r.clockOut}` : ''}
                  {r.notes && <span className="day-card-note"> {r.notes}</span>}
                </span>
              </button>
              <div className="day-card-side">
                <span className="day-card-work">{v.workMin !== null ? formatMinutes(v.workMin) : ''}</span>
                {!!v.otMin && <span className="day-card-ot">残業 {formatMinutes(v.otMin)}</span>}
                <button type="button" className="btn-icon btn-delete" onClick={() => confirmDelete(r.id, r.date)}>削除</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function DayHead({ date }: { date: Date }) {
  const dow = date.getDay();
  return (
    <div className="day-card-date">
      <span className="day-card-day">{date.getDate()}</span>
      <span className={`dow-label ${dow === 0 ? 'dow-sun' : dow === 6 ? 'dow-sat' : ''}`}>{DOW_LABELS[dow]}</span>
    </div>
  );
}
