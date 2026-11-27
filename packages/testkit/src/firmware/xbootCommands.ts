/** Opcode dispatch, shared by legacy and hardened model modes. Parameters finish in XbootModel. */
import '../marker.ts';

interface Commands {
  readonly send: (bytes: number[]) => void;
  readonly pending: (op: number, need: number) => void;
  readonly erase: () => void;
  readonly readWord: () => number[];
  readonly writeBuffer: () => void;
  readonly readEeprom: () => number;
  readonly signature: readonly number[];
  readonly leave: () => void;
}
const PARAMETERS: Readonly<Record<number, number>> = {
  0x41: 2, 0x48: 3, 0x42: 3, 0x67: 3,
  0x63: 1, 0x43: 1, 0x44: 1, 0x6c: 1, 0x78: 1, 0x79: 1, 0x54: 1, 0x68: 1,
};
const REPLIES: Readonly<Record<number, readonly number[]>> = {
  0x61: [0x59], 0x62: [0x59, 2, 0],
  0x72: [0xff], 0x46: [0xff], 0x4e: [0xff], 0x51: [0xff],
  0x50: [13], 0x4c: [13], 0x70: [0x53], 0x74: [123, 0],
  0x53: [...'XBoot++'].map((c) => c.charCodeAt(0)), 0x56: [0x31, 0x37],
};
export function dispatchXboot(op: number, io: Commands): void {
  const need = PARAMETERS[op];
  if (need !== undefined) { io.pending(op, need); return; }
  const reply = REPLIES[op];
  if (reply !== undefined) { io.send([...reply]); return; }
  switch (op) {
    case 0x65: io.erase(); return;
    case 0x52: io.send(io.readWord()); return;
    case 0x6d: io.writeBuffer(); return;
    case 0x64: io.send([io.readEeprom()]); return;
    case 0x73: io.send([...io.signature]); return;
    case 0x45: io.send([13]); io.leave(); return;
    case 0x1b: return;
    default: io.send([0x3f]);
  }
}
