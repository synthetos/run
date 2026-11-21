import { expect, it } from 'vitest';
import { ApplicationAnswer } from '../src/applicationAnswer.ts';
const enc = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

it.each([
  ['a JSON error reply (JSON mode)', '{"r":{},"f":[3,102,10]}\n'],
  ['a JSON reply with a CR', '{"r":{"gc":"S"},"f":[1,0,3]}\r'],
  ['a ready banner', '{"r":{"fv":0.97,"fb":449.01,"hp":1,"hv":8,"id":"3Y2462-WWR","msg":"SYSTEM READY"},"f":[1,0,0]}\n'],
  ['a status report', '{"sr":{"stat":1}}\n'],
  ['the text-mode prompt, no line end', 'tinyg [mm] ok> '],
  ['the text-mode prompt in inches after an error line', 'Unrecognized command\ntinyg [in] err: '],
])('%s proves the firmware is running', (_name, reply) => {
  const a = new ApplicationAnswer();
  a.push(enc(reply.slice(0, 5)));
  a.push(enc(reply.slice(5)));
  expect(a.proven).toBe(true);
  expect(text(a.bytes())).toBe(reply);
});

it.each([
  ['silence', ''],
  ["xboot's refusal of a line end", '?'],
  ["xboot's refusals and stray bytes", '??\r\n'],
  ['text that is not a TinyG prompt', 'hello [mm] ok>\n'],
  ['malformed JSON', '{"r":\n'],
  ['JSON that is no TinyG reply', '{"x":1}\n'],
])('%s proves nothing', (_name, reply) => {
  const a = new ApplicationAnswer();
  a.push(enc(reply));
  expect(a.proven).toBe(false);
});

it('an overlong line proves nothing, and the answer is bounded', () => {
  const a = new ApplicationAnswer();
  a.push(enc('x'.repeat(5000)));
  a.push(enc('{"r":{},"f":[3,102,10]}\n'));
  expect(a.proven).toBe(false);
  expect(a.bytes().length).toBeLessThanOrEqual(4096);
});

it('stays proven once proven', () => {
  const a = new ApplicationAnswer();
  a.push(enc('{"sr":{"stat":1}}\n'));
  a.push(enc('?'));
  expect(a.proven).toBe(true);
});
