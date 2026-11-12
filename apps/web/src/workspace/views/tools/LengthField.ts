import { h, type ComponentChild } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { formatLength, parseLength, type ToolUnit } from '../../tools/units.ts';

export interface LengthProps {
  readonly field: string; readonly label: string; readonly value: number | undefined;
  readonly unit: ToolUnit | '°' | ''; readonly optional?: boolean; readonly allowZero?: boolean;
  readonly onChange: (n: number | undefined) => void;
  readonly onValidity: (field: string, valid: boolean) => void;
}
export function LengthField({ field, label, value, unit, optional = false, allowZero = false, onChange, onValidity }: LengthProps): ComponentChild {
  const formatted = (): string => value === undefined ? '' : unit === 'mm' || unit === 'in' ? formatLength(value, unit) : String(value);
  const [raw, setRaw] = useState(formatted);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => { setRaw(formatted()); setError(null); onValidity(field, true); }, [unit]);
  useEffect(() => () => onValidity(field, true), []);
  return h('label', { class: 'field' }, h('span', null, label), h('span', { class: 'unit-input' }, h('input', {
    value: raw, type: 'text', inputMode: 'decimal', 'data-tool-field': field, 'aria-invalid': error === null ? undefined : 'true',
    onInput: (e: Event) => {
      const s = (e.currentTarget as HTMLInputElement).value; setRaw(s);
      const empty = optional && s.trim() === '';
      const n = empty ? undefined : parseLength(s, unit === 'in' ? 'in' : 'mm');
      const valid = empty || (n !== null && n !== undefined && (allowZero || n > 0) && (field !== 'flutes' || Number.isInteger(n)));
      setError(valid ? null : unit === 'in' ? 'Enter inches, such as 0.25 or 1/4.' : 'Enter a valid positive number.');
      onValidity(field, valid);
      if (valid) onChange(n ?? undefined);
    },
    onBlur: () => { if (error === null) setRaw(formatted()); },
  }), unit === '' ? null : h('i', null, unit)), error === null ? null : h('small', { class: 'field-error', role: 'alert' }, error));
}
