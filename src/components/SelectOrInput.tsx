import { useRef, useState } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** ドロップダウンに表示する候補 */
  options: readonly string[];
  /** 手入力欄のプレースホルダー */
  placeholder?: string;
  /** 行追加後のフォーカス移動に使う要素（ドロップダウン） */
  focusRef?: (el: HTMLElement | null) => void;
  /** 手入力欄のキー入力（Enter での行追加など）を親に渡す */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

const CUSTOM = '__custom__';

/**
 * 勤怠区分と同じ標準のドロップダウンで候補を選び、
 * 候補にない値は「その他（手入力）」を選んで入力する。
 */
export default function SelectOrInput({ value, onChange, options, placeholder, focusRef, onKeyDown }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  // 「その他（手入力）」を選んだ直後（まだ何も入力していない状態）も入力欄を表示する
  const [customSelected, setCustomSelected] = useState(false);
  const isOption = options.includes(value);
  const custom = customSelected || (value !== '' && !isOption);

  return (
    <div className="select-or-input">
      <select
        ref={(el) => focusRef?.(el)}
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustomSelected(true);
            if (isOption) onChange('');
            // 入力欄が表示されてからフォーカスする
            setTimeout(() => inputRef.current?.focus(), 0);
          } else {
            setCustomSelected(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">選択してください</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={CUSTOM}>その他（手入力）</option>
      </select>
      {custom && (
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder ?? '候補にない場合は入力'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
    </div>
  );
}
