import { useState, useEffect } from 'react';
import { loadUserProfile } from '../utils/storage';
import { printWorkReport } from '../utils/pdf';
import type { WeekReportData } from '../utils/pdf';
import {
  WEEK_LABELS, EMPTY_WEEK, loadAllWeeks, saveAllWeeks, loadSummary, saveSummary, loadName, saveName, hasContent,
  transferWeek, transferMonth, weekHasData, monthHasData,
} from '../utils/workReport';

const CONDITIONS = ['', '◎', '○', '△', '×'];

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

  // 別の月・週への転記
  const [xferScope, setXferScope] = useState<'week' | 'month'>('week');
  const [xferMode, setXferMode] = useState<'copy' | 'move'>('copy');
  const [xferYear, setXferYear] = useState(currentYear);
  const [xferMonth, setXferMonth] = useState(currentMonth);
  const [xferWeek, setXferWeek] = useState(0);

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

  // 指定した月・週を表示し直す（同じ月のまま週だけ変わる場合もあるため、状態を直接読み込む）
  function showReport(y: number, m: number, week: number) {
    const loaded = loadAllWeeks(y, m);
    const s = loadSummary(y, m);
    setYear(y);
    setMonth(m);
    setSelectedWeek(week);
    setSavedWeeks(loaded);
    setForm({ ...loaded[week] });
    setMonthlySummary(s);
    setSummaryDraft(s);
  }

  function handleTransfer() {
    const isWeek = xferScope === 'week';
    const verb = xferMode === 'move' ? '移動' : 'コピー';
    const srcLabel = `${year}年${month}月${isWeek ? ` ${WEEK_LABELS[selectedWeek]}` : '（全週・総括）'}`;
    const dstLabel = `${xferYear}年${xferMonth}月${isWeek ? ` ${WEEK_LABELS[xferWeek]}` : ''}`;

    if (year === xferYear && month === xferMonth && (!isWeek || selectedWeek === xferWeek)) {
      alert('転記元と転記先が同じです。');
      return;
    }
    const srcHasData = isWeek ? hasContent(savedWeeks[selectedWeek]) : savedWeeks.some(hasContent) || monthlySummary.trim() !== '';
    if (!srcHasData) {
      alert(`${srcLabel}には保存済みの内容がありません。`);
      return;
    }
    // 転記は保存済みの内容で行う
    const unsaved = JSON.stringify(form) !== JSON.stringify(savedWeeks[selectedWeek]) || summaryDraft !== monthlySummary;
    if (unsaved && !window.confirm('保存していない変更があります。保存済みの内容で転記しますか？')) return;

    const dstHasData = isWeek
      ? weekHasData({ year: xferYear, month: xferMonth, week: xferWeek })
      : monthHasData(xferYear, xferMonth);
    const message = `${srcLabel} を ${dstLabel} に${verb}します。`
      + (dstHasData ? `\n\n${dstLabel}にはすでに内容があります。上書きしてよろしいですか？` : '')
      + (xferMode === 'move' ? `\n\n※ 移動すると ${srcLabel} の内容は空になります。` : '');
    if (!window.confirm(message)) return;

    if (isWeek) {
      transferWeek({ year, month, week: selectedWeek }, { year: xferYear, month: xferMonth, week: xferWeek }, xferMode === 'move');
    } else {
      transferMonth({ year, month }, { year: xferYear, month: xferMonth }, xferMode === 'move');
    }
    showReport(xferYear, xferMonth, isWeek ? xferWeek : 0);
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

      {/* 別の月・週への転記 */}
      <details className="work-report-transfer">
        <summary>別の月・週に転記</summary>
        <p className="hint">
          保存済みの内容を別の月・週へコピーまたは移動します。間違えて別の月に作成した場合は「移動」、同じ形式で別の月に作成したい場合は「コピー」を使ってください。
        </p>
        <div className="form-row">
          <label>転記する範囲</label>
          <div className="radio-group">
            <label><input type="radio" checked={xferScope === 'week'} onChange={() => setXferScope('week')} /> 表示中の週（{WEEK_LABELS[selectedWeek]}）</label>
            <label><input type="radio" checked={xferScope === 'month'} onChange={() => setXferScope('month')} /> 表示中の月すべて（全週・総括）</label>
          </div>
        </div>
        <div className="form-row">
          <label>転記先</label>
          <select value={xferYear} onChange={(e) => setXferYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={xferMonth} onChange={(e) => setXferMonth(Number(e.target.value))}>
            {months.map((m) => <option key={m} value={m}>{m}月</option>)}
          </select>
          {xferScope === 'week' && (
            <select value={xferWeek} onChange={(e) => setXferWeek(Number(e.target.value))}>
              {WEEK_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}
            </select>
          )}
        </div>
        <div className="form-row">
          <label>方法</label>
          <div className="radio-group">
            <label><input type="radio" checked={xferMode === 'copy'} onChange={() => setXferMode('copy')} /> コピー（元の内容を残す）</label>
            <label><input type="radio" checked={xferMode === 'move'} onChange={() => setXferMode('move')} /> 移動（元の内容を消す）</label>
          </div>
        </div>
        <div className="work-report-save-row">
          <button className="btn btn-secondary" onClick={handleTransfer}>転記する</button>
        </div>
      </details>

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
