export type AttendanceType = 'work' | 'paid_leave' | 'planned_paid_leave' | 'holiday' | 'absence' | 'am_leave' | 'pm_leave' | 'scheduled_holiday_work' | 'legal_holiday_work'
  | 'transfer_holiday_work' | 'transfer_holiday';

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
  // 振替休日出勤の場合、代わりに休む振替休日の日付（YYYY-MM-DD）
  transferDate?: string;
}

// 月度ごとの有給設定。totalDays はその月の月初時点の有給残日数。
// month が無いデータ（旧形式の年度設定）はその年の1月の設定として扱う。
export interface PaidLeaveSettings {
  year: number;
  month?: number;
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
  transfer_holiday_work: '振替休日出勤',
  transfer_holiday: '振替休日',
};
