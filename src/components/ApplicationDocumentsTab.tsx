import { useState } from 'react';
import {
  generateId, todayStr, isLateArrival, isEarlyDeparture,
  loadLeaveApplications, upsertLeaveApplication, deleteLeaveApplication,
  loadLateEarlyApplications, upsertLateEarlyApplication, deleteLateEarlyApplication,
} from '../utils/storage';
import {
  LEAVE_TYPES, findLateEarly, lateEarlyKey, checkLeaveEntry, checkLateEarlyApplication,
  type LateEarlyOccurrence,
} from '../utils/completeness';
import { loadName, saveName } from '../utils/workReport';
import type { LeaveType, LeaveApplicationRecord, LateEarlyApplicationRecord } from '../types/application';
import { LEAVE_LABELS, calcLeaveDays } from '../types/application';
import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import Icon from './Icon';
import SubmittedNotice from './SubmittedNotice';
import { useCloudState } from '../utils/cloudSync';

interface Props {
  records: AttendanceRecord[];
  workSettings: WorkSettings;
}

type LateEarlyType = '遅刻' | '早退';
type LeaveEntry = { date: string; leaveType: LeaveType };

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function fmtDateJp(d: string): string {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth() + 1}月${dt.getDate()}日(${DOW_LABELS[dt.getDay()]})`;
}

function earliestDate(entries: { date: string }[]): string {
  return entries.reduce((min, e) => (!min || e.date < min ? e.date : min), '');
}

// 理由の候補。押すと「〜のため」の形で理由欄に入る。候補にない理由はそのまま入力する
const LEAVE_REASONS = ['私用', '通院', '体調不良', '家庭の事情'];
const LATE_EARLY_REASONS: Record<LateEarlyType, string[]> = {
  遅刻: ['電車遅延', '体調不良', '通院', '私用'],
  早退: ['体調不良', '通院', '私用', '家庭の事情'],
};
const reasonText = (option: string) => `${option}のため`;
// 候補から入れた理由（「のため」が付く前に保存した申請の理由も含む）
const ALL_REASONS = new Set(
  [...LEAVE_REASONS, ...LATE_EARLY_REASONS.遅刻, ...LATE_EARLY_REASONS.早退].flatMap((o) => [o, reasonText(o)]),
);

interface ReasonFieldProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
}

// 理由の入力欄と候補ボタン。手入力した理由を候補で置き換えるときは確認する
function ReasonField({ value, onChange, options, placeholder }: ReasonFieldProps) {
  function pick(option: string) {
    const next = reasonText(option);
    const current = value.trim();
    if (current && !ALL_REASONS.has(current) && !window.confirm(`入力中の理由を「${next}」に置き換えますか？`)) return;
    onChange(next);
  }

  return (
    <div className="reason-field">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
      />
      <div className="reason-presets">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={`reason-preset${value.trim() === reasonText(o) ? ' active' : ''}`}
            onClick={() => pick(o)}
          >{o}</button>
        ))}
      </div>
    </div>
  );
}

// 未保存の変更があるかを見るための比較用の文字列
function leaveContent(r: Pick<LeaveApplicationRecord, 'applicationDate' | 'dateEntries' | 'reason'>): string {
  return JSON.stringify([r.applicationDate, r.dateEntries.map((e) => [e.date, e.leaveType]), r.reason]);
}

function lateEarlyContent(r: Omit<LateEarlyApplicationRecord, 'id' | 'name'>): string {
  return JSON.stringify([r.applicationDate, r.type, r.targetDate, r.scheduledTime, r.actualTime, r.reason]);
}

function confirmDiscard(dirty: boolean): boolean {
  return !dirty || window.confirm('入力中の内容が保存されていません。破棄してよろしいですか？');
}

type DocType = 'leave' | 'late_early';

export default function ApplicationDocumentsTab({ records, workSettings }: Props) {
  const [docType, setDocType] = useState<DocType>('leave');
  // 勤務表・交通費・作業報告書と共通の氏名
  const [name, setName] = useState(loadName);
  // 上長・管理者が部下のデータを開いている間は、氏名（本人の社員情報）を変更できない
  const viewing = useCloudState().viewing;
  // 勤務表から追加する候補と、保存済みの一覧を表示する月
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);

  // 休暇申請
  const [leaveApplications, setLeaveApplications] = useState<LeaveApplicationRecord[]>(loadLeaveApplications);
  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);
  const [applicationDate, setApplicationDate] = useState(todayStr);
  const [dateEntries, setDateEntries] = useState<LeaveEntry[]>([]);
  const [addingDate, setAddingDate] = useState(todayStr);
  const [addingType, setAddingType] = useState<LeaveType>('paid_leave');
  const [reason, setReason] = useState('');

  // 遅早退申請
  const [lateEarlyApplications, setLateEarlyApplications] = useState<LateEarlyApplicationRecord[]>(loadLateEarlyApplications);
  const [editingLateEarlyId, setEditingLateEarlyId] = useState<string | null>(null);
  const [leAppDate, setLeAppDate] = useState(todayStr);
  const [lateEarlyType, setLateEarlyType] = useState<LateEarlyType>('遅刻');
  const [targetDate, setTargetDate] = useState(todayStr);
  const [scheduledTime, setScheduledTime] = useState('');
  const [actualTime, setActualTime] = useState('');
  const [leReason, setLeReason] = useState('');

  function updateName(value: string) {
    setName(value);
    saveName(value);
  }

  const currentYear = new Date().getFullYear();
  const years = [...new Set([...Array.from({ length: 5 }, (_, i) => currentYear - 2 + i), year])].sort((a, b) => a - b);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthRecords = records.filter((r) => r.date.startsWith(monthPrefix));
  const recordByDate = new Map(records.map((r) => [r.date, r]));

  // 保存した申請が一覧に見えるよう、その月を表示する
  function showMonthOf(date: string) {
    const [y, m] = date.split('-').map(Number);
    setYear(y);
    setMonth(m);
  }

  // ── 休暇申請 ──

  const leaveDays = calcLeaveDays(dateEntries);
  const editingLeave = leaveApplications.find((a) => a.id === editingLeaveId);
  const leaveDirty = editingLeave
    ? leaveContent(editingLeave) !== leaveContent({ applicationDate, dateEntries, reason })
    : dateEntries.length > 0 || reason.trim() !== '';

  // 申請済みの日（otherLeaveDates は編集中の申請を除く。編集中の申請は入力中の内容で数える）
  const appliedLeaveDates = new Set(leaveApplications.flatMap((a) => a.dateEntries.map((e) => e.date)));
  const otherLeaveDates = new Set(
    leaveApplications.filter((a) => a.id !== editingLeaveId).flatMap((a) => a.dateEntries.map((e) => e.date)),
  );
  // 対象月の勤務表で、有給・午前休・午後休・振替休日になっている日
  const monthLeaveRecords = monthRecords
    .filter((r) => LEAVE_TYPES.has(r.type))
    .sort((a, b) => a.date.localeCompare(b.date));
  const unappliedLeaveCount = monthLeaveRecords.filter((r) => !appliedLeaveDates.has(r.date)).length;
  // まだどの申請書にも入っていない日（勤務表から追加の候補）
  const leaveCandidates = monthLeaveRecords.filter(
    (r) => !otherLeaveDates.has(r.date) && !dateEntries.some((e) => e.date === r.date),
  );

  function addDate() {
    if (!addingDate) return;
    if (dateEntries.some((e) => e.date === addingDate)) return;
    if (otherLeaveDates.has(addingDate)) {
      alert(`${fmtDateJp(addingDate)}はすでに別の休暇申請書で申請済みです。`);
      return;
    }
    setDateEntries((prev) =>
      [...prev, { date: addingDate, leaveType: addingType }].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    );
  }

  function addFromAttendance(targets: AttendanceRecord[]) {
    setDateEntries((prev) =>
      [
        ...prev,
        ...targets
          .filter((r) => !prev.some((e) => e.date === r.date))
          .map((r) => ({ date: r.date, leaveType: r.type as LeaveType })),
      ].sort((a, b) => a.date.localeCompare(b.date)),
    );
  }

  function removeDate(d: string) {
    setDateEntries((prev) => prev.filter((e) => e.date !== d));
  }

  function updateEntryType(date: string, type: LeaveType) {
    setDateEntries((prev) =>
      prev.map((e) => (e.date === date ? { ...e, leaveType: type } : e)),
    );
  }

  function resetLeaveForm() {
    setEditingLeaveId(null);
    setApplicationDate(todayStr());
    setDateEntries([]);
    setReason('');
  }

  function buildLeaveRecord(id: string): LeaveApplicationRecord {
    return {
      id,
      applicationDate,
      name,
      dateEntries: dateEntries.map((e) => ({ date: e.date, leaveType: e.leaveType })),
      reason,
    };
  }

  function handleSaveLeave() {
    if (!name.trim()) { alert('氏名を入力してください。'); return; }
    if (!applicationDate) { alert('申請日を入力してください。'); return; }
    if (dateEntries.length === 0) { alert('取得日を1日以上追加してください。'); return; }
    const duplicated = dateEntries.filter((e) => otherLeaveDates.has(e.date));
    if (duplicated.length > 0) {
      alert(`次の日はすでに別の休暇申請書で申請済みです。取得日一覧から外してください。\n${duplicated.map((e) => fmtDateJp(e.date)).join('、')}`);
      return;
    }
    upsertLeaveApplication(buildLeaveRecord(editingLeaveId ?? generateId()));
    setLeaveApplications(loadLeaveApplications());
    if (!dateEntries.some((e) => e.date.startsWith(monthPrefix))) showMonthOf(dateEntries[0].date);
    resetLeaveForm();
  }

  function handleEditLeave(record: LeaveApplicationRecord) {
    if (!confirmDiscard(leaveDirty)) return;
    setEditingLeaveId(record.id);
    setApplicationDate(record.applicationDate);
    setDateEntries(record.dateEntries.map((e) => ({ ...e })));
    setReason(record.reason);
    window.scrollTo(0, 0);
  }

  function handleDeleteLeave(id: string) {
    if (!window.confirm('この休暇申請を削除しますか？')) return;
    deleteLeaveApplication(id);
    setLeaveApplications(loadLeaveApplications());
    if (editingLeaveId === id) resetLeaveForm();
  }

  // ── 遅早退申請 ──

  // 対象月の勤務表の実績（出退勤時刻）から検知した遅刻・早退
  const monthLateEarly = findLateEarly(monthRecords, workSettings);
  const occurrenceByKey = new Map(monthLateEarly.map((o) => [lateEarlyKey(o.date, o.type), o]));
  const occurredLateEarly = new Set(occurrenceByKey.keys());
  // 申請済みの遅刻・早退（otherLateEarly は編集中の申請を除く）
  const appliedLateEarly = new Set(lateEarlyApplications.map((a) => lateEarlyKey(a.targetDate, a.type)));
  const otherLateEarly = new Set(
    lateEarlyApplications.filter((a) => a.id !== editingLateEarlyId).map((a) => lateEarlyKey(a.targetDate, a.type)),
  );
  const unappliedLateEarlyCount = monthLateEarly.filter((o) => !appliedLateEarly.has(lateEarlyKey(o.date, o.type))).length;
  // まだ申請していない遅刻・早退（勤務表から選択の候補）
  const lateEarlyCandidates = monthLateEarly.filter((o) => !otherLateEarly.has(lateEarlyKey(o.date, o.type)));

  function applyLateEarlyCandidate(c: LateEarlyOccurrence) {
    setLateEarlyType(c.type);
    setTargetDate(c.date);
    setScheduledTime(c.scheduledTime);
    setActualTime(c.actualTime);
  }

  function resetLateEarlyForm() {
    setEditingLateEarlyId(null);
    setLeAppDate(todayStr());
    setLateEarlyType('遅刻');
    setTargetDate(todayStr());
    setScheduledTime('');
    setActualTime('');
    setLeReason('');
  }

  function buildLateEarlyRecord(id: string): LateEarlyApplicationRecord {
    return {
      id,
      applicationDate: leAppDate,
      name,
      type: lateEarlyType,
      targetDate,
      scheduledTime,
      actualTime,
      reason: leReason,
    };
  }

  const editingLateEarly = lateEarlyApplications.find((a) => a.id === editingLateEarlyId);
  const lateEarlyDirty = editingLateEarly
    ? lateEarlyContent(editingLateEarly) !== lateEarlyContent(buildLateEarlyRecord(''))
    : scheduledTime !== '' || actualTime !== '' || leReason.trim() !== '';

  function handleSaveLateEarly() {
    if (!name.trim()) { alert('氏名を入力してください。'); return; }
    if (!leAppDate) { alert('申請日を入力してください。'); return; }
    if (!targetDate) { alert('対象日を入力してください。'); return; }
    if (!scheduledTime || !actualTime) { alert('本来の時刻と実際の時刻を入力してください。'); return; }
    if (!leReason.trim()) { alert('理由を入力してください。'); return; }
    if (otherLateEarly.has(lateEarlyKey(targetDate, lateEarlyType))) {
      alert(`${fmtDateJp(targetDate)}の${lateEarlyType}はすでに申請済みです。保存済みの申請を編集してください。`);
      return;
    }
    // 遅刻なら実際の時刻は本来より後、早退なら前のはず。日をまたぐ勤務もあるため止めずに確認する
    const consistent = lateEarlyType === '遅刻'
      ? isLateArrival(actualTime, scheduledTime)
      : isEarlyDeparture(actualTime, scheduledTime);
    if (!consistent && !window.confirm(
      `${lateEarlyType}の申請ですが、実際の時刻（${actualTime}）が本来の時刻（${scheduledTime}）より${lateEarlyType === '遅刻' ? '後' : '前'}になっていません。このまま保存しますか？`,
    )) return;
    upsertLateEarlyApplication(buildLateEarlyRecord(editingLateEarlyId ?? generateId()));
    setLateEarlyApplications(loadLateEarlyApplications());
    if (!targetDate.startsWith(monthPrefix)) showMonthOf(targetDate);
    resetLateEarlyForm();
  }

  function handleEditLateEarly(record: LateEarlyApplicationRecord) {
    if (!confirmDiscard(lateEarlyDirty)) return;
    setEditingLateEarlyId(record.id);
    setLeAppDate(record.applicationDate);
    setLateEarlyType(record.type);
    setTargetDate(record.targetDate);
    setScheduledTime(record.scheduledTime);
    setActualTime(record.actualTime);
    setLeReason(record.reason);
    window.scrollTo(0, 0);
  }

  function handleDeleteLateEarly(id: string) {
    if (!window.confirm('この遅早退申請を削除しますか？')) return;
    deleteLateEarlyApplication(id);
    setLateEarlyApplications(loadLateEarlyApplications());
    if (editingLateEarlyId === id) resetLateEarlyForm();
  }

  const monthLeaveApplications = leaveApplications
    .filter((a) => a.dateEntries.some((e) => e.date.startsWith(monthPrefix)))
    .sort((a, b) => earliestDate(a.dateEntries).localeCompare(earliestDate(b.dateEntries)));
  const monthLateEarlyApplications = lateEarlyApplications
    .filter((a) => a.targetDate.startsWith(monthPrefix))
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));

  const monthFilter = (
    <div className="list-filter app-doc-month">
      <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="年">
        {years.map((y) => <option key={y} value={y}>{y}年</option>)}
      </select>
      <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="月">
        {months.map((m) => <option key={m} value={m}>{m}月</option>)}
      </select>
      <span className="hint hint-inline">勤務表から追加する候補と、保存済みの一覧をこの月で表示します</span>
    </div>
  );
  const monthNotice = <SubmittedNotice docs={[docType === 'leave' ? 'leave' : 'lateEarly']} year={year} month={month} />;

  const applicantSection = (
    <div className="leave-app-section">
      <h3 className="leave-app-section-title">申請者情報</h3>
      <div className="form-row">
        <label>氏名</label>
        <input
          type="text"
          value={name}
          onChange={(e) => updateName(e.target.value)}
          readOnly={!!viewing}
          title={viewing ? '氏名は本人だけが変更できます' : undefined}
          placeholder="氏名"
        />
      </div>
      <p className="form-hint">勤務表・交通費・作業報告書の氏名と共通です</p>
    </div>
  );

  const unappliedBadge = (count: number) =>
    count > 0 && (
      <span className="app-doc-menu-count" title={`${month}月の未申請 ${count}件`} aria-label={`未申請 ${count}件`}>
        {count}
      </span>
    );

  return (
    <div className="app-doc-tab">
      <div className="app-doc-sidebar">
        <div className="app-doc-menu-title">書類の種類</div>
        <div
          className={`app-doc-menu-item ${docType === 'leave' ? 'active' : ''}`}
          onClick={() => setDocType('leave')}
        >
          休暇申請書{unappliedBadge(unappliedLeaveCount)}
        </div>
        <div
          className={`app-doc-menu-item ${docType === 'late_early' ? 'active' : ''}`}
          onClick={() => setDocType('late_early')}
        >
          遅早退申請書{unappliedBadge(unappliedLateEarlyCount)}
        </div>
      </div>

      <div className="app-doc-content">
        {docType === 'leave' && (
          <>
            <h2 className="section-title">{editingLeaveId ? '休暇申請書を編集' : '休暇申請書'}</h2>
            {monthFilter}
            {monthNotice}
            {applicantSection}

            <div className="leave-app-section">
              <h3 className="leave-app-section-title">申請内容</h3>
              <div className="form-row">
                <label>申請日</label>
                <input
                  type="date"
                  value={applicationDate}
                  onChange={(e) => setApplicationDate(e.target.value)}
                />
              </div>
              <div className="form-row form-row-top">
                <label>取得日一覧</label>
                <div className="date-entry-list">
                  {dateEntries.map((entry) => (
                    <div key={entry.date} className="date-entry">
                      <span className="date-entry-label">{fmtDateJp(entry.date)}</span>
                      <select
                        className="date-entry-type"
                        value={entry.leaveType}
                        onChange={(e) => updateEntryType(entry.date, e.target.value as LeaveType)}
                      >
                        {(Object.keys(LEAVE_LABELS) as LeaveType[]).map((k) => (
                          <option key={k} value={k}>{LEAVE_LABELS[k]}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="date-tag-remove"
                        onClick={() => removeDate(entry.date)}
                      >×</button>
                    </div>
                  ))}
                  {dateEntries.length === 0 && (
                    <span className="no-dates">「勤務表から追加」か「手動で日付を追加」で取得日を追加してください</span>
                  )}
                </div>
              </div>
              <div className="form-row form-row-top">
                <label>勤務表から追加</label>
                <div className="pending-list">
                  {leaveCandidates.length === 0 ? (
                    <span className="no-dates">{month}月の勤務表に、未申請の休暇はありません</span>
                  ) : (
                    <>
                      {leaveCandidates.map((r) => (
                        <button
                          key={r.date}
                          type="button"
                          className="pending-chip"
                          onClick={() => addFromAttendance([r])}
                        >
                          ＋ {fmtDateJp(r.date)} {ATTENDANCE_TYPE_LABELS[r.type]}
                        </button>
                      ))}
                      {leaveCandidates.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => addFromAttendance(leaveCandidates)}
                        >すべて追加</button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label>手動で日付を追加</label>
                <div className="date-add-fields">
                  <input
                    type="date"
                    value={addingDate}
                    onChange={(e) => setAddingDate(e.target.value)}
                  />
                  <select
                    value={addingType}
                    onChange={(e) => setAddingType(e.target.value as LeaveType)}
                  >
                    {(Object.keys(LEAVE_LABELS) as LeaveType[]).map((k) => (
                      <option key={k} value={k}>{LEAVE_LABELS[k]}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={addDate}
                  >追加</button>
                </div>
              </div>
              <div className="form-row">
                <label>取得日数</label>
                <span className="leave-days-display">{leaveDays}日</span>
              </div>
              <div className="form-row form-row-top">
                <label>取得理由</label>
                <ReasonField
                  value={reason}
                  onChange={setReason}
                  options={LEAVE_REASONS}
                  placeholder="取得理由を入力するか、下の候補から選んでください"
                />
              </div>
            </div>

            <div className="leave-app-actions">
              {editingLeaveId && (
                <button className="btn btn-secondary" onClick={() => { if (confirmDiscard(leaveDirty)) resetLeaveForm(); }}>
                  新規作成に戻る
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSaveLeave}>
                {editingLeaveId ? '更新' : '保存'}
              </button>
            </div>

            <div className="leave-app-section">
              <h3 className="leave-app-section-title">保存済みの休暇申請（{year}年{month}月）</h3>
              {monthLeaveApplications.length === 0 ? (
                <div className="skill-empty">{month}月の休暇申請はありません。</div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>申請日</th>
                        <th>取得日</th>
                        <th>取得日数</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthLeaveApplications.map((b) => (
                        <tr key={b.id} className={b.id === editingLeaveId ? 'is-editing' : undefined}>
                          <td>{fmtDateJp(b.applicationDate)}</td>
                          <td>
                            {b.dateEntries.map((e) => {
                              const issue = checkLeaveEntry(e, recordByDate.get(e.date));
                              return (
                                <div key={e.date}>
                                  {fmtDateJp(e.date)} {LEAVE_LABELS[e.leaveType]}
                                  {issue && <div className="app-issue"><Icon name="alert" size={13} />{issue}</div>}
                                </div>
                              );
                            })}
                          </td>
                          <td>{calcLeaveDays(b.dateEntries)}日</td>
                          <td>
                            <div className="actions">
                              <button className="btn-icon btn-edit" onClick={() => handleEditLeave(b)}>編集</button>
                              <button className="btn-icon btn-delete" onClick={() => handleDeleteLeave(b.id)}>削除</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {docType === 'late_early' && (
          <>
            <h2 className="section-title">{editingLateEarlyId ? '遅早退申請書を編集' : '遅早退申請書'}</h2>
            {monthFilter}
            {monthNotice}
            {applicantSection}

            <div className="leave-app-section">
              <h3 className="leave-app-section-title">申請内容</h3>
              <div className="form-row">
                <label>申請日</label>
                <input
                  type="date"
                  value={leAppDate}
                  onChange={(e) => setLeAppDate(e.target.value)}
                />
              </div>
              <div className="form-row form-row-top">
                <label>勤務表から選択</label>
                <div className="pending-list">
                  {lateEarlyCandidates.length === 0 ? (
                    <span className="no-dates">{month}月の勤務表に、未申請の遅刻・早退はありません</span>
                  ) : (
                    lateEarlyCandidates.map((c) => {
                      const selected = c.date === targetDate && c.type === lateEarlyType;
                      return (
                        <button
                          key={lateEarlyKey(c.date, c.type)}
                          type="button"
                          className={`pending-chip${selected ? ' is-selected' : ''}`}
                          onClick={() => applyLateEarlyCandidate(c)}
                        >
                          {fmtDateJp(c.date)} {c.type}（{c.scheduledTime} → {c.actualTime}）
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="form-row">
                <label>種別</label>
                <select
                  value={lateEarlyType}
                  onChange={(e) => setLateEarlyType(e.target.value as LateEarlyType)}
                >
                  <option value="遅刻">遅刻</option>
                  <option value="早退">早退</option>
                </select>
              </div>
              <div className="form-row">
                <label>対象日</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label>本来の時刻</label>
                <input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label>実際の時刻</label>
                <input
                  type="time"
                  value={actualTime}
                  onChange={(e) => setActualTime(e.target.value)}
                />
              </div>
              <div className="form-row form-row-top">
                <label>理由</label>
                <ReasonField
                  value={leReason}
                  onChange={setLeReason}
                  options={LATE_EARLY_REASONS[lateEarlyType]}
                  placeholder="理由を入力するか、下の候補から選んでください"
                />
              </div>
            </div>

            <div className="leave-app-actions">
              {editingLateEarlyId && (
                <button className="btn btn-secondary" onClick={() => { if (confirmDiscard(lateEarlyDirty)) resetLateEarlyForm(); }}>
                  新規作成に戻る
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSaveLateEarly}>
                {editingLateEarlyId ? '更新' : '保存'}
              </button>
            </div>

            <div className="leave-app-section">
              <h3 className="leave-app-section-title">保存済みの遅早退申請（{year}年{month}月）</h3>
              {monthLateEarlyApplications.length === 0 ? (
                <div className="skill-empty">{month}月の遅早退申請はありません。</div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>対象日</th>
                        <th>種別</th>
                        <th>本来 → 実際</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthLateEarlyApplications.map((r) => {
                        const issue = checkLateEarlyApplication(r, occurredLateEarly);
                        // 申請後に勤務表の時刻を直した場合など、申請書の時刻が勤務表と違うもの
                        const actual = occurrenceByKey.get(lateEarlyKey(r.targetDate, r.type));
                        const timeDiffers = !!actual
                          && (actual.scheduledTime !== r.scheduledTime || actual.actualTime !== r.actualTime);
                        return (
                          <tr key={r.id} className={r.id === editingLateEarlyId ? 'is-editing' : undefined}>
                            <td>
                              {fmtDateJp(r.targetDate)}
                              {issue && <div className="app-issue"><Icon name="alert" size={13} />{issue}</div>}
                            </td>
                            <td>{r.type}</td>
                            <td>
                              {r.scheduledTime} → {r.actualTime}
                              {timeDiffers && (
                                <div className="app-issue is-soft">
                                  <Icon name="alert" size={13} />
                                  勤務表では {actual.scheduledTime} → {actual.actualTime} です
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="actions">
                                <button className="btn-icon btn-edit" onClick={() => handleEditLateEarly(r)}>編集</button>
                                <button className="btn-icon btn-delete" onClick={() => handleDeleteLateEarly(r.id)}>削除</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
