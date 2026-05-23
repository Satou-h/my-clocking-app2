import { useState } from 'react';
import type { AttendanceRecord, AttendanceType, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import {
  generateId, calcWorkMinutes, calcOvertimeMinutes,
  calcLateNightMinutes, isLateArrival, isEarlyDeparture, formatMinutes,
} from '../utils/storage';

interface Props {
  existingRecord?: AttendanceRecord;
  workSettings: WorkSettings;
  onSave: (record: AttendanceRecord) => void;
  onCancel?: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function AttendanceForm({ existingRecord, workSettings, onSave, onCancel }: Props) {
  const [date, setDate] = useState(existingRecord?.date ?? today());
  const [type, setType] = useState<AttendanceType>(existingRecord?.type ?? 'work');
  const [clockIn, setClockIn] = useState(existingRecord?.clockIn ?? '');
  const [clockOut, setClockOut] = useState(existingRecord?.clockOut ?? '');
  const [breakMinutes, setBreakMinutes] = useState(String(existingRecord?.breakMinutes ?? 60));
  const [notes, setNotes] = useState(existingRecord?.notes ?? '');
  const [error, setError] = useState('');
  const [useCustomTime, setUseCustomTime] = useState(
    !!(existingRecord?.customStartTime || existingRecord?.customEndTime)
  );
  const [customStartTime, setCustomStartTime] = useState(existingRecord?.customStartTime ?? '');
  const [customEndTime, setCustomEndTime] = useState(existingRecord?.customEndTime ?? '');

  const needsTime = type === 'work' || type === 'absence' || type === 'am_leave' || type === 'pm_leave';
  const isHalfLeave = type === 'am_leave' || type === 'pm_leave';

  const effectiveStart = (useCustomTime && customStartTime) ? customStartTime : workSettings.standardStartTime;
  const effectiveEnd = (useCustomTime && customEndTime) ? customEndTime : workSettings.standardEndTime;

  // リアルタイム計算
  const calc = (() => {
    if (!needsTime || !clockIn || !clockOut) return null;
    const work = calcWorkMinutes(clockIn, clockOut, parseInt(breakMinutes) || 0);
    if (work <= 0) return null;
    return {
      work,
      overtime: calcOvertimeMinutes(work),
      lateNight: calcLateNightMinutes(clockIn, clockOut),
      late: !isHalfLeave && isLateArrival(clockIn, effectiveStart),
      early: !isHalfLeave && isEarlyDeparture(clockOut, effectiveEnd),
    };
  })();

  function fillStandard() {
    setType('work');
    setClockIn(workSettings.standardStartTime);
    setClockOut(workSettings.standardEndTime);
    setBreakMinutes('60');
  }

  function fillAmLeave() {
    setType('am_leave');
    setClockIn('13:00');
    setClockOut(workSettings.standardEndTime);
    setBreakMinutes('0');
  }

  function fillPmLeave() {
    setType('pm_leave');
    setClockIn(workSettings.standardStartTime);
    setClockOut('12:00');
    setBreakMinutes('0');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (needsTime && clockIn && clockOut) {
      const work = calcWorkMinutes(clockIn, clockOut, parseInt(breakMinutes) || 0);
      if (work <= 0) {
        setError('退勤時間は出勤時間より後にしてください');
        return;
      }
    }

    onSave({
      id: existingRecord?.id ?? generateId(),
      date,
      type,
      clockIn: needsTime ? clockIn || undefined : undefined,
      clockOut: needsTime ? clockOut || undefined : undefined,
      breakMinutes: needsTime ? parseInt(breakMinutes) || 0 : 0,
      notes: notes || undefined,
      customStartTime: useCustomTime && customStartTime ? customStartTime : undefined,
      customEndTime: useCustomTime && customEndTime ? customEndTime : undefined,
    });
  }

  return (
    <form className="attendance-form" onSubmit={handleSubmit}>
      <h2>{existingRecord ? '勤怠編集' : '勤怠入力'}</h2>

      <div className="quick-fill">
        <span className="quick-fill-label">クイック入力：</span>
        <button type="button" className="btn-quick" onClick={fillStandard}>定時</button>
        <button type="button" className="btn-quick btn-quick-am" onClick={fillAmLeave}>午前休</button>
        <button type="button" className="btn-quick btn-quick-pm" onClick={fillPmLeave}>午後休</button>
      </div>

      <div className="form-row">
        <label>日付</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>

      <div className="form-row">
        <label>種別</label>
        <select value={type} onChange={(e) => setType(e.target.value as AttendanceType)}>
          {(Object.entries(ATTENDANCE_TYPE_LABELS) as [AttendanceType, string][]).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      {needsTime && (
        <>
          <div className="form-row">
            <label>出勤時間 <span className="std-hint">(基準 {effectiveStart})</span></label>
            <input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />
          </div>
          <div className="form-row">
            <label>退勤時間 <span className="std-hint">(基準 {effectiveEnd})</span></label>
            <input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
          </div>
          <div className="form-row">
            <label>休憩時間（分）</label>
            <input
              type="number"
              min={0}
              max={480}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(e.target.value)}
            />
          </div>
        </>
      )}

      {needsTime && !isHalfLeave && (
        <div className="custom-time-section">
          <label className="custom-time-toggle">
            <input
              type="checkbox"
              checked={useCustomTime}
              onChange={(e) => {
                setUseCustomTime(e.target.checked);
                if (!e.target.checked) {
                  setCustomStartTime('');
                  setCustomEndTime('');
                }
              }}
            />
            この日の基準時間を変更する
          </label>
          {useCustomTime && (
            <div className="custom-time-fields">
              <div className="form-row">
                <label>基準 出勤時間</label>
                <input
                  type="time"
                  value={customStartTime}
                  onChange={(e) => setCustomStartTime(e.target.value)}
                  placeholder={workSettings.standardStartTime}
                />
              </div>
              <div className="form-row">
                <label>基準 退勤時間</label>
                <input
                  type="time"
                  value={customEndTime}
                  onChange={(e) => setCustomEndTime(e.target.value)}
                  placeholder={workSettings.standardEndTime}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="form-row">
        <label>備考</label>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="任意" />
      </div>

      {error && <p className="form-error">{error}</p>}

      {/* リアルタイム計算プレビュー */}
      {calc && (
        <div className="calc-preview">
          <div className="calc-row">
            <span className="calc-label">労働時間</span>
            <span className="calc-val">{formatMinutes(calc.work)}</span>
          </div>
          <div className="calc-row">
            <span className="calc-label">残業時間</span>
            <span className={`calc-val ${calc.overtime > 0 ? 'val-overtime' : ''}`}>
              {calc.overtime > 0 ? formatMinutes(calc.overtime) : 'なし'}
            </span>
          </div>
          <div className="calc-row">
            <span className="calc-label">深夜時間</span>
            <span className={`calc-val ${calc.lateNight > 0 ? 'val-latenight' : ''}`}>
              {calc.lateNight > 0 ? formatMinutes(calc.lateNight) : 'なし'}
            </span>
          </div>
          <div className="calc-row">
            <span className="calc-label">遅刻 / 早退</span>
            <span className="calc-val">
              {calc.late && <span className="badge badge-late">遅刻</span>}
              {calc.early && <span className="badge badge-early">早退</span>}
              {!calc.late && !calc.early && <span className="text-ok">なし</span>}
            </span>
          </div>
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary">保存</button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>キャンセル</button>}
      </div>
    </form>
  );
}
