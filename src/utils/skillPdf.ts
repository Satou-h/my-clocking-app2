// スキルシート（情報処理技術者 経歴書）・スキル一覧PDF（pdf-lib・A4横）
// 勤務表・交通費・作業状況報告書と同じデザインでそろえる
import { PDFDocument, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { SkillEntry, Certification, SkillSheetProfile, WorkHistoryEntry } from '../types/skill';
import { fmtYearMonth } from './workHistory';
import { C, createPainter, downloadPdf, drawParagraph, loadFont, type Painter } from './pdfKit';

const W = 841.89, H = 595.28; // A4 横
const M = { l: 28, r: 28, t: 22, b: 18 };
const RIGHT = W - M.r;

function filename(prefix: string, employeeId: string, lastName: string): string {
  const user = (employeeId || lastName) ? `_${employeeId}${lastName}` : '';
  return `${prefix}${user}.pdf`;
}

// タイトル・氏名・青い区切り線（右側に注記を入れられる）
function drawHeader(p: Painter, title: string, name: string, note = '') {
  p.txt(title, M.l, M.t + 18, 17, C.primary);
  const metaY = M.t + 40;
  p.txt('氏名', M.l, metaY, 7, C.sub);
  p.txt(name, M.l + p.width('氏名', 7) + 5, metaY, 11, C.ink);
  if (note) p.txt(note, RIGHT - p.width(note, 6.5), metaY, 6.5, C.sub);
  p.hline(M.l, RIGHT, M.t + 48, C.primary, 1.2);
}

// 左端の見出し帯（保有資格・開発経験・自己PR）
function drawBand(p: Painter, label: string, y: number, h: number, w: number) {
  p.rect(M.l, y, w, h, { fill: C.primarySoft });
  p.cell(label, M.l, y, w, h, 8, C.primary, 'center');
}

// 青い見出し行。cols は [見出し, 幅]。区切りは白の細線
function drawHeadRow(p: Painter, x: number, y: number, h: number, cols: [string, number][]) {
  const total = cols.reduce((a, [, w]) => a + w, 0);
  p.rect(x, y, total, h, { fill: C.primary });
  let cx = x;
  cols.forEach(([label, w], i) => {
    p.cell(label, cx, y, w, h, 7.5, C.white, 'center');
    if (i > 0) p.vline(cx, y + 4, y + h - 4, C.white, 0.4, 0.35);
    cx += w;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// スキルシート（情報処理技術者 経歴書）
// ══════════════════════════════════════════════════════════════════════════════

export async function buildSkillSheetPdf(
  fontBytes: ArrayBuffer | Uint8Array,
  profile: SkillSheetProfile,
  entries: SkillEntry[],
  certifications: Certification[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // サブセット化は loadFont() で詰め直したフォントが前提
  const font = await doc.embedFont(fontBytes, { subset: true });
  doc.setTitle(`情報処理技術者 経歴書 ${profile.name}`);

  const page = doc.addPage([W, H]);
  const p = createPainter(page, font);
  drawHeader(p, '情報処理技術者 経歴書', profile.name, '※同プロジェクトで複数の言語等を扱った場合は期間の重複があります');

  // ── 基本情報（年齢・経験年数・所属会社・住所・最寄駅） ────────────────────
  const infoY = M.t + 60, infoH = 40;
  const info: [string, string, number][] = [
    ['年齢', profile.age ? `${profile.age}才` : '', 80],
    ['経験年数', profile.totalExperience, 110],
    ['所属会社', profile.company, 210],
    ['住所', profile.address, 0],
    ['最寄駅', profile.nearestStation, 150],
  ];
  info[3][2] = RIGHT - M.l - info.reduce((a, [, , w]) => a + w, 0);
  p.rect(M.l, infoY, RIGHT - M.l, infoH, { stroke: C.line, bw: 0.7 });
  let ix = M.l;
  info.forEach(([label, value, w], i) => {
    if (i > 0) p.vline(ix, infoY + 8, infoY + infoH - 8, C.line, 0.5);
    p.txt(label, ix + 10, infoY + 14, 6.5, C.sub);
    if (value) p.txt(p.fit(value, 10, w - 20), ix + 10, infoY + 31, 10, C.ink);
    ix += w;
  });

  const bandW = 56;
  const tx = M.l + bandW, tw = RIGHT - tx;
  const hH = 18, rowH = 18, gap = 10;
  const fs = 8;

  // ── 保有資格（2列で並べる） ───────────────────────────────────────────────
  const certY = infoY + infoH + 12;
  const certRows = Math.max(Math.ceil(certifications.length / 2), 3);
  const dateW = 72, certNameW = (tw - dateW * 2) / 2;
  const certH = hH + rowH * certRows;
  drawBand(p, '保有資格', certY, certH, bandW);
  drawHeadRow(p, tx, certY, hH, [['IT関係資格名称', certNameW], ['取得年月', dateW], ['IT関係資格名称', certNameW], ['取得年月', dateW]]);
  for (let r = 0; r < certRows; r++) {
    const y = certY + hH + rowH * r;
    if (r > 0) p.hline(tx, RIGHT, y, C.line, 0.45);
    [certifications[r * 2], certifications[r * 2 + 1]].forEach((c, k) => {
      if (!c) return;
      const x = tx + (certNameW + dateW) * k;
      p.cell(p.fit(c.name, fs, certNameW - 16), x, y, certNameW, rowH, fs, C.ink, 'left');
      p.cell(p.fit(c.acquiredDate, 7.5, dateW - 8), x + certNameW, y, dateW, rowH, 7.5, C.ink, 'center');
    });
  }
  p.vline(tx + certNameW, certY + hH, certY + certH, C.line, 0.5);
  p.vline(tx + certNameW + dateW, certY + hH, certY + certH, C.lineStrong, 0.6);
  p.vline(tx + certNameW * 2 + dateW, certY + hH, certY + certH, C.line, 0.5);
  p.rect(M.l, certY, RIGHT - M.l, certH, { stroke: C.lineStrong, bw: 0.7 });

  // ── 開発経験（言語を3列・DBを1列） ───────────────────────────────────────
  const DB_CAT = 'データベース';
  const nonDB = entries.filter(e => e.category !== DB_CAT);
  const dbSkills = entries.filter(e => e.category === DB_CAT);
  const per = Math.ceil(nonDB.length / 3) || 1;
  const skillCols = [nonDB.slice(0, per), nonDB.slice(per, per * 2), nonDB.slice(per * 2), dbSkills];
  const skillRows = Math.max(...skillCols.map(c => c.length), 2);
  const expW = 58, skillNameW = (tw - expW * 4) / 4;
  const skillY = certY + certH + gap;
  const skillH = hH + rowH * skillRows;
  drawBand(p, '開発経験', skillY, skillH, bandW);
  drawHeadRow(p, tx, skillY, hH, [
    ['言語', skillNameW], ['経験年数', expW], ['言語', skillNameW], ['経験年数', expW],
    ['言語', skillNameW], ['経験年数', expW], ['DB', skillNameW], ['経験年数', expW],
  ]);
  for (let r = 0; r < skillRows; r++) {
    const y = skillY + hH + rowH * r;
    if (r > 0) p.hline(tx, RIGHT, y, C.line, 0.45);
    skillCols.forEach((col, k) => {
      const e = col[r];
      if (!e) return;
      const x = tx + (skillNameW + expW) * k;
      p.cell(p.fit(e.skillName, fs, skillNameW - 16), x, y, skillNameW, rowH, fs, C.ink, 'left');
      p.cell(p.fit(e.experienceYears, 7.5, expW - 8), x + skillNameW, y, expW, rowH, 7.5, C.ink, 'center');
    });
  }
  for (let k = 0; k < 4; k++) {
    const x = tx + (skillNameW + expW) * k;
    if (k > 0) p.vline(x, skillY + hH, skillY + skillH, k === 3 ? C.lineStrong : C.line, k === 3 ? 0.6 : 0.5);
    p.vline(x + skillNameW, skillY + hH, skillY + skillH, C.line, 0.5);
  }
  p.rect(M.l, skillY, RIGHT - M.l, skillH, { stroke: C.lineStrong, bw: 0.7 });

  // ── 自己PR（残りの高さをすべて使う） ─────────────────────────────────────
  const prY = skillY + skillH + gap;
  const prH = Math.max(60, H - M.b - prY);
  drawBand(p, '自己PR', prY, prH, bandW);
  drawParagraph(p, profile.selfPR, tx, prY, tw, prH, 9, 10);
  p.rect(M.l, prY, RIGHT - M.l, prH, { stroke: C.lineStrong, bw: 0.7 });

  return doc.save();
}

export async function printSkillSheet(
  profile: SkillSheetProfile,
  entries: SkillEntry[],
  certifications: Certification[],
  employeeId = '',
  lastName = '',
): Promise<void> {
  const bytes = await buildSkillSheetPdf(await loadFont(), profile, entries, certifications);
  downloadPdf(bytes, filename('20_スキルシート', employeeId, lastName));
}

// ══════════════════════════════════════════════════════════════════════════════
// スキル一覧（案件ごとの職歴。多い場合は次のページに続ける）
// ══════════════════════════════════════════════════════════════════════════════

const PROCESS_EXAMPLES = ['要件定義', '調査', '分析', '基本設計', 'プログラミング', '単体テスト', '結合テスト', 'システムテスト', 'リリース', '運用', '研修'];

export async function buildWorkHistoryPdf(
  fontBytes: ArrayBuffer | Uint8Array,
  name: string,
  entries: WorkHistoryEntry[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // サブセット化は loadFont() で詰め直したフォントが前提
  const font = await doc.embedFont(fontBytes, { subset: true });
  doc.setTitle(`スキル一覧 ${name}`);

  const cols = [
    { key: 'period', label: '作業期間', w: 88 },
    { key: 'work', label: '業務内容', w: 150 },
    { key: 'machine', label: '機種', w: 36 },
    { key: 'os', label: 'OS', w: 64 },
    { key: 'lang1', label: '言語', w: 70 },
    { key: 'lang2', label: '言語', w: 70 },
    { key: 'db', label: 'DB', w: 66 },
    { key: 'tools', label: '主要ツール', w: 92 },
    { key: 'role', label: '役割', w: 38 },
    { key: 'process', label: '作業工程', w: 0 },
  ];
  cols[cols.length - 1].w = RIGHT - M.l - cols.reduce((a, c) => a + c.w, 0);
  const colX: number[] = [];
  cols.reduce((acc, c) => (colX.push(acc), acc + c.w), M.l);
  const ci = (k: string) => cols.findIndex(c => c.key === k);
  const cw = (k: string) => cols[ci(k)].w;
  const cx = (k: string) => colX[ci(k)];

  const fs = 7.8, lineH = 13, padY = 6;
  const tY = M.t + 60, hH = 20;
  const bottom = H - M.b - 20; // 凡例の分をあける

  // 1案件分の表示内容と高さ（行数は項目の多いものに合わせる。最低2行）
  const lines = (s: string) => (s ? s.split('\n').map(v => v.trim()).filter(Boolean) : []);
  const blank: WorkHistoryEntry = {
    id: '', startDate: '', endDate: '', duration: '', clientType: '', systemName: '',
    machine: '', os: '', languages: '', db: '', tools: '', role: '', workProcess: '',
  };
  const rows = [...entries];
  while (rows.length < 3) rows.push({ ...blank });

  const pages: PDFPage[] = [];
  let p!: Painter;
  let y = 0;

  const newPage = () => {
    const page = doc.addPage([W, H]);
    pages.push(page);
    p = createPainter(page, font);
    drawHeader(p, 'スキル一覧', name);
    drawHeadRow(p, M.l, tY, hH, cols.map(c => [c.label, c.w] as [string, number]));
    y = tY + hH;
  };
  // 表の縦線と外枠（ページごとに、そのページの明細の高さで引く）
  const closeTable = () => {
    colX.slice(1).forEach(x => p.vline(x, tY + hH, y, C.line, 0.5));
    p.rect(M.l, tY, RIGHT - M.l, y - tY, { stroke: C.lineStrong, bw: 0.7 });
  };

  newPage();
  for (const e of rows) {
    const langs = lines(e.languages);
    const lang1 = langs.filter((_, i) => i % 2 === 0);
    const lang2 = langs.filter((_, i) => i % 2 === 1);
    const os = lines(e.os), db = lines(e.db), tools = lines(e.tools);
    const proc = e.workProcess ? p.wrap(e.workProcess, fs, cw('process') - 12) : [];
    const n = Math.max(2, lang1.length, os.length, db.length, tools.length, proc.length);
    const h = n * lineH + padY * 2;

    if (y + h > bottom && y > tY + hH) {
      closeTable();
      newPage();
    }
    const q = p;
    if (y > tY + hH) q.hline(M.l, RIGHT, y, C.lineStrong, 0.6);
    const base = (i: number) => y + padY + lineH * i + lineH / 2 + fs * 0.36;

    // 作業期間（期間の下に長さをバッジで）
    const period = e.startDate ? `${fmtYearMonth(e.startDate)} 〜${e.endDate ? ` ${fmtYearMonth(e.endDate)}` : ''}` : '';
    if (period) q.txt(period, cx('period') + 7, base(0), 7.5, C.ink);
    if (e.duration) q.badge(e.duration, cx('period') + 6, y + padY + lineH, lineH, 6.8, C.primarySoft, C.primary);

    // 業務内容（業種・案件の下にシステム名）
    if (e.clientType) q.txt(q.fit(e.clientType, 8.2, cw('work') - 14), cx('work') + 7, base(0), 8.2, C.ink);
    if (e.systemName) q.txt(q.fit(e.systemName, 7.2, cw('work') - 14), cx('work') + 7, base(1), 7.2, C.sub);

    // 機種・役割（案件の高さの中央）
    if (e.machine) q.cell(q.fit(e.machine, 7.5, cw('machine') - 4), cx('machine'), y, cw('machine'), h, 7.5, C.ink, 'center');
    if (e.role) {
      const rw = Math.min(cw('role') - 6, Math.max(24, q.width(e.role, 6.8) + 8));
      q.badge(q.fit(e.role, 6.8, rw - 6), cx('role') + (cw('role') - rw) / 2, y, h, 6.8, C.off, C.ink, rw);
    }

    // 一覧の項目（1行に1つ）
    const list: [string, string[]][] = [['os', os], ['lang1', lang1], ['lang2', lang2], ['db', db], ['tools', tools]];
    for (const [k, items] of list) {
      items.forEach((s, i) => q.txt(q.fit(s, fs, cw(k) - 12), cx(k) + 6, base(i), fs, C.ink));
    }
    proc.forEach((s, i) => q.txt(s, cx('process') + 6, base(i), fs, C.ink));

    y += h;
  }
  closeTable();

  // 凡例（最後のページの表のすぐ下）
  const lp = p;
  let fx = M.l;
  const fy = y + 14;
  lp.txt('作業工程例', fx, fy, 6.5, C.primary); fx += lp.width('作業工程例', 6.5) + 8;
  for (const s of PROCESS_EXAMPLES) { lp.txt(s, fx, fy, 6.5, C.sub); fx += lp.width(s, 6.5) + 7; }

  // ページ番号（2ページ以上のときだけ）
  if (pages.length > 1) {
    pages.forEach((pg, i) => {
      const label = `${i + 1} / ${pages.length}`;
      const pp = createPainter(pg, font);
      pp.txt(label, RIGHT - pp.width(label, 7), H - M.b, 7, C.sub);
    });
  }

  return doc.save();
}

export async function printWorkHistory(
  name: string,
  entries: WorkHistoryEntry[],
  employeeId = '',
  lastName = '',
): Promise<void> {
  const bytes = await buildWorkHistoryPdf(await loadFont(), name, entries);
  downloadPdf(bytes, filename('21_スキル一覧', employeeId, lastName));
}
