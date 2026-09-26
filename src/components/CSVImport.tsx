import { useRef, useState } from 'react';
import type { AttendanceRecord } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import type { WeekReportData } from '../utils/pdf';
import { parseCSV, exportCSV, parseTransportCSV, exportTransportCSV, exportWorkReportCSV, parseWorkReportCSV } from '../utils/csv';
import { loadAllWeeks, saveAllWeeks } from '../utils/workReport';
import { exportFullBackup, importFullBackup, parseBackupSummary, type BackupSummary } from '../utils/backup';

interface Props {
  records: AttendanceRecord[];
  transportRecords: TransportRecord[];
  onImport: (records: AttendanceRecord[], mode: 'merge' | 'replace') => void;
  onImportTransport: (records: TransportRecord[], mode: 'merge' | 'replace') => void;
}

export default function CSVImport({ records, transportRecords, onImport, onImportTransport }: Props) {
  // 勤怠
  const attFileRef = useRef<HTMLInputElement>(null);
  const [attPreview, setAttPreview] = useState<AttendanceRecord[] | null>(null);
  const [attErrors, setAttErrors] = useState<string[]>([]);
  const [attMode, setAttMode] = useState<'merge' | 'replace'>('merge');

  // 交通費
  const trpFileRef = useRef<HTMLInputElement>(null);
  const [trpPreview, setTrpPreview] = useState<TransportRecord[] | null>(null);
  const [trpErrors, setTrpErrors] = useState<string[]>([]);
  const [trpMode, setTrpMode] = useState<'merge' | 'replace'>('merge');

  // 作業報告
  const now = new Date();
  const [wrYear, setWrYear] = useState(now.getFullYear());
  const [wrMonth, setWrMonth] = useState(now.getMonth() + 1);
  const wrFileRef = useRef<HTMLInputElement>(null);
  const [wrPreview, setWrPreview] = useState<WeekReportData[] | null>(null);
  const [wrErrors, setWrErrors] = useState<string[]>([]);

  // ── 全データバックアップ ──
  const [backupCode, setBackupCode]           = useState('');
  const [backupCopied, setBackupCopied]       = useState(false);
  const [restoreInput, setRestoreInput]       = useState('');
  const [restorePreview, setRestorePreview]   = useState<BackupSummary | null>(null);
  const [restoreError, setRestoreError]       = useState('');

  // ── 勤怠 ──
  function handleAttFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseCSV(ev.target?.result as string);
      setAttPreview(result.records);
      setAttErrors(result.errors);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function handleAttImport() {
    if (!attPreview) return;
    onImport(attPreview, attMode);
    setAttPreview(null);
    setAttErrors([]);
    if (attFileRef.current) attFileRef.current.value = '';
  }

  function handleAttExport() {
    downloadCSV(exportCSV(records), `勤怠データ_${today()}.csv`);
  }

  // ── 交通費 ──
  function handleTrpFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseTransportCSV(ev.target?.result as string);
      setTrpPreview(result.records);
      setTrpErrors(result.errors);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function handleTrpImport() {
    if (!trpPreview) return;
    onImportTransport(trpPreview, trpMode);
    setTrpPreview(null);
    setTrpErrors([]);
    if (trpFileRef.current) trpFileRef.current.value = '';
  }

  function handleTrpExport() {
    downloadCSV(exportTransportCSV(transportRecords), `交通費データ_${today()}.csv`);
  }

  // ── 作業報告 ──
  function handleWrExport() {
    const weeks = loadAllWeeks(wrYear, wrMonth);
    downloadCSV(exportWorkReportCSV(weeks), `作業報告_${wrYear}${String(wrMonth).padStart(2, '0')}.csv`);
  }

  function handleWrFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseWorkReportCSV(ev.target?.result as string);
      setWrPreview(result.weeks);
      setWrErrors(result.errors);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function handleWrImport() {
    if (!wrPreview) return;
    saveAllWeeks(wrYear, wrMonth, wrPreview);
    setWrPreview(null);
    setWrErrors([]);
    if (wrFileRef.current) wrFileRef.current.value = '';
  }

  // ── バックアップ ──────────────────────────────────────────────────────────────
  function handleBackupExport() {
    const code = exportFullBackup();
    setBackupCode(code);
    setBackupCopied(false);
  }

  function handleBackupCopy() {
    if (!backupCode) return;
    navigator.clipboard?.writeText(backupCode).catch(() => {/* noop */});
    setBackupCopied(true);
    setTimeout(() => setBackupCopied(false), 2500);
  }

  function handleRestoreDecode() {
    const summary = parseBackupSummary(restoreInput);
    if (!summary) {
      setRestoreError('バックアップコードを解析できませんでした。コードが正確か確認してください。');
      setRestorePreview(null);
      return;
    }
    setRestorePreview(summary);
    setRestoreError('');
  }

  function handleRestoreApply() {
    const result = importFullBackup(restoreInput);
    if (!result.success) {
      setRestoreError(result.error ?? 'エラーが発生しました');
      return;
    }
    alert('データを復元しました。ページを再読み込みします。');
    window.location.reload();
  }

  return (
    <div className="csv-import">
      <h2>CSV 取り込み / エクスポート</h2>

      {/* ── 全データバックアップ ── */}
      <h3>全データバックアップ</h3>
      <p className="hint">
        勤怠・交通費・スキルデータ・申請書類・作業報告など、すべてのデータを1つのテキストコードに変換します。
        コードをコピーして別デバイスに貼り付けることで、PCとスマホ間のデータ移行が行えます。
      </p>

      <div className="csv-section">
        <h4>バックアップコードを生成（エクスポート）</h4>
        <p className="hint">現在のすべてのデータをテキストコードに変換します。</p>
        <button className="btn btn-secondary" onClick={handleBackupExport}>
          バックアップコードを生成
        </button>
        {backupCode && (
          <div className="jumon-display">
            <textarea className="jumon-text backup-code" readOnly rows={5} value={backupCode}
              onClick={e => (e.target as HTMLTextAreaElement).select()} />
            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-secondary" onClick={handleBackupCopy}>
                {backupCopied ? 'コピーしました ✓' : 'コードをコピー'}
              </button>
              <span className="hint" style={{ margin: 0 }}>{backupCode.length.toLocaleString()}文字</span>
            </div>
          </div>
        )}
      </div>

      <div className="csv-section">
        <h4>バックアップコードから復元（インポート）</h4>
        <p className="hint">
          別デバイスで生成したバックアップコードを貼り付けてください。
          内容を確認してから「復元する」を押すとすべてのデータが上書きされ、ページが再読み込みされます。
        </p>
        <textarea
          className="jumon-input"
          rows={5}
          placeholder="バックアップコードをここに貼り付け…"
          value={restoreInput}
          onChange={e => { setRestoreInput(e.target.value); setRestorePreview(null); setRestoreError(''); }}
        />
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={handleRestoreDecode} disabled={!restoreInput.trim()}>
            解析する
          </button>
        </div>
        {restoreError && <div className="csv-errors"><strong>{restoreError}</strong></div>}
        {restorePreview && (
          <div className="csv-preview">
            <strong>バックアップの内容:</strong>
            <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
              {restorePreview.timestamp > 0 && (
                <li>バックアップ日時: {new Date(restorePreview.timestamp).toLocaleString('ja-JP')}</li>
              )}
              <li>勤怠レコード: {restorePreview.attendance}件</li>
              <li>交通費レコード: {restorePreview.transport}件</li>
              <li>有給設定: {restorePreview.paidLeave}件</li>
              <li>スキルデータ: {restorePreview.skillEntries}件 / 資格: {restorePreview.certifications}件</li>
              <li>休暇申請: {restorePreview.leaveApps}件 / 遅刻早退申請: {restorePreview.lateEarlyApps}件</li>
              <li>作業報告: {restorePreview.workReportMonths}ヶ月分</li>
              <li>勤務設定: {restorePreview.hasWorkSettings ? 'あり' : 'なし'}</li>
              <li>社員情報: {restorePreview.hasProfile ? 'あり' : 'なし'}</li>
              <li>スキルプロフィール: {restorePreview.hasSkillProfile ? 'あり' : 'なし'}</li>
            </ul>
            <p style={{ color: 'var(--color-danger, #e55)', fontWeight: 600, marginTop: 8 }}>
              ⚠️ 現在のすべてのデータが上書きされます。この操作は元に戻せません。
            </p>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleRestoreApply}>復元する</button>
              <button className="btn btn-secondary" onClick={() => { setRestorePreview(null); setRestoreInput(''); }}>キャンセル</button>
            </div>
          </div>
        )}
      </div>

      <hr />

      {/* ── 勤怠 ── */}
      <h3>勤怠データ</h3>

      <div className="csv-section">
        <h4>エクスポート</h4>
        <p className="hint">現在の勤怠データをCSVとしてダウンロードします。</p>
        <button className="btn btn-secondary" onClick={handleAttExport}>
          CSVダウンロード ({records.length}件)
        </button>
      </div>

      <div className="csv-section">
        <h4>インポート</h4>
        <p className="hint">
          対応フォーマット（1行目はヘッダー行）:<br />
          <code>日付,種別,出勤時間,退勤時間,休憩(分),備考</code><br />
          種別: 出勤・有給休暇・休日・欠勤・午前休・午後休・所定休日出勤・法定休日出勤・振替休日出勤・振替休日
        </p>
        <div className="form-row">
          <label>取り込み方式</label>
          <select value={attMode} onChange={(e) => setAttMode(e.target.value as 'merge' | 'replace')}>
            <option value="merge">マージ（既存データに追加・上書き）</option>
            <option value="replace">置換（既存データをすべて削除して置き換え）</option>
          </select>
        </div>
        <div className="form-row">
          <input ref={attFileRef} type="file" accept=".csv,text/csv" onChange={handleAttFile} />
        </div>
        {attErrors.length > 0 && (
          <div className="csv-errors">
            <strong>エラー / 警告:</strong>
            <ul>{attErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        {attPreview && (
          <div className="csv-preview">
            <strong>プレビュー: {attPreview.length}件を取り込みます</strong>
            <table className="data-table preview-table">
              <thead>
                <tr><th>日付</th><th>種別</th><th>出勤</th><th>退勤</th><th>休憩(分)</th></tr>
              </thead>
              <tbody>
                {attPreview.slice(0, 10).map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td><td>{r.type}</td>
                    <td>{r.clockIn ?? '-'}</td><td>{r.clockOut ?? '-'}</td>
                    <td>{r.breakMinutes ?? 0}</td>
                  </tr>
                ))}
                {attPreview.length > 10 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>...他 {attPreview.length - 10} 件</td></tr>
                )}
              </tbody>
            </table>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleAttImport}>インポート実行</button>
              <button className="btn btn-secondary" onClick={() => { setAttPreview(null); setAttErrors([]); }}>キャンセル</button>
            </div>
          </div>
        )}
      </div>

      <hr />

      {/* ── 交通費 ── */}
      <h3>交通費データ</h3>

      <div className="csv-section">
        <h4>エクスポート</h4>
        <p className="hint">現在の交通費データをCSVとしてダウンロードします。</p>
        <button className="btn btn-secondary" onClick={handleTrpExport}>
          CSVダウンロード ({transportRecords.length}件)
        </button>
      </div>

      <div className="csv-section">
        <h4>インポート</h4>
        <p className="hint">
          対応フォーマット（1行目はヘッダー行）:<br />
          <code>日付,行先,出発地点,到着地点,往復片道,金額,備考</code><br />
          往復片道: 往復・片道　金額: 半角数字（¥記号・カンマ不要）
        </p>
        <div className="form-row">
          <label>取り込み方式</label>
          <select value={trpMode} onChange={(e) => setTrpMode(e.target.value as 'merge' | 'replace')}>
            <option value="merge">マージ（取り込む日付の交通費は置き換え、他の日は残す）</option>
            <option value="replace">置換（既存データをすべて削除して置き換え）</option>
          </select>
        </div>
        <div className="form-row">
          <input ref={trpFileRef} type="file" accept=".csv,text/csv" onChange={handleTrpFile} />
        </div>
        {trpErrors.length > 0 && (
          <div className="csv-errors">
            <strong>エラー / 警告:</strong>
            <ul>{trpErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        {trpPreview && (
          <div className="csv-preview">
            <strong>プレビュー: {trpPreview.length}件を取り込みます</strong>
            <table className="data-table preview-table">
              <thead>
                <tr><th>日付</th><th>行先</th><th>出発</th><th>到着</th><th>往復/片道</th><th>金額</th></tr>
              </thead>
              <tbody>
                {trpPreview.slice(0, 10).map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td><td>{r.destination}</td>
                    <td>{r.from || '-'}</td><td>{r.to || '-'}</td>
                    <td>{r.tripType === 'roundtrip' ? '往復' : '片道'}</td>
                    <td>¥{r.amount.toLocaleString()}</td>
                  </tr>
                ))}
                {trpPreview.length > 10 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#888' }}>...他 {trpPreview.length - 10} 件</td></tr>
                )}
              </tbody>
            </table>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleTrpImport}>インポート実行</button>
              <button className="btn btn-secondary" onClick={() => { setTrpPreview(null); setTrpErrors([]); }}>キャンセル</button>
            </div>
          </div>
        )}
      </div>
      <hr />

      {/* ── 作業報告 ── */}
      <h3>作業報告データ</h3>

      <div className="csv-section">
        <h4>エクスポート</h4>
        <div className="form-row">
          <label>対象年月</label>
          <select value={wrYear} onChange={(e) => setWrYear(Number(e.target.value))}>
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <select value={wrMonth} onChange={(e) => setWrMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}月</option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary" onClick={handleWrExport}>
          CSVダウンロード ({wrYear}年{wrMonth}月)
        </button>
      </div>

      <div className="csv-section">
        <h4>インポート</h4>
        <p className="hint">
          CSVをインポートすると選択した年月のデータが置き換わります。<br />
          <code>週,開発言語・ツール・作業工程,前半体調,前半理由,後半体調,後半理由,良かった点,悪かった点,その他(気づいた点)</code>
        </p>
        <div className="form-row">
          <input ref={wrFileRef} type="file" accept=".csv,text/csv" onChange={handleWrFile} />
        </div>
        {wrErrors.length > 0 && (
          <div className="csv-errors">
            <strong>エラー / 警告:</strong>
            <ul>{wrErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        {wrPreview && (
          <div className="csv-preview">
            <strong>プレビュー: {wrYear}年{wrMonth}月に取り込みます（5週分）</strong>
            <table className="data-table preview-table">
              <thead>
                <tr>
                  <th>週</th><th>開発言語・ツール・作業工程</th><th>前半体調/理由</th><th>後半体調/理由</th>
                  <th>良かった点</th><th>悪かった点</th><th>その他</th>
                </tr>
              </thead>
              <tbody>
                {wrPreview.map((w, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {['第一週','第二週','第三週','第四週','第五週'][i]}
                    </td>
                    <td>{w.tools || '-'}</td>
                    <td>{w.conditionFirst}{w.reasonFirst ? ` ${w.reasonFirst}` : ''}</td>
                    <td>{w.conditionSecond}{w.reasonSecond ? ` ${w.reasonSecond}` : ''}</td>
                    <td>{w.goodPoints || '-'}</td>
                    <td>{w.badPoints || '-'}</td>
                    <td>{w.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleWrImport}>インポート実行</button>
              <button className="btn btn-secondary" onClick={() => { setWrPreview(null); setWrErrors([]); }}>キャンセル</button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

function today() { return new Date().toISOString().slice(0, 10); }

function downloadCSV(csv: string, filename: string) {
  const bom = '﻿';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
