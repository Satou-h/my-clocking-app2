import { useState } from 'react';
import type { WorkSettings } from '../types/attendance';

interface Props {
  settings: WorkSettings;
  onSave: (settings: WorkSettings) => void;
  onClearAttendance: () => void;
  onClearTransport: () => void;
  onClearAll: () => void;
}

export default function WorkSettingsForm({ settings, onSave, onClearAttendance, onClearTransport, onClearAll }: Props) {
  const [startTime, setStartTime] = useState(settings.standardStartTime);
  const [endTime, setEndTime] = useState(settings.standardEndTime);
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ standardStartTime: startTime, standardEndTime: endTime });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="work-settings-form">
      <h2>勤務時間設定</h2>
      <p className="hint">
        基準出退勤時間を設定します。この時間を基準に遅刻・早退・残業・深夜時間を計算します。
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>標準出勤時間</label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </div>
        <div className="form-row">
          <label>標準退勤時間</label>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
          />
        </div>

        <div className="settings-info">
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">所定労働時間</span>
              <span className="info-value">
                {calcStandardHours(startTime, endTime)}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">残業判定</span>
              <span className="info-value">8時間超過分</span>
            </div>
            <div className="info-item">
              <span className="info-label">深夜時間帯</span>
              <span className="info-value">22:00 〜 翌5:00</span>
            </div>
            <div className="info-item">
              <span className="info-label">遅刻判定</span>
              <span className="info-value">標準出勤時間を過ぎた出勤</span>
            </div>
            <div className="info-item">
              <span className="info-label">早退判定</span>
              <span className="info-value">標準退勤時間より早い退勤</span>
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">設定を保存</button>
          {saved && <span className="save-notice">保存しました</span>}
        </div>
      </form>

      <hr />

      <div className="danger-zone">
        <h3>データ管理</h3>
        <p className="hint">削除したデータは元に戻せません。操作前にCSVエクスポートでバックアップを取ることをお勧めします。</p>
        <div className="danger-actions">
          <div className="danger-item">
            <div className="danger-desc">
              <strong>勤怠データをクリア</strong>
              <span>登録済みの勤怠記録をすべて削除します</span>
            </div>
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => {
                if (window.confirm('勤怠データをすべて削除しますか？\nこの操作は元に戻せません。')) {
                  onClearAttendance();
                }
              }}
            >
              勤怠データをクリア
            </button>
          </div>
          <div className="danger-item">
            <div className="danger-desc">
              <strong>交通費データをクリア</strong>
              <span>登録済みの交通費記録をすべて削除します</span>
            </div>
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => {
                if (window.confirm('交通費データをすべて削除しますか？\nこの操作は元に戻せません。')) {
                  onClearTransport();
                }
              }}
            >
              交通費データをクリア
            </button>
          </div>
          <div className="danger-item danger-item-all">
            <div className="danger-desc">
              <strong>すべてのデータをクリア</strong>
              <span>勤怠・交通費のすべての記録を削除します</span>
            </div>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (window.confirm('すべてのデータを削除しますか？\nこの操作は元に戻せません。')) {
                  onClearAll();
                }
              }}
            >
              すべてクリア
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function calcStandardHours(start: string, end: string): string {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return '-';
  return `${Math.floor(mins / 60)}時間${mins % 60 > 0 ? `${mins % 60}分` : ''}`;
}
