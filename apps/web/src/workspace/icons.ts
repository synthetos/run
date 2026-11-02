/**
 * The workspace's line icons (from the workspace design study). Built with
 * Preact as SVG elements, never as markup strings; decorative, so hidden from
 * assistive technology.
 */
import { h, type ComponentChild } from 'preact';

const PATHS = {
  run: 'M7 4.5v15l12-7.5Z',
  setup: 'M2 19h20M4 19v-3h16v3M7 16v-4h10v4M6 12V9h3v3m6 0V9h3v3',
  tools: 'M9 2h6v7H9ZM10 9h4v8l-2 4-2-4ZM10 12.5l4-1.5M10 15.5l4-1.5',
  board: 'M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2ZM9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4M9 9h6v6H9Z',
  materials: 'M3 8 12 4l9 4-9 4ZM3 8v8l9 4 9-4V8M12 12v8',
  machines: 'M2 20h20M4 20V8m16 12V8M3 8h18M10 8v6h4V8m-2 6v3',
  projects: 'M3 5h7l2 3h9v12H3Z',
  analyze: 'M3 3v18h19M6 16l4-6 5 3 6-8',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
  safety: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5Z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  warning: 'm12 3 10 18H2Z M12 9v5m0 3v1',
  file: 'M5 2h9l5 5v15H5Z M14 2v6h5M8 13h8m-8 4h5',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm3.5 8 3.5 3.5',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5',
  download: 'M12 4v12m-5-5 5 5 5-5M4 15v5h16v-5',
  chip: 'M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2ZM9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4',
  plug: 'M9 2v5m6-5v5M6 7h12v4a6 6 0 0 1-12 0Zm6 10v5',
  external: 'M14 4h6v6m0-6-9 9M18 14v6H4V6h6',
  cloud: 'M4.5 12.5h7a3 3 0 0 0 .4-6A4 4 0 0 0 4.3 7a2.8 2.8 0 0 0 .2 5.5Z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16Zm10-14 4 4',
  trash: 'M4 7h16M10 3h4M6 7l1 13h10l1-13M10 11v6m4-6v6',
  chevron: 'm9 6 6 6-6 6',
  ruler: 'M3 17 17 3l4 4L7 21ZM7 13l2 2m1-5 2 2m1-5 2 2',
  lines: 'M5 6h14M5 10h14M5 14h14M5 18h9',
  droplet: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z',
  hazard: 'm12 3 10 18H2ZM12 10v4m0 3v.5',
  spindle: 'M9 2h6v5H9ZM8 7h8l-1 5H9ZM11 12h2v6l-1 3-1-3Z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6m0-9v.5',
  pin: 'M12 3a5 5 0 0 1 5 5c0 4-5 9-5 9s-5-5-5-9a5 5 0 0 1 5-5Zm0 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(name: IconName, size = 24): ComponentChild {
  return h(
    'svg',
    { viewBox: name === 'search' || name === 'cloud' ? '0 0 16 16' : '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
    h('path', { d: PATHS[name] }),
  );
}
