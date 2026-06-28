import { useState, useEffect } from 'react';
import { loadUserProfile } from '../utils/storage';
import { printWorkReport } from '../utils/pdf';
import type { WeekReportData } from '../utils/pdf';

const WEEK_LABELS = ['第一週', '第二週', '第三週', '第四週', '第五週'];
const CONDITIONS = ['', '◎', '○', '△', '×'];

const EMPTY_WEEK: WeekReportData = {
  tools: '',
  conditionFirst: '○',
  reasonFirst: '',
  conditionSecond: '○',
  reasonSecond: '',
  goodPoints: '',
  badPoints: '',
  notes: '',
};

export function workReportKey(year: number, month: number) {
  return `clocking_work_report_${year}_${String(month).padStart(2, '0')}`;
}

function summaryKey(year: number, month: number) {
  return `clocking_work_report_summary_${year}_${String(month).padStart(2, '0')}`;
}

function migrateWeek(w: Record<string, string>): WeekReportData {
  return {
    tools:           w.tools           ?? '',
    conditionFirst:  w.conditionFirst  ?? (w.condition ? '○' : '○'),
    reasonFirst:     w.reasonFirst     ?? (w.condition ?? ''),
    conditionSecond: w.conditionSecond ?? '○',
    reasonSecond:    w.reasonSecond    ?? '',
    goodPoints:      w.goodPoints      ?? '',
    badPoints:       w.badPoints       ?? '',
    notes:           w.notes           ?? '',
  };
}

export function loadAllWeeks(year: number, month: number): WeekReportData[] {
  try {
    const raw = localStorage.getItem(workReportKey(year, month));
    if (!raw) return WEEK_LABELS.map(() => ({ ...EMPTY_WEEK }));
    const parsed = JSON.parse(raw);
    return (parsed as Record<string, string>[]).map(migrateWeek);
  } catch {
    return WEEK_LABELS.map(() => ({ ...EMPTY_WEEK }));
  }
}

export function saveAllWeeks(year: number, month: number, weeks: WeekReportData[]) {
  localStorage.setItem(workReportKey(year, month), JSON.stringify(weeks));
}

function loadSummary(year: number, month: number): string {
  return localStorage.getItem(summaryKey(year, month)) ?? '';
}

function saveSummary(year: number, month: number, text: string) {
  localStorage.setItem(summaryKey(year, month), text);
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
  return w.tools.trim() !== '' || w.goodPoints.trim() !== '' || w.badPoints.trim() !== '' ||
    w.notes.trim() !== '' || w.reasonFirst.trim() !== '' || w.reasonSecond.trim() !== '';
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
  const [summaryDraft, setSummaryDraft] = useState(() => loadSummary(currentYear, currentMonth));
  const [monthlySummary, setMonthlySummary] = useState(() => loadSummary(currentYear, currentMonth));

  useEffect(() => {
    const loaded = loadAllWeeks(year, month);
    setSavedWeeks(loaded);
    setForm({ ...loaded[selectedWeek] });
    const s = loadSummary(year, month);
    setMonthlySummary(s);
    setSummaryDraft(s);
  }, [year, month]);

  function handleWeekSelect(index: number) {
    setSelectedWeek(index);
    setForm({ ...savedWeeks[index] });
  }

  function updateField<K extends keyof WeekReportData>(field: K, value: string) {
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

  function handleSaveSummary() {
    saveSummary(year, month, summaryDraft);
    setMonthlySummary(summaryDraft);
  }

  function handlePrint() {
    const { employeeId, lastName } = loadUserProfile();
    if (!employeeId || !lastName) {
      alert('画面上部に社員番号と苗字を入力してください。');
      return;
    }
    printWorkReport(year, month, name, savedWeeks, employeeId, lastName, monthlySummary);
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

        <div className="form-row">
          <label>開発言語/ツール/作業工程</label>
          <textarea
            value={form.tools}
            onChange={(e) => updateField('tools', e.target.value)}
            rows={3}
            placeholder="例: Java、TypeScript&#10;Git&#10;VSCODE、A5SQL"
          />
        </div>

        <div className="wr-half-section">
          <div className="wr-half-label">前半</div>
          <div className="wr-half-fields">
            <div className="form-row">
              <label>体調</label>
              <select value={form.conditionFirst} onChange={(e) => updateField('conditionFirst', e.target.value)}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{c || '（未選択）'}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>理由</label>
              <input
                type="text"
                value={form.reasonFirst}
                onChange={(e) => updateField('reasonFirst', e.target.value)}
                placeholder="例: 特に問題なし"
              />
            </div>
          </div>
        </div>

        <div className="wr-half-section">
          <div className="wr-half-label">後半</div>
          <div className="wr-half-fields">
            <div className="form-row">
              <label>体調</label>
              <select value={form.conditionSecond} onChange={(e) => updateField('conditionSecond', e.target.value)}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{c || '（未選択）'}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>理由</label>
              <input
                type="text"
                value={form.reasonSecond}
                onChange={(e) => updateField('reasonSecond', e.target.value)}
                placeholder="例: 特に問題なし"
              />
            </div>
          </div>
        </div>

        <div className="form-row">
          <label>良かった点</label>
          <textarea
            value={form.goodPoints}
            onChange={(e) => updateField('goodPoints', e.target.value)}
            rows={2}
          />
        </div>
        <div className="form-row">
          <label>悪かった点</label>
          <textarea
            value={form.badPoints}
            onChange={(e) => updateField('badPoints', e.target.value)}
            rows={2}
          />
        </div>
        <div className="form-row">
          <label>その他（気づいた点等）</label>
          <textarea
            value={form.notes}
            onChange={(e) => updateField('notes', e.target.value)}
            rows={2}
          />
        </div>

        <div className="work-report-save-row">
          <button className="btn btn-primary" onClick={handleSave}>保存</button>
        </div>
      </div>

      {/* 総括欄 */}
      <div className="work-report-summary-section">
        <h3 className="work-report-summary-title">総括欄（今月のまとめ）</h3>
        <textarea
          className="work-report-summary-textarea"
          value={summaryDraft}
          onChange={(e) => setSummaryDraft(e.target.value)}
          rows={4}
          placeholder="今月全体のまとめ・振り返りを記述してください"
        />
        <div className="work-report-save-row">
          <button className="btn btn-primary" onClick={handleSaveSummary}>総括を保存</button>
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
                    {w.tools.trim() && (
                      <tr><th>開発言語/ツール/作業工程</th><td>{w.tools.split('\n').map((l, j) => <span key={j}>{l}<br /></span>)}</td></tr>
                    )}
                    <tr>
                      <th>前半 体調 / 理由</th>
                      <td>{w.conditionFirst}{w.reasonFirst ? `　${w.reasonFirst}` : ''}</td>
                    </tr>
                    <tr>
                      <th>後半 体調 / 理由</th>
                      <td>{w.conditionSecond}{w.reasonSecond ? `　${w.reasonSecond}` : ''}</td>
                    </tr>
                    {w.goodPoints.trim() && (
                      <tr><th>良かった点</th><td>{w.goodPoints.split('\n').map((l, j) => <span key={j}>{l}<br /></span>)}</td></tr>
                    )}
                    {w.badPoints.trim() && (
                      <tr><th>悪かった点</th><td>{w.badPoints.split('\n').map((l, j) => <span key={j}>{l}<br /></span>)}</td></tr>
                    )}
                    {w.notes.trim() && (
                      <tr><th>その他</th><td>{w.notes.split('\n').map((l, j) => <span key={j}>{l}<br /></span>)}</td></tr>
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
