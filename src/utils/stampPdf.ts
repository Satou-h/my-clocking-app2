// 上長の検印：部下がこのアプリで出力したPDFを読み込み、確認印・確認・検印の欄に上長のサインを入れる
// 欄の位置は、PDFを出力したときに書いておいたもの（pdfKit.ts の writeSignAreas）を使う
import { PDFBool, PDFDocument, PDFName } from 'pdf-lib';
import { drawImageFit, readSignAreas } from './pdfKit';

// 上長がサインする欄（勤務表: 確認印 / 休暇・遅刻早退申請書: 確認 / 交通費精算書: 検印）
const MANAGER_LABELS = ['確認印', '確認', '検印'];
const STAMPED_KEY = PDFName.of('ClockingManagerSigned');

export type StampResult =
  | { ok: true; title: string; labels: string[]; bytes: Uint8Array }
  | { ok: false; title: string; reason: string };

export async function stampManagerSignature(src: ArrayBuffer, signature: string): Promise<StampResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(src);
  } catch {
    return { ok: false, title: '', reason: 'PDFとして読み込めませんでした' };
  }
  const title = doc.getTitle() ?? '';
  const areas = readSignAreas(doc);
  if (!areas) {
    return { ok: false, title, reason: 'サインする欄の位置がわかりません。このアプリの最新版で出力し直したPDFを読み込んでください' };
  }
  const labels = MANAGER_LABELS.filter((l) => areas[l]);
  if (labels.length === 0) return { ok: false, title, reason: 'リーダーがサインする欄がない書類です' };
  if (doc.catalog.get(STAMPED_KEY)) return { ok: false, title, reason: 'すでに検印済みです' };

  const img = await doc.embedPng(signature);
  const page = doc.getPage(0);
  for (const l of labels) drawImageFit(page, img, areas[l]);
  doc.catalog.set(STAMPED_KEY, PDFBool.True);
  return { ok: true, title, labels, bytes: await doc.save() };
}
