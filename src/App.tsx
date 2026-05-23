import { useState, useCallback } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from './types/attendance';
import type { TransportRecord } from './types/transport';
import {
  loadRecords, saveRecords,
  loadPaidLeaveSettings, savePaidLeaveSettings,
  loadWorkSettings, saveWorkSettings,
  loadTransportRecords, saveTransportRecords,
} from './utils/storage';
import AttendanceForm from './components/AttendanceForm';
import AttendanceList from './components/AttendanceList';
import PaidLeaveManager from './components/PaidLeaveManager';
import CSVImport from './components/CSVImport';
import WorkSettingsForm from './components/WorkSettingsForm';
import TransportTab from './components/TransportTab';
import './App.css';

type Tab = 'input' | 'list' | 'paid_leave' | 'csv' | 'transport' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('input');
  const [records, setRecords] = useState<AttendanceRecord[]>(loadRecords);
  const [paidLeave, setPaidLeave] = useState<PaidLeaveSettings[]>(loadPaidLeaveSettings);
  const [workSettings, setWorkSettings] = useState<WorkSettings>(loadWorkSettings);
  const [transportRecords, setTransportRecords] = useState<TransportRecord[]>(loadTransportRecords);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | undefined>();

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

  function handleSaveTransport(record: TransportRecord) {
    const exists = transportRecords.some((r) => r.id === record.id);
    const next = exists
      ? transportRecords.map((r) => r.id === record.id ? record : r)
      : [...transportRecords, record];
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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'input', label: '勤怠入力' },
    { key: 'list', label: '勤怠一覧' },
    { key: 'paid_leave', label: '有給管理' },
    { key: 'transport', label: '交通費' },
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
            workSettings={workSettings}
            onSave={handleSave}
            onCancel={editingRecord ? () => { setEditingRecord(undefined); setTab('list'); } : undefined}
          />
        )}
        {tab === 'list' && (
          <AttendanceList
            records={records}
            workSettings={workSettings}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
        {tab === 'paid_leave' && (
          <PaidLeaveManager records={records} settings={paidLeave} onSaveSettings={handleSavePaidLeave} />
        )}
        {tab === 'transport' && (
          <TransportTab
            records={transportRecords}
            attendanceRecords={records}
            onSave={handleSaveTransport}
            onDelete={handleDeleteTransport}
          />
        )}
        {tab === 'csv' && (
          <CSVImport records={records} onImport={handleImport} />
        )}
        {tab === 'settings' && (
          <WorkSettingsForm settings={workSettings} onSave={handleSaveWorkSettings} />
        )}
      </main>
    </div>
  );
}
