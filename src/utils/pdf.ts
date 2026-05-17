import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { TRIP_TYPE_LABELS } from '../types/transport';
import {
  calcWorkMinutes, calcOvertimeMinutes, calcLateNightMinutes,
  isLateArrival, isEarlyDeparture, formatMinutes,
} from './storage';
import { getHolidayName } from './holidays';

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

  // 当月の全日を生成
  const daysInMonth = new Date(year, month, 0).getDate();
  const recordByDate = new Map(filtered.map((r) => [r.date, r]));

  const rows = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const r = recordByDate.get(dateStr);

    // 登録済みレコード
    if (r) {
      const hasTime = r.type === 'work' && r.clockIn && r.clockOut;
      const wMin = hasTime ? calcWorkMinutes(r.clockIn!, r.clockOut!, r.breakMinutes ?? 0) : null;
      const ot   = wMin !== null ? calcOvertimeMinutes(wMin) : null;
      const ln   = hasTime ? calcLateNightMinutes(r.clockIn!, r.clockOut!) : null;
      const late  = hasTime ? isLateArrival(r.clockIn!, workSettings.standardStartTime) : false;
      const early = hasTime ? isEarlyDeparture(r.clockOut!, workSettings.standardEndTime) : false;
      const typeClass = r.type === 'paid_leave' ? 'tr-paid' : r.type === 'holiday' ? 'tr-holiday' : r.type === 'absence' ? 'tr-absence' : '';
      return `
        <tr class="${typeClass}">
          <td class="td-date">${fmtDate(dateStr)}</td>
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
    }

    // 未登録日：土日・祝日
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    const holidayName = getHolidayName(dateStr);
    if (dow === 0 || dow === 6 || holidayName) {
      return `
        <tr class="tr-off">
          <td class="td-date">${fmtDate(dateStr)}</td>
          <td><span class="badge holiday">休日</span></td>
          <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
          <td></td>
          <td class="td-notes td-holiday-name">${holidayName ?? ''}</td>
        </tr>`;
    }

    // 未登録の平日
    return `
      <tr class="tr-empty">
        <td class="td-date">${fmtDate(dateStr)}</td>
        <td>-</td>
        <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
        <td></td><td></td>
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
  .tr-off     td { background: #f2f3f5 !important; color: #aaa; }
  .tr-off .dow-日 { color: #ef9a9a; }
  .tr-off .dow-土 { color: #90caf9; }
  .td-holiday-name { color: #888 !important; font-size: 7.5px; }
  .tr-empty   td { background: #fafbfc !important; color: #ccc; }

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

export function printTransportRecords(
  records: TransportRecord[],
  year: number,
  month: number,
) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const filtered = records
    .filter((r) => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  const total = filtered.reduce((sum, r) => sum + r.amount, 0);
  const roundtripCount = filtered.filter((r) => r.tripType === 'roundtrip').length;
  const onewayCount    = filtered.filter((r) => r.tripType === 'oneway').length;

  const rows = filtered.map((r) => {
    const d   = new Date(r.date + 'T00:00:00');
    const day = d.getDate();
    const dow = DOW[d.getDay()];
    const dowClass = d.getDay() === 0 ? 'dow-日' : d.getDay() === 6 ? 'dow-土' : '';
    const tripClass = r.tripType === 'roundtrip' ? 'badge-rt' : 'badge-ow';
    return `
      <tr>
        <td class="td-date">${day}日 <span class="${dowClass}">(${dow})</span></td>
        <td class="td-dest">${r.destination}</td>
        <td>${r.from}</td>
        <td>${r.to}</td>
        <td><span class="badge ${tripClass}">${TRIP_TYPE_LABELS[r.tripType]}</span></td>
        <td class="td-amount">¥${r.amount.toLocaleString()}</td>
        <td class="td-notes">${r.notes ?? ''}</td>
      </tr>`;
  }).join('');

  const totalRow = filtered.length > 0 ? `
    <tr class="tr-total">
      <td colspan="5" class="td-total-label">合計 ${filtered.length}件</td>
      <td class="td-amount td-total-amount">¥${total.toLocaleString()}</td>
      <td></td>
    </tr>` : '';

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${year}年${month}月 交通費一覧</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
    font-size: 9px;
    color: #1a1a2e;
    background: #fff;
  }

  .report-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1.5px solid #2d6cdf;
    padding-bottom: 4px;
    margin-bottom: 5px;
  }
  .report-title { font-size: 13px; font-weight: 700; color: #2d6cdf; }
  .print-date   { font-size: 8px; color: #999; }

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
  .summary td.total { color: #2d6cdf; font-size: 10px; }

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
  table.detail tr:nth-child(even) td { background: #f9faff; }
  td.td-dest { text-align: left; font-weight: 600; }
  td.td-amount { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  td.td-notes { text-align: left; white-space: normal; max-width: 100px; font-size: 8px; color: #636e72; }

  .tr-total td {
    background: #f1f3f9 !important;
    border-top: 2px solid #dfe6e9;
    font-weight: 700;
  }
  .td-total-label { text-align: right; color: #636e72; font-size: 8.5px; }
  .td-total-amount { font-size: 11px; color: #2d6cdf; }

  .dow-日 { color: #e53935; font-weight: 700; }
  .dow-土 { color: #1e88e5; font-weight: 700; }

  .badge {
    display: inline-block;
    padding: 0 5px;
    border-radius: 8px;
    font-size: 8px;
    font-weight: 700;
    line-height: 1.6;
  }
  .badge-rt { background: #e3f2fd; color: #1565c0; }
  .badge-ow { background: #fce4ec; color: #880e4f; }

  .print-btn {
    position: fixed; top: 12px; right: 16px;
    background: #2d6cdf; color: #fff; border: none;
    padding: 6px 14px; border-radius: 5px;
    cursor: pointer; font-size: 12px; font-weight: 600; z-index: 999;
  }
  .print-btn:hover { background: #1a54c4; }

  @page { size: A4; margin: 10mm; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>

<div class="report-header">
  <div class="report-title">${year}年${month}月　交通費一覧</div>
  <div class="print-date">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
</div>

<table class="summary">
  <thead>
    <tr><th>件数</th><th>往復</th><th>片道</th><th>合計金額</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>${filtered.length}件</td>
      <td>${roundtripCount}件</td>
      <td>${onewayCount}件</td>
      <td class="total">¥${total.toLocaleString()}</td>
    </tr>
  </tbody>
</table>

<table class="detail">
  <thead>
    <tr>
      <th>日付</th><th>行先</th><th>出発地点</th><th>到着地点</th>
      <th>往復/片道</th><th>金額</th><th>備考</th>
    </tr>
  </thead>
  <tbody>
    ${filtered.length === 0
      ? '<tr><td colspan="7" style="text-align:center;padding:20px;color:#aaa;">データがありません</td></tr>'
      : rows}
  </tbody>
  ${totalRow ? `<tfoot>${totalRow}</tfoot>` : ''}
</table>

<script>
  window.addEventListener('load', () => setTimeout(() => window.print(), 400));
<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    alert('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
    return;
  }
  win.document.write(html);
  win.document.close();
}
