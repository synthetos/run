# @synthetos/gcode-view

Toolpath preview for the browser: chunked WebGL2 line rendering on demand, a 2D SVG fallback, a line scrubber and a virtualised list window.

Its input is a plain `SegmentList`, never G-code text. Whatever interprets the program (for run.synthetos.com, the `@synthetos/gcode` interpreter after the safety sanitiser) builds the list; this package only draws it. It imports no machine, safety, protocol or G-code code and has no runtime dependencies.

There is deliberately **no play, simulate or animate API**: a preview must never look like a machine that is moving. The scrubber highlights lines; it does not move a tool.

## Input

```ts
interface SegmentList {
  vertices: Float32Array;     // x, y, z per vertex
  kinds: Uint8Array;          // SEGMENT per vertex: the segment from the previous vertex (BREAK, RAPID, FEED, ARC; | UNCERTAIN)
  lineToVertex: Uint32Array;  // first vertex of each line, plus one closing entry equal to the vertex count
  lineMarks?: Uint8Array;     // LINE_MARK bits per line: OUT_OF_BOUNDS (red), UNCERTAIN (dimmed)
}
```

`checkSegmentList` throws a `SegmentListError` when the arrays disagree; every entry point calls it.

## Use

```ts
import { attachViewControls, createRenderer } from '@synthetos/gcode-view';

const gl = canvas.getContext('webgl2');
if (gl === null) {
  // fall back to svgPaths(list) and draw <path d> elements
} else {
  const renderer = createRenderer(gl, { colors });
  attachViewControls(canvas, renderer);
  renderer.resize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio);
  await renderer.load(list, { signal, onProgress });  // uploads in time slices; AbortError on cancel
  renderer.setRapidsVisible(false);
  renderer.setHighlight(line);                         // scrubber: lines 0..line
  renderer.setEnvelope(box);                           // work envelope in machine coordinates, or null
  renderer.setWcsOrigin([x, y, z]);                    // axis triad, or null
}
```

- **Render on demand.** A frame is drawn only after a change; several changes before the next frame draw once.
- **No long tasks.** `load` builds chunks of 65,536 segments and yields to the browser every 12 ms (`runSliced`), so a million-line program uploads without a main-thread task over 50 ms.
- **Lite lists.** `listWindow` computes the rows a virtualised list renders, including lists taller than the browser's maximum element height.

## Licence

AGPL-3.0-or-later, like the rest of the repository. See the root `LICENSE`.
