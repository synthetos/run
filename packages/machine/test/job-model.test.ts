import { describe, expect, it } from 'vitest';
import {
  liveMotion,
  liveStart,
  type SessionState
} from '../src/index.ts';
import { jobHarness, load, runUntil, start } from './jobHarness.ts';
import { ready, value } from './jobLayerHarness.ts';

describe('the live start state and motion model for the sanitiser', () => {
  it('maps every read it has and leaves the rest unknown', async () => {
    const base = await ready();
    const s: SessionState = {
      ...base,
      values: {
        unit: value(0),
        dist: value(1),
        admo: value(0),
        plan: value(2),
        coor: value(2),
        // In G20 the board prints g55 and g92 in inches and ofs in mm (EN json_parser.c:828; config_app.c:858-871).
        g55: value({ x: 1, y: 2, z: 3, q: 9, a: 'n' }),
        g57: value({ x: 1, a: 90 }),
        g92: value({ x: 0.5, y: 0, z: 0 }),
        ofs: value({ x: 38.1, y: 50.8, z: 78.2 }),
        mpo: value([1, 2]),
        g28: value({ x: 0 }, 100),
        gun: value(0),
        gdi: value(1),
        gpl: value(1),
        gco: value(3),
      },
    };
    const st = liveStart(s);
    expect(st).toMatchObject({ units: 'G20', distance: 'G91', arcDistance: 'G90.1', plane: 'G19', wcs: 'G55', g92: { active: true } });
    expect(st.wcsOffsets?.G55).toEqual({ X: 25.4, Y: 50.8, Z: expect.closeTo(76.2, 9) });
    // A, B and C are degrees, never converted.
    expect(st.wcsOffsets?.G57).toEqual({ X: 25.4, A: 90 });
    expect(st.g92?.offsets).toEqual({ X: 12.7, Y: 0, Z: 0 });
    expect(st.toolOffset).toEqual({ X: 0, Y: 0, Z: 2 });
    expect(st.machine).toBeUndefined();
    expect(st.g28).toBeUndefined();
    expect(st.defaults).toEqual({ units: 'G20', distance: 'G91', plane: 'G18', wcs: 'G56' });
    const other = liveStart({ ...base, values: { unit: value(7), dist: value(3), admo: value(1), plan: value(9), coor: value(0), gun: value(1), gdi: value(0), gpl: value(0), gco: value(9) } });
    expect(other).toMatchObject({ arcDistance: 'G91.1', defaults: { units: 'G21', distance: 'G90', plane: 'G17' } });
    expect(other.units).toBeUndefined();
    expect(other.wcs).toBeUndefined();
    expect(liveStart({ ...base, values: { unit: value(1), coor: value(1), g54: value({ x: 0 }), g92: value({ x: 0 }), ofs: value({ y: 1 }) } }).toolOffset).toEqual({});
    // Without the units read, offsets printed in them are unknown: never guessed as mm.
    const unitless = liveStart({ ...base, values: { coor: value(1), g54: value({ x: 1, y: 0, z: 0 }), g92: value({ x: 0, y: 0, z: 0 }), ofs: value({ x: 1, y: 0, z: 0 }), g28: value({ x: 1 }) } });
    expect(unitless.wcsOffsets).toEqual({});
    expect(unitless.g92).toBeUndefined();
    expect(unitless.g28).toBeUndefined();
    expect(unitless.toolOffset).toBeUndefined();
  });
});

describe('the live start state and motion model for the sanitiser', () => {
  it('a board an inch job left in G20 prints its offsets in inches: the next check takes them back to mm (EN json_parser.c:828)', async () => {
    const h = await jobHarness();
    // The job sets G54 in mm, then works in inches; its M30 keeps G20 (the edge-next program end leaves the units).
    await start(h, 'G21 G90\nG10 L2 P1 X50.8 Y25.4 Z-12.7\nG20\nG0 X0.5 Y0.25\nM30');
    expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'done')).toBe(true);
    // A temporary offset on X at machine X 63.5 (G54 50.8 + 0.5 in).
    expect(h.session.request({ intent: 'tempOffset', axes: ['x'] })).toEqual({ allowed: true });
    await h.run(1500);
    await load(h, 'G21 G90\nG0 X1\nM30', 'second.nc');
    const s = h.session.state;
    expect(s.values['unit']?.value).toBe(0);
    expect(s.values['g54']?.value).toMatchObject({ x: 2, y: 1, z: -0.5 });
    expect(s.values['g92']?.value).toMatchObject({ x: 0.5 });
    const st = liveStart(s);
    expect(st.units).toBe('G20');
    const mm = (v: Readonly<Record<string, number>> | undefined): Record<string, number> => Object.fromEntries(Object.entries(v ?? {}).filter(([k]) => 'XYZ'.includes(k)).map(([k, x]) => [k, Math.round(x * 1000) / 1000 + 0]));
    expect(mm(st.wcsOffsets?.G54)).toEqual({ X: 50.8, Y: 25.4, Z: -12.7 });
    expect(mm(st.g92?.offsets)).toEqual({ X: 12.7, Y: 0, Z: 0 });
    expect(mm(st.toolOffset)).toEqual({ X: 0, Y: 0, Z: 0 });
  });
});

describe('the live start state and motion model for the sanitiser', () => {
  it('takes vm, fr, am and ra per axis, skipping what is missing or not valid', async () => {
    const base = await ready();
    const m = liveMotion({ ...base, values: { x: value({ vm: 900, fr: 0, am: 1 }), y: value({ am: 7 }), a: value({ am: 3, ra: 0 }), b: value({ am: 3, ra: 2 }) } });
    expect(m.maxVelocity).toEqual({ X: 900 });
    expect(m.feedrateMax).toEqual({});
    expect(m.linear).toEqual({ X: 1 });
    expect(m.rotary).toEqual({ A: { mode: 3 }, B: { mode: 3, radiusMm: 2 } });
  });
});
