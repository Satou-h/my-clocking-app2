import { useState } from 'react';
import Icon from './Icon';
import { useCloudState, cloudStatus, signOut, syncNow, flushBeforeSignOut } from '../utils/cloudSync';

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 設定画面の「クラウド保存」欄（保存の状態・今すぐ同期・ログアウト） */
export default function CloudSyncPanel() {
  const cloud = useCloudState();
  const [busy, setBusy] = useState(false);
  const status = cloudStatus(cloud);

  async function handleSignOut() {
    setBusy(true);
    try {
      const pending = await flushBeforeSignOut();
      if (pending > 0 && !window.confirm(
        `クラウドにまだ保存できていない変更が${pending}件あります。\nログアウトすると、この変更は失われます。ログアウトしますか？`,
      )) return;
      const error = await signOut();
      if (error) window.alert(`ログアウトできませんでした。\n${error}`);
    } finally {
      setBusy(false);
    }
  }

  const working = cloud.phase === 'checking' || cloud.phase === 'syncing';
  return (
    <section className="cloud-panel">
      <h3>クラウド保存</h3>
      <div className={`cloud-status cloud-tone-${status.tone}`} role="status">
        <Icon name="cloud" size={20} />
        <div>
          <strong>{status.label}</strong>
          <span>{cloud.email}</span>
          {cloud.lastSyncedAt && <span>最終同期 {fmtTime(cloud.lastSyncedAt)}</span>}
        </div>
      </div>
      <div className="cloud-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || working}
          onClick={() => { void syncNow(); }}
        >
          今すぐ同期
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={handleSignOut}>ログアウト</button>
      </div>
      <p className="hint cloud-note">
        データはすべてクラウドのデータベースに保存し、この端末（ブラウザ）には残しません。
        入力するたびにすぐクラウドへ保存し、画面に戻ったときにほかの端末の変更を読み込みます。
        通信できないときは保存できず、ページを閉じると保存できていない変更は失われます。
      </p>
    </section>
  );
}
