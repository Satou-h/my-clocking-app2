// 表示テーマ。auto は OS のダークモード設定に従う
export type Theme = 'auto' | 'light' | 'dark';

const THEME_KEY = 'theme';

export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 保存できなくても表示の切り替えは行う
  }
  applyTheme(theme);
}

// CSS 側は :root[data-theme="light" | "dark"] で OS 設定を上書きする
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
