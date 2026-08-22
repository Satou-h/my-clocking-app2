export type AttendanceType = 'work' | 'paid_leave' | 'planned_paid_leave' | 'holiday' | 'absence' | 'am_leave' | 'pm_leave' | 'scheduled_holiday_work' | 'legal_holiday_work';

export interface AttendanceRecord {
  id: string;
  date: string;
  type: AttendanceType;
  clockIn?: string;
  clockOut?: string;
  breakMinutes?: number;
  notes?: string;
  customStartTime?: string;
  customEndTime?: string;
  // 在宅勤務・徒歩圏内など、その日は交通費が発生しない場合に立てるフラグ
  noTransport?: boolean;
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
  planned_paid_leave: '計画有給',
  holiday: '休日',
  absence: '欠勤',
  am_leave: '午前休',
  pm_leave: '午後休',
  scheduled_holiday_work: '所定休日出勤',
  legal_holiday_work: '法定休日出勤',
};
