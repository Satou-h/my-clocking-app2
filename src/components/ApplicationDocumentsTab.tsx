import { useState } from 'react';
import { printLeaveApplication, printLateEarlyApplication } from '../utils/pdf';
import {
  loadUserProfile, generateId, isLateArrival, isEarlyDeparture,
  loadLeaveApplications, upsertLeaveApplication, deleteLeaveApplication,
  loadLateEarlyApplications, upsertLateEarlyApplication, deleteLateEarlyApplication,
} from '../utils/storage';
import type { LeaveType, LeaveApplicationRecord, LateEarlyApplicationRecord } from '../types/application';
import { LEAVE_LABELS } from '../types/application';
import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import { checkMonthCompleteness, formatCompletenessIssue } from '../utils/completeness';

interface Props {
  records: AttendanceRecord[];
  workSettings: WorkSettings;
}

const LEAVE_APP_SETTINGS_KEY = 'clocking_leave_app_settings';

interface LeaveAppSettings {
  name: string;
}

function loadLeaveAppSettings(): LeaveAppSettings {
  try {
    const raw = localStorage.getItem(LEAVE_APP_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { name: '' };
  } catch {
    return { name: '' };
  }
}

function saveLeaveAppSettings(s: LeaveAppSettings) {
  localStorage.setItem(LEAVE_APP_SETTINGS_KEY, JSON.stringify(s));
}

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function fmtDateJp(d: string): string {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth() + 1}月${dt.getDate()}日(${DOW_LABELS[dt.getDay()]})`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function calcLeaveDays(entries: { leaveType: LeaveType }[]): number {
  return entries.reduce((sum, e) => sum + (e.leaveType === 'paid_leave' ? 1 : 0.5), 0);
}

function deriveYearMonth(dateStr: string): { year: number; month: number } | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})/);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

function latestDate(entries: { date: string }[]): string {
  return entries.reduce((max, e) => (e.date > max ? e.date : max), '');
}

const LEAVE_ATTENDANCE_TYPES = new Set(['paid_leave', 'am_leave', 'pm_leave']);

interface LateEarlyCandidate {
  date: string;
  type: '遅刻' | '早退';
  scheduledTime: string;
  actualTime: string;
}

type DocType = 'leave' | 'late_early';

export default function ApplicationDocumentsTab({ records, workSettings }: Props) {
  const [docType, setDocType] = useState<DocType>('leave');
  const [settings, setSettings] = useState<LeaveAppSettings>(loadLeaveAppSettings);

  // 休暇申請
  const [leaveApplications, setLeaveApplications] = useState<LeaveApplicationRecord[]>(loadLeaveApplications);
  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);
  const [applicationDate, setApplicationDate] = useState(today);
  const [dateEntries, setDateEntries] = useState<{ date: string; leaveType: LeaveType }[]>([
    { date: today(), leaveType: 'paid_leave' },
  ]);
  const [addingDate, setAddingDate] = useState(today);
  const [addingType, setAddingType] = useState<LeaveType>('paid_leave');
  const [reason, setReason] = useState('');

  // 遅早退申請
  const [lateEarlyApplications, setLateEarlyApplications] = useState<LateEarlyApplicationRecord[]>(loadLateEarlyApplications);
  const [editingLateEarlyId, setEditingLateEarlyId] = useState<string | null>(null);
  const [leAppDate, setLeAppDate] = useState(today);
  const [lateEarlyType, setLateEarlyType] = useState<'遅刻' | '早退'>('遅刻');
  const [targetDate, setTargetDate] = useState(today);
  const [scheduledTime, setScheduledTime] = useState('');
  const [actualTime, setActualTime] = useState('');
  const [leReason, setLeReason] = useState('');

  function updateName(value: string) {
    const next = { name: value };
    setSettings(next);
    saveLeaveAppSettings(next);
  }

  const leaveDays = calcLeaveDays(dateEntries);

  // 勤務表に有給・午前休・午後休として記録済みで、まだ取得日一覧に追加していない日
  const leaveCandidates = records
    .filter((r) => LEAVE_ATTENDANCE_TYPES.has(r.type) && !dateEntries.some((e) => e.date === r.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  function addDate() {
    if (!addingDate) return;
    if (dateEntries.some((e) => e.date === addingDate)) return;
    setDateEntries((prev) =>
      [...prev, { date: addingDate, leaveType: addingType }].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    );
  }

  function addDateFromAttendance(date: string) {
    const record = records.find((r) => r.date === date);
    if (!record) return;
    const leaveType = record.type as LeaveType;
    setDateEntries((prev) =>
      prev.some((e) => e.date === date)
        ? prev
        : [...prev, { date, leaveType }].sort((a, b) => a.date.localeCompare(b.date)),
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
    setApplicationDate(today());
    setDateEntries([{ date: today(), leaveType: 'paid_leave' }]);
    setReason('');
  }

  function buildLeaveRecord(id: string): LeaveApplicationRecord {
    return {
      id,
      applicationDate,
      name: settings.name,
      dateEntries: dateEntries.map((e) => ({ date: e.date, leaveType: e.leaveType })),
      reason,
    };
  }

  function handleSaveLeave() {
    if (!settings.name.trim()) { alert('氏名を入力してください。'); return; }
    if (dateEntries.length === 0) { alert('日付を1つ以上追加してください。'); return; }
    upsertLeaveApplication(buildLeaveRecord(editingLeaveId ?? generateId()));
    setLeaveApplications(loadLeaveApplications());
    resetLeaveForm();
  }

  function printLeaveRecord(record: LeaveApplicationRecord) {
    const { employeeId, lastName } = loadUserProfile();
    if (!employeeId || !lastName) { alert('画面上部に社員番号と苗字を入力してください。'); return; }
    const ym = deriveYearMonth(record.dateEntries[0]?.date ?? record.applicationDate);
    if (ym) {
      const completeness = checkMonthCompleteness(
        ym.year, ym.month, records, [], loadLeaveApplications(), loadLateEarlyApplications(), workSettings,
      );
      if (!completeness.leaveApplication.complete) {
        alert(formatCompletenessIssue('休暇申請書', completeness.leaveApplication));
        return;
      }
    }
    printLeaveApplication({
      applicationDate: record.applicationDate,
      name: record.name,
      dateEntries: record.dateEntries.map((e) => ({ date: e.date, leaveLabel: LEAVE_LABELS[e.leaveType] })),
      leaveDays: calcLeaveDays(record.dateEntries),
      reason: record.reason,
    }, employeeId, lastName);
  }

  function handlePrintLeave() {
    if (dateEntries.length === 0) { alert('日付を1つ以上追加してください。'); return; }
    const record = buildLeaveRecord(editingLeaveId ?? generateId());
    const { employeeId, lastName } = loadUserProfile();
    if (!employeeId || !lastName) { alert('画面上部に社員番号と苗字を入力してください。'); return; }
    upsertLeaveApplication(record);
    setLeaveApplications(loadLeaveApplications());
    printLeaveRecord(record);
  }

  function handleEditLeave(record: LeaveApplicationRecord) {
    setEditingLeaveId(record.id);
    setApplicationDate(record.applicationDate);
    setDateEntries(record.dateEntries.map((e) => ({ ...e })));
    setReason(record.reason);
    if (record.name && record.name !== settings.name) updateName(record.name);
    setDocType('leave');
  }

  function handleDeleteLeave(id: string) {
    if (!window.confirm('この休暇申請を削除しますか？')) return;
    deleteLeaveApplication(id);
    setLeaveApplications(loadLeaveApplications());
    if (editingLeaveId === id) resetLeaveForm();
  }

  // 勤務表の実績（出退勤時刻）から遅刻・早退を検知した候補
  const lateEarlyCandidates: LateEarlyCandidate[] = records
    .filter((r) => r.type === 'work' && r.clockIn && r.clockOut)
    .flatMap((r) => {
      const refStart = r.customStartTime ?? workSettings.standardStartTime;
      const refEnd = r.customEndTime ?? workSettings.standardEndTime;
      const candidates: LateEarlyCandidate[] = [];
      if (isLateArrival(r.clockIn!, refStart)) {
        candidates.push({ date: r.date, type: '遅刻', scheduledTime: refStart, actualTime: r.clockIn! });
      }
      if (isEarlyDeparture(r.clockOut!, refEnd, r.clockIn)) {
        candidates.push({ date: r.date, type: '早退', scheduledTime: refEnd, actualTime: r.clockOut! });
      }
      return candidates;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  function applyLateEarlyCandidate(key: string) {
    const candidate = lateEarlyCandidates.find((c) => `${c.date}_${c.type}` === key);
    if (!candidate) return;
    setLateEarlyType(candidate.type);
    setTargetDate(candidate.date);
    setScheduledTime(candidate.scheduledTime);
    setActualTime(candidate.actualTime);
  }

  function resetLateEarlyForm() {
    setEditingLateEarlyId(null);
    setLeAppDate(today());
    setLateEarlyType('遅刻');
    setTargetDate(today());
    setScheduledTime('');
    setActualTime('');
    setLeReason('');
  }

  function buildLateEarlyRecord(id: string): LateEarlyApplicationRecord {
    return {
      id,
      applicationDate: leAppDate,
      name: settings.name,
      type: lateEarlyType,
      targetDate,
      scheduledTime,
      actualTime,
      reason: leReason,
    };
  }

  function handleSaveLateEarly() {
    if (!settings.name.trim()) { alert('氏名を入力してください。'); return; }
    upsertLateEarlyApplication(buildLateEarlyRecord(editingLateEarlyId ?? generateId()));
    setLateEarlyApplications(loadLateEarlyApplications());
    resetLateEarlyForm();
  }

  function printLateEarlyRecord(record: LateEarlyApplicationRecord) {
    const { employeeId, lastName } = loadUserProfile();
    if (!employeeId || !lastName) { alert('画面上部に社員番号と苗字を入力してください。'); return; }
    const ym = deriveYearMonth(record.targetDate);
    if (ym) {
      const completeness = checkMonthCompleteness(
        ym.year, ym.month, records, [], loadLeaveApplications(), loadLateEarlyApplications(), workSettings,
      );
      if (!completeness.lateEarlyApplication.complete) {
        alert(formatCompletenessIssue('遅早退申請書', completeness.lateEarlyApplication));
        return;
      }
    }
    printLateEarlyApplication({
      applicationDate: record.applicationDate,
      name: record.name,
      type: record.type,
      targetDate: record.targetDate,
      scheduledTime: record.scheduledTime,
      actualTime: record.actualTime,
      reason: record.reason,
    }, employeeId, lastName);
  }

  function handlePrintLateEarly() {
    const record = buildLateEarlyRecord(editingLateEarlyId ?? generateId());
    const { employeeId, lastName } = loadUserProfile();
    if (!employeeId || !lastName) { alert('画面上部に社員番号と苗字を入力してください。'); return; }
    upsertLateEarlyApplication(record);
    setLateEarlyApplications(loadLateEarlyApplications());
    printLateEarlyRecord(record);
  }

  function handleEditLateEarly(record: LateEarlyApplicationRecord) {
    setEditingLateEarlyId(record.id);
    setLeAppDate(record.applicationDate);
    setLateEarlyType(record.type);
    setTargetDate(record.targetDate);
    setScheduledTime(record.scheduledTime);
    setActualTime(record.actualTime);
    setLeReason(record.reason);
    if (record.name && record.name !== settings.name) updateName(record.name);
    setDocType('late_early');
  }

  function handleDeleteLateEarly(id: string) {
    if (!window.confirm('この遅早退申請を削除しますか？')) return;
    deleteLateEarlyApplication(id);
    setLateEarlyApplications(loadLateEarlyApplications());
    if (editingLateEarlyId === id) resetLateEarlyForm();
  }

  const sortedLeaveApplications = [...leaveApplications].sort(
    (a, b) => latestDate(b.dateEntries).localeCompare(latestDate(a.dateEntries)),
  );
  const sortedLateEarlyApplications = [...lateEarlyApplications].sort(
    (a, b) => b.targetDate.localeCompare(a.targetDate),
  );

  return (
    <div className="app-doc-tab">
      <div className="app-doc-sidebar">
        <div className="app-doc-menu-title">書類の種類</div>
        <div
          className={`app-doc-menu-item ${docType === 'leave' ? 'active' : ''}`}
          onClick={() => setDocType('leave')}
        >
          休暇申請書
        </div>
        <div
          className={`app-doc-menu-item ${docType === 'late_early' ? 'active' : ''}`}
          onClick={() => setDocType('late_early')}
        >
          遅早退申請書
        </div>
      </div>

      <div className="app-doc-content">
        {docType === 'leave' && (
          <>
            <h2 className="section-title">{editingLeaveId ? '休暇申請書を編集' : '休暇申請書'}</h2>

            <div className="leave-app-section">
              <h3 className="leave-app-section-title">申請者情報</h3>
              <div className="form-row">
                <label>氏名</label>
                <input
                  type="text"
                  value={settings.name}
                  onChange={(e) => updateName(e.target.value)}
                  placeholder="氏名"
                />
              </div>
            </div>

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
              <div className="form-row" style={{ alignItems: 'flex-start' }}>
                <label style={{ paddingTop: 6 }}>取得日一覧</label>
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
                    <span className="no-dates">日付が未選択です</span>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label>勤務表から追加</label>
                <select
                  className="attendance-date-picker"
                  value=""
                  onChange={(e) => { if (e.target.value) addDateFromAttendance(e.target.value); }}
                  disabled={leaveCandidates.length === 0}
                >
                  <option value="">
                    {leaveCandidates.length === 0 ? '対象になる勤怠記録がありません' : '有給・休暇の記録から選択…'}
                  </option>
                  {leaveCandidates.map((r) => (
                    <option key={r.date} value={r.date}>
                      {fmtDateJp(r.date)} {ATTENDANCE_TYPE_LABELS[r.type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>手動で日付を追加</label>
                <input
                  type="date"
                  value={addingDate}
                  onChange={(e) => setAddingDate(e.target.value)}
                />
                <select
                  className="date-entry-type"
                  style={{ marginLeft: 8 }}
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
                  style={{ marginLeft: 8, padding: '5px 14px', fontSize: '13px' }}
                  onClick={addDate}
                >追加</button>
              </div>
              <div className="form-row">
                <label>取得日数</label>
                <span className="leave-days-display">{leaveDays}日</span>
              </div>
              <div className="form-row">
                <label>取得理由</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="取得理由を入力してください"
                  rows={3}
                />
              </div>
            </div>

            <div className="leave-app-actions">
              {editingLeaveId && (
                <button className="btn btn-secondary" onClick={resetLeaveForm}>新規作成に戻る</button>
              )}
              <button className="btn btn-primary" onClick={handleSaveLeave}>
                {editingLeaveId ? '更新' : '保存'}
              </button>
              <button className="btn btn-pdf" onClick={handlePrintLeave}>
                PDF出力
              </button>
            </div>

            <div className="leave-app-section">
              <h3 className="leave-app-section-title">保存済みの休暇申請</h3>
              {sortedLeaveApplications.length === 0 ? (
                <div className="skill-empty">保存された休暇申請はありません。</div>
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
                      {sortedLeaveApplications.map((b) => (
                        <tr key={b.id}>
                          <td>{fmtDateJp(b.applicationDate)}</td>
                          <td>{b.dateEntries.map((e) => fmtDateJp(e.date)).join('、')}</td>
                          <td>{calcLeaveDays(b.dateEntries)}日</td>
                          <td className="actions">
                            <button className="btn-icon btn-edit" onClick={() => handleEditLeave(b)}>編集</button>
                            <button className="btn-icon btn-delete" onClick={() => handleDeleteLeave(b.id)}>削除</button>
                            <button className="btn-icon btn-pdf-icon" onClick={() => printLeaveRecord(b)}>PDF</button>
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

            <div className="leave-app-section">
              <h3 className="leave-app-section-title">申請者情報</h3>
              <div className="form-row">
                <label>氏名</label>
                <input
                  type="text"
                  value={settings.name}
                  onChange={(e) => updateName(e.target.value)}
                  placeholder="氏名"
                />
              </div>
            </div>

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
              <div className="form-row">
                <label>勤務表から選択</label>
                <select
                  className="attendance-date-picker"
                  value=""
                  onChange={(e) => { if (e.target.value) applyLateEarlyCandidate(e.target.value); }}
                  disabled={lateEarlyCandidates.length === 0}
                >
                  <option value="">
                    {lateEarlyCandidates.length === 0 ? '対象になる勤怠記録がありません' : '遅刻・早退の記録から選択…'}
                  </option>
                  {lateEarlyCandidates.map((c) => (
                    <option key={`${c.date}_${c.type}`} value={`${c.date}_${c.type}`}>
                      {fmtDateJp(c.date)} {c.type}（{c.scheduledTime} → {c.actualTime}）
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>種別</label>
                <select
                  value={lateEarlyType}
                  onChange={(e) => setLateEarlyType(e.target.value as '遅刻' | '早退')}
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
              <div className="form-row">
                <label>理由</label>
                <textarea
                  value={leReason}
                  onChange={(e) => setLeReason(e.target.value)}
                  placeholder="理由を入力してください"
                  rows={3}
                />
              </div>
            </div>

            <div className="leave-app-actions">
              {editingLateEarlyId && (
                <button className="btn btn-secondary" onClick={resetLateEarlyForm}>新規作成に戻る</button>
              )}
              <button className="btn btn-primary" onClick={handleSaveLateEarly}>
                {editingLateEarlyId ? '更新' : '保存'}
              </button>
              <button className="btn btn-pdf" onClick={handlePrintLateEarly}>
                PDF出力
              </button>
            </div>

            <div className="leave-app-section">
              <h3 className="leave-app-section-title">保存済みの遅早退申請</h3>
              {sortedLateEarlyApplications.length === 0 ? (
                <div className="skill-empty">保存された遅早退申請はありません。</div>
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
                      {sortedLateEarlyApplications.map((r) => (
                        <tr key={r.id}>
                          <td>{fmtDateJp(r.targetDate)}</td>
                          <td>{r.type}</td>
                          <td>{r.scheduledTime} → {r.actualTime}</td>
                          <td className="actions">
                            <button className="btn-icon btn-edit" onClick={() => handleEditLateEarly(r)}>編集</button>
                            <button className="btn-icon btn-delete" onClick={() => handleDeleteLateEarly(r.id)}>削除</button>
                            <button className="btn-icon btn-pdf-icon" onClick={() => printLateEarlyRecord(r)}>PDF</button>
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
      </div>
    </div>
  );
}
