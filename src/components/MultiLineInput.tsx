import { useEffect, useRef } from 'react';
import SelectOrInput from './SelectOrInput';

interface Props {
  /** 改行区切りの文字列（1行 = 1項目） */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** ドロップダウンに表示する候補（候補外の手入力も可能） */
  options?: readonly string[];
}

/**
 * 1項目ごとにテキストボックスを並べる入力欄。
 * 値は従来どおり改行区切りの文字列で受け渡す。
 */
export default function MultiLineInput({ value, onChange, placeholder, options }: Props) {
  const lines = value.split('\n');
  const inputRefs = useRef<(HTMLElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndex.current !== null) {
      inputRefs.current[focusIndex.current]?.focus();
      focusIndex.current = null;
    }
  });

  function update(next: string[]) {
    onChange(next.join('\n'));
  }

  function handleChange(index: number, text: string) {
    update(lines.map((l, i) => (i === index ? text : l)));
  }

  function handleAdd(afterIndex: number) {
    const next = [...lines];
    next.splice(afterIndex + 1, 0, '');
    focusIndex.current = afterIndex + 1;
    update(next);
  }

  function handleRemove(index: number) {
    if (lines.length <= 1) {
      update(['']);
      return;
    }
    focusIndex.current = Math.max(0, index - 1);
    update(lines.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleAdd(index);
    } else if (e.key === 'Backspace' && lines[index] === '' && lines.length > 1) {
      e.preventDefault();
      handleRemove(index);
    }
  }

  return (
    <div className="multi-line-input">
      {lines.map((line, i) => (
        <div key={i} className="multi-line-input-row">
          {options ? (
            <SelectOrInput
              focusRef={(el) => { inputRefs.current[i] = el; }}
              value={line}
              options={options}
              onChange={(v) => handleChange(i, v)}
              onKeyDown={(e) => handleKeyDown(e, i)}
            />
          ) : (
            <input
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              value={line}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              placeholder={i === 0 ? placeholder : ''}
            />
          )}
          <button
            type="button"
            className="btn-row-delete"
            onClick={() => handleRemove(i)}
            disabled={lines.length <= 1 && line === ''}
            title="この行を削除"
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn-row-edit multi-line-input-add" onClick={() => handleAdd(lines.length - 1)}>
        ＋ 行を追加
      </button>
    </div>
  );
}
