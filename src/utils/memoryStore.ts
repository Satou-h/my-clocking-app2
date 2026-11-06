/**
 * memoryStore.ts — 画面で使うデータの置き場所（メモリ上だけに持ち、端末には保存しない）
 *
 * データの正はクラウド（Supabase）のデータベース。ログインしたときにデータベースから読み込んでここに入れ、
 * 保存した内容は cloudSync.ts がすぐにデータベースへ送る。ページを閉じたり再読み込みしたりすると消える。
 * 読み書きのたびに文字列にするのは、読み出した内容を画面側で書き換えても元のデータが変わらないようにするため。
 */
const items = new Map<string, string>();

export const memoryStore = {
  getItem(key: string): string | null {
    return items.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    items.set(key, value);
  },
  removeItem(key: string): void {
    items.delete(key);
  },
  keys(): string[] {
    return [...items.keys()];
  },
  clear(): void {
    items.clear();
  },
};
