/**
 * Board definition generator (ROADMAP TB-05a): the committed definitions are
 * exactly what `pnpm gen:boards` renders (CI drift test), the vendored facts
 * are at the pinned edge-next commit, the extractor refuses source it does not
 * understand, and an overlay can only add facts that fit the generated pins.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, SCHEMA_DIR, TINYG_TAG, extractFromRepo, pinnedCommit, readFacts, readOverlays, renderAllBoards } from '../src/boards/all.ts';
import { applyOverlay, parseOverlay, renderBoard, renderTinyGBoards, tinygBoard } from '../src/boards/render.ts';
import type { BoardOverlay } from '../src/boards/render.ts';
import { extractTinyG, renderFacts } from '../src/boards/tinyg.ts';
import type { TinyGSourceFile } from '../src/boards/tinyg.ts';

describe('committed board definitions', () => {
  const rendered = renderAllBoards();

  it.each([...rendered.keys()])('packages/schema/%s is byte-identical to a fresh render (regenerate with `pnpm gen:boards`)', (path) => {
    expect(readFileSync(join(SCHEMA_DIR, path), 'utf8')).toBe(rendered.get(path));
  });

  it('renders one definition per recognised TinyG hv plus the index', () => {
    expect([...rendered.keys()].sort()).toEqual(['boards/tinyg/tinyg-v6@6.json', 'boards/tinyg/tinyg-v7@7.json', 'boards/tinyg/tinyg-v8@8.json', 'src/generated/boards.ts']);
  });

  it('the vendored facts are at the pinned EN commit', () => {
    const facts = readFacts();
    expect(facts.commit).toBe(pinnedCommit(TINYG_TAG));
    expect(facts.firmware).toBe(`EN@${facts.commit.slice(0, 8)}`);
  });

  it('a change to the facts changes the render (the drift test would fail)', () => {
    const facts = readFacts();
    const changed = { ...facts, outputPortsV7: { ...facts.outputPortsV7, value: ['A', 'F', 'E', 'D'] as const } };
    expect(renderTinyGBoards(changed, readOverlays()).get('boards/tinyg/tinyg-v8@8.json')).not.toBe(rendered.get('boards/tinyg/tinyg-v8@8.json'));
  });
});

const tinygRepo = process.env['TINYG_REPO'] ?? resolve(REPO_ROOT, '../TinyG');
describe.skipIf(!existsSync(join(tinygRepo, '.git')))('the vendored facts against the local TinyG clone (git show only)', () => {
  it('re-extracting at the pinned commit reproduces vendor/tinyg-board-facts/EN.json byte for byte', () => {
    expect(renderFacts(extractFromRepo(tinygRepo))).toBe(readFileSync(join(REPO_ROOT, 'vendor/tinyg-board-facts/EN.json'), 'utf8'));
  });
});

/** Synthetic sources shaped like the TinyG files the extractor reads (written for this test, not copied). */
function sources(): Record<TinyGSourceFile, string> {
  return {
    'firmware/tinyg/hardware.h': [
      'typedef enum {',
      '\tHM_PLATFORM_NONE = 0,',
      '\tHW_PLATFORM_TINYG_XMEGA,',
      '\tHW_PLATFORM_G2_DUE,',
      '} hwPlatform;',
      '#define HW_VERSION_TINYGV6\t\t6',
      '#define HW_VERSION_TINYGV7\t\t7',
      '#define HW_VERSION_TINYGV8\t\t8',
      '#define HW_VERSION_TINYGV9C\t\t0',
      '#define PORT_MOTOR_1\tPORTA',
      '#define PORT_MOTOR_2\tPORTF',
      '#define PORT_MOTOR_3\tPORTE',
      '#define PORT_MOTOR_4\tPORTD',
      '#define PORT_SWITCH_X\tPORTA',
      '#define PORT_SWITCH_Y\tPORTD',
      '#define PORT_SWITCH_Z\tPORTE',
      '#define PORT_SWITCH_A\tPORTF',
      '#define PORT_OUT_V7_X\tPORTA',
      '#define PORT_OUT_V7_Y\tPORTF',
      '#define PORT_OUT_V7_Z\tPORTD',
      '#define PORT_OUT_V7_A\tPORTE',
      '#define PORT_OUT_V6_X\tPORTA',
      '#define PORT_OUT_V6_Y\tPORTF',
      '#define PORT_OUT_V6_Z\tPORTE',
      '#define PORT_OUT_V6_A\tPORTD',
      'typedef enum {',
      '\tSTEP_BIT_bp = 0,\t// bit 0',
      '\tDIRECTION_BIT_bp,\t// bit 1',
      '\tMOTOR_ENABLE_BIT_bp,\t// bit 2',
      '\tMICROSTEP_BIT_0_bp,\t// bit 3',
      '\tMICROSTEP_BIT_1_bp,\t// bit 4',
      '\tGPIO1_OUT_BIT_bp,\t// bit 5',
      '\tSW_MIN_BIT_bp,\t// bit 6',
      '\tSW_MAX_BIT_bp\t// bit 7',
      '} cfgPortBits;',
      '#define SPINDLE_BIT\t0x08',
      '#define SPINDLE_DIR\t0x04',
      '#define SPINDLE_PWM\t0x02',
      '#define MIST_COOLANT_BIT\t0x01',
      '#define FLOOD_COOLANT_BIT\t0x01',
    ].join('\n'),
    'firmware/tinyg/hardware.c': [
      '\tif (hw_version > 6.9) {',
      ...['X', 'Y', 'Z', 'A'].map((a, i) => `\t\thw.out_port[${i}] = &PORT_OUT_V7_${a};`),
      '\t} else {',
      ...['X', 'Y', 'Z', 'A'].map((a, i) => `\t\thw.out_port[${i}] = &PORT_OUT_V6_${a};`),
      '\t}',
      'void hw_request_bootloader() { }',
      '\tif (nv->value_flt > TINYG_HARDWARE_VERSION_MAX) {',
    ].join('\n'),
    'firmware/tinyg/tinyg.h': [
      '#define TINYG_HARDWARE_PLATFORM\t\tHW_PLATFORM_TINYG_XMEGA',
      '#define TINYG_HARDWARE_VERSION\t\tHW_VERSION_TINYGV8',
      '#define TINYG_HARDWARE_VERSION_MAX\tTINYG_HARDWARE_VERSION',
      '#define MOTORS\t\t4',
    ].join('\n'),
    'firmware/tinyg/switch.h': ['\tSW_MIN_X = 0,', '\tSW_MAX_X,', '\tSW_MIN_Y,', '\tSW_MAX_Y,', '\tSW_MIN_Z,', '\tSW_MAX_Z,', '\tSW_MIN_A,', '\tSW_MAX_A,', '\tNUM_SWITCHES'].join('\n'),
    'firmware/tinyg/gpio.c': [
      'void gpio_set_bit_on(uint8_t b)',
      '{',
      ...['08', '04', '02', '01'].map((m, i) => `\tif (b & 0x${m}) { hw.out_port[${i}]->OUTSET = GPIO1_OUT_BIT_bm; }`),
      '}',
    ].join('\n'),
    'firmware/tinyg/stepper.c': '\tif ((mi != 1) && (mi != 2) && (mi != 4) && (mi != 8)) {',
    'firmware/tinyg/config_app.c': ['\t{ "sys","st", x },', '\t{ "sys","spep",x },', '\t{ "sys","spdp",x },'].join('\n'),
    'firmware/tinyg/settings.h': '#include "settings/settings_default.h"',
  };
}
const COMMIT = 'a'.repeat(40);
const extract = (s: Record<TinyGSourceFile, string>) => extractTinyG((p) => s[p], 'EN', COMMIT);
const edit = (file: TinyGSourceFile, from: string | RegExp, to: string) => {
  const s = sources();
  const next = s[file].replace(from, to);
  expect(next).not.toBe(s[file]);
  return { ...s, [file]: next };
};

describe('the TinyG extractor', () => {
  it('reads the synthetic sources: hp 1, hv 6/7/8 (not the v9 platform values), the v7 and v6 port maps', () => {
    const f = extract(sources());
    expect(f.platform.value).toBe(1);
    expect(f.revisions.map((r) => r.value)).toEqual([6, 7, 8]);
    expect(f.hvMax.value).toBe(8);
    expect(f.outputPortsV6.value).toEqual(['A', 'F', 'E', 'D']);
    expect(f.platform.src).toBe('EN hardware.h:3; EN tinyg.h:1');
  });

  it('a lower TINYG_HARDWARE_VERSION_MAX drops the revisions above it', () => {
    const f = extract(edit('firmware/tinyg/tinyg.h', 'HW_VERSION_TINYGV8', 'HW_VERSION_TINYGV7'));
    expect(f.revisions.map((r) => r.value)).toEqual([6, 7]);
  });

  it.each([
    ['a missing port binding', 'firmware/tinyg/hardware.h', /#define PORT_MOTOR_3\tPORTE\n/, ''],
    ['a duplicated definition', 'firmware/tinyg/hardware.h', '#define SPINDLE_PWM\t0x02', '#define SPINDLE_PWM\t0x02\n#define SPINDLE_PWM\t0x02'],
    ['separate mist and flood outputs', 'firmware/tinyg/hardware.h', 'FLOOD_COOLANT_BIT\t0x01', 'FLOOD_COOLANT_BIT\t0x10'],
    ['a port bit out of order', 'firmware/tinyg/hardware.h', '// bit 5', '// bit 6'],
    ['an out_port binding the extractor does not expect', 'firmware/tinyg/hardware.c', 'hw.out_port[2] = &PORT_OUT_V7_Z', 'hw.out_port[2] = &PORT_OUT_V7_A'],
    ['MOTORS disagreeing with the motor ports', 'firmware/tinyg/tinyg.h', 'MOTORS\t\t4', 'MOTORS\t\t5'],
    ['a platform missing from the enum', 'firmware/tinyg/tinyg.h', 'HW_PLATFORM_TINYG_XMEGA', 'HW_PLATFORM_TINYG_V9'],
    ['a hardware version the max does not name', 'firmware/tinyg/tinyg.h', 'TINYG_HARDWARE_VERSION\t\tHW_VERSION_TINYGV8', 'TINYG_HARDWARE_VERSION\t\tHW_VERSION_TINYGV9C'],
    ['hw_set_hv without its upper bound', 'firmware/tinyg/hardware.c', 'value_flt > TINYG_HARDWARE_VERSION_MAX', 'value_flt > 99'],
    ['a fifth GPIO mask line', 'firmware/tinyg/gpio.c', '\n}', '\n\tif (b & 0x10) { hw.out_port[0]->OUTSET = GPIO1_OUT_BIT_bm; }\n}'],
    ['a missing switch', 'firmware/tinyg/switch.h', '\tSW_MAX_A,\n', ''],
    ['a missing polarity token', 'firmware/tinyg/config_app.c', '"spdp"', '"spxx"'],
  ] as const)('refuses %s', (_name, file, from, to) => {
    expect(() => extract(edit(file, from, to))).toThrow(/gen-boards/);
  });

  it('refuses a short commit or a bad tag', () => {
    expect(() => extractTinyG((p) => sources()[p], 'EN', 'ead63997')).toThrow(/40-hex/);
    expect(() => extractTinyG((p) => sources()[p], 'en', COMMIT)).toThrow(/tag/);
  });
});

describe('overlays', () => {
  const facts = readFacts();
  const v8 = readOverlays().find((o) => o.board === 'tinyg-v8@8') as BoardOverlay;

  it('the v8 overlay adds connectors, driver and ratings without touching the generated pins or outputs', () => {
    const base = tinygBoard(facts, 8);
    const merged = applyOverlay(base, v8);
    expect(merged.pins).toEqual(base.pins);
    expect(merged.outputs).toEqual(base.outputs);
    expect(merged.connectors?.map((c) => c.id)).toEqual(['J1', 'J6', 'J7', 'J8']);
    expect(merged.motors.driver?.verified).toBe('schematic');
  });

  it('refuses an overlay pin naming a signal the generated pins do not have', () => {
    const bad: BoardOverlay = {
      ...v8,
      connectors: [{ id: 'J6', label: 'x', pins: [{ n: 1, label: 'Probe', signal: 'in.probe' }], src: 'test overlay', verified: 'schematic' }],
    };
    expect(() => renderBoard(applyOverlay(tinygBoard(facts, 8), bad))).toThrow(/in\.probe/);
  });

  it('refuses an overlay for a board that is not generated, or one that sets firmware facts', () => {
    expect(() => renderTinyGBoards(facts, [{ ...v8, board: 'tinyg-v9@9' }])).toThrow(/matches no generated board/);
    expect(() => parseOverlay({ ...v8, pins: [] }, 'boards/overlays/tinyg-v8@8.json')).toThrow(/may not set "pins"/);
    expect(() => parseOverlay({ ...v8, outputs: [] }, 'boards/overlays/tinyg-v8@8.json')).toThrow(/may not set "outputs"/);
    expect(() => parseOverlay({ ...v8, motors: { count: { value: 6 } } }, 'boards/overlays/tinyg-v8@8.json')).toThrow(/motors\.count/);
    expect(() => parseOverlay(v8, 'boards/overlays/tinyg-v7@7.json')).toThrow(/named after its board/);
  });

  it('an unrecognised hv cannot be generated', () => {
    expect(() => tinygBoard(facts, 9)).toThrow(/not a TinyG revision/);
  });
});
