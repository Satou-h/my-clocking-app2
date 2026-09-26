export type LeaveType = 'paid_leave' | 'am_leave' | 'pm_leave' | 'transfer_holiday';

export const LEAVE_LABELS: Record<LeaveType, string> = {
  paid_leave: '一日有給',
  am_leave: '午前休',
  pm_leave: '午後休',
  transfer_holiday: '振替休日',
};

// 取得日数（午前休・午後休は0.5日、それ以外は1日）
export function calcLeaveDays(entries: { leaveType: LeaveType }[]): number {
  return entries.reduce((sum, e) => sum + (e.leaveType === 'am_leave' || e.leaveType === 'pm_leave' ? 0.5 : 1), 0);
}

export interface LeaveApplicationRecord {
  id: string;
  applicationDate: string;
  name: string;
  dateEntries: { date: string; leaveType: LeaveType }[];
  reason: string;
}

export interface LateEarlyApplicationRecord {
  id: string;
  applicationDate: string;
  name: string;
  type: '遅刻' | '早退';
  targetDate: string;
  scheduledTime: string;
  actualTime: string;
  reason: string;
}
