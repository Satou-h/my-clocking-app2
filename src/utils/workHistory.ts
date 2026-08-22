// 職歴の年月は <input type="month"> の値（YYYY-MM）を正として扱う。
// 旧データ（"2021.04" 等）や表示用の "YYYY/MM" もあわせて受け付けて正規化する。
export function normalizeYearMonth(s: string): string {
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})$/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}`;
}

// 表示用に "YYYY/MM" 形式へ変換する。認識できない値はそのまま返す。
export function fmtYearMonth(s: string): string {
  const norm = normalizeYearMonth(s) || s;
  const m = norm.match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : s;
}

// 開始年月・終了年月（YYYY-MM）から期間を算出する。終了年月が未入力の場合は現在までとする。
export function calcDurationLabel(startDate: string, endDate: string): string {
  const start = normalizeYearMonth(startDate);
  if (!start) return '';
  const [sy, sm] = start.split('-').map(Number);

  let ey: number, em: number;
  const end = normalizeYearMonth(endDate);
  if (end) {
    [ey, em] = end.split('-').map(Number);
  } else {
    const now = new Date();
    ey = now.getFullYear();
    em = now.getMonth() + 1;
  }

  const totalMonths = Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years > 0 && months > 0) return `${years}年${months}ヶ月`;
  if (years > 0) return `${years}年`;
  return `${months}ヶ月`;
}
