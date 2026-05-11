export type AttendanceType = 'work' | 'paid_leave' | 'holiday' | 'absence';

export interface AttendanceRecord {
  id: string;
  date: string;
  type: AttendanceType;
  clockIn?: string;
  clockOut?: string;
  breakMinutes?: number;
  notes?: string;
}

export interface PaidLeaveSettings {
  year: number;
  totalDays: number;
}

export interface WorkSettings {
  standardStartTime: string;
  standardEndTime: string;
}

export const DEFAULT_WORK_SETTINGS: WorkSettings = {
  standardStartTime: '09:00',
  standardEndTime: '18:00',
};

export const ATTENDANCE_TYPE_LABELS: Record<AttendanceType, string> = {
  work: '出勤',
  paid_leave: '有給休暇',
  holiday: '休日',
  absence: '欠勤',
};
