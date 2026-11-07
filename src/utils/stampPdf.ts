// リーダーの検印：メンバーがこのアプリで出力したPDFを読み込み、確認印・確認・検印の欄にリーダーの印鑑を押す
// 欄の位置は、PDFを出力したときに書いておいたもの（pdfKit.ts の writeSignAreas）を使う
import { PDFBool, PDFDocument, PDFName } from 'pdf-lib';
import { drawImageFit, readSignAreas } from './pdfKit';

// リーダーが押印する欄（勤務表: 確認印 / 休暇・遅刻早退申請書: 確認 / 交通費精算書: 検印）
const LEADER_LABELS = ['確認印', '確認', '検印'];
const STAMPED_KEY = PDFName.of('ClockingManagerSigned');

export type StampResult =
  | { ok: true; title: string; labels: string[]; bytes: Uint8Array }
  | { ok: false; title: string; reason: string };

// seal: リーダーの印鑑（PNG の data URL。seal.ts の sealImage）
export async function stampLeaderSeal(src: ArrayBuffer, seal: string): Promise<StampResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(src);
  } catch {
    return { ok: false, title: '', reason: 'PDFとして読み込めませんでした' };
  }
  const title = doc.getTitle() ?? '';
  const areas = readSignAreas(doc);
  if (!areas) {
    return { ok: false, title, reason: '押印する欄の位置がわかりません。このアプリの最新版で出力し直したPDFを読み込んでください' };
  }
  const labels = LEADER_LABELS.filter((l) => areas[l]);
  if (labels.length === 0) return { ok: false, title, reason: 'リーダーが押印する欄がない書類です' };
  if (doc.catalog.get(STAMPED_KEY)) return { ok: false, title, reason: 'すでに検印済みです' };

  const img = await doc.embedPng(seal);
  const page = doc.getPage(0);
  for (const l of labels) drawImageFit(page, img, areas[l]);
  doc.catalog.set(STAMPED_KEY, PDFBool.True);
  return { ok: true, title, labels, bytes: await doc.save() };
}
