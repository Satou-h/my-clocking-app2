// 月末に出力・提出する書類（ダウンロードするPDFの種類。データベースに記録する提出の単位も同じ）
export const DOC_KEYS = ['attendance', 'transport', 'leave', 'lateEarly', 'workReport', 'skillSheet', 'workHistory'] as const;
export type DocKey = typeof DOC_KEYS[number];

export const DOC_LABELS: Record<DocKey, string> = {
  attendance: '勤務表',
  transport: '交通費',
  leave: '休暇申請書',
  lateEarly: '遅早退申請書',
  workReport: '作業報告書',
  skillSheet: 'スキルシート',
  workHistory: 'スキル一覧',
};

export function isDocKey(v: unknown): v is DocKey {
  return typeof v === 'string' && (DOC_KEYS as readonly string[]).includes(v);
}
