import { useState, useEffect } from 'react';
import { loadUserProfile } from '../utils/storage';
import { printWorkReport } from '../utils/pdf';
import type { WeekReportData } from '../utils/pdf';

const WEEK_LABELS = ['第一週', '第二週', '第三週', '第四週', '第五週'];

const FIELD_LABELS: { key: keyof WeekReportData; label: string }[] = [
  { key: 'tools',      label: '開発言語・ツール・作業工程' },
  { key: 'condition',  label: '体調と理由' },
  { key: 'goodPoints', label: '良かった点' },
  { key: 'badPoints',  label: '悪かった点' },
  { key: 'notes',      label: 'その他(気づいた点)' },
];

const EMPTY_WEEK: WeekReportData = {
  tools: '', condition: '', goodPoints: '', badPoints: '', notes: '',
};

export function workReportKey(year: number, month: number) {
  return `clocking_work_report_${year}_${String(month).padStart(2, '0')}`;
}

export function loadAllWeeks(year: number, month: number): WeekReportData[] {
  try {
    const raw = localStorage.getItem(workReportKey(year, month));
    return raw ? JSON.parse(raw) : WEEK_LABELS.map(() => ({ ...EMPTY_WEEK }));
  } catch {
    return WEEK_LABELS.map(() => ({ ...EMPTY_WEEK }));
  }
}

export function saveAllWeeks(year: number, month: number, weeks: WeekReportData[]) {
  localStorage.setItem(workReportKey(year, month), JSON.stringify(weeks));
}

function loadName(): string {
  try {
    const raw = localStorage.getItem('clocking_leave_app_settings');
    return raw ? (JSON.parse(raw).name ?? '') : '';
  } catch { return ''; }
}

function saveName(name: string) {
  try {
    const raw = localStorage.getItem('clocking_leave_app_settings');
    const settings = raw ? JSON.parse(raw) : {};
    localStorage.setItem('clocking_leave_app_settings', JSON.stringify({ ...settings, name }));
  } catch {}
}

function hasContent(w: WeekReportData) {
  return Object.values(w).some((v) => v.trim() !== '');
}

export default function WorkReportTab() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [form, setForm] = useState<WeekReportData>({ ...EMPTY_WEEK });
  const [savedWeeks, setSavedWeeks] = useState<WeekReportData[]>(() => loadAllWeeks(currentYear, currentMonth));
  const [name, setName] = useState(loadName);

  useEffect(() => {
    const loaded = loadAllWeeks(year, month);
    setSavedWeeks(loaded);
    setForm({ ...loaded[selectedWeek] });
  }, [year, month]);

  function handleWeekSelect(index: number) {
    setSelectedWeek(index);
    setForm({ ...savedWeeks[index] });
  }

  function updateField(field: keyof WeekReportData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    const next = savedWeeks.map((w, i) => i === selectedWeek ? { ...form } : w);
    setSavedWeeks(next);
    saveAllWeeks(year, month, next);
  }

  function handleNameChange(value: string) {
    setName(value);
    saveName(value);
  }

  function handlePrint() {
    const { employeeId, lastName } = loadUserProfile();
    if (!employeeId || !lastName) {
      alert('画面上部に社員番号と苗字を入力してください。');
      return;
    }
    printWorkReport(year, month, name, savedWeeks, employeeId, lastName);
  }

  const years = [currentYear - 1, currentYear, currentYear + 1];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="work-report-tab">

      {/* ツールバー */}
      <div className="work-report-toolbar">
        <div className="form-row">
          <label>氏名</label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="氏名"
          />
        </div>
        <div className="form-row">
          <label>対象年月</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {months.map((m) => <option key={m} value={m}>{m}月</option>)}
          </select>
        </div>
        <button className="btn btn-pdf" onClick={handlePrint}>PDF出力</button>
      </div>

      {/* 週選択タブ */}
      <div className="week-tab-nav">
        {WEEK_LABELS.map((label, i) => (
          <button
            key={i}
            className={`week-tab-btn ${selectedWeek === i ? 'active' : ''} ${hasContent(savedWeeks[i]) ? 'has-data' : ''}`}
            onClick={() => handleWeekSelect(i)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 入力フォーム */}
      <div className="work-report-week">
        <h3 className="work-report-week-title">{WEEK_LABELS[selectedWeek]}</h3>
        {FIELD_LABELS.map(({ key, label }) => (
          <div className="form-row" key={key}>
            <label>{label}</label>
            <textarea
              value={form[key]}
              onChange={(e) => updateField(key, e.target.value)}
              rows={2}
            />
          </div>
        ))}
        <div className="work-report-save-row">
          <button className="btn btn-primary" onClick={handleSave}>保存</button>
        </div>
      </div>

      {/* 保存済みプレビュー */}
      {savedWeeks.some(hasContent) && (
        <div className="work-report-preview">
          <h3 className="work-report-preview-title">保存済み内容</h3>
          {savedWeeks.map((w, i) =>
            hasContent(w) ? (
              <div key={i} className="work-report-preview-week">
                <div className="work-report-preview-week-header">{WEEK_LABELS[i]}</div>
                <table className="work-report-preview-table">
                  <tbody>
                    {FIELD_LABELS.map(({ key, label }) =>
                      w[key].trim() ? (
                        <tr key={key}>
                          <th>{label}</th>
                          <td>{w[key].split('\n').map((line, j) => (
                            <span key={j}>{line}<br /></span>
                          ))}</td>
                        </tr>
                      ) : null
                    )}
                  </tbody>
                </table>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
