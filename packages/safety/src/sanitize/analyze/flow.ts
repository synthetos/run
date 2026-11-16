import { type Word } from '../lex.ts';

export function flowFlags({ has, codes }: FlowFlagsInput): { programStop: boolean; optionalStop: Word | null; programEnd: boolean; outputsOn: boolean } {


  const programStop = has('M0') || has('M60');
  const programEnd = has('M2') || has('M30');
  const optionalStop = codes.find((c) => c.code === 'M1')?.word ?? null;
  const outputsOn = ['M3', 'M4', 'M7', 'M8'].some(has);
  return { programStop, optionalStop, programEnd, outputsOn };
}

interface FlowFlagsInput {
  has: (code: string) => boolean;
  codes: { word: Word; code: string; }[]
}
