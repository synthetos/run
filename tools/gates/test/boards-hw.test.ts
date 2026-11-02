/**
 * Private-hardware overlay derivation (ROADMAP TB-05a, RUN_PLAN §5.1 rule 6):
 * only derived connector facts leave the tool, every src is opaque, and output
 * that would name a path or file is refused. The schematic below is written
 * for this test.
 */
import { describe, expect, it } from 'vitest';
import { assertNothingLeaks, deriveConnectors, opaqueSrc, parseSexpr } from '../src/boards/hw.ts';

const SCH = `(kicad_sch (version 20231120)
  (lib_symbols
    (symbol "Conn:Conn_01x04"
      (symbol "Conn_01x04_1_1"
        (pin passive line (at 0 0 0) (length 2) (name "GND" (effects)) (number "1" (effects)))
        (pin passive line (at 0 0 0) (length 2) (name "+3.3V" (effects)) (number "2" (effects)))
        (pin passive line (at 0 0 0) (length 2) (name "OUT_A" (effects)) (number "3" (effects)))
        (pin passive line (at 0 0 0) (length 2) (name "~" (effects)) (number "4" (effects)))))
    (symbol "Device:R" (pin passive line (name "~") (number "1"))))
  (symbol (lib_id "Conn:Conn_01x04") (at 10 10 0)
    (property "Reference" "J12" (at 0 0 0))
    (property "Value" "AUX \\"OUT\\"" (at 0 0 0))
    (property "Footprint" "Lib:SecretFootprint" (at 0 0 0)))
  (symbol (lib_id "Device:R") (property "Reference" "R1") (property "Value" "10k")))`;

const FILE = { relPath: 'boards/Example/Example.kicad_sch', text: SCH };
const COMMIT = 'abcdef1234567';

describe('gen-boards-hw', () => {
  it('derives connector id, label and pins with power nets, and nothing else', () => {
    const [c, ...rest] = deriveConnectors([FILE], COMMIT);
    expect(rest).toEqual([]);
    expect(c).toEqual({
      id: 'J12',
      label: 'AUX OUT',
      pins: [
        { n: 1, label: 'GND', net: 'GND' },
        { n: 2, label: '+3.3V', net: '3V3' },
        { n: 3, label: 'OUT A' },
        { n: 4, label: '4' },
      ],
      src: opaqueSrc(FILE.relPath, COMMIT),
      verified: 'hardware-repo',
    });
    expect(JSON.stringify(c)).not.toMatch(/Example|Footprint|Secret|kicad/);
    expect(c?.src).toMatch(/^hw:[0-9a-f]{12}$/);
  });

  it('refuses output that names a source file or path', () => {
    expect(() => assertNothingLeaks({ label: 'see Example sheet' }, [FILE])).toThrow(/refusing/);
    expect(() => assertNothingLeaks({ label: 'a/b' }, [FILE])).toThrow(/refusing/);
    expect(() => assertNothingLeaks({ label: 'x.kicad_pcb' }, [FILE])).toThrow(/refusing/);
    expect(() => assertNothingLeaks({ label: 'J1 power' }, [FILE])).not.toThrow();
  });

  it('a value that would leak the file name stops the derivation', () => {
    const leaky = { ...FILE, text: SCH.replace('AUX \\"OUT\\"', 'Example header') };
    expect(() => deriveConnectors([leaky], COMMIT)).toThrow(/refusing/);
  });

  it('refuses a non-KiCad-6 file, unbalanced input and a bad commit', () => {
    expect(() => deriveConnectors([{ relPath: 'a.sch', text: '(eeschema)' }], COMMIT)).toThrow(/KiCad 6/);
    expect(() => parseSexpr('(a (b)')).toThrow(/unbalanced/);
    expect(() => parseSexpr('(a))')).toThrow(/unbalanced/);
    expect(() => deriveConnectors([FILE], 'HEAD')).toThrow(/commit/);
  });
});
