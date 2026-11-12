import { expect, it } from 'vitest';
import { PrecheckReply } from '../src/precheckReply.ts';
const enc = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
it('drops exactly the first error footer across chunks, preserving the next reply', () => {
  const r = new PrecheckReply();
  expect(r.push(enc('{"r":{},"f":'))).toHaveLength(0);
  expect(text(r.push(enc('[3,102,10]}\nnext\n')))).toBe('next\n');
  expect(r.done).toBe(true);
  expect(text(r.push(enc('{"r":{},"f":[3,102,10]}\n')))).toContain('102');
  expect(r.finish()).toHaveLength(0);
});
it.each(['{"r":{},"f":[3,103,10]}\n', '{"r":{},"f":[3,2,10]}\r'])('tolerates any single error footer: %s', line => {
  expect(new PrecheckReply().push(enc(line))).toHaveLength(0);
});
it.each(['{"r":{"sr":{}},"f":[3,0,10]}\n', '{"sr":{"fv":0.97,"fb":450.02,"msg":"SYSTEM READY"}}\n', 'garbled\n', '\n', 'x'.repeat(2049)])('keeps unexpected input for the ordinary probe', line => {
  const r = new PrecheckReply(); expect(text(r.push(enc(line)))).toBe(line); expect(r.done).toBe(line.length > 2048);
});
it('silence and a partial reply remain visible to the splice guard', () => {
  const r = new PrecheckReply(); expect(r.push(enc('partial'))).toHaveLength(0);
  expect(text(r.finish())).toBe('partial'); expect(text(r.push(enc('tail\n')))).toBe('tail\n');
  expect(new PrecheckReply().finish()).toHaveLength(0);
});

it('preserves unsolicited reports before consuming the one error reply', () => {
  const r = new PrecheckReply(); const report = '{"sr":{"stat":1}}\n';
  expect(text(r.push(enc(report + '{"r":{},"f":[3,102,10]}\n')))).toBe(report);
  expect(r.done).toBe(true);
});
