/** Inert snapshot data shared by sessions with no workspace controls. */
export const PROBE_CLOSED = Object.freeze({
  step: 'closed' as const,
  block: 'notConnected' as const,
  settings: Object.freeze({ modes: Object.freeze([null, null, null, null, null, null, null, null]), prbp: null, unit: null, zjh: null }),
  refreshing: false,
  reading: null,
  readingAt: null,
  plan: null,
  touch: Object.freeze({ sawClear: false, sawTouching: false, sawReleased: false, problem: null }),
  touchAt: null,
  passedAt: null,
  anchor: null,
  run: null,
  outcome: null,
  plateOut: false,
  alarmExpected: false,
  killUntil: null,
});

