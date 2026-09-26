import { useState, useCallback } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from './types/attendance';
import type { TransportRecord } from './types/transport';
import {
  loadRecords, saveRecords,
  loadPaidLeaveSettings, savePaidLeaveSettings,
  loadWorkSettings, saveWorkSettings,
  loadTransportRecords, saveTransportRecords,
  loadUserProfile, saveUserProfile,
  findPaidLeaveSetting,
} from './utils/storage';
import AttendanceForm from './components/AttendanceForm';
import AttendanceList from './components/AttendanceList';
import CSVImport from './components/CSVImport';
import TransferTab from './components/TransferTab';
import TimeSelect from './components/TimeSelect';
import type { TransferMeta } from './utils/transfer';
import WorkSettingsForm from './components/WorkSettingsForm';
import TransportTab from './components/TransportTab';
import ApplicationDocumentsTab from './components/ApplicationDocumentsTab';
import WorkReportTab from './components/WorkReportTab';
import SkillTab from './components/SkillTab';
import BulkDownloadTab from './components/BulkDownloadTab';
import './App.css';

type Tab = 'input' | 'list' | 'csv' | 'transfer' | 'transport' | 'settings' | 'documents' | 'report' | 'skill' | 'bulk';

export default function App() {
  const [tab, setTab] = useState<Tab>('input');
  const [records, setRecords] = useState<AttendanceRecord[]>(loadRecords);
  const [paidLeave, setPaidLeave] = useState<PaidLeaveSettings[]>(loadPaidLeaveSettings);
  const [workSettings, setWorkSettings] = useState<WorkSettings>(loadWorkSettings);
  const [transportRecords, setTransportRecords] = useState<TransportRecord[]>(loadTransportRecords);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | undefined>();
  const [userProfile, setUserProfile] = useState(loadUserProfile);
  const [listYear, setListYear] = useState(new Date().getFullYear());
  const [listMonth, setListMonth] = useState(new Date().getMonth() + 1);

  function handleProfileChange(key: 'employeeId' | 'lastName', value: string) {
    const next = { ...userProfile, [key]: value };
    setUserProfile(next);
    saveUserProfile(next);
  }

  const persistRecords = useCallback((next: AttendanceRecord[]) => {
    setRecords(next);
    saveRecords(next);
  }, []);

  function handleSave(record: AttendanceRecord) {
    const existsById = records.some((r) => r.id === record.id);
    let next: AttendanceRecord[];
    if (existsById) {
      next = records.map((r) => r.id === record.id ? record : r);
    } else {
      const sameDate = records.find((r) => r.date === record.date);
      if (sameDate) {
        next = records.map((r) => r.date === record.date ? { ...record, id: r.id } : r);
      } else {
        next = [...records, record];
      }
    }
    persistRecords(next);
    setEditingRecord(undefined);
    setTab('list');
  }

  function handleSaveMultiple(newRecords: AttendanceRecord[]) {
    let next = [...records];
    for (const record of newRecords) {
      const sameDate = next.find((r) => r.date === record.date);
      if (sameDate) {
        next = next.map((r) => r.date === record.date ? { ...record, id: r.id } : r);
      } else {
        next.push(record);
      }
    }
    persistRecords(next);
    setTab('list');
  }

  function handleDelete(id: string) {
    persistRecords(records.filter((r) => r.id !== id));
  }

  function handleEdit(record: AttendanceRecord) {
    setEditingRecord(record);
    setTab('input');
  }

  function handleSavePaidLeave(settings: PaidLeaveSettings[]) {
    setPaidLeave(settings);
    savePaidLeaveSettings(settings);
  }

  // ヘッダーの基準時間は選択したその場で保存する
  function handleWorkTimeChange(key: 'standardStartTime' | 'standardEndTime', value: string) {
    if (!value) return;
    handleSaveWorkSettings({ ...workSettings, [key]: value });
  }

  function handleSaveWorkSettings(settings: WorkSettings) {
    setWorkSettings(settings);
    saveWorkSettings(settings);
  }

  function handleClearAttendance() {
    persistRecords([]);
  }

  function handleClearTransport() {
    setTransportRecords([]);
    saveTransportRecords([]);
  }

  function handleClearAll() {
    persistRecords([]);
    setTransportRecords([]);
    saveTransportRecords([]);
  }

  function handleSaveTransport(record: TransportRecord) {
    const exists = transportRecords.some((r) => r.id === record.id);
    const next = exists
      ? transportRecords.map((r) => r.id === record.id ? record : r)
      : [...transportRecords, record];
    setTransportRecords(next);
    saveTransportRecords(next);
  }

  function handleSaveTransportMultiple(newRecords: TransportRecord[]) {
    const next = [...transportRecords, ...newRecords];
    setTransportRecords(next);
    saveTransportRecords(next);
  }

  function handleDeleteTransport(id: string) {
    const next = transportRecords.filter((r) => r.id !== id);
    setTransportRecords(next);
    saveTransportRecords(next);
  }

  function handleImport(imported: AttendanceRecord[], mode: 'merge' | 'replace') {
    if (mode === 'replace') {
      persistRecords(imported);
    } else {
      const existingDates = new Map(records.map((r) => [r.date, r]));
      const merged = [...records];
      for (const r of imported) {
        const existing = existingDates.get(r.date);
        if (existing) {
          const idx = merged.findIndex((x) => x.id === existing.id);
          merged[idx] = { ...r, id: existing.id };
        } else {
          merged.push(r);
        }
      }
      persistRecords(merged);
    }
    setTab('list');
  }

  // QR / カナコードで受け取った基準時間・社員番号・苗字を反映（含まれている項目のみ上書き）
  function handleImportMeta(meta: TransferMeta, year: number, month: number) {
    // 有給残日数は転送元の対象月の設定として保存する
    if (meta.paidLeaveDays !== undefined) {
      const existing = findPaidLeaveSetting(paidLeave, year, month);
      handleSavePaidLeave([...paidLeave.filter((s) => s !== existing), { year, month, totalDays: meta.paidLeaveDays }]);
    }
    if (meta.workSettings) handleSaveWorkSettings({ ...workSettings, ...meta.workSettings });
    if (meta.employeeId || meta.lastName) {
      const next = {
        ...userProfile,
        ...(meta.employeeId ? { employeeId: meta.employeeId } : {}),
        ...(meta.lastName ? { lastName: meta.lastName } : {}),
      };
      setUserProfile(next);
      saveUserProfile(next);
    }
  }

  function handleImportTransport(imported: TransportRecord[], mode: 'merge' | 'replace') {
    if (mode === 'replace') {
      setTransportRecords(imported);
      saveTransportRecords(imported);
    } else {
      // 1日に複数件の交通費があり得るため、取り込んだ日付の既存データはその日ごと置き換える
      // （同じデータを繰り返し取り込んでも重複しない）
      const importedDates = new Set(imported.map((r) => r.date));
      const next = [...transportRecords.filter((r) => !importedDates.has(r.date)), ...imported]
        .sort((a, b) => a.date.localeCompare(b.date));
      setTransportRecords(next);
      saveTransportRecords(next);
    }
    setTab('transport');
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'input', label: '勤怠入力' },
    { key: 'list', label: '勤怠一覧' },
    { key: 'transport', label: '交通費' },
    { key: 'documents', label: '申請書類' },
    { key: 'report', label: '作業報告' },
    { key: 'skill', label: 'スキル表' },
    { key: 'bulk', label: '一括ダウンロード' },
    { key: 'transfer', label: 'QR/カナコード' },
    { key: 'settings', label: '設定' },
    { key: 'csv', label: 'CSV' },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <h1>勤怠管理</h1>
        <div className="header-worktime">
          <span className="header-profile-label">基準時間</span>
          <TimeSelect
            className="header-profile-input header-time-select"
            value={workSettings.standardStartTime}
            onChange={(v) => handleWorkTimeChange('standardStartTime', v)}
            ariaLabel="基準出勤時間"
          />
          <span className="header-time-sep">〜</span>
          <TimeSelect
            className="header-profile-input header-time-select"
            value={workSettings.standardEndTime}
            onChange={(v) => handleWorkTimeChange('standardEndTime', v)}
            ariaLabel="基準退勤時間"
          />
        </div>
        <div className="header-profile">
          <label className="header-profile-label">社員番号</label>
          <input
            className="header-profile-input"
            type="text"
            value={userProfile.employeeId}
            onChange={(e) => handleProfileChange('employeeId', e.target.value)}
            placeholder="例: SS00"
          />
          <label className="header-profile-label">苗字</label>
          <input
            className="header-profile-input"
            type="text"
            value={userProfile.lastName}
            onChange={(e) => handleProfileChange('lastName', e.target.value)}
            placeholder="例: 佐藤"
          />
        </div>
      </header>

      <nav className="tab-nav">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${tab === t.key ? 'active' : ''}`}
            onClick={() => {
              if (t.key !== 'input') setEditingRecord(undefined);
              setTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === 'input' && (
          <AttendanceForm
            key={editingRecord?.id ?? 'new'}
            existingRecord={editingRecord}
            records={records}
            workSettings={workSettings}
            onSave={handleSave}
            onSaveMultiple={handleSaveMultiple}
            onCancel={editingRecord ? () => { setEditingRecord(undefined); setTab('list'); } : undefined}
          />
        )}
        {tab === 'list' && (
          <AttendanceList
            records={records}
            workSettings={workSettings}
            paidLeaveSettings={paidLeave}
            filterYear={listYear}
            filterMonth={listMonth}
            onFilterChange={(y, m) => { setListYear(y); setListMonth(m); }}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onSavePaidLeave={handleSavePaidLeave}
          />
        )}
        {tab === 'transport' && (
          <TransportTab
            records={transportRecords}
            attendanceRecords={records}
            onSave={handleSaveTransport}
            onSaveMultiple={handleSaveTransportMultiple}
            onDelete={handleDeleteTransport}
          />
        )}
        {tab === 'documents' && (
          <ApplicationDocumentsTab records={records} workSettings={workSettings} />
        )}
        {tab === 'skill' && (
          <SkillTab />
        )}
        {tab === 'report' && (
          <WorkReportTab />
        )}
        {tab === 'bulk' && (
          <BulkDownloadTab
            records={records}
            transportRecords={transportRecords}
            workSettings={workSettings}
            paidLeaveSettings={paidLeave}
          />
        )}
        {tab === 'csv' && (
          <CSVImport
            records={records}
            transportRecords={transportRecords}
            onImport={handleImport}
            onImportTransport={handleImportTransport}
          />
        )}
        {tab === 'transfer' && (
          <TransferTab
            records={records}
            transportRecords={transportRecords}
            onImport={handleImport}
            onImportTransport={handleImportTransport}
            workSettings={workSettings}
            userProfile={userProfile}
            paidLeaveSettings={paidLeave}
            onImportMeta={handleImportMeta}
          />
        )}
        {tab === 'settings' && (
          <WorkSettingsForm
            settings={workSettings}
            onClearAttendance={handleClearAttendance}
            onClearTransport={handleClearTransport}
            onClearAll={handleClearAll}
          />
        )}
      </main>
    </div>
  );
}
