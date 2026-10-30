// PDFの保存（ダウンロード / 共有シート）をまとめて扱う
// iPhone・iPad は <a download> でもPDFがプレビュー表示になり、連続ダウンロードもブロックされるため、
// 共有シート（Web Share API）にまとめて渡し、「"ファイル"に保存」などから保存してもらう。
// それ以外の端末は従来どおりダウンロードする。

let collecting: File[] | null = null;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIOS(): boolean {
  // iPadOS の Safari は Mac と名乗るため、タッチ対応かどうかで見分ける
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function canShareFiles(files: File[]): boolean {
  return isIOS() && typeof navigator.canShare === 'function' && navigator.canShare({ files });
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// 共有シートは「タップした直後」にしか開けない。PDF生成に時間がかかって開けなかったときは、
// 準備完了のダイアログを出してもう一度タップしてもらう。
function showSharePrompt(files: File[]): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'share-prompt-backdrop';
  backdrop.innerHTML = `
    <div class="share-prompt" role="dialog" aria-modal="true">
      <p class="share-prompt-title">PDFの準備ができました（${files.length}件）</p>
      <p class="share-prompt-hint">「保存・共有」を押して、「"ファイル"に保存」やメール・LINEなどを選んでください。</p>
      <ul class="share-prompt-files"></ul>
      <div class="share-prompt-actions">
        <button type="button" class="btn btn-secondary" data-action="close">閉じる</button>
        <button type="button" class="btn btn-primary" data-action="share">保存・共有</button>
      </div>
    </div>`;
  const list = backdrop.querySelector('.share-prompt-files')!;
  for (const file of files) {
    const li = document.createElement('li');
    li.textContent = file.name;
    list.appendChild(li);
  }

  const close = () => backdrop.remove();
  backdrop.querySelector('[data-action="close"]')!.addEventListener('click', close);
  backdrop.querySelector('[data-action="share"]')!.addEventListener('click', () => {
    navigator.share({ files })
      .then(close)
      .catch((err: DOMException) => {
        // キャンセル（AbortError）のときはダイアログを残して、もう一度選べるようにする
        if (err.name !== 'AbortError') alert('共有できませんでした: ' + err.message);
      });
  });
  document.body.appendChild(backdrop);
}

async function shareFiles(files: File[]): Promise<void> {
  try {
    await navigator.share({ files });
  } catch (err) {
    const name = (err as DOMException).name;
    if (name === 'AbortError') return;
    if (name === 'NotAllowedError') { showSharePrompt(files); return; }
    throw err;
  }
}

// 作成したPDFを端末に渡す。iPhone・iPad は共有シート、それ以外はダウンロード
export async function deliverPdfs(files: File[]): Promise<void> {
  if (files.length === 0) return;
  if (canShareFiles(files)) { await shareFiles(files); return; }
  for (const [i, file] of files.entries()) {
    // 連続ダウンロードがブラウザに間引かれないよう間隔をあける
    if (i > 0) await wait(600);
    downloadFile(file);
  }
}

// PDFを1件保存する。collectPdfs の実行中は保存せずに溜めておく
export function savePdf(data: Uint8Array | Blob, filename: string): void {
  const blob = data instanceof Blob ? data : new Blob([data.buffer as ArrayBuffer], { type: 'application/pdf' });
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (collecting) { collecting.push(file); return; }
  deliverPdfs([file]).catch((err: Error) => alert('PDFの保存に失敗しました: ' + err.message));
}

// generate の中で savePdf されたPDFを、保存せずに集めて返す（一括ダウンロード用）
export async function collectPdfs(generate: () => Promise<void>): Promise<File[]> {
  const files: File[] = [];
  collecting = files;
  try {
    await generate();
  } finally {
    collecting = null;
  }
  return files;
}
