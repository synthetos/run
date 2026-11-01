/**
 * The generated board definitions and the panel set each one drives
 * (ROADMAP TB-05a; RUN_PLAN §5.1 rule 6).
 *
 * `BOARD_DEFINITIONS` holds every definition `pnpm gen:boards` wrote to
 * packages/schema/boards/, validated (schema plus pin consistency) when this
 * module loads. `boardPanels` turns a board selection into the panels the UI
 * shows: only what the definition lists, so a board without a spindle
 * direction output gets no spindle direction panel, and a board that is not
 * known exactly gets the common subset (nothing, when unknown) and a visible
 * notice instead of a guess.
 */
import { parseBoardDefinition, selectBoard } from './boards.ts';
import type { BoardDefinition, BoardIdentity, BoardSelection, OutputId } from './boards.ts';
import { GENERATED_BOARDS } from './generated/boards.ts';

function load(json: unknown): BoardDefinition {
  const parsed = parseBoardDefinition(json);
  if (!parsed.ok) throw new Error(`board definition invalid: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  return parsed.board;
}

export const BOARD_DEFINITIONS: readonly BoardDefinition[] = Object.freeze(GENERATED_BOARDS.map(load));

/** Select from the generated definitions. */
export function selectGeneratedBoard(identity: BoardIdentity): BoardSelection {
  return selectBoard(identity, BOARD_DEFINITIONS);
}

export const UNRECOGNISED_BOARD_NOTICE = 'Unrecognised board revision';
export const UNCERTAIN_BOARD_NOTICE = 'Board revision not certain';

export type BoardPanel =
  | { readonly kind: 'motors'; readonly count: number; readonly microsteps: readonly number[]; readonly driver?: string }
  | { readonly kind: 'inputs'; readonly functions: readonly string[] }
  | { readonly kind: 'output'; readonly id: OutputId; readonly polarityToken?: string; readonly mcu?: string }
  | { readonly kind: 'adc'; readonly channels: readonly string[] }
  | { readonly kind: 'connectors'; readonly ids: readonly string[] }
  | { readonly kind: 'ratings'; readonly ids: readonly string[] };

export interface BoardPanelSet {
  readonly boardId: string;
  readonly title: string;
  /** Present whenever the board is not known exactly; the UI must show it. */
  readonly notice?: { readonly text: string; readonly detail: string };
  readonly panels: readonly BoardPanel[];
}

/** The panels a board selection allows. Capability-driven: nothing the definition does not list. */
export function boardPanels(selection: BoardSelection): BoardPanelSet {
  const b = selection.board;
  const panels: BoardPanel[] = [];
  if (b.motors.count.value > 0) {
    panels.push({
      kind: 'motors',
      count: b.motors.count.value,
      microsteps: b.motors.microsteps.value,
      ...(b.motors.driver === undefined ? {} : { driver: b.motors.driver.value }),
    });
  }
  if (b.inputs.functions.value.length > 0) panels.push({ kind: 'inputs', functions: b.inputs.functions.value });
  for (const o of b.outputs) {
    const mcu = b.pins?.find((p) => p.signal === `out.${o.id}`)?.mcu;
    panels.push({ kind: 'output', id: o.id, ...(o.polarityToken === undefined ? {} : { polarityToken: o.polarityToken }), ...(mcu === undefined ? {} : { mcu }) });
  }
  if (b.adc.length > 0) panels.push({ kind: 'adc', channels: b.adc.map((a) => a.id) });
  if ((b.connectors ?? []).length > 0) panels.push({ kind: 'connectors', ids: (b.connectors ?? []).map((c) => c.id) });
  if ((b.ratings ?? []).length > 0) panels.push({ kind: 'ratings', ids: (b.ratings ?? []).map((r) => r.id) });

  if (selection.kind === 'exact') return { boardId: b.id, title: b.name, panels };
  const notice =
    selection.reason === 'unknown'
      ? { text: UNRECOGNISED_BOARD_NOTICE, detail: 'No board definition matches this board. Only what every board has is shown; nothing else is assumed.' }
      : { text: UNCERTAIN_BOARD_NOTICE, detail: `This board could be ${selection.candidates.join(' or ')}. Only what all of them have is shown.` };
  return { boardId: b.id, title: b.name, notice, panels };
}
