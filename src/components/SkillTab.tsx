import { useState } from 'react';
import type { SkillEntry, Certification, SkillSheetProfile, WorkHistoryEntry } from '../types/skill';
import { DEFAULT_CATEGORIES } from '../types/skill';
import {
  loadSkillEntries, saveSkillEntries,
  loadSkillProfile, saveSkillProfile,
  loadCertifications, saveCertifications,
  loadWorkHistory, saveWorkHistory,
  generateId, loadUserProfile,
} from '../utils/storage';
import { printSkillSheet, printWorkHistory } from '../utils/skillPdf';

const EMPTY_FORM = { category: '', skillName: '', experienceYears: '' };
const EMPTY_CERT_FORM = { name: '', acquiredDate: '' };
const EMPTY_WH_FORM: Omit<WorkHistoryEntry, 'id'> = {
  startDate: '',
  endDate: '',
  duration: '',
  clientType: '',
  systemName: '',
  machine: 'PC',
  os: 'Win11',
  languages: '',
  db: '',
  tools: '',
  role: 'PG',
  workProcess: '',
};

export default function SkillTab() {
  const [profile, setProfile] = useState<SkillSheetProfile>(() => {
    const saved = loadSkillProfile();
    if (!saved.name) {
      const { lastName } = loadUserProfile();
      return { ...saved, name: lastName };
    }
    return saved;
  });
  const [certifications, setCertifications] = useState<Certification[]>(loadCertifications);
  const [certForm, setCertForm] = useState(EMPTY_CERT_FORM);
  const [workHistory, setWorkHistory] = useState<WorkHistoryEntry[]>(loadWorkHistory);
  const [whForm, setWhForm] = useState(EMPTY_WH_FORM);
  const [editingWhId, setEditingWhId] = useState<string | null>(null);
  const [entries, setEntries] = useState<SkillEntry[]>(loadSkillEntries);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  function updateProfile(field: keyof SkillSheetProfile, value: string) {
    const next = { ...profile, [field]: value };
    setProfile(next);
    saveSkillProfile(next);
  }

  function handleAddCert() {
    if (!certForm.name.trim()) return;
    const next = [...certifications, { ...certForm, id: generateId() }];
    setCertifications(next);
    saveCertifications(next);
    setCertForm(EMPTY_CERT_FORM);
  }

  function handleDeleteCert(id: string) {
    const next = certifications.filter((c) => c.id !== id);
    setCertifications(next);
    saveCertifications(next);
  }

  function persistWH(next: WorkHistoryEntry[]) {
    setWorkHistory(next);
    saveWorkHistory(next);
  }

  function handleWhSubmit() {
    if (!whForm.clientType.trim()) return;
    if (editingWhId) {
      persistWH(workHistory.map((e) => e.id === editingWhId ? { ...whForm, id: editingWhId } : e));
      setEditingWhId(null);
    } else {
      persistWH([...workHistory, { ...whForm, id: generateId() }]);
    }
    setWhForm(EMPTY_WH_FORM);
  }

  function handleWhEdit(entry: WorkHistoryEntry) {
    setEditingWhId(entry.id);
    setWhForm({
      startDate: entry.startDate, endDate: entry.endDate, duration: entry.duration,
      clientType: entry.clientType, systemName: entry.systemName,
      machine: entry.machine, os: entry.os, languages: entry.languages,
      db: entry.db, tools: entry.tools, role: entry.role, workProcess: entry.workProcess,
    });
  }

  function handleWhDelete(id: string) {
    persistWH(workHistory.filter((e) => e.id !== id));
    if (editingWhId === id) { setEditingWhId(null); setWhForm(EMPTY_WH_FORM); }
  }

  function handleWhCancel() {
    setEditingWhId(null);
    setWhForm(EMPTY_WH_FORM);
  }

  function persist(next: SkillEntry[]) {
    setEntries(next);
    saveSkillEntries(next);
  }

  function handleSubmit() {
    if (!form.skillName.trim() || !form.category.trim()) return;
    if (editingId) {
      persist(entries.map((e) => e.id === editingId ? { ...form, id: editingId } : e));
      setEditingId(null);
    } else {
      persist([...entries, { ...form, id: generateId() }]);
    }
    setForm(EMPTY_FORM);
  }

  function handleEdit(entry: SkillEntry) {
    setEditingId(entry.id);
    setForm({ category: entry.category, skillName: entry.skillName, experienceYears: entry.experienceYears });
  }

  function handleDelete(id: string) {
    persist(entries.filter((e) => e.id !== id));
    if (editingId === id) { setEditingId(null); setForm(EMPTY_FORM); }
  }

  function handleCancel() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function handlePrintSkillSheet() {
    const { employeeId, lastName } = loadUserProfile();
    printSkillSheet(profile, entries, certifications, employeeId, lastName)
      .catch((err: Error) => alert('PDF生成エラー: ' + err.message));
  }

  function handlePrintWorkHistory() {
    const { employeeId, lastName } = loadUserProfile();
    printWorkHistory(profile.name, workHistory, employeeId, lastName)
      .catch((err: Error) => alert('PDF生成エラー: ' + err.message));
  }

  const grouped = entries.reduce<Record<string, SkillEntry[]>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});

  const categoryOrder = [
    ...DEFAULT_CATEGORIES.filter((c) => grouped[c]),
    ...Object.keys(grouped).filter((c) => !DEFAULT_CATEGORIES.includes(c as never)),
  ];

  return (
    <div className="skill-tab">

      {/* ツールバー */}
      <div className="skill-toolbar">
        <button className="btn btn-pdf" onClick={handlePrintSkillSheet}>スキルシートPDF</button>
        <button className="btn btn-pdf" onClick={handlePrintWorkHistory}>スキル一覧PDF</button>
      </div>

      {/* 基本情報 */}
      <div className="skill-form-section">
        <h3 className="skill-form-title">基本情報</h3>
        <div className="skill-form-grid">
          <div className="form-row">
            <label>氏名</label>
            <input type="text" value={profile.name} onChange={(e) => updateProfile('name', e.target.value)} placeholder="例: 山田 太郎" />
          </div>
          <div className="form-row">
            <label>年齢</label>
            <input type="text" value={profile.age} onChange={(e) => updateProfile('age', e.target.value)} placeholder="例: 23" />
          </div>
          <div className="form-row">
            <label>住所</label>
            <input type="text" value={profile.address} onChange={(e) => updateProfile('address', e.target.value)} placeholder="例: 札幌市北区" />
          </div>
          <div className="form-row">
            <label>所属会社</label>
            <input type="text" value={profile.company} onChange={(e) => updateProfile('company', e.target.value)} placeholder="例: 株式会社〇〇" />
          </div>
          <div className="form-row">
            <label>経験年数</label>
            <input type="text" value={profile.totalExperience} onChange={(e) => updateProfile('totalExperience', e.target.value)} placeholder="例: 4年9ヵ月" />
          </div>
          <div className="form-row">
            <label>最寄駅</label>
            <input type="text" value={profile.nearestStation} onChange={(e) => updateProfile('nearestStation', e.target.value)} placeholder="例: 北24条駅" />
          </div>
          <div className="form-row">
            <label>自己PR</label>
            <textarea
              value={profile.selfPR}
              onChange={(e) => updateProfile('selfPR', e.target.value)}
              rows={5}
              placeholder="自己PRを入力..."
            />
          </div>
        </div>
      </div>

      {/* 保有資格 */}
      <div className="skill-form-section">
        <h3 className="skill-form-title">保有資格</h3>
        <div className="skill-form-grid">
          <div className="form-row">
            <label>資格名称</label>
            <input
              type="text"
              value={certForm.name}
              onChange={(e) => setCertForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="例: 基本情報技術者"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCert(); }}
            />
          </div>
          <div className="form-row">
            <label>取得年月</label>
            <input
              type="text"
              value={certForm.acquiredDate}
              onChange={(e) => setCertForm((p) => ({ ...p, acquiredDate: e.target.value }))}
              placeholder="例: 2023年4月"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCert(); }}
            />
          </div>
        </div>
        <div className="skill-form-actions">
          <button className="btn btn-primary" onClick={handleAddCert} disabled={!certForm.name.trim()}>追加</button>
        </div>
        {certifications.length > 0 && (
          <table className="skill-table">
            <thead>
              <tr>
                <th>資格名称</th>
                <th>取得年月</th>
                <th className="th-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {certifications.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="td-exp">{c.acquiredDate}</td>
                  <td className="td-actions">
                    <button className="btn-row-delete" onClick={() => handleDeleteCert(c.id)}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* スキル一覧（職歴） */}
      <div className="skill-form-section">
        <h3 className="skill-form-title">{editingWhId ? '職歴を編集' : '職歴を追加'}</h3>
        <div className="skill-form-grid">
          {/* 作業期間 */}
          <div className="wh-form-row-group">
            <div className="form-row">
              <label>開始年月</label>
              <input type="text" value={whForm.startDate} onChange={(e) => setWhForm((p) => ({ ...p, startDate: e.target.value }))} placeholder="2021.04" />
            </div>
            <div className="form-row">
              <label>終了年月</label>
              <input type="text" value={whForm.endDate} onChange={(e) => setWhForm((p) => ({ ...p, endDate: e.target.value }))} placeholder="2021.06" />
            </div>
            <div className="form-row">
              <label>期間</label>
              <input type="text" value={whForm.duration} onChange={(e) => setWhForm((p) => ({ ...p, duration: e.target.value }))} placeholder="3ヶ月" />
            </div>
          </div>
          {/* 業務内容 */}
          <div className="form-row">
            <label>業務内容</label>
            <input type="text" value={whForm.clientType} onChange={(e) => setWhForm((p) => ({ ...p, clientType: e.target.value }))} placeholder="例: 小売業向け" />
          </div>
          <div className="form-row">
            <label>システム名</label>
            <input type="text" value={whForm.systemName} onChange={(e) => setWhForm((p) => ({ ...p, systemName: e.target.value }))} placeholder="例: 会計期システム" />
          </div>
          {/* 環境 */}
          <div className="wh-form-row-group">
            <div className="form-row">
              <label>機種</label>
              <input type="text" value={whForm.machine} onChange={(e) => setWhForm((p) => ({ ...p, machine: e.target.value }))} placeholder="PC" />
            </div>
            <div className="form-row">
              <label>OS</label>
              <input type="text" value={whForm.os} onChange={(e) => setWhForm((p) => ({ ...p, os: e.target.value }))} placeholder="Win11" />
            </div>
            <div className="form-row">
              <label>DB</label>
              <input type="text" value={whForm.db} onChange={(e) => setWhForm((p) => ({ ...p, db: e.target.value }))} placeholder="Oracle 19c" />
            </div>
          </div>
          {/* 言語・ツール */}
          <div className="form-row">
            <label>言語</label>
            <textarea
              value={whForm.languages}
              onChange={(e) => setWhForm((p) => ({ ...p, languages: e.target.value }))}
              rows={3}
              placeholder="1行1言語で入力&#10;例:&#10;PL/SQL&#10;Excel VBA"
            />
          </div>
          <div className="form-row">
            <label>主要ツール</label>
            <textarea
              value={whForm.tools}
              onChange={(e) => setWhForm((p) => ({ ...p, tools: e.target.value }))}
              rows={2}
              placeholder="1行1ツール&#10;例: VSCODE"
            />
          </div>
          {/* 役割・工程 */}
          <div className="wh-form-row-group">
            <div className="form-row">
              <label>役割</label>
              <input type="text" value={whForm.role} onChange={(e) => setWhForm((p) => ({ ...p, role: e.target.value }))} placeholder="PG" />
            </div>
            <div className="form-row" style={{ flex: 2 }}>
              <label>作業工程</label>
              <input type="text" value={whForm.workProcess} onChange={(e) => setWhForm((p) => ({ ...p, workProcess: e.target.value }))} placeholder="例: 製造、単体テスト、結合テスト" />
            </div>
          </div>
        </div>
        <div className="skill-form-actions">
          <button className="btn btn-primary" onClick={handleWhSubmit} disabled={!whForm.clientType.trim()}>
            {editingWhId ? '更新' : '追加'}
          </button>
          {editingWhId && (
            <button className="btn btn-secondary" onClick={handleWhCancel}>キャンセル</button>
          )}
        </div>
        {workHistory.length > 0 && (
          <table className="skill-table">
            <thead>
              <tr>
                <th>作業期間</th>
                <th>業務内容 / システム名</th>
                <th>言語</th>
                <th className="th-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {workHistory.map((e) => (
                <tr key={e.id}>
                  <td className="td-exp">{e.startDate}{e.endDate ? ` ～ ${e.endDate}` : ' ～'}</td>
                  <td>{e.clientType}{e.systemName ? ` / ${e.systemName}` : ''}</td>
                  <td className="td-exp">{e.languages.split('\n').filter(Boolean).join('・')}</td>
                  <td className="td-actions">
                    <button className="btn-row-edit" onClick={() => handleWhEdit(e)}>編集</button>
                    <button className="btn-row-delete" onClick={() => handleWhDelete(e.id)}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* スキル追加フォーム */}
      <div className="skill-form-section">
        <h3 className="skill-form-title">{editingId ? 'スキルを編集' : 'スキルを追加'}</h3>
        <div className="skill-form-grid">
          <div className="form-row">
            <label>カテゴリ</label>
            <input
              list="category-list"
              type="text"
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              placeholder="例: プログラミング言語"
            />
            <datalist id="category-list">
              {DEFAULT_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="form-row">
            <label>スキル名</label>
            <input
              type="text"
              value={form.skillName}
              onChange={(e) => setForm((p) => ({ ...p, skillName: e.target.value }))}
              placeholder="例: TypeScript"
            />
          </div>
          <div className="form-row">
            <label>経験年数</label>
            <input
              type="text"
              value={form.experienceYears}
              onChange={(e) => setForm((p) => ({ ...p, experienceYears: e.target.value }))}
              placeholder="例: 3年 / 6ヶ月"
            />
          </div>
        </div>
        <div className="skill-form-actions">
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!form.skillName.trim() || !form.category.trim()}
          >
            {editingId ? '更新' : '追加'}
          </button>
          {editingId && (
            <button className="btn btn-secondary" onClick={handleCancel}>キャンセル</button>
          )}
        </div>
      </div>

      {/* スキル一覧テーブル */}
      {entries.length === 0 ? (
        <div className="skill-empty">スキルがまだ登録されていません。上のフォームから追加してください。</div>
      ) : (
        <div className="skill-table-wrapper">
          {categoryOrder.map((cat) => (
            <div key={cat} className="skill-category-block">
              <div className="skill-category-header">{cat}</div>
              <table className="skill-table">
                <thead>
                  <tr>
                    <th>スキル名</th>
                    <th>経験年数</th>
                    <th className="th-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[cat].map((entry) => (
                    <tr key={entry.id} className={editingId === entry.id ? 'tr-editing' : ''}>
                      <td>{entry.skillName}</td>
                      <td className="td-exp">{entry.experienceYears}</td>
                      <td className="td-actions">
                        <button className="btn-row-edit" onClick={() => handleEdit(entry)}>編集</button>
                        <button className="btn-row-delete" onClick={() => handleDelete(entry.id)}>削除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
