import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  encodeMonth, decodeMonth, encodeQR, decodeQR, bytesToJumon, jumonToBytes, formatJumon,
  type TransferMeta, type TransferDocs,
} from '../utils/transfer';
import {
  findPaidLeaveSetting, loadLeaveApplications, loadLateEarlyApplications,
  loadSkillProfile, loadSkillEntries, loadCertifications, loadWorkHistory,
  importApplications, importSkillSheet, type UserProfile,
} from '../utils/storage';
import { WEEK_LABELS, loadAllWeeks, loadSummary, loadName, importWorkReport } from '../utils/workReport';
import Icon from './Icon';

interface Props {
  records: AttendanceRecord[];
  transportRecords: TransportRecord[];
  onImport: (records: AttendanceRecord[]) => void;
  onImportTransport: (records: TransportRecord[]) => void;
  workSettings: WorkSettings;
  userProfile: UserProfile;
  paidLeaveSettings: PaidLeaveSettings[];
  onImportMeta: (meta: TransferMeta, year: number, month: number) => void;
}

// QR / カナコードで読み込んだ付加情報（基準時間・有給残日数）の確認表示と取り込み選択
// 社員番号・苗字・氏名もコードに含まれるが、管理者が「ユーザー管理」で設定するものなので取り込まない
function TransferMetaPreview({ meta, month, apply, onApplyChange }: {
  meta?: TransferMeta; month: number; apply: boolean; onApplyChange: (v: boolean) => void;
}) {
  if (!meta || (!meta.workSettings && meta.paidLeaveDays === undefined)) return null;
  return (
    <div className="my-8">
      <ul className="bullet-list">
        {meta.workSettings && <li>基準時間: {meta.workSettings.standardStartTime} ～ {meta.workSettings.standardEndTime}</li>}
        {meta.paidLeaveDays !== undefined && <li>{month}月 月初の有給残日数: {meta.paidLeaveDays}日</li>}
      </ul>
      <label className="range-toggle">
        <input type="checkbox" checked={apply} onChange={(e) => onApplyChange(e.target.checked)} />
        基準時間・有給残日数も取り込む（現在の設定を上書きします）
      </label>
    </div>
  );
}

type DocKey = keyof TransferDocs;
const APPLY_ALL_DOCS: Record<DocKey, boolean> = { workReport: true, applications: true, skillSheet: true };

// エクスポートで含める内容（基準時間・社員番号などの付加情報は常に含める）
type ExportKey = 'attendance' | 'transport' | DocKey;
const EXPORT_ITEMS: { key: ExportKey; label: string }[] = [
  { key: 'attendance', label: '勤怠' },
  { key: 'transport', label: '交通費' },
  { key: 'workReport', label: '作業報告書' },
  { key: 'applications', label: '申請書類' },
  { key: 'skillSheet', label: 'スキル表' },
];
const INCLUDE_ALL: Record<ExportKey, boolean> = {
  attendance: true, transport: true, workReport: true, applications: true, skillSheet: true,
};

// QR / カナコードで読み込んだ提出書類（作業報告書・申請書類・スキル表）の確認表示と取り込み選択
function TransferDocsPreview({ docs, month, oldFormat, apply, onApplyChange }: {
  docs: TransferDocs; month: number; oldFormat: boolean;
  apply: Record<DocKey, boolean>; onApplyChange: (v: Record<DocKey, boolean>) => void;
}) {
  const { workReport, applications, skillSheet } = docs;
  const toggle = (key: DocKey, label: string) => (
    <label className="range-toggle">
      <input type="checkbox" checked={apply[key]} onChange={(e) => onApplyChange({ ...apply, [key]: e.target.checked })} />
      {label}
    </label>
  );
  const reportParts = workReport ? [
    ...WEEK_LABELS.filter((_, i) => workReport.weeks[i]),
    ...(workReport.summary.trim() ? ['総括'] : []),
  ] : [];
  return (
    <>
      {oldFormat && (
        <div className="notice-banner my-8" role="status">
          <Icon name="alert" />
          <span>
            このコードは古い版のアプリで作られたため、勤務区分（帰社）などの一部の内容が含まれていません。
            送る側でページを再読み込み（アプリを開き直し）してから、コードを作り直してください。
          </span>
        </div>
      )}
      {workReport && (
        <div className="my-8">
          <ul className="bullet-list">
            <li>作業報告書: {reportParts.join('・')}</li>
          </ul>
          {toggle('workReport', `作業報告書も取り込む（${month}月の受け取った週と総括を上書きし、ほかの週は残します）`)}
        </div>
      )}
      {applications && (
        <div className="my-8">
          <ul className="bullet-list">
            <li>申請書類: 休暇申請 {applications.leave.length}件・遅刻早退申請 {applications.lateEarly.length}件</li>
          </ul>
          {toggle('applications', `申請書類も取り込む（${month}月の同じ日付の申請を上書きし、ほかの申請は残します）`)}
        </div>
      )}
      {skillSheet && (
        <div className="my-8">
          <ul className="bullet-list">
            <li>
              スキル表: スキル {skillSheet.skills.length}件・資格 {skillSheet.certifications.length}件・職務経歴 {skillSheet.workHistory.length}件
            </li>
          </ul>
          {toggle('skillSheet', 'スキル表も取り込む（プロフィールと同じ項目を上書きし、ほかのスキル・資格・職務経歴は残します）')}
        </div>
      )}
    </>
  );
}

// 読み込んだ提出書類のうち、取り込みを選んだものを保存する（上書きだけで、既存のデータをまとめて消すことはしない）
function importDocs(docs: TransferDocs, apply: Record<DocKey, boolean>, year: number, month: number) {
  if (docs.workReport && apply.workReport) importWorkReport(year, month, docs.workReport);
  if (docs.applications && apply.applications) importApplications(docs.applications);
  if (docs.skillSheet && apply.skillSheet) importSkillSheet(docs.skillSheet);
}

// 取り込みは上書き（マージ）だけ。既存のデータをすべて消して置き換える取り込みはできない
const IMPORT_HINT = '取り込む日付のデータは上書きし、ほかの日のデータはそのまま残します。';

// QRコード / カナコードで別デバイスとデータをやり取りするタブ
export default function TransferTab({
  records, transportRecords, onImport, onImportTransport, workSettings, userProfile, paidLeaveSettings, onImportMeta,
}: Props) {
  // 転送する付加情報（有給残日数は対象月の月初の設定値）
  const metaForMonth = (year: number, month: number): TransferMeta => ({
    workSettings,
    employeeId: userProfile.employeeId,
    lastName: userProfile.lastName,
    paidLeaveDays: findPaidLeaveSetting(paidLeaveSettings, year, month)?.totalDays,
    name: loadName(),
  });
  // 転送する提出書類（「含める内容」で選んだもののみ。申請書類は対象月の日付を含むもの。スキル表は月に関係なく全体）
  const docsForMonth = (year: number, month: number): TransferDocs => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return {
      workReport: include.workReport ? { weeks: loadAllWeeks(year, month), summary: loadSummary(year, month) } : undefined,
      applications: include.applications ? {
        leave: loadLeaveApplications().filter((b) => b.dateEntries.some((e) => e.date.startsWith(prefix))),
        lateEarly: loadLateEarlyApplications().filter((r) => r.targetDate.startsWith(prefix)),
      } : undefined,
      skillSheet: include.skillSheet ? {
        profile: loadSkillProfile(), skills: loadSkillEntries(),
        certifications: loadCertifications(), workHistory: loadWorkHistory(),
      } : undefined,
    };
  };

  // ── QR / カナコード ──
  const nowX = new Date();
  const [xferYear, setXferYear]   = useState(nowX.getFullYear());
  const [xferMonth, setXferMonth] = useState(nowX.getMonth() + 1);
  // すべて含めるとQRコードに収まらないことがあるため、含める内容を選んで分けて転送できるようにする
  const [include, setInclude] = useState(INCLUDE_ALL);
  // QR export
  const [qrDataUrl, setQrDataUrl]       = useState<string | null>(null);
  const [qrGenerating, setQrGenerating] = useState(false);
  // QR import
  const [qrScanMode, setQrScanMode]     = useState<'none' | 'camera' | 'file'>('none');
  const qrFileRef                        = useRef<HTMLInputElement>(null);
  const [qrImportAtt, setQrImportAtt]   = useState<AttendanceRecord[] | null>(null);
  const [qrImportTrp, setQrImportTrp]   = useState<TransportRecord[] | null>(null);
  const [qrImportInfo, setQrImportInfo] = useState<{ year: number; month: number; oldFormat: boolean } | null>(null);
  const [qrImportMeta, setQrImportMeta] = useState<TransferMeta | undefined>();
  const [qrApplyMeta, setQrApplyMeta]   = useState(true);
  const [qrImportDocs, setQrImportDocs] = useState<TransferDocs>({});
  const [qrApplyDocs, setQrApplyDocs]   = useState(APPLY_ALL_DOCS);
  const [qrError, setQrError]           = useState('');
  // カナコード export
  const [jumonStr, setJumonStr]         = useState('');
  // カナコード import
  const [jumonInput, setJumonInput]         = useState('');
  const [jumonImportAtt, setJumonImportAtt] = useState<AttendanceRecord[] | null>(null);
  const [jumonImportTrp, setJumonImportTrp] = useState<TransportRecord[]>([]);
  const [jumonImportInfo, setJumonImportInfo] = useState<{ year: number; month: number; oldFormat: boolean } | null>(null);
  const [jumonImportMeta, setJumonImportMeta] = useState<TransferMeta | undefined>();
  const [jumonApplyMeta, setJumonApplyMeta]   = useState(true);
  const [jumonImportDocs, setJumonImportDocs] = useState<TransferDocs>({});
  const [jumonApplyDocs, setJumonApplyDocs]   = useState(APPLY_ALL_DOCS);
  const [jumonError, setJumonError]     = useState('');

  // ── QR ──────────────────────────────────────────────────────────────────────
  async function handleQrGenerate() {
    setQrGenerating(true); setQrError('');
    try {
      const text = encodeQR(
        include.attendance ? records : [], include.transport ? transportRecords : [],
        xferYear, xferMonth, metaForMonth(xferYear, xferMonth), docsForMonth(xferYear, xferMonth),
      );
      const url  = await QRCode.toDataURL(text, { errorCorrectionLevel: 'L', margin: 2, width: 300 });
      setQrDataUrl(url);
    } catch (e) {
      const tooBig = /too big|amount of data/i.test(String(e));
      setQrError(tooBig
        ? 'データ量が多すぎてQRコードに収まりません。「含める内容」のチェックを減らして何回かに分けて転送するか、カナコードをご利用ください。'
        : 'QRコードの生成に失敗しました: ' + String(e));
    } finally {
      setQrGenerating(false);
    }
  }

  const handleQrDecoded = useCallback((text: string) => {
    setQrScanMode('none');
    const result = decodeQR(text);
    if (!result) { setQrError('QRコードのデータを解析できませんでした。'); return; }
    setQrImportAtt(result.att);
    setQrImportTrp(result.trp);
    setQrImportInfo({ year: result.year, month: result.month, oldFormat: result.oldFormat });
    setQrImportMeta(result.meta);
    setQrApplyMeta(true);
    setQrImportDocs(result.docs ?? {});
    setQrApplyDocs(APPLY_ALL_DOCS);
    setQrError('');
  }, []);

  function handleQrImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(objUrl); return; }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      URL.revokeObjectURL(objUrl);
      if (code) handleQrDecoded(code.data);
      else setQrError('QRコードを認識できませんでした。鮮明な画像を使用してください。');
    };
    img.src = objUrl;
    if (qrFileRef.current) qrFileRef.current.value = '';
  }

  function handleQrImport() {
    if (!qrImportAtt) return;
    if (qrImportAtt.length > 0)           onImport(qrImportAtt);
    if (qrImportTrp && qrImportTrp.length > 0) onImportTransport(qrImportTrp);
    if (qrImportMeta && qrApplyMeta && qrImportInfo) onImportMeta(qrImportMeta, qrImportInfo.year, qrImportInfo.month);
    if (qrImportInfo) importDocs(qrImportDocs, qrApplyDocs, qrImportInfo.year, qrImportInfo.month);
    setQrImportAtt(null); setQrImportTrp(null); setQrImportInfo(null);
  }

  // ── カナコード ────────────────────────────────────────────────────────────
  function handleJumonGenerate() {
    const bytes = encodeMonth(
      include.attendance ? records : [], include.transport ? transportRecords : [],
      xferYear, xferMonth, metaForMonth(xferYear, xferMonth), docsForMonth(xferYear, xferMonth),
    );
    setJumonStr(formatJumon(bytesToJumon(bytes)));
    setJumonError('');
  }

  function handleJumonDecode() {
    const bytes = jumonToBytes(jumonInput);
    if (!bytes) { setJumonError('カナコードを解析できませんでした。正確に入力されているか確認してください。'); return; }
    const result = decodeMonth(bytes);
    if (!result) { setJumonError('カナコードのバージョンが不正です。'); return; }
    setJumonImportAtt(result.records);
    setJumonImportTrp(result.transportRecords);
    setJumonImportInfo({ year: result.year, month: result.month, oldFormat: result.oldFormat });
    setJumonImportMeta(result.meta);
    setJumonApplyMeta(true);
    setJumonImportDocs(result.docs ?? {});
    setJumonApplyDocs(APPLY_ALL_DOCS);
    setJumonError('');
  }

  function handleJumonImport() {
    if (!jumonImportAtt) return;
    if (jumonImportAtt.length > 0) onImport(jumonImportAtt);
    if (jumonImportTrp.length > 0)  onImportTransport(jumonImportTrp);
    if (jumonImportMeta && jumonApplyMeta && jumonImportInfo) onImportMeta(jumonImportMeta, jumonImportInfo.year, jumonImportInfo.month);
    if (jumonImportInfo) importDocs(jumonImportDocs, jumonApplyDocs, jumonImportInfo.year, jumonImportInfo.month);
    setJumonImportAtt(null); setJumonImportInfo(null); setJumonInput('');
  }

  return (
    <div className="csv-import">
      <h2>QR / カナコード転送</h2>

      {/* ── QRコード転送 ── */}
      <h3>QRコード転送</h3>
      <p className="hint">1ヶ月分の勤怠＋交通費＋作業報告書・申請書類・スキル表と、基準時間・有給残日数をQRコードで別デバイスに転送します。</p>

      <div className="form-row">
        <label>対象年月</label>
        <select value={xferYear} onChange={e => { setXferYear(Number(e.target.value)); setQrDataUrl(null); setJumonStr(''); }}>
          {[nowX.getFullYear()-1, nowX.getFullYear(), nowX.getFullYear()+1].map(y =>
            <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={xferMonth} onChange={e => { setXferMonth(Number(e.target.value)); setQrDataUrl(null); setJumonStr(''); }}>
          {Array.from({length:12},(_,i)=>i+1).map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
      </div>
      <div className="form-row">
        <label>含める内容</label>
        <div className="radio-group">
          {EXPORT_ITEMS.map(({ key, label }) => (
            <label key={key}>
              <input type="checkbox" checked={include[key]}
                onChange={e => { setInclude({ ...include, [key]: e.target.checked }); setQrDataUrl(null); setJumonStr(''); }} />
              {label}
            </label>
          ))}
        </div>
      </div>
      <p className="hint">
        基準時間・有給残日数は常に含まれます（社員番号・氏名はユーザー管理で設定するため、取り込みません）。スキル表は対象月に関係なく、スキル・資格・職務経歴の全体を転送します。<br/>
        QRコードとカナコードのどちらにも、ここで選んだ内容が含まれます。
      </p>

      <div className="csv-section">
        <h4>エクスポート（QRコード生成）</h4>
        <p className="hint">「含める内容」で選んだデータをQRコード画像に変換します。スマホでスキャンするか、スクリーンショットを保存してください。<br/>※ 勤怠の勤務区分（帰社）、勤怠・交通費の備考、交通費の行先・出発地・到着地も含まれます。データ量が多いとQRコードに収まらない場合があります。その場合は含める内容を減らして何回かに分けて転送するか、カナコードをご利用ください。</p>
        <button className="btn btn-secondary" onClick={handleQrGenerate} disabled={qrGenerating}>
          {qrGenerating ? '生成中…' : 'QRコードを生成'}
        </button>
        {qrDataUrl && (
          <div className="qr-display">
            <img src={qrDataUrl} alt="QRコード" className="qr-image" />
            <p className="hint">{xferYear}年{xferMonth}月 — 反対デバイスでスキャンしてください</p>
          </div>
        )}
      </div>

      <div className="csv-section">
        <h4>インポート（QRコードをスキャン）</h4>
        <p className="hint">カメラでスキャン、または保存した画像ファイルを選択してください。</p>
        <div className="btn-row">
          <button className="btn btn-secondary"
            onClick={() => { setQrScanMode(s => s === 'camera' ? 'none' : 'camera'); setQrError(''); }}>
            {qrScanMode === 'camera' ? 'カメラを閉じる' : '📷 カメラでスキャン'}
          </button>
          <button className="btn btn-secondary" onClick={() => qrFileRef.current?.click()}>
            🖼️ 画像ファイルを選択
          </button>
          <input ref={qrFileRef} type="file" accept="image/*" className="is-hidden" onChange={handleQrImageFile} />
        </div>
        {qrScanMode === 'camera' && <QRScanner onDecode={handleQrDecoded} onClose={() => setQrScanMode('none')} />}
        {qrError && <div className="csv-errors"><strong>{qrError}</strong></div>}
        {qrImportAtt && qrImportInfo && (
          <div className="csv-preview">
            <strong>{qrImportInfo.year}年{qrImportInfo.month}月のデータを読み込みました</strong>
            <ul className="bullet-list my-8">
              <li>勤怠レコード: {qrImportAtt.length}件</li>
              <li>交通費レコード: {qrImportTrp?.length ?? 0}件</li>
            </ul>
            <TransferMetaPreview meta={qrImportMeta} month={qrImportInfo.month} apply={qrApplyMeta} onApplyChange={setQrApplyMeta} />
            <TransferDocsPreview
              docs={qrImportDocs} month={qrImportInfo.month} oldFormat={qrImportInfo.oldFormat}
              apply={qrApplyDocs} onApplyChange={setQrApplyDocs}
            />
            <p className="hint">{IMPORT_HINT}</p>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleQrImport}>インポート実行</button>
              <button className="btn btn-secondary" onClick={() => { setQrImportAtt(null); setQrImportTrp(null); setQrImportInfo(null); }}>キャンセル</button>
            </div>
          </div>
        )}
      </div>

      <hr />

      {/* ── カナコード転送 ── */}
      <h3>カナコード転送</h3>
      <p className="hint">1ヶ月分のデータをカタカナ文字列に変換します。コードをコピー&amp;ペーストまたは手入力することで、別デバイスへ勤怠（勤務区分・備考を含む）・交通費（行先・出発地・到着地・備考を含む）・作業報告書・申請書類・スキル表と基準時間・有給残日数を転送できます。</p>

      <div className="csv-section">
        <h4>コードを生成（エクスポート）</h4>
        <button className="btn btn-secondary" onClick={handleJumonGenerate}>カナコードを生成</button>
        {jumonStr && (
          <div className="jumon-display">
            <pre className="jumon-text">{jumonStr}</pre>
            <button className="btn btn-secondary mt-8"
              onClick={() => navigator.clipboard?.writeText(jumonStr.replace(/[　\n]/g,''))}>
              コピー
            </button>
          </div>
        )}
      </div>

      <div className="csv-section">
        <h4>コードを入力（インポート）</h4>
        <p className="hint">別デバイスで生成したカナコードを貼り付けるか、手入力してください。スペース・改行は無視されます。</p>
        <textarea
          className="jumon-input"
          rows={5}
          placeholder="カナコードをここに入力…"
          value={jumonInput}
          onChange={e => { setJumonInput(e.target.value); setJumonImportAtt(null); setJumonError(''); }}
        />
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={handleJumonDecode} disabled={!jumonInput.trim()}>
            コードを解析
          </button>
        </div>
        {jumonError && <div className="csv-errors"><strong>{jumonError}</strong></div>}
        {jumonImportAtt && jumonImportInfo && (
          <div className="csv-preview">
            <strong>{jumonImportInfo.year}年{jumonImportInfo.month}月のデータを読み込みました（勤怠 {jumonImportAtt.length}件・交通費 {jumonImportTrp.length}件）</strong>
            {jumonImportAtt.length > 0 && <table className="data-table preview-table mt-8">
              <thead><tr><th>日付</th><th>種別</th><th>出勤</th><th>退勤</th><th>休憩</th><th>備考</th></tr></thead>
              <tbody>
                {jumonImportAtt.slice(0, 8).map(r => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{ATTENDANCE_TYPE_LABELS[r.type]}</td>
                    <td>{r.clockIn ?? '-'}</td>
                    <td>{r.clockOut ?? '-'}</td>
                    <td>{r.breakMinutes ?? 0}</td>
                    <td>{r.notes ?? ''}</td>
                  </tr>
                ))}
                {jumonImportAtt.length > 8 && (
                  <tr><td colSpan={6} className="td-more">…他 {jumonImportAtt.length - 8} 件</td></tr>
                )}
              </tbody>
            </table>}
            <TransferMetaPreview meta={jumonImportMeta} month={jumonImportInfo.month} apply={jumonApplyMeta} onApplyChange={setJumonApplyMeta} />
            <TransferDocsPreview
              docs={jumonImportDocs} month={jumonImportInfo.month} oldFormat={jumonImportInfo.oldFormat}
              apply={jumonApplyDocs} onApplyChange={setJumonApplyDocs}
            />
            <p className="hint mt-8">{IMPORT_HINT}</p>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleJumonImport}>インポート実行</button>
              <button className="btn btn-secondary" onClick={() => { setJumonImportAtt(null); setJumonImportInfo(null); }}>キャンセル</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── カメラQRスキャナー ──────────────────────────────────────────────────────────
function QRScanner({ onDecode, onClose }: { onDecode: (text: string) => void; onClose: () => void }) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let active = true;

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) { video.srcObject = stream; video.play(); }

        function scan() {
          if (!active) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
            c.width = v.videoWidth; c.height = v.videoHeight;
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.drawImage(v, 0, 0);
              const imgData = ctx.getImageData(0, 0, c.width, c.height);
              const code = jsQR(imgData.data, imgData.width, imgData.height);
              if (code) { stopCamera(); onDecode(code.data); return; }
            }
          }
          rafRef.current = requestAnimationFrame(scan);
        }
        rafRef.current = requestAnimationFrame(scan);
      })
      .catch(() => { alert('カメラへのアクセスができませんでした。'); onClose(); });

    return () => { active = false; stopCamera(); };
  }, [onDecode, onClose, stopCamera]);

  return (
    <div className="qr-scanner">
      <p className="hint">カメラにQRコードをかざしてください</p>
      <video ref={videoRef} playsInline autoPlay muted className="qr-video" />
      <canvas ref={canvasRef} className="is-hidden" />
      <button className="btn btn-secondary mt-8" onClick={() => { stopCamera(); onClose(); }}>
        キャンセル
      </button>
    </div>
  );
}
