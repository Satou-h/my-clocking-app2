import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import {
  calcWorkMinutes, calcOvertimeMinutes, calcLateNightMinutes,
  isLateArrival, isEarlyDeparture, getEffectiveBreak,
} from './storage';

export interface MonthlySummary {
  workDays: number;
  scheduledHolidayDays: number;
  legalHolidayDays: number;
  workMins: number;
  overtimeMins: number;
  legalHolidayMins: number;
  lateNightMins: number;
  lateCount: number;
  earlyCount: number;
  paidDays: number;
}

export const isWorkType = (type: string) =>
  type === 'work' || type === 'am_leave' || type === 'pm_leave'
  || type === 'scheduled_holiday_work' || type === 'legal_holiday_work' || type === 'transfer_holiday_work';

// 月次集計（実際の登録レコードのみ）
export function calcMonthlySummary(
  records: AttendanceRecord[],
  workSettings: WorkSettings,
  year: number,
  month: number,
): MonthlySummary {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthRecords = records.filter((r) => r.date.startsWith(prefix));

  const summary = monthRecords.reduce(
    (acc, r) => {
      if (!isWorkType(r.type) || !r.clockIn || !r.clockOut) return acc;
      const effBreak = getEffectiveBreak(r.type, r.clockIn, r.clockOut, r.breakMinutes ?? 0);
      const work = calcWorkMinutes(r.clockIn, r.clockOut, effBreak);
      const ln = calcLateNightMinutes(r.clockIn, r.clockOut);
      const refStart = r.customStartTime ?? workSettings.standardStartTime;
      const refEnd = r.customEndTime ?? workSettings.standardEndTime;
      const isHalf = r.type === 'am_leave' || r.type === 'pm_leave';
      const late = !isHalf && isLateArrival(r.clockIn, refStart);
      const early = !isHalf && isEarlyDeparture(r.clockOut, refEnd, r.clockIn);
      // 所定休日出勤は全時間を残業に加算、法定休日出勤は専用集計
      const ot = r.type === 'scheduled_holiday_work' ? work
        : r.type === 'legal_holiday_work' ? 0
        : calcOvertimeMinutes(work);
      const legalHoliday = r.type === 'legal_holiday_work' ? work : 0;
      return {
        ...acc,
        workDays: acc.workDays + (r.type === 'work' || r.type === 'transfer_holiday_work' ? 1 : 0),
        scheduledHolidayDays: acc.scheduledHolidayDays + (r.type === 'scheduled_holiday_work' ? 1 : 0),
        legalHolidayDays: acc.legalHolidayDays + (r.type === 'legal_holiday_work' ? 1 : 0),
        workMins: acc.workMins + work,
        overtimeMins: acc.overtimeMins + ot,
        legalHolidayMins: acc.legalHolidayMins + legalHoliday,
        lateNightMins: acc.lateNightMins + ln,
        lateCount: acc.lateCount + (late ? 1 : 0),
        earlyCount: acc.earlyCount + (early ? 1 : 0),
      };
    },
    { workDays: 0, scheduledHolidayDays: 0, legalHolidayDays: 0, workMins: 0, overtimeMins: 0, legalHolidayMins: 0, lateNightMins: 0, lateCount: 0, earlyCount: 0, paidDays: 0 },
  );

  summary.paidDays = monthRecords.reduce((acc, r) => {
    if (r.type === 'paid_leave' || r.type === 'planned_paid_leave') return acc + 1;
    if (r.type === 'am_leave' || r.type === 'pm_leave') return acc + 0.5;
    return acc;
  }, 0);

  return summary;
}
