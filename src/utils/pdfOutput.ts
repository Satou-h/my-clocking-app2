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

// 準備完了ダイアログの枠（タイトル・説明・ファイル一覧・閉じるボタン）を表示する
function openPrompt(title: string, hint: string): { list: HTMLUListElement; actions: HTMLDivElement; close: () => void } {
  const backdrop = document.createElement('div');
  backdrop.className = 'share-prompt-backdrop';
  backdrop.innerHTML = `
    <div class="share-prompt" role="dialog" aria-modal="true">
      <p class="share-prompt-title"></p>
      <p class="share-prompt-hint"></p>
      <ul class="share-prompt-files"></ul>
      <div class="share-prompt-actions">
        <button type="button" class="btn btn-secondary" data-action="close">閉じる</button>
      </div>
    </div>`;
  backdrop.querySelector('.share-prompt-title')!.textContent = title;
  backdrop.querySelector('.share-prompt-hint')!.textContent = hint;

  const close = () => backdrop.remove();
  backdrop.querySelector('[data-action="close"]')!.addEventListener('click', close);
  document.body.appendChild(backdrop);
  return {
    list: backdrop.querySelector('.share-prompt-files')!,
    actions: backdrop.querySelector('.share-prompt-actions')!,
    close,
  };
}

// 共有シートは「タップした直後」にしか開けない。PDF生成に時間がかかって開けなかったときは、
// 準備完了のダイアログを出してもう一度タップしてもらう。
function showSharePrompt(files: File[]): void {
  const { list, actions, close } = openPrompt(
    `PDFの準備ができました（${files.length}件）`,
    '「保存・共有」を押して、「"ファイル"に保存」やメール・LINEなどを選んでください。',
  );
  for (const file of files) {
    const li = document.createElement('li');
    li.textContent = file.name;
    list.appendChild(li);
  }

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'btn btn-primary';
  share.textContent = '保存・共有';
  share.addEventListener('click', () => {
    navigator.share({ files })
      .then(close)
      .catch((err: DOMException) => {
        // キャンセル（AbortError）のときはダイアログを残して、もう一度選べるようにする
        if (err.name !== 'AbortError') alert('共有できませんでした: ' + err.message);
      });
  });
  actions.appendChild(share);
}

// 共有シートが使えない iPhone・iPad（Chrome など）は、ダウンロードごとに保存先の選択が出て
// 2件目以降が止められるため、1件ずつタップして保存してもらう
function showDownloadPrompt(files: File[]): void {
  const { list } = openPrompt(
    `PDFの準備ができました（${files.length}件）`,
    '1件ずつ「保存」を押してください。保存先を選ぶ画面が出たら、選び終えてから次の書類を保存してください。',
  );
  list.classList.add('share-prompt-files-buttons');
  for (const file of files) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = file.name;
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-secondary';
    save.textContent = '保存';
    save.addEventListener('click', () => {
      downloadFile(file);
      save.textContent = '保存済み ✓';
    });
    li.append(name, save);
    list.appendChild(li);
  }
}

async function shareFiles(files: File[]): Promise<void> {
  try {
    await navigator.share({ files });
  } catch (err) {
    const name = (err as DOMException).name;
    if (name === 'AbortError') return;
    if (name === 'NotAllowedError') { showSharePrompt(files); return; }
    showDownloadPrompt(files);
  }
}

// 作成したPDFを端末に渡す。iPhone・iPad は共有シート、それ以外はダウンロード
export async function deliverPdfs(files: File[]): Promise<void> {
  if (files.length === 0) return;
  if (canShareFiles(files)) { await shareFiles(files); return; }
  if (isIOS() && files.length > 1) { showDownloadPrompt(files); return; }
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
