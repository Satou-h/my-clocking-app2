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

// 職歴フォームのドロップダウン候補（候補外の手入力も可能）
export const OS_OPTIONS = [
  'Win11', 'Win10', 'Windows Server 2022', 'Windows Server 2019', 'Windows Server 2016',
  'Linux', 'RHEL', 'CentOS', 'Ubuntu', 'AlmaLinux', 'Amazon Linux',
  'macOS', 'UNIX', 'AIX', 'Solaris', 'iOS', 'Android',
] as const;

export const DB_OPTIONS = [
  'Oracle', 'SQL Server', 'MySQL', 'PostgreSQL', 'MariaDB', 'SQLite', 'Db2',
  'Access', 'MongoDB', 'Redis', 'DynamoDB', 'Firebase',
] as const;

export const LANGUAGE_OPTIONS = [
  'Java', 'C', 'C++', 'C#', 'VB.NET', 'VB6', 'Excel VBA', 'Access VBA',
  'COBOL', 'PL/SQL', 'SQL', 'Python', 'PHP', 'Ruby', 'Go', 'Kotlin', 'Swift',
  'JavaScript', 'TypeScript', 'HTML/CSS', 'Shell', 'PowerShell',
] as const;

export const DEFAULT_CATEGORIES = [
  'プログラミング言語',
  'フレームワーク/ライブラリ',
  'データベース',
  'OS/インフラ',
  'ツール/その他',
] as const;
