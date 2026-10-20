import { Fragment, useState, useCallback } from 'react';
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
import TransferTab from './components/TransferTab';
import MonthStatus from './components/MonthStatus';
import Icon, { type IconName } from './components/Icon';
import type { TransferMeta } from './utils/transfer';
import { getSubmitStatus } from './utils/submitStatus';
import { saveName } from './utils/workReport';
import WorkSettingsForm from './components/WorkSettingsForm';
import TransportTab from './components/TransportTab';
import ApplicationDocumentsTab from './components/ApplicationDocumentsTab';
import WorkReportTab from './components/WorkReportTab';
import SkillTab from './components/SkillTab';
import BulkDownloadTab from './components/BulkDownloadTab';
import './App.css';

type Tab = 'input' | 'list' | 'transfer' | 'transport' | 'settings' | 'documents' | 'report' | 'skill' | 'bulk'
  // スマホの下タブ「提出」「その他」から開くメニュー画面
  | 'menu-submit' | 'menu-more';

type NavGroupId = 'daily' | 'submit' | 'more';

// 使う流れ（毎日 → 月末 → たまに）でメニューを分ける
const NAV_GROUPS: { id: NavGroupId; label: string; items: { key: Tab; label: string; icon: IconName; desc?: string }[] }[] = [
  {
    id: 'daily', label: '日々の入力', items: [
      { key: 'input', label: '勤怠入力', icon: 'pen' },
      { key: 'list', label: '勤怠一覧', icon: 'calendar' },
      { key: 'transport', label: '交通費', icon: 'train' },
    ],
  },
  {
    id: 'submit', label: '月末の提出', items: [
      { key: 'report', label: '作業報告', icon: 'report', desc: '週ごとの作業内容と月のまとめ' },
      { key: 'documents', label: '申請書類', icon: 'form', desc: '休暇申請書・遅刻早退申請書' },
      { key: 'skill', label: 'スキル表', icon: 'user', desc: 'スキル・資格・職務経歴' },
      { key: 'bulk', label: '一括ダウンロード', icon: 'download', desc: '提出書類をまとめてPDF出力' },
    ],
  },
  {
    id: 'more', label: 'その他', items: [
      { key: 'transfer', label: 'QR/カナコード', icon: 'qr', desc: '別の端末へデータを移す' },
      { key: 'settings', label: '設定', icon: 'settings', desc: '社員情報・基準時間・テーマ・データ削除' },
    ],
  },
];

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

  // 設定画面の基準時間は選択したその場で保存する
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

  // QR / カナコードで受け取った基準時間・社員番号・苗字・氏名を反映（含まれている項目のみ上書き）
  function handleImportMeta(meta: TransferMeta, year: number, month: number) {
    // 有給残日数は転送元の対象月の設定として保存する
    if (meta.paidLeaveDays !== undefined) {
      const existing = findPaidLeaveSetting(paidLeave, year, month);
      handleSavePaidLeave([...paidLeave.filter((s) => s !== existing), { year, month, totalDays: meta.paidLeaveDays }]);
    }
    if (meta.workSettings) handleSaveWorkSettings({ ...workSettings, ...meta.workSettings });
    if (meta.name) saveName(meta.name);
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

  function openTab(key: Tab) {
    if (key !== 'input') setEditingRecord(undefined);
    setTab(key);
    window.scrollTo(0, 0);
  }

  // 月末に提出する書類の入力状況（今月分）。未対応の件数をメニューに表示する
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const todayStr = `${thisYear}-${String(thisMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const submitItems = getSubmitStatus(thisYear, thisMonth, records, transportRecords, workSettings, todayStr);
  const pendingCount = submitItems.filter((i) => !i.done).length;

  const profileMissing = !userProfile.employeeId.trim() || !userProfile.lastName.trim();
  const groupOfTab = NAV_GROUPS.find((g) => g.items.some((i) => i.key === tab))?.id;

  function renderMenuList(groupId: NavGroupId) {
    const group = NAV_GROUPS.find((g) => g.id === groupId)!;
    return (
      <>
        <h2 className="page-title">{group.label}</h2>
        <nav className="menu-list" aria-label={group.label}>
          {group.items.map((item) => (
            <button key={item.key} type="button" className="menu-list-item" onClick={() => openTab(item.key)}>
              <Icon name={item.icon} size={20} />
              <span>
                {item.label}
                {item.desc && <span className="menu-list-desc">{item.desc}</span>}
              </span>
              <span className="menu-list-chevron"><Icon name="chevron" size={18} /></span>
            </button>
          ))}
        </nav>
      </>
    );
  }

  const bottomItems: { key: Tab; label: string; icon: IconName; active: boolean; count?: number }[] = [
    { key: 'input', label: '入力', icon: 'pen', active: tab === 'input' },
    { key: 'list', label: '一覧', icon: 'calendar', active: tab === 'list' },
    { key: 'transport', label: '交通費', icon: 'train', active: tab === 'transport' },
    { key: 'menu-submit', label: '提出', icon: 'download', active: tab === 'menu-submit' || groupOfTab === 'submit', count: pendingCount },
    { key: 'menu-more', label: 'その他', icon: 'more', active: tab === 'menu-more' || groupOfTab === 'more' },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-logo"><Icon name="clock" size={16} /></span>
          <h1>勤怠管理</h1>
        </div>
        <button type="button" className="header-user" onClick={() => openTab('settings')} aria-label="社員情報の設定">
          {profileMissing
            ? <span className="header-user-unset">社員情報 未設定</span>
            : <span>{userProfile.employeeId} {userProfile.lastName}</span>}
          <span className="header-avatar">{userProfile.lastName.trim().charAt(0) || <Icon name="user" size={16} />}</span>
        </button>
      </header>

      <div className="app-body">
        <nav className="side-nav" aria-label="メインメニュー">
          <div className="side-nav-inner">
            {NAV_GROUPS.map((group) => (
              <Fragment key={group.id}>
                <div className="nav-group-label">{group.label}</div>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`nav-item ${tab === item.key ? 'active' : ''}`}
                    aria-current={tab === item.key ? 'page' : undefined}
                    onClick={() => openTab(item.key)}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    {item.key === 'bulk' && pendingCount > 0 && <span className="nav-count">{pendingCount}件</span>}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        </nav>

      <main className="app-main">
        {profileMissing && tab !== 'settings' && (
          <div className="notice-banner" role="status">
            <Icon name="alert" />
            <span>社員番号・苗字が未設定です（PDFの出力に必要です）</span>
            <button type="button" className="btn-link" onClick={() => openTab('settings')}>設定する</button>
          </div>
        )}
        {tab === 'menu-submit' && renderMenuList('submit')}
        {tab === 'menu-more' && renderMenuList('more')}
        {tab === 'input' && (
          <div className="input-layout">
            <AttendanceForm
              key={editingRecord?.id ?? 'new'}
              existingRecord={editingRecord}
              records={records}
              workSettings={workSettings}
              onSave={handleSave}
              onSaveMultiple={handleSaveMultiple}
              onCancel={editingRecord ? () => { setEditingRecord(undefined); setTab('list'); } : undefined}
            />
            <MonthStatus
              year={thisYear}
              month={thisMonth}
              records={records}
              workSettings={workSettings}
              paidLeaveSettings={paidLeave}
              submitItems={submitItems}
              onOpenBulk={() => openTab('bulk')}
            />
          </div>
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
            userProfile={userProfile}
            onProfileChange={handleProfileChange}
            onWorkTimeChange={handleWorkTimeChange}
            onClearAttendance={handleClearAttendance}
            onClearTransport={handleClearTransport}
            onClearAll={handleClearAll}
          />
        )}
      </main>
      </div>

      <nav className="bottom-nav" aria-label="メインメニュー">
        {bottomItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`bottom-nav-item ${item.active ? 'active' : ''}`}
            aria-current={item.active ? 'page' : undefined}
            onClick={() => openTab(item.key)}
          >
            <Icon name={item.icon} size={22} />
            {item.label}
            {!!item.count && <span className="bottom-nav-count" aria-label={`未対応 ${item.count}件`}>{item.count}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
