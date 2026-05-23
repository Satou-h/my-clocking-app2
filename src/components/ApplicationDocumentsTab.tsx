import { useState } from 'react';
import { printLeaveApplication } from '../utils/pdf';

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

function countLeaveDays(start: string, end: string): number {
  if (!start || !end || start > end) return 0;
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function ApplicationDocumentsTab() {
  const [settings, setSettings] = useState<LeaveAppSettings>(loadLeaveAppSettings);
  const [applicationDate, setApplicationDate] = useState(today);
  const [leaveType, setLeaveType] = useState<LeaveType>('paid_leave');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState('');

  function updateName(value: string) {
    const next = { name: value };
    setSettings(next);
    saveLeaveAppSettings(next);
  }

  const effectiveEnd = leaveType === 'paid_leave' ? endDate : startDate;
  const leaveDays = leaveType === 'paid_leave'
    ? countLeaveDays(startDate, effectiveEnd)
    : 0.5;

  function handlePrint() {
    printLeaveApplication({
      applicationDate,
      name: settings.name,
      leaveLabel: LEAVE_LABELS[leaveType],
      startDate,
      endDate: effectiveEnd,
      leaveDays,
      reason,
    });
  }

  return (
    <div className="app-doc-tab">
      <div className="app-doc-sidebar">
        <div className="app-doc-menu-title">書類の種類</div>
        <div className="app-doc-menu-item active">休暇申請書</div>
      </div>

      <div className="app-doc-content">
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
          <div className="form-row">
            <label>休暇種別</label>
            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            >
              {(Object.keys(LEAVE_LABELS) as LeaveType[]).map((k) => (
                <option key={k} value={k}>{LEAVE_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>{leaveType === 'paid_leave' ? '開始日' : '取得日'}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
            />
          </div>
          {leaveType === 'paid_leave' && (
            <div className="form-row">
              <label>終了日</label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          )}
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
          <button className="btn btn-pdf" onClick={handlePrint}>
            PDF出力
          </button>
        </div>
      </div>
    </div>
  );
}
