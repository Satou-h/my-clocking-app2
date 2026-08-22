import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import type { LeaveApplicationRecord, LateEarlyApplicationRecord } from '../types/application';
import { isLateArrival, isEarlyDeparture } from './storage';
import { getHolidayName } from './holidays';

const WORK_TYPES = new Set(['work', 'am_leave', 'pm_leave', 'scheduled_holiday_work', 'legal_holiday_work']);
// 休暇申請書が必要な区分。計画有給は事前に会社側で計画されている休暇のため、
// 都度の申請書は不要（LEAVE_TYPES に含めない）
const LEAVE_TYPES = new Set(['paid_leave', 'am_leave', 'pm_leave']);
// 終日通勤が発生しない区分（丸一日の休暇・休日・欠勤）
const NO_COMMUTE_TYPES = new Set(['paid_leave', 'planned_paid_leave', 'holiday', 'absence']);

export interface DocCompleteness {
  required: boolean;
  complete: boolean;
  missingDates: string[];
  extraDates: string[];
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

  // 遅早退申請書: 遅刻・早退が発生した出勤日はすべて申請書が必要
  const lateEarlyDates = monthRecords
    .filter((r) => {
      if (r.type !== 'work' || !r.clockIn || !r.clockOut) return false;
      const refStart = r.customStartTime ?? workSettings.standardStartTime;
      const refEnd = r.customEndTime ?? workSettings.standardEndTime;
      return isLateArrival(r.clockIn, refStart) || isEarlyDeparture(r.clockOut, refEnd, r.clockIn);
    })
    .map((r) => r.date);
  const coveredLateEarlyDates = new Set(lateEarlyApplications.map((r) => r.targetDate));
  const missingLateEarly = lateEarlyDates.filter((d) => !coveredLateEarlyDates.has(d));

  const attendance: DocCompleteness = {
    required: true,
    complete: missingAttendance.length === 0,
    missingDates: missingAttendance,
    extraDates: [],
  };
  const transport: DocCompleteness = {
    required: true,
    complete: missingTransport.length === 0 && extraTransport.length === 0,
    missingDates: missingTransport,
    extraDates: extraTransport,
  };
  const leaveApplication: DocCompleteness = {
    required: leaveDates.length > 0,
    complete: missingLeaveApp.length === 0,
    missingDates: missingLeaveApp,
    extraDates: [],
  };
  const lateEarlyApplication: DocCompleteness = {
    required: lateEarlyDates.length > 0,
    complete: missingLateEarly.length === 0,
    missingDates: missingLateEarly,
    extraDates: [],
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
