import { useState, type FormEvent, type ReactNode } from 'react';
import Icon from './Icon';
import {
  useCloudState, signIn, signUp, signOut, syncNow, requestPasswordReset, updatePassword, chooseInitialData,
  type DataCounts,
} from '../utils/cloudSync';

/**
 * ログインまわりの画面。ログインが済むまでは、いつもの画面の代わりにこれらを出す（Root.tsx）。
 */

function AuthLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="auth-screen">
      <div className={`auth-container ${wide ? 'auth-container-wide' : ''}`}>
        <div className="auth-brand">
          <span className="app-logo"><Icon name="clock" size={16} /></span>
          <h1>勤怠管理</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

// ログアウトできなかったとき（通信できないなど）は知らせる
async function signOutWithAlert(): Promise<void> {
  const error = await signOut();
  if (error) window.alert(`ログアウトできませんでした。\n${error}`);
}

type Mode = 'login' | 'signup' | 'reset';

const SUBMIT_LABEL: Record<Mode, string> = { login: 'ログイン', signup: '登録する', reset: '再設定メールを送る' };

/** メールアドレスとパスワードでのログイン・新規登録・パスワード再設定メールの送信 */
export function LoginForm({ idPrefix }: { idPrefix: string }) {
  const cloud = useCloudState();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(
    cloud.linkError ? { error: true, text: cloud.linkError } : null,
  );

  function switchMode(next: Mode) {
    setMode(next);
    setMessage(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'login') {
        const error = await signIn(addr, password);
        if (error) setMessage({ error: true, text: error });
      } else if (mode === 'signup') {
        const r = await signUp(addr, password);
        if (r.error) setMessage({ error: true, text: r.error });
        else if (r.needsConfirm) {
          setMessage({
            error: false,
            text: `${addr} に確認メールを送りました。メールのリンクを開くと登録が完了し、ログインした状態でこのアプリが開きます。`
              + '（すでに登録済みのアドレスの場合はメールは届きません。ログインしてください）',
          });
        }
      } else {
        const error = await requestPasswordReset(addr);
        setMessage(error
          ? { error: true, text: error }
          : { error: false, text: `登録済みのアドレスであれば、${addr} にパスワード再設定のメールを送りました。メールのリンクを開いて、新しいパスワードを決めてください。` });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-field">
        <label htmlFor={`${idPrefix}-email`}>メールアドレス</label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {mode !== 'reset' && (
        <div className="auth-field">
          <label htmlFor={`${idPrefix}-password`}>パスワード</label>
          <input
            id={`${idPrefix}-password`}
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'signup' ? 6 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'signup' && <span className="auth-hint">6文字以上で決めてください</span>}
        </div>
      )}
      {mode === 'reset' && (
        <p className="auth-hint">登録したメールアドレスに、新しいパスワードを決めるためのメールを送ります。</p>
      )}
      {message && (
        <p className={`cloud-message ${message.error ? 'cloud-message-error' : ''}`} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
        {busy ? '送信中…' : SUBMIT_LABEL[mode]}
      </button>
      <div className="auth-links">
        {mode === 'login' && (
          <>
            <span>初めての方は <button type="button" className="btn-link" onClick={() => switchMode('signup')}>新規登録</button></span>
            <button type="button" className="btn-link" onClick={() => switchMode('reset')}>パスワードを忘れた場合</button>
          </>
        )}
        {mode === 'signup' && (
          <span>登録済みの方は <button type="button" className="btn-link" onClick={() => switchMode('login')}>ログイン</button></span>
        )}
        {mode === 'reset' && (
          <button type="button" className="btn-link" onClick={() => switchMode('login')}>ログインに戻る</button>
        )}
      </div>
    </form>
  );
}

/** 起動時、ログインしていないときに最初に出す画面 */
export function LoginScreen() {
  const cloud = useCloudState();
  return (
    <AuthLayout>
      <div className="auth-card">
        <h2>ログイン</h2>
        <p className="auth-lead">
          データはクラウドに保存します。パソコンとスマホで同じアカウントにログインすると、同じデータを使えます。
        </p>
        {cloud.pending > 0 && (
          <p className="cloud-message cloud-message-error" role="alert">
            ログインが切れたため、クラウドに保存できていない変更が{cloud.pending}件あります。
            このページを閉じずに、同じアカウントでログインし直すと保存します。
          </p>
        )}
        <LoginForm idPrefix="login" />
      </div>
    </AuthLayout>
  );
}

/** ログイン状態を確かめている間 */
export function AuthLoading() {
  return (
    <AuthLayout>
      <div className="auth-card">
        <div className="auth-loading" role="status">
          <span className="auth-spinner" aria-hidden="true" />
          <p>読み込んでいます…</p>
        </div>
      </div>
    </AuthLayout>
  );
}

function countText(c: DataCounts): string[] {
  return [
    `勤怠 ${c.attendance}日`,
    `交通費 ${c.transport}件`,
    `申請書 ${c.applications}件`,
    `作業報告 ${c.workReports}か月`,
    `社員情報・スキル表など ${c.others ? 'あり' : 'なし'}`,
  ];
}

/** ログインした端末に以前の版で保存したデータが残っていて、クラウドにもデータがあったときの選択 */
function CloudChoice() {
  const cloud = useCloudState();
  const [busy, setBusy] = useState(false);
  if (!cloud.choice) return null;
  const { local, cloud: remote } = cloud.choice;

  async function choose(source: 'local' | 'cloud') {
    const message = source === 'cloud'
      ? 'クラウドのデータを使い、この端末に残っているデータは消します。\nこの端末にしかないデータは消え、元に戻せません。よろしいですか？'
      : 'クラウドのデータを、この端末に残っているデータで上書きします。\nクラウドにしかないデータは消え、元に戻せません。よろしいですか？';
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      await chooseInitialData(source);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cloud-choice" aria-labelledby="cloud-choice-title">
      <h2 id="cloud-choice-title">どちらのデータを使いますか？</h2>
      <p className="auth-lead">
        この端末に、以前の版で保存したデータが残っています。データはクラウドだけに保存するようになったため、
        クラウドのデータとどちらを使うか選んでください。選んだあと、この端末のデータは消します。
      </p>
      <div className="cloud-choice-grid">
        <div className="cloud-choice-col">
          <strong>この端末に残っているデータ</strong>
          <ul>{countText(local).map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
        <div className="cloud-choice-col">
          <strong>クラウド</strong>
          <ul>{countText(remote).map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      </div>
      <p className="hint">
        別の端末で先にログインしてデータを送ってある場合は「クラウドのデータを使う」を選んでください。
        選ばなかった方のデータは消えます（2つを合わせることはできません）。
      </p>
      {cloud.error && <p className="cloud-message cloud-message-error" role="alert">{cloud.error}</p>}
      <div className="cloud-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => choose('cloud')}>
          クラウドのデータを使う
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => choose('local')}>
          この端末のデータでクラウドを上書きする
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={signOutWithAlert}>
          ログアウト
        </button>
      </div>
    </section>
  );
}

/** ログイン直後: クラウドからの読み込み・どちらのデータを使うかの選択 */
export function SetupScreen() {
  const cloud = useCloudState();
  if (cloud.phase === 'needs-choice') {
    return (
      <AuthLayout wide>
        <CloudChoice />
        {cloud.email && <p className="auth-email">ログイン中: {cloud.email}</p>}
      </AuthLayout>
    );
  }
  const failed = cloud.phase === 'error' || cloud.phase === 'offline';
  return (
    <AuthLayout>
      <div className="auth-card">
        {failed ? (
          <>
            <h2>クラウドに接続できませんでした</h2>
            <p className="cloud-message cloud-message-error" role="alert">
              {cloud.error ?? '通信状態を確認して、やり直してください。'}
            </p>
            <p className="auth-hint">データはクラウドだけに保存しているため、接続できるまで使えません。</p>
            <div className="cloud-actions">
              <button type="button" className="btn btn-primary" onClick={() => { void syncNow(); }}>やり直す</button>
              <button type="button" className="btn btn-secondary" onClick={signOutWithAlert}>ログアウト</button>
            </div>
          </>
        ) : (
          <div className="auth-loading" role="status">
            <span className="auth-spinner" aria-hidden="true" />
            <p>クラウドからデータを読み込んでいます…</p>
          </div>
        )}
      </div>
      {cloud.email && <p className="auth-email">ログイン中: {cloud.email}</p>}
    </AuthLayout>
  );
}

/** パスワード再設定メールのリンクから開いたとき */
export function PasswordResetScreen() {
  const cloud = useCloudState();
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
      setError(await updatePassword(password));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <h2>新しいパスワード</h2>
        <p className="auth-lead">{cloud.email} の新しいパスワードを決めてください。</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="reset-password">新しいパスワード</label>
            <input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="auth-hint">6文字以上で決めてください</span>
          </div>
          <div className="auth-field">
            <label htmlFor="reset-password-confirm">確認のため、もう一度</label>
            <input
              id="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && <p className="cloud-message cloud-message-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? '設定中…' : 'パスワードを設定する'}
          </button>
          <div className="auth-links">
            <button type="button" className="btn-link" onClick={signOutWithAlert}>ログアウト</button>
          </div>
        </form>
      </div>
    </AuthLayout>
  );
}
