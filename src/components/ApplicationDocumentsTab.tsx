import { useState } from 'react';
import { printLeaveApplication, printLateEarlyApplication } from '../utils/pdf';
import type { LeaveApplicationEntry } from '../utils/pdf';
import { loadUserProfile } from '../utils/storage';

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

type LeaveType = 'paid_leave' | 'am_leave' | 'pm_leave';

const LEAVE_LABELS: Record<LeaveType, string> = {
  paid_leave: '一日有給',
  am_leave: '午前休',
  pm_leave: '午後休',
};

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function fmtDateJp(d: string): string {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth() + 1}月${dt.getDate()}日(${DOW_LABELS[dt.getDay()]})`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

type DocType = 'leave' | 'late_early';

export default function ApplicationDocumentsTab() {
  const [docType, setDocType] = useState<DocType>('leave');
  const [settings, setSettings] = useState<LeaveAppSettings>(loadLeaveAppSettings);

  // 休暇申請
  const [applicationDate, setApplicationDate] = useState(today);
  const [dateEntries, setDateEntries] = useState<{ date: string; leaveType: LeaveType }[]>([
    { date: today(), leaveType: 'paid_leave' },
  ]);
  const [addingDate, setAddingDate] = useState(today);
  const [addingType, setAddingType] = useState<LeaveType>('paid_leave');
  const [reason, setReason] = useState('');

  // 遅早退申請
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

  const leaveDays = dateEntries.reduce(
    (sum, e) => sum + (e.leaveType === 'paid_leave' ? 1 : 0.5),
    0,
  );

  function addDate() {
    if (!addingDate) return;
    if (dateEntries.some((e) => e.date === addingDate)) return;
    setDateEntries((prev) =>
      [...prev, { date: addingDate, leaveType: addingType }].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
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

  function handlePrintLeave() {
    const { employeeId, lastName } = loadUserProfile();
    if (!employeeId || !lastName) { alert('画面上部に社員番号と苗字を入力してください。'); return; }
    if (dateEntries.length === 0) { alert('日付を1つ以上追加してください。'); return; }
    const entries: LeaveApplicationEntry[] = dateEntries.map((e) => ({
      date: e.date,
      leaveLabel: LEAVE_LABELS[e.leaveType],
    }));
    printLeaveApplication({
      applicationDate,
      name: settings.name,
      dateEntries: entries,
      leaveDays,
      reason,
    }, employeeId, lastName);
  }

  function handlePrintLateEarly() {
    const { employeeId, lastName } = loadUserProfile();
    if (!employeeId || !lastName) { alert('画面上部に社員番号と苗字を入力してください。'); return; }
    printLateEarlyApplication({
      applicationDate: leAppDate,
      name: settings.name,
      type: lateEarlyType,
      targetDate,
      scheduledTime,
      actualTime,
      reason: leReason,
    }, employeeId, lastName);
  }

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
            <h2 className="section-title">休暇申請書</h2>

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
                <label>日付を追加</label>
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
              <button className="btn btn-pdf" onClick={handlePrintLeave}>
                PDF出力
              </button>
            </div>
          </>
        )}

        {docType === 'late_early' && (
          <>
            <h2 className="section-title">遅早退申請書</h2>

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
              <button className="btn btn-pdf" onClick={handlePrintLateEarly}>
                PDF出力
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
