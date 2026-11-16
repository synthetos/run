/** Override source evidence. */
import '../marker.ts';
import type { Behaviour } from './types.ts';
export const OVERRIDE_BEHAVIOURS: readonly Behaviour[] = [
  {
    id: 'EN-45005', model: 'tinyg-en',
    summary: '450.05 layout 3 keeps existing settings except removed output-pause keys. Pause leaves outputs running; active dwell reports Run. Override GETs return reset defaults only (mcp is 0); override SETs are an explicit model gap until Part B.',
    status: 'verified-source',
    cites: [
      { src: 'EN45005', file: 'config.c', lines: [232, 240], quote: 'Layout 3 removes output-pause settings' },
      { src: 'EN45005', file: 'canonical_machine.c', lines: [190, 215], quote: 'if (pending)' },
      { src: 'EN45005', file: 'config_app.c', lines: [701, 712], quote: 'ov_get_mfo' },
    ],
    issues: ['N99'],
  },
  {
    id: 'EN-45006-OVERRIDES', model: 'tinyg-en',
    summary: '450.06 RAM feed/spindle factors and effective permission, ordered M48–M51, and reset/kill/program-end defaults. A spindle factor never starts a stopped spindle.',
    status: 'verified-source',
    cites: [
      { src: 'EN45006', file: 'override.c', lines: [75, 85], quote: 'void ov_reset_job(void)' },
      { src: 'EN45006', file: 'spindle.c', lines: [234, 278], quote: 'stat_t spindle_set_sso(nvObj_t *nv)' },
      { src: 'EN45006', file: 'runtime.c', lines: [847, 865], quote: 'stat_t rt_set_sso' },
    ],
  },
];
