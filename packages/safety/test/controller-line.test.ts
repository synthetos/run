/**
 * The block for a line that starts with a controller's command character says what it is and what to do (SAFETY
 * §4.7 step 4): a GRBL homing or unlock line names GRBL and the fix; the line stays a block, never stripped.
 */
import { describe, expect, it } from 'vitest';
import { controllerLineMessage } from '../src/sanitize/controllerLine.ts';
import { TINYG_EN } from '@synthetos/protocol';
import { run } from './sanitizeHelpers.ts';

const EN = TINYG_EN;

describe('controller command lines', () => {
  it('an Estlcam/GRBL file ending in $HZ is blocked at that line, with what it is and what to do', () => {
    const text = ['G21 G90', 'G1 X1 F600', '$HZ'].join('\n');
    const r = run(`${text}\n`, EN);
    const block = r.report.entries.find((e) => e.rule === 'first-character');
    expect(r.report.blocked).toBe(true);
    expect(block).toMatchObject({ line: 3, severity: 'block', message: '"$HZ" is a GRBL homing command; this file was made for a GRBL machine. Remove the line, or export the file with a TinyG post-processor.' });
  });

  it('each kind of controller line in plain words', () => {
    expect(controllerLineMessage('$H')).toContain('GRBL homing command');
    expect(controllerLineMessage('$h z')).toContain('GRBL homing command');
    expect(controllerLineMessage('$X')).toBe('"$X" is a GRBL unlock command (it clears an alarm); this file was made for a GRBL machine. Remove the line, or export the file with a TinyG post-processor.');
    expect(controllerLineMessage('$110=500')).toBe('"$110=500" is a controller setting or command (a "$" line, as GRBL and TinyG text mode use), not G-code. Remove the line, or export the file with a TinyG post-processor.');
    expect(controllerLineMessage('?')).toBe('"?" is a status request to a controller, not G-code. Remove the line.');
    expect(controllerLineMessage('{"xvm":null}')).toBe('"{\\"xvm\\":null}" is a JSON command to the controller, not G-code. Remove the line.');
    expect(controllerLineMessage('help')).toBe('"help" starts with "h", which TinyG reads as a controller command, not G-code. Remove the line, or export the file with a TinyG post-processor.');
    expect(controllerLineMessage('$' + 'x'.repeat(40))).toContain('…"');
  });
});

it.each(['$H', '$HZ', '$h z', '$X', '$110=500', '?', '{"xvm":null}', 'help'])('keeps the specific controller repair for %s without generic Board advice', code => {
  const block = run(`G21 G90\n${code}\n`, EN).report.entries.find(e => e.rule === 'first-character');
  expect(block?.message).toBe(controllerLineMessage(code));
  expect(block?.message).not.toContain('Fix:');
  expect(block?.message).not.toContain('Board');
  expect(block?.message.match(/Remove the line/g)).toHaveLength(1);
});
