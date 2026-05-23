import { useState } from 'react';
import type { AttendanceRecord } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import type { TransportRecord, TripType } from '../types/transport';
import { TRIP_TYPE_LABELS } from '../types/transport';
import { generateId } from '../utils/storage';
import { printTransportRecords } from '../utils/pdf';

interface Props {
  records: TransportRecord[];
  attendanceRecords: AttendanceRecord[];
  onSave: (record: TransportRecord) => void;
  onDelete: (id: string) => void;
}

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function blankForm(date = ''): Omit<TransportRecord, 'id'> {
  return { date, destination: '', from: '', to: '', tripType: 'roundtrip', amount: 0, notes: '' };
}

export default function TransportTab({ records, attendanceRecords, onSave, onDelete }: Props) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const [filterYear, setFilterYear] = useState(currentYear);
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<TransportRecord, 'id'>>(blankForm());
  const [errors, setErrors] = useState<Partial<Record<keyof TransportRecord, string>>>({});

  const prefix = `${filterYear}-${String(filterMonth).padStart(2, '0')}`;

  const monthRecords = records
    .filter((r) => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 当月の勤怠レコード（日付連携用）
  const monthAttendance = attendanceRecords
    .filter((r) => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  const attendanceByDate = new Map(attendanceRecords.map((r) => [r.date, r]));

  const total = monthRecords.reduce((sum, r) => sum + r.amount, 0);
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  function openAdd() {
    setForm(blankForm(`${prefix}-01`));
    setEditId(null);
    setErrors({});
    setShowForm(true);
  }

  function openEdit(r: TransportRecord) {
    setForm({ date: r.date, destination: r.destination, from: r.from, to: r.to, tripType: r.tripType, amount: r.amount, notes: r.notes });
    setEditId(r.id);
    setErrors({});
    setShowForm(true);
  }

  function validate(): Partial<Record<keyof TransportRecord, string>> {
    const e: Partial<Record<keyof TransportRecord, string>> = {};
    if (!form.date) e.date = '日付を入力してください';
    if (!form.destination.trim()) e.destination = '行先を入力してください';
    if (!form.from.trim()) e.from = '出発地点を入力してください';
    if (!form.to.trim()) e.to = '到着地点を入力してください';
    if (form.amount < 0) e.amount = '金額は0以上を入力してください';
    return e;
  }

  function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    onSave({ id: editId ?? generateId(), ...form });
    setShowForm(false);
    setErrors({});
  }

  function handleDelete(id: string, date: string) {
    if (window.confirm(`${date} の交通費を削除しますか？`)) onDelete(id);
  }

  function set<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  // 過去に登録した各フィールドの候補（重複排除・50音順）
  function candidates(key: 'destination' | 'from' | 'to') {
    return [...new Set(records.map((r) => r[key]).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'ja')
    );
  }
  const destCandidates = candidates('destination');
  const fromCandidates = candidates('from');
  const toCandidates   = candidates('to');

  function HistorySelect({ list, field }: { list: string[]; field: 'destination' | 'from' | 'to' }) {
    if (list.length === 0) return null;
    return (
      <select
        className="attendance-date-picker"
        value=""
        onChange={(e) => { if (e.target.value) set(field, e.target.value); }}
      >
        <option value="">履歴から選択…</option>
        {list.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }

  return (
    <div className="transport-tab">
      <h2>交通費</h2>

      <div className="list-filter">
        <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))}>
          {months.map((m) => <option key={m} value={m}>{m}月</option>)}
        </select>
        {!showForm && (
          <button className="btn btn-primary" onClick={openAdd}>+ 追加</button>
        )}
        <button
          className="btn btn-pdf"
          onClick={() => printTransportRecords(records, filterYear, filterMonth)}
          title={`${filterYear}年${filterMonth}月をPDF出力`}
        >
          PDF出力
        </button>
      </div>

      {/* 入力フォーム */}
      {showForm && (
        <div className="transport-form-card">
          <h3>{editId ? '交通費を編集' : '交通費を追加'}</h3>

          <div className="form-row">
            <label>日付 <span className="required">*</span></label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
            {monthAttendance.length > 0 && (
              <select
                className="attendance-date-picker"
                value=""
                title="勤務日から選択"
                onChange={(e) => { if (e.target.value) set('date', e.target.value); }}
              >
                <option value="">勤務日から選択…</option>
                {monthAttendance.map((r) => {
                  const d = new Date(r.date + 'T00:00:00');
                  const dow = DOW[d.getDay()];
                  return (
                    <option key={r.date} value={r.date}>
                      {d.getMonth() + 1}/{d.getDate()}({dow}) {ATTENDANCE_TYPE_LABELS[r.type]}
                    </option>
                  );
                })}
              </select>
            )}
          </div>
          {errors.date && <div className="form-error">{errors.date}</div>}

          <div className="form-row">
            <label>行先 <span className="required">*</span></label>
            <input
              type="text"
              placeholder="例: 〇〇株式会社"
              value={form.destination}
              onChange={(e) => set('destination', e.target.value)}
            />
            <HistorySelect list={destCandidates} field="destination" />
          </div>
          {errors.destination && <div className="form-error">{errors.destination}</div>}

          <div className="form-row">
            <label>出発地点 <span className="required">*</span></label>
            <input
              type="text"
              placeholder="例: さっぽろ駅"
              value={form.from}
              onChange={(e) => set('from', e.target.value)}
            />
            <HistorySelect list={fromCandidates} field="from" />
          </div>
          {errors.from && <div className="form-error">{errors.from}</div>}

          <div className="form-row">
            <label>到着地点 <span className="required">*</span></label>
            <input
              type="text"
              placeholder="例: 麻生駅"
              value={form.to}
              onChange={(e) => set('to', e.target.value)}
            />
            <HistorySelect list={toCandidates} field="to" />
          </div>
          {errors.to && <div className="form-error">{errors.to}</div>}

          <div className="form-row">
            <label>往復 / 片道</label>
            <div className="trip-type-group">
              {(['roundtrip', 'oneway'] as TripType[]).map((t) => (
                <label key={t} className="radio-label">
                  <input
                    type="radio"
                    name="tripType"
                    value={t}
                    checked={form.tripType === t}
                    onChange={() => set('tripType', t)}
                  />
                  {TRIP_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </div>

          <div className="form-row">
            <label>金額（円）<span className="required">*</span></label>
            <input
              type="number"
              min={0}
              step={10}
              value={form.amount}
              onChange={(e) => set('amount', Math.max(0, Number(e.target.value)))}
            />
          </div>
          {errors.amount && <div className="form-error">{errors.amount}</div>}

          <div className="form-row">
            <label>備考</label>
            <input
              type="text"
              placeholder="メモなど"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleSubmit}>保存</button>
            <button className="btn btn-secondary" onClick={() => setShowForm(false)}>キャンセル</button>
          </div>
        </div>
      )}

      {/* 一覧テーブル */}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>日付</th>
              <th>行先</th>
              <th>出発地点</th>
              <th>到着地点</th>
              <th>往復/片道</th>
              <th>金額</th>
              <th>備考</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {monthRecords.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-message" style={{ padding: '32px 0' }}>
                  この月の交通費はありません
                </td>
              </tr>
            ) : (
              monthRecords.map((r) => {
                const d = new Date(r.date + 'T00:00:00');
                const dow = DOW[d.getDay()];
                const isSun = d.getDay() === 0;
                const isSat = d.getDay() === 6;
                const att = attendanceByDate.get(r.date);
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="day-cell">
                        {d.getDate()}日
                        <span className={`dow-label ${isSun ? 'dow-sun' : isSat ? 'dow-sat' : ''}`}>
                          ({dow})
                        </span>
                        {att && (
                          <span className={`att-chip att-chip-${att.type}`} title={ATTENDANCE_TYPE_LABELS[att.type]}>
                            {ATTENDANCE_TYPE_LABELS[att.type]}
                          </span>
                        )}
                      </span>
                    </td>
                    <td>{r.destination}</td>
                    <td>{r.from}</td>
                    <td>{r.to}</td>
                    <td>
                      <span className={`badge badge-${r.tripType}`}>
                        {TRIP_TYPE_LABELS[r.tripType]}
                      </span>
                    </td>
                    <td className="td-amount">¥{r.amount.toLocaleString()}</td>
                    <td>{r.notes}</td>
                    <td className="actions">
                      <button className="btn-icon btn-edit" onClick={() => openEdit(r)}>編集</button>
                      <button className="btn-icon btn-delete" onClick={() => handleDelete(r.id, r.date)}>削除</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {monthRecords.length > 0 && (
            <tfoot>
              <tr className="tr-total">
                <td colSpan={5} className="td-total-label">合計</td>
                <td className="td-amount td-total-amount">¥{total.toLocaleString()}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
