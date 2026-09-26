import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { encodeMonth, decodeMonth, encodeQR, decodeQR, bytesToJumon, jumonToBytes, formatJumon, type TransferMeta } from '../utils/transfer';
import type { UserProfile } from '../utils/storage';

interface Props {
  records: AttendanceRecord[];
  transportRecords: TransportRecord[];
  onImport: (records: AttendanceRecord[], mode: 'merge' | 'replace') => void;
  onImportTransport: (records: TransportRecord[], mode: 'merge' | 'replace') => void;
  workSettings: WorkSettings;
  userProfile: UserProfile;
  onImportMeta: (meta: TransferMeta) => void;
}

// QR / カナコードで読み込んだ付加情報（基準時間・社員番号・苗字）の確認表示と取り込み選択
function TransferMetaPreview({ meta, apply, onApplyChange }: { meta?: TransferMeta; apply: boolean; onApplyChange: (v: boolean) => void }) {
  if (!meta || (!meta.workSettings && !meta.employeeId && !meta.lastName)) return null;
  return (
    <div style={{ margin: '8px 0' }}>
      <ul style={{ margin: '0 0 6px', paddingLeft: 20 }}>
        {meta.workSettings && <li>基準時間: {meta.workSettings.standardStartTime} ～ {meta.workSettings.standardEndTime}</li>}
        {meta.employeeId && <li>社員番号: {meta.employeeId}</li>}
        {meta.lastName && <li>苗字: {meta.lastName}</li>}
      </ul>
      <label className="range-toggle">
        <input type="checkbox" checked={apply} onChange={(e) => onApplyChange(e.target.checked)} />
        基準時間・社員番号・苗字も取り込む（現在の設定を上書きします）
      </label>
    </div>
  );
}

// QRコード / カナコードで別デバイスとデータをやり取りするタブ
export default function TransferTab({ records, transportRecords, onImport, onImportTransport, workSettings, userProfile, onImportMeta }: Props) {
  const transferMeta: TransferMeta = {
    workSettings,
    employeeId: userProfile.employeeId,
    lastName: userProfile.lastName,
  };

  // ── QR / カナコード ──
  const nowX = new Date();
  const [xferYear, setXferYear]   = useState(nowX.getFullYear());
  const [xferMonth, setXferMonth] = useState(nowX.getMonth() + 1);
  // QR export
  const [qrDataUrl, setQrDataUrl]       = useState<string | null>(null);
  const [qrGenerating, setQrGenerating] = useState(false);
  // QR import
  const [qrScanMode, setQrScanMode]     = useState<'none' | 'camera' | 'file'>('none');
  const qrFileRef                        = useRef<HTMLInputElement>(null);
  const [qrImportAtt, setQrImportAtt]   = useState<AttendanceRecord[] | null>(null);
  const [qrImportTrp, setQrImportTrp]   = useState<TransportRecord[] | null>(null);
  const [qrImportInfo, setQrImportInfo] = useState<{ year: number; month: number } | null>(null);
  const [qrImportMode, setQrImportMode] = useState<'merge' | 'replace'>('merge');
  const [qrImportMeta, setQrImportMeta] = useState<TransferMeta | undefined>();
  const [qrApplyMeta, setQrApplyMeta]   = useState(true);
  const [qrError, setQrError]           = useState('');
  // カナコード export
  const [jumonStr, setJumonStr]         = useState('');
  // カナコード import
  const [jumonInput, setJumonInput]         = useState('');
  const [jumonImportAtt, setJumonImportAtt] = useState<AttendanceRecord[] | null>(null);
  const [jumonImportInfo, setJumonImportInfo] = useState<{ year: number; month: number } | null>(null);
  const [jumonImportMode, setJumonImportMode] = useState<'merge' | 'replace'>('merge');
  const [jumonImportMeta, setJumonImportMeta] = useState<TransferMeta | undefined>();
  const [jumonApplyMeta, setJumonApplyMeta]   = useState(true);
  const [jumonError, setJumonError]     = useState('');

  // ── QR ──────────────────────────────────────────────────────────────────────
  async function handleQrGenerate() {
    setQrGenerating(true); setQrError('');
    try {
      const text = encodeQR(records, transportRecords, xferYear, xferMonth, transferMeta);
      const url  = await QRCode.toDataURL(text, { errorCorrectionLevel: 'L', margin: 2, width: 300 });
      setQrDataUrl(url);
    } catch (e) {
      const tooBig = /too big|amount of data/i.test(String(e));
      setQrError(tooBig
        ? 'データ量が多すぎてQRコードに収まりません。備考を短くするか、カナコードまたは「全データバックアップ」をご利用ください。'
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
    setQrImportInfo({ year: result.year, month: result.month });
    setQrImportMeta(result.meta);
    setQrApplyMeta(true);
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
    if (qrImportAtt.length > 0)           onImport(qrImportAtt, qrImportMode);
    if (qrImportTrp && qrImportTrp.length > 0) onImportTransport(qrImportTrp, qrImportMode);
    if (qrImportMeta && qrApplyMeta)       onImportMeta(qrImportMeta);
    setQrImportAtt(null); setQrImportTrp(null); setQrImportInfo(null);
  }

  // ── カナコード ────────────────────────────────────────────────────────────
  function handleJumonGenerate() {
    const bytes = encodeMonth(records, xferYear, xferMonth, transferMeta);
    setJumonStr(formatJumon(bytesToJumon(bytes)));
    setJumonError('');
  }

  function handleJumonDecode() {
    const bytes = jumonToBytes(jumonInput);
    if (!bytes) { setJumonError('カナコードを解析できませんでした。正確に入力されているか確認してください。'); return; }
    const result = decodeMonth(bytes);
    if (!result) { setJumonError('カナコードのバージョンが不正です。'); return; }
    setJumonImportAtt(result.records);
    setJumonImportInfo({ year: result.year, month: result.month });
    setJumonImportMeta(result.meta);
    setJumonApplyMeta(true);
    setJumonError('');
  }

  function handleJumonImport() {
    if (!jumonImportAtt) return;
    onImport(jumonImportAtt, jumonImportMode);
    if (jumonImportMeta && jumonApplyMeta) onImportMeta(jumonImportMeta);
    setJumonImportAtt(null); setJumonImportInfo(null); setJumonInput('');
  }

  return (
    <div className="csv-import">
      <h2>QR / カナコード転送</h2>

      {/* ── QRコード転送 ── */}
      <h3>QRコード転送</h3>
      <p className="hint">1ヶ月分の勤怠＋交通費と、基準時間・社員番号・苗字をQRコードで別デバイスに転送します。</p>

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

      <div className="csv-section">
        <h4>エクスポート（QRコード生成）</h4>
        <p className="hint">勤怠と交通費（日付・金額・往復）をQRコード画像に変換します。スマホでスキャンするか、スクリーンショットを保存してください。<br/>※ 勤怠・交通費の備考も含まれます。交通費の行先・出発地・到着地はQRに含まれません。備考が多いとQRコードに収まらない場合があります。全フィールドを転送する場合は「全データバックアップ」をご利用ください。</p>
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary"
            onClick={() => { setQrScanMode(s => s === 'camera' ? 'none' : 'camera'); setQrError(''); }}>
            {qrScanMode === 'camera' ? 'カメラを閉じる' : '📷 カメラでスキャン'}
          </button>
          <button className="btn btn-secondary" onClick={() => qrFileRef.current?.click()}>
            🖼️ 画像ファイルを選択
          </button>
          <input ref={qrFileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleQrImageFile} />
        </div>
        {qrScanMode === 'camera' && <QRScanner onDecode={handleQrDecoded} onClose={() => setQrScanMode('none')} />}
        {qrError && <div className="csv-errors"><strong>{qrError}</strong></div>}
        {qrImportAtt && qrImportInfo && (
          <div className="csv-preview">
            <strong>{qrImportInfo.year}年{qrImportInfo.month}月のデータを読み込みました</strong>
            <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
              <li>勤怠レコード: {qrImportAtt.length}件</li>
              <li>交通費レコード: {qrImportTrp?.length ?? 0}件</li>
            </ul>
            <TransferMetaPreview meta={qrImportMeta} apply={qrApplyMeta} onApplyChange={setQrApplyMeta} />
            <div className="form-row">
              <label>取り込み方式</label>
              <select value={qrImportMode} onChange={e => setQrImportMode(e.target.value as 'merge' | 'replace')}>
                <option value="merge">マージ（既存データに追加・上書き）</option>
                <option value="replace">置換（既存データをすべて削除）</option>
              </select>
            </div>
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
      <p className="hint">月次勤怠データをカタカナ文字列に変換します。コードをコピー&amp;ペーストまたは手入力することで、別デバイスへ勤怠データと基準時間・社員番号・苗字を転送できます（備考を含む・交通費は除く）。</p>

      <div className="csv-section">
        <h4>コードを生成（エクスポート）</h4>
        <button className="btn btn-secondary" onClick={handleJumonGenerate}>カナコードを生成</button>
        {jumonStr && (
          <div className="jumon-display">
            <pre className="jumon-text">{jumonStr}</pre>
            <button className="btn btn-secondary" style={{marginTop:8}}
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
            <strong>{jumonImportInfo.year}年{jumonImportInfo.month}月の勤怠データを読み込みました（{jumonImportAtt.length}件）</strong>
            <table className="data-table preview-table" style={{marginTop:8}}>
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
                  <tr><td colSpan={6} style={{textAlign:'center',color:'#888'}}>…他 {jumonImportAtt.length - 8} 件</td></tr>
                )}
              </tbody>
            </table>
            <TransferMetaPreview meta={jumonImportMeta} apply={jumonApplyMeta} onApplyChange={setJumonApplyMeta} />
            <div className="form-row" style={{marginTop:8}}>
              <label>取り込み方式</label>
              <select value={jumonImportMode} onChange={e => setJumonImportMode(e.target.value as 'merge' | 'replace')}>
                <option value="merge">マージ（既存データに追加・上書き）</option>
                <option value="replace">置換（既存データをすべて削除）</option>
              </select>
            </div>
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
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => { stopCamera(); onClose(); }}>
        キャンセル
      </button>
    </div>
  );
}
