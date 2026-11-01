/**
 * SVG export download (RUN_PLAN §7.3; P0-05 Trusted Types export policy).
 * The string renderer's output is branded by `brandSvgExport` (which checks
 * it against the export allowlist again) and turned into a Blob only through
 * the `rs-svg-export` policy. Without Trusted Types nothing is exported.
 */
import { renderString, rules, type Diagram, type Dialect, type Paper, type WiringBoard } from '@synthetos/wiring';
import { brandSvgExport, TrustedTypesError, type RunTrustedTypes } from '../security/tt.ts';

export function exportFileName(board: WiringBoard): string {
  return `wiring-${board.id.replace(/[^a-z0-9-]/gi, '-')}.svg`;
}

export function downloadSvgExport(tt: RunTrustedTypes | null, doc: Document, diagram: Diagram, board: WiringBoard, dialect: Dialect, paper: Paper): string {
  if (tt === null) return 'Not exported: this browser has no Trusted Types (use Chrome or Edge).';
  try {
    const svg = brandSvgExport(renderString(diagram, board, rules(diagram, board, dialect), { paper }));
    const url = URL.createObjectURL(tt.svgExportBlob(svg));
    const a = doc.createElement('a');
    a.href = url;
    a.download = exportFileName(board);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return `Exported ${exportFileName(board)}.`;
  } catch (e) {
    if (e instanceof TrustedTypesError) return `Not exported: ${e.message}`;
    throw e;
  }
}
