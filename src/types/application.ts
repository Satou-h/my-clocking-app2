export type LeaveType = 'paid_leave' | 'am_leave' | 'pm_leave';

export const LEAVE_LABELS: Record<LeaveType, string> = {
  paid_leave: '一日有給',
  am_leave: '午前休',
  pm_leave: '午後休',
};

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
