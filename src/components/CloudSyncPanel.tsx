import { useState } from 'react';
import Icon from './Icon';
import { LoginForm } from './AuthScreens';
import { useCloudState, cloudStatus, signOut, syncNow, flushBeforeSignOut } from '../utils/cloudSync';

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 設定画面の「クラウド保存」欄（同期の状態・今すぐ同期・ログアウト） */
export default function CloudSyncPanel() {
  const cloud = useCloudState();
  const [busy, setBusy] = useState(false);
  const status = cloudStatus(cloud);

  async function handleSignOut() {
    setBusy(true);
    try {
      const pending = await flushBeforeSignOut();
      if (pending > 0 && !window.confirm(
        `クラウドにまだ送れていない変更が${pending}件あります。\nログアウトすると、この変更はクラウドに送られません（この端末には残ります）。ログアウトしますか？`,
      )) return;
      const error = await signOut();
      if (error) window.alert(`ログアウトできませんでした。\n${error}`);
    } finally {
      setBusy(false);
    }
  }

  // ログインが切れた端末（同期していた端末はそのまま使えるため、ここでログインし直す）
  if (cloud.phase === 'signed-out') {
    return (
      <section className="cloud-panel">
        <h3>クラウド保存</h3>
        <div className="notice-banner" role="status">
          <Icon name="alert" />
          <span>
            ログインが切れています。ログインし直すと、この端末で入力した内容をクラウドに送ります
            {cloud.pending > 0 && `（未送信 ${cloud.pending}件）`}。
          </span>
        </div>
        <LoginForm idPrefix="cloud" />
      </section>
    );
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
        入力するたびに自動でクラウドへ送り、アプリを開いたときや画面に戻ったときにほかの端末の変更を取り込みます。
        ログアウトするとログイン画面に戻ります（この端末のデータは消えません）。
      </p>
    </section>
  );
}
