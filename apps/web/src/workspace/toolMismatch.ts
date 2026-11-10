/**
 * The file's tools against the tool table (tool-mismatch, 2026-11-10): the CAM comment says T1 is a 6 mm end mill,
 * the table's T1 is 3.175 mm. On the machine that is the wrong tool or the wrong offsets; in the 3D view the grooves
 * look wrong. Pure. Nothing here changes what is sent: it says so, and offers to edit T1 or take the file's tool.
 *
 * A diameter differs by more than `DIAMETER_TOLERANCE_MM` or `DIAMETER_TOLERANCE_FRACTION` of the larger, whichever
 * is more. A type differs only between families (an O-flute or a surfacing bit is still a flat-bottomed cutter; a
 * V-bit, an engraver and a chamfer mill are all V-shaped). A side the file does not state is never compared.
 */
import type { Tool, ToolType } from '@synthetos/library';
import type { FileTool } from '../gcode-worker/camTools.ts';

export const DIAMETER_TOLERANCE_MM = 0.05;
export const DIAMETER_TOLERANCE_FRACTION = 0.02;

/** The tool table's part this module reads. */
export interface TableTool {
  readonly number: number;
  readonly tool: Pick<Tool, 'id' | 'name' | 'type' | 'geometry'>;
}

export interface ToolMismatch {
  readonly number: number;
  readonly file: FileTool;
  readonly table: TableTool;
  readonly diameter: boolean;
  readonly type: boolean;
  /** "The file says T1 is a 6 mm end mill." */
  readonly fileText: string;
  /** "Your tool table's T1 is 3.175 mm." */
  readonly tableText: string;
}

const FAMILY: Readonly<Record<ToolType, string>> = {
  flat: 'flat',
  'o-flute': 'flat',
  surfacing: 'flat',
  'thread-mill': 'thread-mill',
  ball: 'ball',
  'bull-nose': 'bull-nose',
  'v-bit': 'v',
  engraver: 'v',
  chamfer: 'v',
  drill: 'drill',
};

/** A type in a sentence. */
export const TYPE_WORDS: Readonly<Record<ToolType, string>> = {
  flat: 'end mill',
  'o-flute': 'O-flute',
  surfacing: 'surfacing bit',
  'thread-mill': 'thread mill',
  ball: 'ball nose',
  'bull-nose': 'bull nose',
  'v-bit': 'V-bit',
  engraver: 'engraver',
  chamfer: 'chamfer mill',
  drill: 'drill',
};

export function diametersDiffer(a: number, b: number): boolean {
  return Math.abs(a - b) > Math.max(DIAMETER_TOLERANCE_MM, DIAMETER_TOLERANCE_FRACTION * Math.max(a, b));
}

/** A size as written: 6, 3.175, 6.35. */
export function mmText(mm: number): string {
  return String(Number(mm.toFixed(3)));
}

/** "a" or "an" before a phrase: "an 8 mm end mill", "an O-flute", "a 6 mm end mill". */
function article(phrase: string): string {
  return /^(?:[aeio]|8|11(?![\d.])|18(?![\d.])|O-)/i.test(phrase) ? `an ${phrase}` : `a ${phrase}`;
}

/** "a 6 mm end mill", "6 mm", "a ball nose". */
function describe(diameter: number | null, type: ToolType | null): string {
  if (type === null) return diameter === null ? 'unknown' : `${mmText(diameter)} mm`;
  return article(diameter === null ? TYPE_WORDS[type] : `${mmText(diameter)} mm ${TYPE_WORDS[type]}`);
}

/** The table's T numbers the file describes differently, in T order. */
export function toolMismatches(fileTools: readonly FileTool[], table: readonly TableTool[]): readonly ToolMismatch[] {
  const out: ToolMismatch[] = [];
  for (const f of fileTools) {
    const t = table.find((e) => e.number === f.number);
    if (t === undefined) continue;
    const diameter = f.diameterMm !== null && diametersDiffer(f.diameterMm, t.tool.geometry.diameter);
    const type = f.type !== null && FAMILY[f.type] !== FAMILY[t.tool.type];
    if (!diameter && !type) continue;
    const fileText = `The file says T${f.number} is ${describe(f.diameterMm, f.type)}.`;
    const tableText = `Your tool table’s T${f.number} is ${describe(t.tool.geometry.diameter, type ? t.tool.type : null)}.`;
    out.push({ number: f.number, file: f, table: t, diameter, type, fileText, tableText });
  }
  return out.sort((a, b) => a.number - b.number);
}

/** The Ready list's words: "T1 doesn't match the file.", "T1 and T3 don't match the file.". */
export function mismatchSummary(list: readonly ToolMismatch[]): string | null {
  if (list.length === 0) return null;
  const names = list.map((m) => `T${m.number}`);
  const joined = names.length === 1 ? (names[0] as string) : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] as string}`;
  return `${joined} ${names.length === 1 ? 'doesn’t' : 'don’t'} match the file.`;
}

/** The tag on a tool made from a file's description: "Use the file's tool" updates it in place next time. */
export const FROM_FILE_TAG = 'from-file';

/**
 * The tool a file describes, as a tool record: the stated diameter and type (an end mill and 3.175 mm where it says
 * none), the rest the usual new-tool placeholders. Named after what it is ("6 mm end mill").
 */
export function toolFromFile(f: FileTool, id: string): Tool {
  const d = f.diameterMm ?? 3.175;
  const type: ToolType = f.type ?? 'flat';
  return {
    id,
    version: 1,
    name: `${mmText(d)} mm ${TYPE_WORDS[type]}`,
    type,
    geometry: {
      diameter: d,
      shank: d,
      flutes: type === 'o-flute' ? 1 : 2,
      fluteLength: Math.max(6, Math.round(d * 3)),
      overallLength: 38,
      ...(f.cornerRadiusMm === undefined ? {} : { cornerRadius: f.cornerRadiusMm }),
      ...(f.vAngle === undefined ? {} : { vAngle: f.vAngle }),
    },
    toolMaterial: 'carbide',
    coating: 'uncoated',
    description: `From the file (line ${f.line}): ${f.text}`,
    notes: '',
    purchase: [],
    cuttingData: [],
    life: { minutes: 0, byMaterial: [] },
    tags: [FROM_FILE_TAG],
    images: [],
  };
}

/** A tool table row (workspace/librarySeed.ts SeedTool). */
export interface PlanEntry {
  readonly number: number;
  readonly store: string | null;
  readonly tool: Tool;
}

/** What "Use the file's tool" will do, in words for its confirmation, and the new table. */
export interface UseFilePlan {
  readonly text: string;
  readonly next: readonly PlanEntry[];
}

/**
 * T`n` becomes the file's tool. A tool made from a file before is updated in place; otherwise a new tool takes T`n`
 * and the table's T`n` keeps its record under the next free T number, so nothing the user entered is lost.
 */
export function useFilePlan(list: readonly PlanEntry[], f: FileTool, newId: string): UseFilePlan {
  const current = list.find((e) => e.number === f.number);
  if (current !== undefined && current.tool.tags.includes(FROM_FILE_TAG)) {
    const tool = { ...toolFromFile(f, current.tool.id), version: current.tool.version + 1 };
    return { text: `T${f.number} becomes ${describe(f.diameterMm ?? tool.geometry.diameter, tool.type)}, as the file says.`, next: list.map((e) => (e === current ? { ...e, tool } : e)) };
  }
  const tool = toolFromFile(f, newId);
  if (current === undefined) return { text: `A new tool, ${tool.name}, is added as T${f.number}.`, next: [...list, { number: f.number, store: null, tool }] };
  const free = Math.max(0, ...list.map((e) => e.number)) + 1;
  // A tool still called by its default name ("T1 tool") follows its new number, as setToolNumber does.
  const moved = current.tool.name === `T${current.number} tool` ? { ...current.tool, name: `T${free} tool` } : current.tool;
  return {
    text: `A new tool, ${tool.name}, becomes T${f.number}. Your ${current.tool.name} moves to T${free}.`,
    next: [...list.map((e) => (e === current ? { ...e, number: free, tool: moved } : e)), { number: f.number, store: null, tool }],
  };
}
