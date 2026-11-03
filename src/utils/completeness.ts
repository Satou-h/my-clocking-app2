import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import type { LeaveType, LeaveApplicationRecord, LateEarlyApplicationRecord } from '../types/application';
import { LEAVE_LABELS } from '../types/application';
import { isLateArrival, isEarlyDeparture } from './storage';
import { getHolidayName } from './holidays';
import type { WeekReportData } from './pdf';
import { hasContent } from './workReport';

const WORK_TYPES = new Set(['work', 'am_leave', 'pm_leave', 'scheduled_holiday_work', 'legal_holiday_work', 'transfer_holiday_work']);
// 休暇申請書が必要な区分。計画有給は事前に会社側で計画されている休暇のため、
// 都度の申請書は不要（LEAVE_TYPES に含めない）
export const LEAVE_TYPES = new Set(['paid_leave', 'am_leave', 'pm_leave', 'transfer_holiday']);
// 終日通勤が発生しない区分（丸一日の休暇・休日・欠勤）
const NO_COMMUTE_TYPES = new Set(['paid_leave', 'planned_paid_leave', 'holiday', 'absence', 'transfer_holiday']);

export interface DocCompleteness {
  required: boolean;
  complete: boolean;
  missingDates: string[];
  extraDates: string[];
  // 日付の過不足以外の不備（振替休日の未取得など）
  issues: string[];
}

// 振替休日出勤と振替休日の対応チェック（対象月に振替休日の日付が含まれるものを確認する）
// ・振替休日出勤には振替休日の日付が必須
// ・振替休日出勤で指定した日は「振替休日」として登録されている必要がある
// ・振替休日には、その日を指定した振替休日出勤が必要
export function checkTransferHolidays(prefix: string, records: AttendanceRecord[]): string[] {
  const issues: string[] = [];
  const recordByDate = new Map(records.map((r) => [r.date, r]));
  const transferWorks = records.filter((r) => r.type === 'transfer_holiday_work');

  for (const w of transferWorks) {
    if (!w.transferDate) {
      if (w.date.startsWith(prefix)) {
        issues.push(`${fmtDateShort(w.date)}の振替休日出勤に振替休日の日付が設定されていません`);
      }
      continue;
    }
    if (!w.transferDate.startsWith(prefix)) continue;
    if (recordByDate.get(w.transferDate)?.type !== 'transfer_holiday') {
      issues.push(`${fmtDateShort(w.date)}の振替休日出勤に対する振替休日（${fmtDateShort(w.transferDate)}）が取得されていません`);
    }
  }

  const linkedDates = new Set(transferWorks.map((w) => w.transferDate));
  for (const r of records) {
    if (r.type === 'transfer_holiday' && r.date.startsWith(prefix) && !linkedDates.has(r.date)) {
      issues.push(`${fmtDateShort(r.date)}の振替休日に対応する振替休日出勤が登録されていません`);
    }
  }
  return issues;
}

// 勤務表の実績（出退勤時刻）から見た遅刻・早退
export interface LateEarlyOccurrence {
  date: string;
  type: '遅刻' | '早退';
  scheduledTime: string;
  actualTime: string;
}

// 出勤日の出退勤時刻を始業・終業時刻と比べて、遅刻・早退を日付順に返す
export function findLateEarly(records: AttendanceRecord[], workSettings: WorkSettings): LateEarlyOccurrence[] {
  return records
    .filter((r) => r.type === 'work' && r.clockIn && r.clockOut)
    .flatMap((r) => {
      const refStart = r.customStartTime ?? workSettings.standardStartTime;
      const refEnd = r.customEndTime ?? workSettings.standardEndTime;
      const found: LateEarlyOccurrence[] = [];
      if (isLateArrival(r.clockIn!, refStart)) {
        found.push({ date: r.date, type: '遅刻', scheduledTime: refStart, actualTime: r.clockIn! });
      }
      if (isEarlyDeparture(r.clockOut!, refEnd, r.clockIn)) {
        found.push({ date: r.date, type: '早退', scheduledTime: refEnd, actualTime: r.clockOut! });
      }
      return found;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 遅早退申請は日付と種別の組で見分ける（同じ日に遅刻と早退があれば、申請書はそれぞれ必要）
export function lateEarlyKey(date: string, type: '遅刻' | '早退'): string {
  return `${date}_${type}`;
}

// 休暇申請の1日分を勤務表と照合する（問題がなければ null）
// ・勤務表が休暇以外（出勤・休日・計画有給など）または未登録 → 不要な申請
// ・どちらも休暇だが区分が違う（例: 勤務表は午前休なのに申請は午後休）→ 区分の不一致
export function checkLeaveEntry(e: { date: string; leaveType: LeaveType }, rec: AttendanceRecord | undefined): string | null {
  const day = fmtDateShort(e.date);
  if (!rec) {
    return `${day}は勤務表に休暇の記録がありません。不要な申請の場合は休暇申請書から削除してください`;
  }
  if (rec.type === e.leaveType) return null;
  if (rec.type === 'planned_paid_leave') {
    return `${day}は計画有給のため休暇申請は不要です。休暇申請書から削除してください`;
  }
  if (!LEAVE_TYPES.has(rec.type)) {
    return `${day}は勤務表が「${ATTENDANCE_TYPE_LABELS[rec.type]}」のため休暇申請は不要です。休暇申請書から削除してください`;
  }
  return `${day}の区分が一致しません（勤務表: ${ATTENDANCE_TYPE_LABELS[rec.type]}、休暇申請: ${LEAVE_LABELS[e.leaveType]}）`;
}

// 遅早退申請を勤務表の実績と照合する。実際には遅刻（早退）していない日の遅刻（早退）申請は不要
// occurred: 勤務表で遅刻・早退があった日の lateEarlyKey
export function checkLateEarlyApplication(a: LateEarlyApplicationRecord, occurred: Set<string>): string | null {
  if (occurred.has(lateEarlyKey(a.targetDate, a.type))) return null;
  return `${fmtDateShort(a.targetDate)}は勤務表上${a.type}していないため${a.type}申請は不要です。遅早退申請書から削除してください`;
}

export interface MonthCompleteness {
  attendance: DocCompleteness;
  transport: DocCompleteness;
  leaveApplication: DocCompleteness;
  lateEarlyApplication: DocCompleteness;
  allComplete: boolean;
}

// 対象月の平日（土日・祝日を除く）一覧
function monthWeekdays(year: number, month: number): string[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    if (dow === 0 || dow === 6) continue;
    if (getHolidayName(dateStr)) continue;
    dates.push(dateStr);
  }
  return dates;
}

export function checkMonthCompleteness(
  year: number,
  month: number,
  records: AttendanceRecord[],
  transportRecords: TransportRecord[],
  leaveApplications: LeaveApplicationRecord[],
  lateEarlyApplications: LateEarlyApplicationRecord[],
  workSettings: WorkSettings,
): MonthCompleteness {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthRecords = records.filter((r) => r.date.startsWith(prefix));
  const recordByDate = new Map(monthRecords.map((r) => [r.date, r]));

  // 勤務表: 平日（祝日除く）はすべて記録が必要
  const missingAttendance = monthWeekdays(year, month).filter((d) => !recordByDate.has(d));
  // 勤務表: 振替休日出勤がある場合は振替休日の取得が必要
  const transferIssues = checkTransferHolidays(prefix, records);

  // 交通費: 出勤扱いの日（交通費なしの日を除く）はすべて交通費登録が必要
  const workDates = monthRecords.filter((r) => WORK_TYPES.has(r.type) && !r.noTransport).map((r) => r.date);
  const transportDates = new Set(
    transportRecords.filter((r) => r.date.startsWith(prefix)).map((r) => r.date),
  );
  const missingTransport = workDates.filter((d) => !transportDates.has(d));

  // 交通費: 在宅勤務・徒歩圏内・有給・休日・欠勤など通勤が発生しない日に登録されている交通費は不要なデータ
  const extraTransport = [...transportDates].filter((d) => {
    const rec = recordByDate.get(d);
    return !!rec && (rec.noTransport || NO_COMMUTE_TYPES.has(rec.type));
  });

  // 休暇申請書: 有給・午前休・午後休の記録がある日はすべて申請書が必要
  const leaveDates = monthRecords.filter((r) => LEAVE_TYPES.has(r.type)).map((r) => r.date);
  const coveredLeaveDates = new Set(leaveApplications.flatMap((b) => b.dateEntries.map((e) => e.date)));
  const missingLeaveApp = leaveDates.filter((d) => !coveredLeaveDates.has(d));

  // 休暇申請書: 申請書の各日付を勤務表と照合する
  const leaveTypeIssues = leaveApplications
    .flatMap((b) => b.dateEntries)
    .filter((e) => e.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((e) => checkLeaveEntry(e, recordByDate.get(e.date)) ?? []);

  // 遅早退申請書: 遅刻・早退が発生した出勤日はすべて申請書が必要（同じ日に両方あれば2枚必要）
  const lateEarly = findLateEarly(monthRecords, workSettings);
  const occurred = new Set(lateEarly.map((o) => lateEarlyKey(o.date, o.type)));
  const monthLateEarlyApps = lateEarlyApplications
    .filter((a) => a.targetDate.startsWith(prefix))
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const applied = new Set(monthLateEarlyApps.map((a) => lateEarlyKey(a.targetDate, a.type)));
  const appliedDates = new Set(monthLateEarlyApps.map((a) => a.targetDate));
  const unapplied = lateEarly.filter((o) => !applied.has(lateEarlyKey(o.date, o.type)));
  // 申請が1枚もない日は未入力。片方だけ申請済みの日は、足りない方を不備として示す
  const missingLateEarly = [...new Set(unapplied.filter((o) => !appliedDates.has(o.date)).map((o) => o.date))];
  const partialLateEarlyIssues = unapplied
    .filter((o) => appliedDates.has(o.date))
    .map((o) => {
      const both = lateEarly.filter((x) => x.date === o.date).length > 1;
      return `${fmtDateShort(o.date)}の${o.type}申請書がありません${both ? '（遅刻と早退は別々に申請が必要です）' : ''}`;
    });

  // 遅早退申請書: 実際には遅刻（早退）していない日の遅刻（早退）申請は不要
  const lateEarlyIssues = [
    ...partialLateEarlyIssues,
    ...monthLateEarlyApps.flatMap((a) => checkLateEarlyApplication(a, occurred) ?? []),
  ];

  const attendance: DocCompleteness = {
    required: true,
    complete: missingAttendance.length === 0 && transferIssues.length === 0,
    missingDates: missingAttendance,
    extraDates: [],
    issues: transferIssues,
  };
  const transport: DocCompleteness = {
    required: true,
    complete: missingTransport.length === 0 && extraTransport.length === 0,
    missingDates: missingTransport,
    extraDates: extraTransport,
    issues: [],
  };
  const leaveApplication: DocCompleteness = {
    required: leaveDates.length > 0 || leaveTypeIssues.length > 0,
    complete: missingLeaveApp.length === 0 && leaveTypeIssues.length === 0,
    missingDates: missingLeaveApp,
    extraDates: [],
    issues: leaveTypeIssues,
  };
  const lateEarlyApplication: DocCompleteness = {
    required: lateEarly.length > 0 || lateEarlyIssues.length > 0,
    complete: missingLateEarly.length === 0 && lateEarlyIssues.length === 0,
    missingDates: missingLateEarly,
    extraDates: [],
    issues: lateEarlyIssues,
  };

  return {
    attendance,
    transport,
    leaveApplication,
    lateEarlyApplication,
    allComplete:
      attendance.complete && transport.complete && leaveApplication.complete && lateEarlyApplication.complete,
  };
}

// 以下はダウンロード画面で書類ごとに使うチェック（選んだ書類だけを出力するため、書類ごとに完結させる）

// 勤務表: 対象月の有給残日数（月初の残日数）が設定されていること
export function withPaidLeaveCheck(doc: DocCompleteness, month: number, paidLeaveRemaining: number | null): DocCompleteness {
  if (paidLeaveRemaining !== null) return doc;
  return {
    ...doc,
    complete: false,
    issues: [...doc.issues, `${month}月の有給残日数が設定されていません（勤怠一覧で月初の有給残日数を設定してください）`],
  };
}

// 勤務表・交通費・作業報告書: 共通の氏名が入力されていること（3つの書類に印字する）
export function withNameCheck(doc: DocCompleteness, name: string): DocCompleteness {
  if (name.trim()) return doc;
  return {
    ...doc,
    complete: false,
    issues: [...doc.issues, '氏名が入力されていません（勤務表・交通費・作業報告書共通）'],
  };
}

// 作業報告書: 対象月のいずれかの週が入力済みで、氏名が入力されていること
export function checkWorkReport(weeks: WeekReportData[], name: string): DocCompleteness {
  const issues = weeks.some(hasContent) ? [] : ['作業報告書が入力されていません'];
  return withNameCheck({ required: true, complete: issues.length === 0, missingDates: [], extraDates: [], issues }, name);
}

// スキル表: 月に依存しない書類。氏名が入力されていること
export function checkSkillSheet(name: string): DocCompleteness {
  const issues = name.trim() ? [] : ['スキル表の氏名が入力されていません'];
  return { required: true, complete: issues.length === 0, missingDates: [], extraDates: [], issues };
}

const DOW_JA_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

export function fmtDateShort(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth() + 1}/${dt.getDate()}(${DOW_JA_SHORT[dt.getDay()]})`;
}
