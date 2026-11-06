/**
 * syncHooks.ts — localStorage への保存をクラウド同期（cloudSync.ts）に知らせる仕組み
 *
 * 保存処理（storage.ts / workReport.ts）は同期処理に依存させず、ここを通して書き込む。
 * ログインしていないときは何もせず、そのまま書き込む。
 */

// 同期の単位（Supabase のテーブルに対応）
export type CollectionId =
  | 'attendance' | 'transport' | 'paidLeave' | 'leave' | 'lateEarly' | 'workReport' | 'skill' | 'profile';

type Tracker = (collection: CollectionId, write: () => void) => void;

let tracker: Tracker | null = null;
let suppressed = 0;

export function setWriteTracker(t: Tracker | null): void {
  tracker = t;
}

export function trackedWrite(collection: CollectionId, write: () => void): void {
  if (!tracker || suppressed > 0) {
    write();
    return;
  }
  tracker(collection, write);
}

// クラウドから取り込んだ内容の書き込みなど、送り返す必要のない書き込みに使う
export function withoutTracking(fn: () => void): void {
  suppressed++;
  try {
    fn();
  } finally {
    suppressed--;
  }
}
