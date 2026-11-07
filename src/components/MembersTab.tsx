import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ROLES, ROLE_LABELS, canBeManager, createAccount, generatePassword, joinFullName, listMembers, setMember,
  type Member, type MemberRole,
} from '../utils/members';
import { useCloudState } from '../utils/cloudSync';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function displayName(m: Member): string {
  return m.fullName.trim() || m.lastName.trim() || '（氏名未設定）';
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'まだログインしていません';
  const d = new Date(iso);
  return `最終ログイン ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// 上長の選択肢（役割が上長・管理者の人。本人は除く）
function ManagerOptions({ members, exclude }: { members: Member[]; exclude?: string }) {
  return (
    <>
      <option value="">なし</option>
      {members.filter((m) => canBeManager(m.role) && m.userId !== exclude).map((m) => (
        <option key={m.userId} value={m.userId}>
          {displayName(m)}（{m.email}）
        </option>
      ))}
    </>
  );
}

type Message = { error: boolean; text: string } | null;

function MessageLine({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p className={`cloud-message ${message.error ? 'cloud-message-error' : ''}`} role={message.error ? 'alert' : 'status'}>
      {message.text}
    </p>
  );
}

/** 一覧の1人分（役割と上長を変えて保存する） */
function MemberCard({ member, members, isYou, onSaved }: {
  member: Member; members: Member[]; isYou: boolean; onSaved: (role: MemberRole) => Promise<void>;
}) {
  const [role, setRole] = useState<MemberRole>(member.role);
  const [managerId, setManagerId] = useState(member.managerId ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  // 読み直した一覧で役割・上長が変わっていたら、選択をその内容に戻す
  const [loaded, setLoaded] = useState({ role: member.role, managerId: member.managerId });
  if (loaded.role !== member.role || loaded.managerId !== member.managerId) {
    setLoaded({ role: member.role, managerId: member.managerId });
    setRole(member.role);
    setManagerId(member.managerId ?? '');
  }
  const changed = role !== member.role || managerId !== (member.managerId ?? '');

  async function handleSave() {
    if (isYou && member.role === 'admin' && role !== 'admin' && !window.confirm(
      '自分を管理者から外すと、この画面を使えなくなります。よろしいですか？',
    )) return;
    setBusy(true);
    setMessage(null);
    try {
      await setMember(member.userId, role, managerId || null);
      setMessage({ error: false, text: '保存しました' });
      await onSaved(role);
    } catch (e) {
      setMessage({ error: true, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="member-card">
      <div className="member-head">
        <strong className="member-name">
          {displayName(member)}
          {member.employeeId && <span className="member-employee-id">{member.employeeId}</span>}
          {isYou && <span className="member-you">あなた</span>}
        </strong>
        <span className="member-meta">{member.email}</span>
        <span className="member-meta">{fmtDate(member.lastSignInAt)}</span>
      </div>
      <div className="member-controls">
        <label className="member-field">
          <span>役割</span>
          <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} disabled={busy}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        <label className="member-field">
          <span>リーダー</span>
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)} disabled={busy}>
            <ManagerOptions members={members} exclude={member.userId} />
          </select>
        </label>
        <button type="button" className="btn btn-primary btn-sm member-save" disabled={!changed || busy} onClick={handleSave}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
      <MessageLine message={message} />
    </li>
  );
}

/** 管理者用: 社員のアカウントを作り、役割と上長を設定する */
export default function MembersTab({ onMyRoleChange }: { onMyRoleChange: (role: MemberRole) => void }) {
  const cloud = useCloudState();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [role, setRole] = useState<MemberRole>('member');
  const [managerId, setManagerId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<Message>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listMembers();
      setMembers(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    listMembers().then(
      (list) => { if (alive) setMembers(list); },
      (e) => { if (alive) setLoadError(errorText(e)); },
    );
    return () => { alive = false; };
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!lastName.trim() || !firstName.trim()) {
      setCreateMessage({ error: true, text: '苗字と名前を入力してください' });
      return;
    }
    const addr = email.trim();
    const fullName = joinFullName(lastName, firstName);
    setCreating(true);
    setCreateMessage(null);
    try {
      const userId = await createAccount(addr, password, lastName, firstName);
      let text = `${fullName}さん（${addr}）のアカウントを作りました。メールアドレスと初期パスワード「${password}」を本人に伝え、`
        + 'ログインしたら設定画面でパスワードを変えるよう伝えてください。';
      let error = false;
      if (role !== 'member' || managerId) {
        try {
          await setMember(userId, role, managerId || null);
        } catch (err) {
          text += `\nただし、役割・リーダーを設定できませんでした（${errorText(err)}）。下の一覧で設定し直してください。`;
          error = true;
        }
      }
      setCreateMessage({ error, text });
      setLastName('');
      setFirstName('');
      setEmail('');
      setPassword(generatePassword());
      setRole('member');
      setManagerId('');
      await refresh();
    } catch (err) {
      setCreateMessage({ error: true, text: errorText(err) });
    } finally {
      setCreating(false);
    }
  }

  const list = members ?? [];

  return (
    <div className="members-tab">
      <h2>ユーザー管理</h2>
      <p className="hint">
        社員のアカウントを作り、役割とリーダーを設定します。この画面は管理者だけが使えます。
      </p>
      <ul className="member-roles">
        <li><strong>一般</strong>：自分のデータだけを見られます</li>
        <li><strong>リーダー</strong>：自分と、自分がリーダーに設定されているメンバーのデータを見られます</li>
        <li><strong>管理者</strong>：全員のデータを見られ、この画面でアカウントの作成と設定ができます</li>
      </ul>

      <h3>アカウントを作る</h3>
      <p className="hint">
        確認メールは送りません。作ったら、メールアドレスと初期パスワードを本人に伝えてください。
        苗字・名前は本人の設定（苗字）と書類の氏名に自動で入り、印鑑も苗字から作られます。
      </p>
      <form onSubmit={handleCreate}>
        <div className="form-row">
          <label htmlFor="member-last-name">苗字</label>
          <input
            id="member-last-name"
            type="text"
            required
            maxLength={20}
            autoComplete="off"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="例: 佐藤"
          />
        </div>
        <div className="form-row">
          <label htmlFor="member-first-name">名前</label>
          <input
            id="member-first-name"
            type="text"
            required
            maxLength={20}
            autoComplete="off"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="例: 太郎"
          />
        </div>
        <div className="form-row">
          <label htmlFor="member-email">メールアドレス</label>
          <input
            id="member-email"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="例: taro@example.com"
          />
        </div>
        <div className="form-row">
          <label htmlFor="member-password">初期パスワード</label>
          <div className="member-password">
            <input
              id="member-password"
              type="text"
              required
              minLength={6}
              autoComplete="off"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPassword(generatePassword())}>
              作り直す
            </button>
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="member-role">役割</label>
          <select id="member-role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="member-manager">リーダー</label>
          <select id="member-manager" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <ManagerOptions members={list} />
          </select>
        </div>
        <MessageLine message={createMessage} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? '作成中…' : 'アカウントを作る'}
          </button>
        </div>
      </form>

      <h3>メンバー</h3>
      <p className="hint">リーダーには、役割が「リーダー」か「管理者」の人を選べます。</p>
      {loadError && (
        <div className="cloud-message cloud-message-error" role="alert">
          メンバーの一覧を読み込めませんでした（{loadError}）
          <div className="cloud-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void refresh(); }}>やり直す</button>
          </div>
        </div>
      )}
      {!members && !loadError && <p className="hint">読み込んでいます…</p>}
      {members && (
        <ul className="member-list">
          {members.map((m) => {
            const isYou = !!cloud.email && m.email === cloud.email.toLowerCase();
            return (
              <MemberCard
                key={m.userId}
                member={m}
                members={members}
                isYou={isYou}
                onSaved={async (role) => {
                  // 自分を管理者から外したときは、この画面を閉じる
                  if (isYou && role !== 'admin') onMyRoleChange(role);
                  else await refresh();
                }}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
