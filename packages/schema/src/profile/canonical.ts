/**
 * The canonical form of a MachineProfile v2 (ROADMAP TB-01; SAFETY §4.10
 * rule 3). Built field by field from the v2 schema's fields, so nothing
 * outside the schema (a fact, a confirmation, an override, cloud revision
 * metadata) can be carried into storage or an export, even through a cast.
 */
import { deepFreeze } from '../frozen.ts';
import type { MachineProfileV2, ProfileAxis, ProfileAxisDef } from './types.ts';
import { PROFILE_AXES } from './types.ts';

const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

function copyAxis(a: ProfileAxisDef): ProfileAxisDef {
  return {
    motors: [...a.motors],
    drive: {
      kind: a.drive.kind,
      ...opt('pitchMm', a.drive.pitchMm),
      ...opt('starts', a.drive.starts),
      ...opt('teeth', a.drive.teeth),
      ...opt('ratio', a.drive.ratio),
    },
    measuredTravelMm: a.measuredTravelMm,
    homeEnd: a.homeEnd,
  };
}

/**
 * A field-by-field copy holding only v2 schema fields, with settings keys in
 * sorted order (so equal profiles export to equal bytes), deep-frozen.
 */
export function canonicalProfile(p: MachineProfileV2): MachineProfileV2 {
  const m = p.machine;
  const axes: Partial<Record<ProfileAxis, ProfileAxisDef>> = {};
  for (const axis of PROFILE_AXES) {
    const a = m.axes[axis];
    if (a !== undefined) axes[axis] = copyAxis(a);
  }
  const draft = Object.fromEntries(
    Object.keys(p.settings.draft)
      .sort()
      .map((k) => [k, p.settings.draft[k] as number]),
  );
  const b = p.boundDevice;
  const f = p.firmware;
  return deepFreeze({
    schemaVersion: 2,
    id: p.id,
    name: p.name,
    boundDevice: b === null ? null : { family: b.family, id: b.id, fb: b.fb, ...opt('fbs', b.fbs), dialectId: b.dialectId },
    board: p.board === null ? null : { id: p.board.id, rev: p.board.rev, hv: p.board.hv },
    firmware: f === null ? null : { dialectId: f.dialectId, fb: f.fb, ...opt('fbs', f.fbs), ...opt('imageSha256', f.imageSha256) },
    machine: {
      type: m.type,
      axes,
      homingOrder: [...m.homingOrder],
      spindle: { kind: m.spindle.kind, drive: m.spindle.drive, activeLow: m.spindle.activeLow },
      psu: m.psu === null ? null : { volts: m.psu.volts, amps: m.psu.amps, earthed: m.psu.earthed },
      estop: { kind: m.estop.kind, auxInput: m.estop.auxInput },
      hostLossPolicy: m.hostLossPolicy,
      queuedMotionCeilingS: m.queuedMotionCeilingS,
      jogCaps: { maxStepMm: m.jogCaps.maxStepMm, maxFeedMmPerMin: m.jogCaps.maxFeedMmPerMin },
      holdTimeoutS: m.holdTimeoutS,
    },
    settings: { draft, schemaKey: p.settings.schemaKey, deviceHash: p.settings.deviceHash },
    wiringRef: p.wiringRef === null ? null : { id: p.wiringRef.id, sha256: p.wiringRef.sha256 },
    createdWith: { tool: p.createdWith.tool, version: p.createdWith.version, sha: p.createdWith.sha },
  });
}
