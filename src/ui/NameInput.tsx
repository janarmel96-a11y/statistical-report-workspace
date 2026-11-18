// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { cleanName } from '../core/names';

interface Props {
  value: string;
  label: string;
  className?: string;
  autoFocus?: boolean;
  /** Return false to refuse the name and restore the previous one. */
  onCommit: (name: string) => void | boolean;
  onCancel?: () => void;
  onFocus?: () => void;
}

/** A name that can be edited in place. Enter or leaving the field saves it, and Escape restores it. */
export function NameInput({ value, label, className = '', autoFocus, onCommit, onCancel, onFocus }: Props) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const name = cleanName(draft, value);
    setDraft(onCommit(name) === false ? value : name);
  };

  return (
    <span className="name-edit">
      <input
        className={className} aria-label={label} title={`${label}. Click to rename.`} value={draft} maxLength={120} autoFocus={autoFocus} spellCheck={false}
        onChange={(e) => setDraft(e.target.value)} onFocus={(e) => { e.target.select(); onFocus?.(); }} onBlur={commit} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { e.stopPropagation(); cancelled.current = true; setDraft(value); e.currentTarget.blur(); onCancel?.(); }
        }}
      />
      <Pencil size={13} aria-hidden="true" />
    </span>
  );
}
