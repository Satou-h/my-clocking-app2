import { useState, type FormEvent } from 'react';
import Icon from './Icon';
import { useCloudState, cloudStatus, signOut, syncNow, flushBeforeSignOut, updatePassword } from '../utils/cloudSync';

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ログイン中のパスワードを変える（管理者が作ったアカウントの初期パスワードを変えるときなど） */
function PasswordChangeForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('確認のパスワードが一致しません');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const err = await updatePassword(password);
      if (err) setError(err);
      else onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="password-change" onSubmit={handleSubmit}>
      <div className="form-row">
        <label htmlFor="new-password">新しいパスワード</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="form-row">
        <label htmlFor="new-password-confirm">確認のため、もう一度</label>
        <input
          id="new-password-confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <p className="form-hint">6文字以上で決めてください</p>
      {error && <p className="cloud-message cloud-message-error" role="alert">{error}</p>}
      <div className="cloud-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '変更中…' : 'パスワードを変える'}</button>
      </div>
    </form>
  );
}

/** 設定画面の「クラウド保存」欄（保存の状態・今すぐ同期・ログアウト） */
export default function CloudSyncPanel() {
  const cloud = useCloudState();
  const [busy, setBusy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
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
        <button
          type="button"
          className="btn btn-secondary"
          aria-expanded={changingPassword}
          onClick={() => { setChangingPassword(!changingPassword); setPasswordChanged(false); }}
        >
          パスワードを変更
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={handleSignOut}>ログアウト</button>
      </div>
      {changingPassword && (
        <PasswordChangeForm onDone={() => { setChangingPassword(false); setPasswordChanged(true); }} />
      )}
      {passwordChanged && <p className="cloud-message" role="status">パスワードを変更しました</p>}
      <p className="hint cloud-note">
        データはすべてクラウドのデータベースに保存し、この端末（ブラウザ）には残しません。
        入力するたびにすぐクラウドへ保存し、画面に戻ったときにほかの端末の変更を読み込みます。
        通信できないときは保存できず、ページを閉じると保存できていない変更は失われます。
      </p>
    </section>
  );
}
