export interface SkillEntry {
  id: string;
  category: string;
  skillName: string;
  experienceYears: string;
}

export interface Certification {
  id: string;
  name: string;
  acquiredDate: string;
}

export interface SkillSheetProfile {
  name: string;
  age: string;
  address: string;
  company: string;
  totalExperience: string;
  nearestStation: string;
  selfPR: string;
}

export const DEFAULT_SKILL_SHEET_PROFILE: SkillSheetProfile = {
  name: '',
  age: '',
  address: '',
  company: '',
  totalExperience: '',
  nearestStation: '',
  selfPR: '',
};

export interface WorkHistoryEntry {
  id: string;
  startDate: string;
  endDate: string;
  duration: string;
  clientType: string;
  systemName: string;
  machine: string;
  os: string;
  languages: string;
  db: string;
  tools: string;
  role: string;
  workProcess: string;
}

export const DEFAULT_CATEGORIES = [
  'プログラミング言語',
  'フレームワーク/ライブラリ',
  'データベース',
  'OS/インフラ',
  'ツール/その他',
] as const;
