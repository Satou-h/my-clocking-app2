import { useRef, useState } from 'react';
import type { AttendanceRecord } from '../types/attendance';
import { parseCSV, exportCSV } from '../utils/csv';

interface Props {
  records: AttendanceRecord[];
  onImport: (records: AttendanceRecord[], mode: 'merge' | 'replace') => void;
}

export default function CSVImport({ records, onImport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<AttendanceRecord[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseCSV(text);
      setPreview(result.records);
      setErrors(result.errors);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function handleImport() {
    if (!preview) return;
    onImport(preview, mode);
    setPreview(null);
    setErrors([]);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleExport() {
    const csv = exportCSV(records);
    const bom = '﻿';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `勤怠データ_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="csv-import">
      <h2>CSV 取り込み / エクスポート</h2>

      <div className="csv-section">
        <h3>CSVエクスポート</h3>
        <p className="hint">現在の全データをCSVファイルとしてダウンロードします。</p>
        <button className="btn btn-secondary" onClick={handleExport}>
          CSVダウンロード ({records.length}件)
        </button>
      </div>

      <hr />

      <div className="csv-section">
        <h3>CSVインポート</h3>
        <p className="hint">
          対応フォーマット（1行目はヘッダー行）:<br />
          <code>日付,種別,出勤時間,退勤時間,休憩(分),備考</code><br />
          日付形式: YYYY-MM-DD / 種別: 出勤・有給休暇・休日・欠勤
        </p>

        <div className="form-row">
          <label>取り込み方式</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}>
            <option value="merge">マージ（既存データに追加・上書き）</option>
            <option value="replace">置換（既存データをすべて削除して置き換え）</option>
          </select>
        </div>

        <div className="form-row">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} />
        </div>

        {errors.length > 0 && (
          <div className="csv-errors">
            <strong>エラー / 警告:</strong>
            <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        {preview && (
          <div className="csv-preview">
            <strong>プレビュー: {preview.length}件を取り込みます</strong>
            <table className="data-table preview-table">
              <thead>
                <tr><th>日付</th><th>種別</th><th>出勤</th><th>退勤</th><th>休憩(分)</th></tr>
              </thead>
              <tbody>
                {preview.slice(0, 10).map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.type}</td>
                    <td>{r.clockIn ?? '-'}</td>
                    <td>{r.clockOut ?? '-'}</td>
                    <td>{r.breakMinutes ?? 0}</td>
                  </tr>
                ))}
                {preview.length > 10 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>...他 {preview.length - 10} 件</td></tr>
                )}
              </tbody>
            </table>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleImport}>インポート実行</button>
              <button className="btn btn-secondary" onClick={() => { setPreview(null); setErrors([]); }}>キャンセル</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
