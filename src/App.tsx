import { useState, useCallback } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from './types/attendance';
import type { TransportRecord } from './types/transport';
import {
  loadRecords, saveRecords,
  loadPaidLeaveSettings, savePaidLeaveSettings,
  loadWorkSettings, saveWorkSettings,
  loadTransportRecords, saveTransportRecords,
  loadUserProfile, saveUserProfile,
} from './utils/storage';
import AttendanceForm from './components/AttendanceForm';
import AttendanceList from './components/AttendanceList';
import CSVImport from './components/CSVImport';
import WorkSettingsForm from './components/WorkSettingsForm';
import TransportTab from './components/TransportTab';
import ApplicationDocumentsTab from './components/ApplicationDocumentsTab';
import WorkReportTab from './components/WorkReportTab';
import SkillTab from './components/SkillTab';
import BulkDownloadTab from './components/BulkDownloadTab';
import './App.css';

type Tab = 'input' | 'list' | 'csv' | 'transport' | 'settings' | 'documents' | 'report' | 'skill' | 'bulk';

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

  function handleImportTransport(imported: TransportRecord[], mode: 'merge' | 'replace') {
    if (mode === 'replace') {
      setTransportRecords(imported);
      saveTransportRecords(imported);
    } else {
      const next = [...transportRecords, ...imported];
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
    { key: 'csv', label: 'CSV' },
    { key: 'settings', label: '設定' },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <h1>勤怠管理</h1>
        <span className="header-sub">
          基準時間: {workSettings.standardStartTime} 〜 {workSettings.standardEndTime}
        </span>
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
        {tab === 'settings' && (
          <WorkSettingsForm
            settings={workSettings}
            onSave={handleSaveWorkSettings}
            onClearAttendance={handleClearAttendance}
            onClearTransport={handleClearTransport}
            onClearAll={handleClearAll}
          />
        )}
      </main>
    </div>
  );
}
