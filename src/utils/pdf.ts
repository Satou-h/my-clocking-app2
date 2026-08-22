import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { TRIP_TYPE_LABELS } from '../types/transport';
import {
  calcWorkMinutes, calcOvertimeMinutes, calcLateNightMinutes,
  isLateArrival, isEarlyDeparture, formatMinutes, getEffectiveBreak,
} from './storage';
import { getHolidayName } from './holidays';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function buildFilename(prefix: string, dateStr: string, employeeId: string, lastName: string): string {
  const userPart = (employeeId || lastName) ? `_${employeeId}${lastName}` : '';
  return `${prefix}${dateStr}${userPart}`;
}

async function htmlToPdf(html: string, landscape: boolean, filename: string): Promise<void> {
  const viewportW = landscape ? 1300 : 900;
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  // Extract CSS and patch body selector so it applies to our container div
  let css = '';
  parsed.querySelectorAll('style').forEach(s => { css += s.textContent ?? ''; });
  const patchedCss = css.replace(/\bbody\s*\{/g, '.pdf-container {');

  // Remove print-button and auto-print script from body content
  parsed.querySelectorAll('script, .print-btn').forEach(el => el.remove());

  // Build an off-screen wrapper (fixed, hidden to the left of the viewport)
  const wrapper = document.createElement('div');
  wrapper.style.cssText =
    `position:fixed;top:0;left:-${viewportW + 60}px;` +
    `width:${viewportW}px;background:#fff;overflow:visible;`;

  const styleTag = document.createElement('style');
  styleTag.textContent = patchedCss;
  wrapper.appendChild(styleTag);

  const container = document.createElement('div');
  container.className = 'pdf-container';
  container.innerHTML = parsed.body.innerHTML;
  wrapper.appendChild(container);

  document.body.appendChild(wrapper);
  // Let the browser lay out the DOM before capturing
  await new Promise(r => setTimeout(r, 300));

  try {
    const canvas = await html2canvas(wrapper, {
      scale: 2,
      useCORS: false,
      logging: false,
      backgroundColor: '#ffffff',
      width: viewportW,
      height: wrapper.scrollHeight,
    });

    const pdf = new jsPDF({
      orientation: landscape ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    const pW = pdf.internal.pageSize.getWidth();
    const pH = pdf.internal.pageSize.getHeight();
    const imgW = pW;
    const imgH = (canvas.height / canvas.width) * pW;
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    if (imgH <= pH) {
      pdf.addImage(imgData, 'JPEG', 0, 0, imgW, imgH);
    } else {
      // Multi-page: slice the image across A4 pages
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, -y, imgW, imgH);
        y += pH;
      }
    }
    pdf.save(filename);
  } finally {
    document.body.removeChild(wrapper);
  }
}

function openPrintWindow(html: string, landscape = false, filename = 'document.pdf'): void {
  htmlToPdf(html, landscape, filename).catch(err =>
    alert('PDF生成エラー: ' + (err instanceof Error ? err.message : String(err)))
  );
}


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
  plRemaining: number | null = null,
  employeeId = '',
  lastName = '',
) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const filtered = records
    .filter((r) => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  const isWorkType = (t: string) =>
    t === 'work' || t === 'am_leave' || t === 'pm_leave'
    || t === 'scheduled_holiday_work' || t === 'legal_holiday_work';

  // 月次集計
  let workDays = 0, scheduledHolidayDays = 0, legalHolidayDays = 0, paidDays = 0;
  let workMins = 0, otMins = 0, legalHolidayMins = 0, lnMins = 0, lateCount = 0, earlyCount = 0;
  for (const r of filtered) {
    if (r.type === 'paid_leave' || r.type === 'planned_paid_leave') { paidDays++; continue; }
    if (r.type === 'am_leave' || r.type === 'pm_leave') { paidDays += 0.5; }
    if (!isWorkType(r.type) || !r.clockIn || !r.clockOut) continue;
    if (r.type === 'work') workDays++;
    if (r.type === 'scheduled_holiday_work') scheduledHolidayDays++;
    if (r.type === 'legal_holiday_work') legalHolidayDays++;
    const effBreak = getEffectiveBreak(r.type, r.clockIn, r.clockOut, r.breakMinutes ?? 0);
    const w = calcWorkMinutes(r.clockIn, r.clockOut, effBreak);
    workMins += w;
    // 所定休日出勤は全時間を残業に加算、法定休日出勤は専用集計
    if (r.type === 'scheduled_holiday_work') otMins += w;
    else if (r.type === 'legal_holiday_work') legalHolidayMins += w;
    else otMins += calcOvertimeMinutes(w);
    lnMins += calcLateNightMinutes(r.clockIn, r.clockOut);
    const refStart = r.customStartTime ?? workSettings.standardStartTime;
    const refEnd   = r.customEndTime   ?? workSettings.standardEndTime;
    const isHalf   = r.type === 'am_leave' || r.type === 'pm_leave';
    if (!isHalf && isLateArrival(r.clockIn, refStart)) lateCount++;
    if (!isHalf && isEarlyDeparture(r.clockOut, refEnd, r.clockIn)) earlyCount++;
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
      const hasTime = isWorkType(r.type) && r.clockIn && r.clockOut;
      const rowEffBreak = hasTime ? getEffectiveBreak(r.type, r.clockIn!, r.clockOut!, r.breakMinutes ?? 0) : 0;
      const wMin = hasTime ? calcWorkMinutes(r.clockIn!, r.clockOut!, rowEffBreak) : null;
      const ot   = wMin !== null
        ? r.type === 'scheduled_holiday_work' ? wMin
          : r.type === 'legal_holiday_work' ? null
          : calcOvertimeMinutes(wMin)
        : null;
      const legalHolidayMin = r.type === 'legal_holiday_work' && wMin !== null ? wMin : null;
      const ln   = hasTime ? calcLateNightMinutes(r.clockIn!, r.clockOut!) : null;
      const rowRefStart = r.customStartTime ?? workSettings.standardStartTime;
      const rowRefEnd   = r.customEndTime   ?? workSettings.standardEndTime;
      const rowIsHalf   = r.type === 'am_leave' || r.type === 'pm_leave';
      const late  = hasTime && !rowIsHalf ? isLateArrival(r.clockIn!, rowRefStart) : false;
      const early = hasTime && !rowIsHalf ? isEarlyDeparture(r.clockOut!, rowRefEnd, r.clockIn) : false;
      const typeClass = r.type === 'paid_leave' || r.type === 'planned_paid_leave' ? 'tr-paid'
        : r.type === 'am_leave' || r.type === 'pm_leave' ? 'tr-paid'
        : r.type === 'holiday' ? 'tr-holiday'
        : r.type === 'absence' ? 'tr-absence'
        : r.type === 'scheduled_holiday_work' ? 'tr-scheduled-holiday'
        : r.type === 'legal_holiday_work' ? 'tr-legal-holiday'
        : '';
      return `
        <tr class="${typeClass}">
          <td class="td-date">${fmtDate(dateStr)}</td>
          <td><span class="badge ${r.type}">${ATTENDANCE_TYPE_LABELS[r.type]}</span></td>
          <td>${r.clockIn ?? '-'}</td>
          <td>${r.clockOut ?? '-'}</td>
          <td>${isWorkType(r.type) ? rowEffBreak : '-'}</td>
          <td>${wMin !== null ? formatMinutes(wMin) : '-'}</td>
          <td class="${ot && ot > 0 ? 'td-ot' : ''}">${ot !== null ? (ot > 0 ? formatMinutes(ot) : '-') : '-'}</td>
          <td class="${legalHolidayMin !== null && legalHolidayMin > 0 ? 'td-lh' : ''}">${legalHolidayMin !== null ? formatMinutes(legalHolidayMin) : '-'}</td>
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
          <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
          <td></td>
          <td class="td-notes td-holiday-name">${holidayName ?? ''}</td>
        </tr>`;
    }

    // 未登録の平日
    return `
      <tr class="tr-empty">
        <td class="td-date">${fmtDate(dateStr)}</td>
        <td>-</td>
        <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
        <td></td><td></td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=900">
<title>${buildFilename('勤務表', `${year}${String(month).padStart(2, '0')}`, employeeId, lastName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
    font-size: 9px;
    color: #1a1a2e;
    background: #fff;
    max-width: 194mm;
    margin: 0 auto;
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
    table-layout: fixed;
    border-collapse: collapse;
    margin-bottom: 5px;
    font-size: 8.5px;
  }
  .summary th {
    background: #f1f3f9;
    color: #636e72;
    font-weight: 600;
    padding: 2px 4px;
    border: 1px solid #dde1ee;
    text-align: center;
    overflow: hidden;
    line-height: 1.2;
  }
  .summary td {
    padding: 2px 4px;
    border: 1px solid #dde1ee;
    text-align: center;
    font-weight: 700;
    overflow: hidden;
    line-height: 1.2;
  }
  .summary td.ot { color: #e65100; }
  .summary td.ln { color: #7b1fa2; }
  .summary td.ng { color: #c62828; }
  .summary td.sh { color: #e65100; }
  .summary td.lh { color: #bf360c; }
  .summary.summary-pl { width: auto; min-width: 120px; }
  .summary td.pl-ok { color: #00b894; }
  .summary td.pl-low { color: #c62828; }

  /* ── 明細テーブル ── */
  table.detail { width: 100%; border-collapse: collapse; }
  table.detail th {
    background: #2d6cdf;
    color: #fff;
    padding: 2px 3px;
    font-size: 8px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
    border: 1px solid #1a54c4;
    line-height: 1.2;
  }
  table.detail td {
    padding: 1px 3px;
    border-bottom: 1px solid #eef0f5;
    border-right: 1px solid #eef0f5;
    vertical-align: middle;
    white-space: nowrap;
    font-size: 8px;
    text-align: center;
    line-height: 1.2;
  }
  table.detail td.td-notes { text-align: left; white-space: normal; max-width: 60px; font-size: 7.5px; color: #636e72; }
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
  .badge.planned_paid_leave { background: #fff9c4; color: #856404; }
  .badge.holiday    { background: #e8f5e9; color: #2e7d32; }
  .badge.absence    { background: #fce4ec; color: #c62828; }
  .badge.am_leave   { background: #e0f2fe; color: #0277bd; }
  .badge.pm_leave   { background: #fce4ec; color: #ad1457; }
  .badge.scheduled_holiday_work { background: #fff3e0; color: #e65100; }
  .badge.legal_holiday_work     { background: #fbe9e7; color: #bf360c; }
  .badge.late       { background: #fce4ec; color: #c62828; }
  .badge.early      { background: #fff8e1; color: #f57f17; }
  .tr-scheduled-holiday td { background: #fff8f0 !important; }
  .tr-legal-holiday     td { background: #fff4f2 !important; }

  .print-btn {
    position: fixed; top: 12px; right: 16px;
    background: #2d6cdf; color: #fff; border: none;
    padding: 6px 14px; border-radius: 5px;
    cursor: pointer; font-size: 12px; font-weight: 600; z-index: 999;
  }
  .print-btn:hover { background: #1a54c4; }

  @page { size: A4 portrait; margin: 8mm; }
  @media print {
    .print-btn { display: none; }
    html { font-size: 8px; }
    body { width: 194mm; max-width: 194mm; margin: 0 auto; }
    table.detail { table-layout: fixed; width: 100%; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>

<div id="page">
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
      <th>出勤日数</th><th>所定休日出勤</th><th>法定休日出勤</th>
      <th>総労働時間</th><th>残業時間</th><th>法定休日時間</th><th>深夜時間</th><th>遅刻</th><th>早退</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${workDays}日</td>
      <td class="sh">${scheduledHolidayDays}日</td>
      <td class="lh">${legalHolidayDays}日</td>
      <td>${formatMinutes(workMins)}</td>
      <td class="ot">${formatMinutes(otMins)}</td>
      <td class="lh">${formatMinutes(legalHolidayMins)}</td>
      <td class="ln">${formatMinutes(lnMins)}</td>
      <td class="ng">${lateCount}回</td>
      <td class="ng">${earlyCount}回</td>
    </tr>
  </tbody>
</table>
<table class="summary summary-pl">
  <thead>
    <tr>
      <th>有給日数</th><th>有給残日数</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${paidDays}日</td>
      <td class="${plRemaining !== null && plRemaining <= 5 ? 'pl-low' : 'pl-ok'}">${plRemaining !== null ? `${plRemaining}日` : '未設定'}</td>
    </tr>
  </tbody>
</table>

<table class="detail">
  <thead>
    <tr>
      <th>日付</th><th>種別</th><th>出勤</th><th>退勤</th>
      <th>休憩(分)</th><th>労働時間</th><th>残業</th><th>法定休日</th><th>深夜</th><th>状態</th><th>備考</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
</div>

</body>
</html>`;

  openPrintWindow(html, false, buildFilename('勤務表', `${year}${String(month).padStart(2, '0')}`, employeeId, lastName) + '.pdf');
}

function fmtJpDate(d: string): string {
  if (!d) return '';
  const date = new Date(d + 'T00:00:00');
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export interface LeaveApplicationEntry {
  date: string;
  leaveLabel: string;
}

export interface LeaveApplicationData {
  applicationDate: string;
  name: string;
  dateEntries: LeaveApplicationEntry[];
  leaveDays: number;
  reason: string;
}

export function printLeaveApplication(data: LeaveApplicationData, employeeId = '', lastName = '') {
  const { applicationDate, name, dateEntries, leaveDays, reason } = data;
  const yymmdd = applicationDate.replace(/-/g, '').slice(2);
  const sorted = [...dateEntries].sort((a, b) => a.date.localeCompare(b.date));
  const dateScheduleHtml = sorted.length === 0
    ? '-'
    : sorted.map((e) => `${fmtJpDate(e.date)}　${e.leaveLabel}`).join('<br>');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=800">
<title>${buildFilename('休暇申請書', yymmdd, employeeId, lastName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
    font-size: 11pt;
    color: #1a1a2e;
    background: #fff;
    padding: 20mm 24mm;
    max-width: 180mm;
    margin: 0 auto;
  }
  h1 {
    text-align: center;
    font-size: 20pt;
    font-weight: 700;
    margin-bottom: 20px;
    letter-spacing: 6px;
    border-bottom: 2px solid #2d6cdf;
    padding-bottom: 10px;
  }
  .meta-block {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 24px;
    font-size: 10pt;
    color: #444;
  }
  .applicant-block { text-align: right; }
  .name-row { margin-bottom: 10px; }
  .sign-row { display: flex; justify-content: flex-end; gap: 20px; }
  .sign-item { display: flex; flex-direction: column; align-items: center; }
  .sign-label { font-size: 8pt; color: #555; margin-bottom: 4px; }
  .sign-box { width: 100px; height: 40px; border-bottom: 1.5px solid #555; display: block; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 24px;
    font-size: 11pt;
  }
  table th {
    background: #f1f3f9;
    font-weight: 600;
    padding: 10px 14px;
    border: 1px solid #aab;
    width: 26%;
    text-align: left;
    color: #444;
  }
  table td {
    padding: 10px 14px;
    border: 1px solid #aab;
    min-height: 36px;
    vertical-align: top;
  }
  .print-btn {
    position: fixed; top: 12px; right: 16px;
    background: #2d6cdf; color: #fff; border: none;
    padding: 6px 14px; border-radius: 5px;
    cursor: pointer; font-size: 12px; font-weight: 600; z-index: 999;
  }
  @page { size: A4 portrait; margin: 15mm; }
  @media print {
    .print-btn { display: none; }
    body { width: 180mm; max-width: 180mm; margin: 0 auto; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>

<h1>休　暇　申　請　書</h1>

<div class="meta-block">
  <div>申請日: ${fmtJpDate(applicationDate)}</div>
  <div class="applicant-block">
    <div class="name-row">氏名: ${name || '　　　　　　　'}</div>
    <div class="sign-row">
      <div class="sign-item"><div class="sign-label">承認</div><div class="sign-box"></div></div>
      <div class="sign-item"><div class="sign-label">確認</div><div class="sign-box"></div></div>
      <div class="sign-item"><div class="sign-label">本人</div><div class="sign-box"></div></div>
    </div>
  </div>
</div>

<table>
  <tr><th>休暇日程</th><td style="line-height:1.8">${dateScheduleHtml}</td></tr>
  <tr><th>取得日数</th><td>${leaveDays}日</td></tr>
  <tr><th>取得理由</th><td>${reason.replace(/\n/g, '<br>')}</td></tr>
</table>

</body>
</html>`;

  openPrintWindow(html, false, buildFilename('休暇申請書', yymmdd, employeeId, lastName) + '.pdf');
}

export interface LateEarlyApplicationData {
  applicationDate: string;
  name: string;
  type: '遅刻' | '早退';
  targetDate: string;
  scheduledTime: string;
  actualTime: string;
  reason: string;
}

export function printLateEarlyApplication(data: LateEarlyApplicationData, employeeId = '', lastName = '') {
  const { applicationDate, name, type, targetDate, scheduledTime, actualTime, reason } = data;
  const yymmdd = applicationDate.replace(/-/g, '').slice(2);

  const sealCss = `
  .name-row { margin-bottom: 10px; }
  .sign-row { display: flex; justify-content: flex-end; gap: 20px; }
  .sign-item { display: flex; flex-direction: column; align-items: center; }
  .sign-label { font-size: 8pt; color: #555; margin-bottom: 4px; }
  .sign-box { width: 100px; height: 40px; border-bottom: 1.5px solid #555; display: block; }`;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=800">
<title>${buildFilename('遅早退申請書', yymmdd, employeeId, lastName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
    font-size: 11pt;
    color: #1a1a2e;
    background: #fff;
    padding: 20mm 24mm;
    max-width: 180mm;
    margin: 0 auto;
  }
  h1 {
    text-align: center;
    font-size: 20pt;
    font-weight: 700;
    margin-bottom: 20px;
    letter-spacing: 6px;
    border-bottom: 2px solid #2d6cdf;
    padding-bottom: 10px;
  }
  .meta-block {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 24px;
    font-size: 10pt;
    color: #444;
  }
  .applicant-block { text-align: right; }
  ${sealCss}
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 24px;
    font-size: 11pt;
  }
  table th {
    background: #f1f3f9;
    font-weight: 600;
    padding: 10px 14px;
    border: 1px solid #aab;
    width: 26%;
    text-align: left;
    color: #444;
  }
  table td {
    padding: 10px 14px;
    border: 1px solid #aab;
    min-height: 36px;
    vertical-align: top;
  }
  .print-btn {
    position: fixed; top: 12px; right: 16px;
    background: #2d6cdf; color: #fff; border: none;
    padding: 6px 14px; border-radius: 5px;
    cursor: pointer; font-size: 12px; font-weight: 600; z-index: 999;
  }
  @page { size: A4 portrait; margin: 15mm; }
  @media print {
    .print-btn { display: none; }
    body { width: 180mm; max-width: 180mm; margin: 0 auto; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>

<h1>遅刻・早退申請書</h1>

<div class="meta-block">
  <div>申請日: ${fmtJpDate(applicationDate)}</div>
  <div class="applicant-block">
    <div class="name-row">氏名: ${name || '　　　　　　　'}</div>
    <div class="sign-row">
      <div class="sign-item"><div class="sign-label">承認</div><div class="sign-box"></div></div>
      <div class="sign-item"><div class="sign-label">確認</div><div class="sign-box"></div></div>
      <div class="sign-item"><div class="sign-label">本人</div><div class="sign-box"></div></div>
    </div>
  </div>
</div>

<table>
  <tr><th>種別</th><td>${type}</td></tr>
  <tr><th>対象日</th><td>${fmtJpDate(targetDate)}</td></tr>
  <tr><th>本来の時刻</th><td>${scheduledTime}</td></tr>
  <tr><th>実際の時刻</th><td>${actualTime}</td></tr>
  <tr><th>理由</th><td>${reason.replace(/\n/g, '<br>')}</td></tr>
</table>

</body>
</html>`;

  openPrintWindow(html, false, buildFilename('遅早退申請書', yymmdd, employeeId, lastName) + '.pdf');
}

const WEEK_LABELS_PDF = ['第一週', '第二週', '第三週', '第四週', '第五週'];

export interface WeekReportData {
  tools: string;
  conditionFirst: string;
  reasonFirst: string;
  conditionSecond: string;
  reasonSecond: string;
  goodPoints: string;
  badPoints: string;
  notes: string;
}

export function printWorkReport(
  year: number,
  month: number,
  name: string,
  weeks: WeekReportData[],
  employeeId = '',
  lastName = '',
  monthlySummary = '',
) {
  const nl2br = (s: string) => s.replace(/\n/g, '<br>').replace(/・/g, '・');

  const weekRows = weeks.map((w, i) => `
    <tr>
      <td rowspan="2" class="td-week">${WEEK_LABELS_PDF[i]}</td>
      <td rowspan="2" class="td-tools">${nl2br(w.tools)}</td>
      <td rowspan="2" class="td-internal"></td>
      <td rowspan="2" class="td-time"></td>
      <td class="td-half">前半</td>
      <td class="td-condition">${w.conditionFirst}</td>
      <td class="td-reason">${nl2br(w.reasonFirst)}</td>
      <td rowspan="2" class="td-good">${nl2br(w.goodPoints)}</td>
      <td rowspan="2" class="td-bad">${nl2br(w.badPoints)}</td>
      <td rowspan="2" class="td-other">${nl2br(w.notes)}</td>
    </tr>
    <tr>
      <td class="td-half">後半</td>
      <td class="td-condition">${w.conditionSecond}</td>
      <td class="td-reason">${nl2br(w.reasonSecond)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1200">
<title>${buildFilename('作業状況報告書', `${year}${String(month).padStart(2, '0')}`, employeeId, lastName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Hiragino Sans', 'Yu Gothic', 'Meiryo', 'Segoe UI', sans-serif;
    font-size: 8.5pt;
    color: #1a1a1a;
    background: #fff;
    padding: 6mm 8mm 4mm;
    max-width: 281mm;
    margin: 0 auto;
  }

  /* フォーム番号 */
  .form-no {
    text-align: right;
    font-size: 7.5pt;
    color: #555;
    margin-bottom: 2px;
  }

  /* ヘッダーエリア */
  .doc-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 5px;
  }
  .meta-boxes {
    border: 1px solid #888;
    border-collapse: collapse;
    flex-shrink: 0;
    font-size: 8.5pt;
  }
  .meta-row {
    display: flex;
    border-bottom: 1px solid #888;
  }
  .meta-row:last-child { border-bottom: none; }
  .meta-label {
    padding: 3px 8px;
    background: #f0f0f0;
    font-weight: 700;
    border-right: 1px solid #888;
    white-space: nowrap;
    min-width: 4.5em;
    text-align: center;
    letter-spacing: 1px;
  }
  .meta-value {
    padding: 3px 14px;
    min-width: 9em;
    font-size: 9pt;
    font-weight: 600;
  }
  .doc-title-block {
    flex: 1;
    text-align: center;
  }
  .doc-title {
    font-size: 15pt;
    font-weight: 700;
    letter-spacing: 8px;
    display: block;
    margin-bottom: 4px;
  }
  .doc-note {
    font-size: 7pt;
    color: #555;
    text-align: right;
    display: block;
    line-height: 1.4;
  }

  /* メインテーブル */
  table.main {
    width: 100%;
    border-collapse: collapse;
    font-size: 8pt;
    table-layout: fixed;
  }
  table.main th, table.main td {
    border: 1px solid #888;
    vertical-align: middle;
    padding: 2px 3px;
  }
  table.main thead th {
    background: #e8e8e8;
    font-weight: 700;
    text-align: center;
    font-size: 7.5pt;
    white-space: nowrap;
    padding: 3px 2px;
  }

  /* 週 列 */
  .td-week {
    text-align: center;
    font-weight: 700;
    writing-mode: vertical-rl;
    text-orientation: upright;
    letter-spacing: 2px;
    font-size: 8.5pt;
    padding: 3px 1px;
    background: #f5f5f5;
    width: 2em;
  }
  /* 開発言語列 */
  .td-tools {
    vertical-align: top;
    font-size: 7.5pt;
    padding: 4px 5px;
    line-height: 1.7;
    width: 13%;
  }
  /* 社内作業 */
  .td-internal {
    vertical-align: top;
    font-size: 7.5pt;
    padding: 3px 3px;
    width: 5%;
    text-align: center;
  }
  /* 時間 */
  .td-time {
    text-align: center;
    font-size: 7.5pt;
    width: 3.5%;
  }
  /* 前半/後半 */
  .td-half {
    text-align: center;
    font-size: 7.5pt;
    white-space: nowrap;
    background: #fafafa;
    padding: 2px;
    width: 2.5em;
  }
  /* 体調 */
  .td-condition {
    text-align: center;
    font-size: 10pt;
    font-weight: 700;
    width: 2em;
  }
  /* 理由 */
  .td-reason {
    font-size: 7.5pt;
    vertical-align: top;
    padding: 3px 4px;
    line-height: 1.5;
    width: 9%;
  }
  /* 良かった点 / 悪かった点 / その他 */
  .td-good, .td-bad, .td-other {
    font-size: 7.5pt;
    vertical-align: top;
    padding: 3px 5px;
    line-height: 1.6;
  }
  .td-good { width: 19%; }
  .td-bad  { width: 19%; }
  .td-other { width: 19%; }

  /* 総括欄行 */
  .td-sum-label {
    background: #e8e8e8;
    font-weight: 700;
    text-align: center;
    font-size: 8pt;
    letter-spacing: 1px;
    vertical-align: middle;
    white-space: nowrap;
    padding: 4px 3px;
  }
  .td-sum-content {
    vertical-align: top;
    padding: 6px 8px;
    font-size: 8pt;
    line-height: 1.7;
    min-height: 36px;
  }
  .td-sum-meta {
    text-align: center;
    font-size: 7.5pt;
    font-weight: 700;
    vertical-align: middle;
    white-space: nowrap;
    background: #f5f5f5;
    padding: 4px 2px;
  }

  /* フッター注記 */
  .td-footer-note {
    font-size: 7pt;
    color: #444;
    padding: 3px 5px;
    background: #f9f9f9;
    text-align: left;
  }

  /* 印刷ボタン */
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
    body { width: 281mm; max-width: 281mm; margin: 0 auto; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>

<div class="form-no">様式1-2-26.1</div>

<div class="doc-header">
  <div class="meta-boxes">
    <div class="meta-row">
      <div class="meta-label">申請月</div>
      <div class="meta-value">${year}年${month}月</div>
    </div>
    <div class="meta-row">
      <div class="meta-label">氏　名</div>
      <div class="meta-value">${name || ''}</div>
    </div>
  </div>
  <div class="doc-title-block">
    <span class="doc-title">作　業　状　況　報　告　書</span>
    <span class="doc-note">※記載例を参考に開発言語/ツール/作業工程の欄には主に現場業務を記載するが、コメント欄には作業内容ではなく主に気持ちの部分を記載して下さい。</span>
  </div>
</div>

<table class="main">
  <colgroup>
    <col style="width:2em">
    <col style="width:13%">
    <col style="width:5%">
    <col style="width:3.5%">
    <col style="width:2.5em">
    <col style="width:2em">
    <col style="width:9%">
    <col>
    <col>
    <col>
  </colgroup>
  <thead>
    <tr>
      <th>週</th>
      <th>開発言語/ツール/作業工程</th>
      <th>社内作業</th>
      <th>時間</th>
      <th></th>
      <th>体調</th>
      <th>理由</th>
      <th>良かった点</th>
      <th>悪かった点</th>
      <th>その他（気づいた点等）</th>
    </tr>
  </thead>
  <tbody>
    ${weekRows}
  </tbody>
  <tfoot>
    <tr>
      <td class="td-sum-label">総<br>括<br>欄</td>
      <td colspan="7" class="td-sum-content">${nl2br(monthlySummary)}</td>
      <td class="td-sum-meta">社内作業<br><br>h</td>
      <td class="td-sum-meta">承認時間<br><br>h</td>
    </tr>
    <tr>
      <td colspan="10" class="td-footer-note">【作業工程】　要件定義　分析　調査　基本設計　詳細設計　プログラミング　単体テスト　結合テスト　その他（　　）　　　　【体調欄】　◎良好　○普通　△やや悪い　×悪い</td>
    </tr>
  </tfoot>
</table>

</body>
</html>`;

  openPrintWindow(html, true, buildFilename('作業状況報告書', `${year}${String(month).padStart(2, '0')}`, employeeId, lastName) + '.pdf');
}

export function printTransportRecords(
  records: TransportRecord[],
  year: number,
  month: number,
  employeeId = '',
  lastName = '',
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
<meta name="viewport" content="width=800">
<title>${buildFilename('小口交通費', `${year}${String(month).padStart(2, '0')}`, employeeId, lastName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
    font-size: 9px;
    color: #1a1a2e;
    background: #fff;
    max-width: 190mm;
    margin: 0 auto;
  }

  .report-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 1.5px solid #2d6cdf;
    padding-bottom: 4px;
    margin-bottom: 5px;
  }
  .report-title { font-size: 13px; font-weight: 700; color: #2d6cdf; }
  .header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
  .sign-row { display: flex; gap: 14px; }
  .sign-item { display: flex; flex-direction: column; align-items: center; }
  .sign-label { font-size: 7.5px; color: #666; margin-bottom: 3px; }
  .sign-box { width: 70px; height: 32px; border-bottom: 1.5px solid #555; display: block; }
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
  @media print {
    .print-btn { display: none; }
    body { width: 190mm; max-width: 190mm; margin: 0 auto; }
    table.detail { table-layout: fixed; width: 100%; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>

<div class="report-header">
  <div class="report-title">${year}年${month}月　交通費一覧</div>
  <div class="header-right">
    <div class="sign-row">
      <div class="sign-item"><div class="sign-label">検印</div><div class="sign-box"></div></div>
      <div class="sign-item"><div class="sign-label">受領印</div><div class="sign-box"></div></div>
    </div>
    <div class="print-date">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
  </div>
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

</body>
</html>`;

  openPrintWindow(html, false, buildFilename('小口交通費', `${year}${String(month).padStart(2, '0')}`, employeeId, lastName) + '.pdf');
}
