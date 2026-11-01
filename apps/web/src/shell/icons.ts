import { h, type ComponentChild } from 'preact';

/**
 * Inline SVG icons, built as elements (never markup; Trusted Types). Every
 * icon is decorative: the text next to it carries the meaning.
 */
const svg = (cls: string, children: ComponentChild[], viewBox = '0 0 24 24'): ComponentChild =>
  h('svg', { class: `icon ${cls}`, viewBox, 'aria-hidden': 'true', focusable: 'false' }, children);

/** ISO 7010 W001-style general warning sign: a black triangle with an exclamation mark. */
export function WarningIcon(): ComponentChild {
  return svg('icon-warning', [
    h('path', { d: 'M12 2 L23 21 H1 Z', class: 'icon-warning-tri' }),
    h('path', { d: 'M12 2 L23 21 H1 Z M12 6.2 L4.4 19 H19.6 Z', class: 'icon-warning-ring', 'fill-rule': 'evenodd' }),
    h('rect', { x: '10.9', y: '9', width: '2.2', height: '5.8', class: 'icon-warning-mark' }),
    h('rect', { x: '10.9', y: '16', width: '2.2', height: '2.2', class: 'icon-warning-mark' }),
  ]);
}

/** A crossed-out plug: no machine connected. */
export function DisconnectedIcon(): ComponentChild {
  return svg('icon-disconnected', [
    h('path', { d: 'M8 3v4M16 3v4M6 7h12v4a6 6 0 0 1-12 0zM12 17v4', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }),
    h('path', { d: 'M3 3l18 18', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.4' }),
  ]);
}

/** Two bars: pause (feedhold). */
export function PauseIcon(): ComponentChild {
  return svg('icon-pause', [
    h('rect', { x: '1', y: '1', width: '22', height: '22', class: 'icon-pause-bg' }),
    h('rect', { x: '7', y: '6', width: '3.5', height: '12', class: 'icon-pause-bar' }),
    h('rect', { x: '13.5', y: '6', width: '3.5', height: '12', class: 'icon-pause-bar' }),
  ]);
}

/** Sun and moon for the theme toggle (the synthetos.com icons). */
export function SunIcon(): ComponentChild {
  return svg('icon-sun', [
    h('circle', { cx: '12', cy: '12', r: '4' }),
    h('path', { d: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41' }),
  ]);
}

export function MoonIcon(): ComponentChild {
  return svg('icon-moon', [h('path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z' })]);
}
