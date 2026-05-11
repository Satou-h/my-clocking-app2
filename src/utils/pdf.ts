import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import {
  calcWorkMinutes, calcOvertimeMinutes, calcLateNightMinutes,
  isLateArrival, isEarlyDeparture, formatMinutes,
} from './storage';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function fmtDate(d: string) {
  const date = new Date(d + 'T00:00:00');
  const day = date.getDate();
  const dow = DOW[date.getDay()];
  return `${day}日 <span class="dow dow-${dow}">(${dow})</span>`;
}

function statusBadges(late: boolean, early: boolean) {
  return [
    late ? '<span class="badge late">遅刻</span>' : '',
    early ? '<span class="badge early">早退</span>' : '',
  ].join('');
}

export function printMonthlyAttendance(
  records: AttendanceRecord[],
  workSettings: WorkSettings,
  year: number,
  month: number,
) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const filtered = records
    .filter((r) => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 月次集計
  let workDays = 0, paidDays = 0;
  let workMins = 0, otMins = 0, lnMins = 0, lateCount = 0, earlyCount = 0;
  for (const r of filtered) {
    if (r.type === 'paid_leave') { paidDays++; continue; }
    if (r.type !== 'work' || !r.clockIn || !r.clockOut) continue;
    workDays++;
    const w = calcWorkMinutes(r.clockIn, r.clockOut, r.breakMinutes ?? 0);
    workMins += w;
    otMins += calcOvertimeMinutes(w);
    lnMins += calcLateNightMinutes(r.clockIn, r.clockOut);
    if (isLateArrival(r.clockIn, workSettings.standardStartTime)) lateCount++;
    if (isEarlyDeparture(r.clockOut, workSettings.standardEndTime)) earlyCount++;
  }

  // テーブル行
  const rows = filtered.map((r) => {
    const hasTime = r.type === 'work' && r.clockIn && r.clockOut;
    const wMin = hasTime ? calcWorkMinutes(r.clockIn!, r.clockOut!, r.breakMinutes ?? 0) : null;
    const ot   = wMin !== null ? calcOvertimeMinutes(wMin) : null;
    const ln   = hasTime ? calcLateNightMinutes(r.clockIn!, r.clockOut!) : null;
    const late  = hasTime ? isLateArrival(r.clockIn!, workSettings.standardStartTime) : false;
    const early = hasTime ? isEarlyDeparture(r.clockOut!, workSettings.standardEndTime) : false;

    const typeClass = r.type === 'paid_leave' ? 'tr-paid' : r.type === 'holiday' ? 'tr-holiday' : '';
    return `
      <tr class="${typeClass}">
        <td class="td-date">${fmtDate(r.date)}</td>
        <td><span class="badge ${r.type}">${ATTENDANCE_TYPE_LABELS[r.type]}</span></td>
        <td>${r.clockIn ?? '-'}</td>
        <td>${r.clockOut ?? '-'}</td>
        <td>${r.type === 'work' ? (r.breakMinutes ?? 0) : '-'}</td>
        <td>${wMin !== null ? formatMinutes(wMin) : '-'}</td>
        <td class="${ot && ot > 0 ? 'td-ot' : ''}">${ot !== null ? (ot > 0 ? formatMinutes(ot) : '-') : '-'}</td>
        <td class="${ln && ln > 0 ? 'td-ln' : ''}">${ln !== null ? (ln > 0 ? formatMinutes(ln) : '-') : '-'}</td>
        <td>${statusBadges(late, early)}</td>
        <td class="td-notes">${r.notes ?? ''}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${year}年${month}月 勤怠一覧</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
    font-size: 9px;
    color: #1a1a2e;
    background: #fff;
  }

  /* ── ヘッダー ── */
  .report-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1.5px solid #2d6cdf;
    padding-bottom: 4px;
    margin-bottom: 5px;
  }
  .report-title { font-size: 13px; font-weight: 700; color: #2d6cdf; }
  .report-meta  { font-size: 8px; color: #636e72; margin-top: 2px; }
  .print-date   { font-size: 8px; color: #999; }

  /* ── サマリー（1行テーブル） ── */
  .summary {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 5px;
    font-size: 8.5px;
  }
  .summary th {
    background: #f1f3f9;
    color: #636e72;
    font-weight: 600;
    padding: 2px 6px;
    border: 1px solid #dde1ee;
    text-align: center;
    white-space: nowrap;
  }
  .summary td {
    padding: 2px 6px;
    border: 1px solid #dde1ee;
    text-align: center;
    font-weight: 700;
    white-space: nowrap;
  }
  .summary td.ot { color: #e65100; }
  .summary td.ln { color: #7b1fa2; }
  .summary td.ng { color: #c62828; }

  /* ── 明細テーブル ── */
  table.detail { width: 100%; border-collapse: collapse; }
  table.detail th {
    background: #2d6cdf;
    color: #fff;
    padding: 3px 5px;
    font-size: 8.5px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
    border: 1px solid #1a54c4;
  }
  table.detail td {
    padding: 2px 5px;
    border-bottom: 1px solid #eef0f5;
    border-right: 1px solid #eef0f5;
    vertical-align: middle;
    white-space: nowrap;
    font-size: 9px;
    text-align: center;
  }
  table.detail td.td-notes { text-align: left; white-space: normal; max-width: 80px; font-size: 8px; color: #636e72; }
  table.detail tr:nth-child(even) td { background: #f9faff; }
  .tr-paid    td { background: #fffde7 !important; }
  .tr-holiday td { background: #f1f8e9 !important; }
  .tr-absence td { background: #fff0f0 !important; }

  .dow-日 { color: #e53935; font-weight: 700; }
  .dow-土 { color: #1e88e5; font-weight: 700; }
  .td-ot { color: #e65100; font-weight: 700; }
  .td-ln { color: #7b1fa2; font-weight: 700; }

  .badge {
    display: inline-block;
    padding: 0 4px;
    border-radius: 8px;
    font-size: 8px;
    font-weight: 700;
    line-height: 1.6;
  }
  .badge.work       { background: #e8f0fe; color: #2d6cdf; }
  .badge.paid_leave { background: #fff9c4; color: #856404; }
  .badge.holiday    { background: #e8f5e9; color: #2e7d32; }
  .badge.absence    { background: #fce4ec; color: #c62828; }
  .badge.late       { background: #fce4ec; color: #c62828; }
  .badge.early      { background: #fff8e1; color: #f57f17; }

  .print-btn {
    position: fixed; top: 12px; right: 16px;
    background: #2d6cdf; color: #fff; border: none;
    padding: 6px 14px; border-radius: 5px;
    cursor: pointer; font-size: 12px; font-weight: 600; z-index: 999;
  }
  .print-btn:hover { background: #1a54c4; }

  @page { size: A4 landscape; margin: 8mm; }
  @media print {
    .print-btn { display: none; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>

<div class="report-header">
  <div>
    <div class="report-title">${year}年${month}月　勤怠一覧</div>
    <div class="report-meta">基準: ${workSettings.standardStartTime}〜${workSettings.standardEndTime}　残業: 8h超過分　深夜: 22:00〜翌5:00</div>
  </div>
  <div class="print-date">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
</div>

<table class="summary">
  <thead>
    <tr>
      <th>出勤日数</th><th>有給日数</th><th>総労働時間</th>
      <th>残業時間</th><th>深夜時間</th><th>遅刻</th><th>早退</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${workDays}日</td>
      <td>${paidDays}日</td>
      <td>${formatMinutes(workMins)}</td>
      <td class="ot">${formatMinutes(otMins)}</td>
      <td class="ln">${formatMinutes(lnMins)}</td>
      <td class="ng">${lateCount}回</td>
      <td class="ng">${earlyCount}回</td>
    </tr>
  </tbody>
</table>

<table class="detail">
  <thead>
    <tr>
      <th>日付</th><th>種別</th><th>出勤</th><th>退勤</th>
      <th>休憩(分)</th><th>労働時間</th><th>残業</th><th>深夜</th><th>状態</th><th>備考</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<script>
  window.addEventListener('load', () => setTimeout(() => window.print(), 400));
<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=1100,height=750');
  if (!win) {
    alert('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
    return;
  }
  win.document.write(html);
  win.document.close();
}
