// Node entry point (Node >= 22.12 runs .ts via type stripping).
import { usage } from './index.ts';

declare const process: { stdout: { write(s: string): unknown } };
process.stdout.write(usage());
