/**
 * pdfRender.ts — PDFを画面で見るために、ページを画像にする（PDF.js）
 *
 * iPhone・Android のブラウザは、ページの中に埋め込んだPDFを1ページ目しか出さない・表示しないことがあるため、
 * 自分でページを描いて画像として表示する。PDF.js は大きいので、使うときに初めて読み込む。
 * 古い iPhone でも動くように legacy 版を使う。
 */
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfWorker = InstanceType<PdfJs['PDFWorker']>;

let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs')
    .then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl;
      return lib;
    })
    .catch((e: unknown) => {
      pdfjs = null; // 次に開くときに読み込み直す
      throw e;
    });
  return pdfjs;
}

// PDFを読み解く裏方（ワーカー）。読み込みに時間がかかるので、一度作ったら書類をまたいで使い回す
let worker: PdfWorker | null = null;
function getWorker(lib: PdfJs): PdfWorker {
  if (!worker || worker.destroyed) worker = new lib.PDFWorker();
  return worker;
}

// 「PDFで確認」を押す前や、PDFを作っている間に、PDF.js とワーカーを読み込んでおく
// （失敗しても、表示するときに読み込み直す）
export function preloadPdfViewer(): void {
  loadPdfJs().then(getWorker).catch(() => {});
}

export interface PageImage {
  // 画像の URL（使い終わったら URL.revokeObjectURL で捨てる）
  url: string;
  // ページの大きさ（縦横比に使う）
  width: number;
  height: number;
}

// file の各ページを、横幅 widthPx の画像にして1ページずつ onPage に渡す。isCancelled() が true になったらやめる
export async function renderPdfPages(
  file: Blob, widthPx: number, onPage: (page: PageImage) => void, isCancelled: () => boolean,
): Promise<void> {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  if (isCancelled()) return;
  // 渡したワーカーは task.destroy() では止まらない（次の書類でも使う）
  const task = lib.getDocument({ data, isEvalSupported: false, worker: getWorker(lib) });
  try {
    const doc = await task.promise.catch((e: unknown) => {
      // ワーカーが壊れていても次に開くときは作り直せるよう、いったん捨てる
      worker?.destroy();
      worker = null;
      throw e;
    });
    for (let i = 1; i <= doc.numPages; i++) {
      if (isCancelled()) return;
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: widthPx / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      page.cleanup();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      // 描いた canvas はすぐ捨てる（iPhone は canvas に使えるメモリが少ない）
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error('ページを画像にできませんでした');
      if (isCancelled()) return;
      onPage({ url: URL.createObjectURL(blob), width: base.width, height: base.height });
    }
  } finally {
    void task.destroy();
  }
}
