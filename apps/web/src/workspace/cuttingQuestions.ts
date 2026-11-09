/**
 * Cutting advice asks one question at a time (docs/design/ANALYZE.md §3, slice 1): the next input that is really
 * needed, in the order the advice needs it. Material first, then the machine's spindle facts, then the operation's
 * own inputs. Motion analysis never waits for any of these. Display only.
 */
import type { AdvisorFields } from './advisorModel.ts';
import type { MachineProfile, ToolEntry } from './library.ts';

export interface Question {
  /** Where the answer lives: a link to Setup or Machines, the machine's saved inputs, or this operation's inputs. */
  readonly scope: 'setup' | 'machines' | 'machine' | 'operation';
  readonly key: string;
  /** A short question or instruction. */
  readonly label: string;
  readonly options?: readonly (readonly [string, string])[];
  /** A short line under the field, when the question needs one. */
  readonly hint?: string;
}

const OPERATION_KINDS: readonly (readonly [string, string])[] = [['slot', 'Slot'], ['pocket', 'Pocket'], ['adaptive', 'Adaptive'], ['profile', 'Profile'], ['finish', 'Finish'], ['drill', 'Drill'], ['v-carve', 'V-carve']];
const COOLANTS: readonly (readonly [string, string])[] = [['none', 'None'], ['air', 'Air'], ['mist', 'Mist'], ['flood', 'Flood']];

const isNumber = (s: string | undefined, min = 0, strict = true): boolean => s !== undefined && s.trim() !== '' && Number.isFinite(Number(s)) && (strict ? Number(s) > min : Number(s) >= min);

/** The first missing machine-level input, or null when the advice has what it needs from the machine. */
export function machineQuestion(profile: MachineProfile | null, fields: AdvisorFields): Question | null {
  if (profile === null) return { scope: 'machines', key: 'profile', label: 'Choose your machine in Machines.' };
  if (!['hobby', 'medium', 'rigid'].includes(fields['frame'] ?? '')) return { scope: 'machine', key: 'frame', label: 'How stiff is the machine?', options: [['hobby', 'Hobby'], ['medium', 'Medium'], ['rigid', 'Rigid']] };
  if (!['vfd', 'pwm', 'dial-router'].includes(fields['spindle'] ?? '')) return { scope: 'machine', key: 'spindle', label: 'How is the spindle speed set?', options: [['dial-router', 'Router dial'], ['pwm', 'PWM'], ['vfd', 'VFD']] };
  if (!isNumber(fields['minRpm'], 0, false)) return { scope: 'machine', key: 'minRpm', label: 'Lowest spindle speed (rpm)?' };
  if (!isNumber(fields['maxRpm']) || Number(fields['maxRpm']) < Number(fields['minRpm'])) return { scope: 'machine', key: 'maxRpm', label: 'Highest spindle speed (rpm)?', hint: 'At least the lowest speed.' };
  if (!isNumber(fields['powerKw'])) return { scope: 'machine', key: 'powerKw', label: 'Spindle power (kW)?' };
  if (fields['spindle'] === 'dial-router' && (fields['dial'] ?? '').trim() === '') return { scope: 'machine', key: 'dial', label: 'Router dial table?', hint: 'Setting=rpm pairs, such as 1=10000, 2=12000.' };
  const axes = profile.axes;
  if ((axes?.x?.maxFeed === undefined || axes.y?.maxFeed === undefined) && !isNumber(fields['xy'])) return { scope: 'machine', key: 'xy', label: 'Fastest XY feed (mm/min)?', hint: 'Or set it in the machine profile.' };
  if (axes?.z?.maxFeed === undefined && !isNumber(fields['z'])) return { scope: 'machine', key: 'z', label: 'Fastest Z feed (mm/min)?', hint: 'Or set it in the machine profile.' };
  return null;
}

/** The first missing input of one operation, or null. `tool` is the operation's own T number, if the file has one. */
export function operationQuestion(tool: number | null, fields: AdvisorFields, tools: readonly ToolEntry[]): Question | null {
  if (tool === null && !tools.some((t) => String(t.number) === fields['tool'])) {
    return { scope: 'operation', key: 'tool', label: 'Which tool is in the spindle?', hint: 'The file does not say. The preview carves with it too.', options: tools.map((t) => [String(t.number), `T${t.number} · ${t.tool.name}`]) };
  }
  if (tool !== null && !tools.some((t) => t.number === tool)) return { scope: 'machines', key: 'tool-library', label: `Add T${tool} to the tool library.` };
  if (!OPERATION_KINDS.some(([k]) => k === fields['kind'])) return { scope: 'operation', key: 'kind', label: 'What kind of cut is it?', options: OPERATION_KINDS };
  if (!isNumber(fields['ap'])) return { scope: 'operation', key: 'ap', label: 'Depth of cut (mm)?', hint: 'From your CAM setup. The file cannot tell.' };
  if (!isNumber(fields['ae'])) return { scope: 'operation', key: 'ae', label: 'Stepover (mm)?', hint: 'From your CAM setup. The file cannot tell.' };
  if (!COOLANTS.some(([k]) => k === fields['coolant'])) return { scope: 'operation', key: 'coolant', label: 'Which coolant?', options: COOLANTS };
  return null;
}
