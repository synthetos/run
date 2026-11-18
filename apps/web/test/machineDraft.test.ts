import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { readMachine } from '@synthetos/library';
import { boardOwner, draftFromMachine, draftFromTemplate, draftValid, machineFromDraft, saveDraft, type MachineDraft } from '../src/wizard/machineDraft.ts';
import { Machine, MACHINE_LEAD, MACHINE_TITLE, MORE_BOARDS } from '../src/wizard/steps/Machine.ts';
import { CATALOGUE } from '../src/workspace/machineDrawings.ts';
import { machineStore, selectedMachineStore } from '../src/workspace/library.ts';
import { createWorkspaceModel } from '../src/workspace/model.ts';
import { snap, view } from './runMotionHarness.ts';

const shapeoko = CATALOGUE.find((t) => t.id === 'shapeoko')!;
const AT = '2026-11-18T12:00:00.000Z';
afterEach(() => { machineStore.set([]); selectedMachineStore.set(null); });

describe('machine draft', () => {
  it('starts from a template: its name, travel as the bed, 19 mm thick', () => {
    expect(draftFromTemplate(shapeoko)).toEqual({ templateId: 'shapeoko', name: 'My Shapeoko', width: 425, depth: 425, thickness: 19 });
    expect(draftFromTemplate(CATALOGUE.find((t) => t.id === 'custom')!).name).toBe('My machine');
  });
  it('is valid with a name and three positive sizes', () => {
    const d = draftFromTemplate(shapeoko);
    expect(draftValid(d)).toBe(true);
    expect(draftValid({ ...d, name: '  ' })).toBe(false);
    expect(draftValid({ ...d, width: 0 })).toBe(false);
    expect(draftValid({ ...d, thickness: -1 })).toBe(false);
    expect(draftValid({ ...d, depth: Number.NaN })).toBe(false);
  });
  it('becomes a machine record the account accepts, with the bed, the board id and a dated bed', () => {
    const m = machineFromDraft(draftFromTemplate(shapeoko), null, '2X3559-ABCD', AT);
    expect(readMachine(m).ok).toBe(true);
    expect(m).toMatchObject({ templateId: 'shapeoko', name: 'My Shapeoko', drive: 'belt', travel: shapeoko.travel, boardId: '2X3559-ABCD', revision: 1, homeFrame: 'front-left-top', createdAt: AT });
    expect(m.bed).toMatchObject({ width: 425, depth: 425, thickness: 19, savedAt: AT, source: { kind: 'placeholder' } });
    expect(m.id).toMatch(/^m-shapeoko-/);
    const noBoard = machineFromDraft(draftFromTemplate(shapeoko), null, null, AT);
    expect('boardId' in noBoard).toBe(false);
    expect(readMachine(noBoard).ok).toBe(true);
  });
  it('on an existing machine keeps the id and createdAt, bumps the revision and keeps the axes', () => {
    const base = { ...machineFromDraft(draftFromTemplate(shapeoko), null, null, '2026-01-01T00:00:00.000Z'), axes: { x: { jerk: 5 } } };
    const d: MachineDraft = { ...draftFromMachine(base), name: 'Bench router', width: 400 };
    const next = machineFromDraft(d, base, 'B-2', AT);
    expect(next).toMatchObject({ id: base.id, createdAt: base.createdAt, name: 'Bench router', revision: 2, boardId: 'B-2', axes: { x: { jerk: 5 } } });
    expect(next.bed?.width).toBe(400);
    expect(readMachine(next).ok).toBe(true);
  });
  it('draftFromMachine reads the bed, or the travel when there is none', () => {
    const m = machineFromDraft({ ...draftFromTemplate(shapeoko), width: 300, depth: 200, thickness: 12 }, null, null, AT);
    expect(draftFromMachine(m)).toEqual({ templateId: 'shapeoko', name: 'My Shapeoko', width: 300, depth: 200, thickness: 12 });
    const { bed: _bed, ...bare } = m;
    expect(draftFromMachine(bare)).toMatchObject({ width: 425, depth: 425, thickness: 19 });
  });
  it('boardOwner finds the machine bound to a board', () => {
    const a = machineFromDraft(draftFromTemplate(shapeoko), null, 'B-1', AT);
    expect(boardOwner('B-1', [a])?.id).toBe(a.id);
    expect(boardOwner('B-9', [a])).toBeNull();
    expect(boardOwner(null, [a])).toBeNull();
  });
  it('saveDraft creates once and then updates the same record (Review Focus 2), selecting it', () => {
    const d = draftFromTemplate(shapeoko);
    const id = saveDraft(d, null, null);
    expect(machineStore.value.value.map((m) => m.id)).toEqual([id]);
    expect(selectedMachineStore.value.value).toBe(id);
    const again = saveDraft({ ...d, name: 'Renamed' }, id, 'B-1');
    expect(again).toBe(id);
    expect(machineStore.value.value).toHaveLength(1);
    expect(machineStore.value.value[0]).toMatchObject({ name: 'Renamed', boardId: 'B-1', revision: 2 });
  });
});

describe('step 2 Your machine (render)', () => {
  const draft = draftFromTemplate(shapeoko);
  const props = { draft, onDraft: () => undefined, owner: null, onUseOwner: () => undefined };
  it('has the template picker, the name, the three sizes with units, the Connect flow and the more-boards line', () => {
    expect(MACHINE_TITLE).toBe('Your machine');
    expect(MACHINE_LEAD).toBe('Tell Run what is on the bench, then connect once.');
    const html = renderToString(h(Machine, { ...props, model: null }));
    expect(html.match(/<option/g)).toHaveLength(CATALOGUE.length);
    expect(html).toContain('class="field f-pick"');
    expect(html).toContain('class="field f-name"');
    expect(html.match(/class="field f-num"/g)).toHaveLength(3);
    expect(html).toContain('value="My Shapeoko"');
    expect(html.match(/<i>mm<\/i>/g)).toHaveLength(3);
    expect(html).toContain('data-region="connect"');
    expect(html).toContain(MORE_BOARDS);
    expect(html).not.toMatch(/E-stop|never need|Saved in this browser/);
  });
  it('connected: the status line with the board, and the owner line when the board already has a machine', () => {
    const model = createWorkspaceModel();
    model.live.value = view(snap());
    const owner = machineFromDraft(draft, null, 'SIM-EN-0001', AT);
    const html = renderToString(h(Machine, { ...props, model, owner }));
    expect(html).toContain('data-wizard="board"');
    expect(html).toContain('Connected · TinyG v8 · firmware 450.01 · SIM-EN-0001');
    expect(html).toContain('This board is <strong>My Shapeoko</strong>');
    expect(html).toContain('data-action="wizard-use-machine"');
  });
});
