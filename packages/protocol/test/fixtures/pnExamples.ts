/**
 * Every JSON example in PROTOCOL_NOTES (synthetos.com docs/run/PROTOCOL_NOTES.md
 * @ 0ba3f3ba), with its expected classification (ROADMAP P0-07 acceptance:
 * "every JSON example in PN").
 *
 * PN quotes 20 distinct JSON-like spans. They fall into three groups:
 * - board output written out in full (`{"ack":true}`): classified as that kind;
 * - board output with elisions (`{"r":{...},"f":[...]}`): not valid JSON as
 *   written, so `Garbled`. Each one also has a concrete instance below, taken
 *   from a capture where one exists;
 * - host-to-board commands (`{"sr":null}`, `{clear}`, `{"hbt":<ms>}`): the board
 *   never sends these. If one arrived it would be `Garbled`, never a report.
 *
 * The OLD-PN (docs/tools/PROTOCOL_NOTES.md) inbound examples PN still relies
 * on ("as OLD-PN") are listed too.
 */

export interface PnExample {
  readonly where: string;
  readonly line: string;
  readonly kind: string;
  readonly reason?: string;
}

/** The 20 spans exactly as PN prints them, in order of first appearance. */
export const PN_VERBATIM: readonly PnExample[] = [
  { where: 'PN §2.2 TG banner (elided)', line: '{"r":{...,"msg":"SYSTEM READY"},"f":[1,...]}', kind: 'Garbled', reason: 'malformed-json' },
  { where: 'PN §2.2 EN banner (key list)', line: '{"sr":{"fv","fb","hp","hv","id","msg":"SYSTEM READY"}}', kind: 'Garbled', reason: 'malformed-json' },
  { where: 'PN §2.3 first line (command)', line: '{"sr":null}', kind: 'Garbled', reason: 'bad-value' },
  { where: 'PN §2.3 first character (fragment)', line: '{', kind: 'Garbled', reason: 'malformed-json' },
  { where: 'PN §2.4 clear (command)', line: '{clear}', kind: 'Garbled', reason: 'malformed-json' },
  { where: 'PN §5.1 response shape (elided)', line: '{"r":{…},"f":[…]}', kind: 'Garbled', reason: 'malformed-json' },
  { where: 'PN §5.5 exception (elided)', line: '{"er":{...}}', kind: 'Garbled', reason: 'malformed-json' },
  { where: 'PN §5.6 ENQ answer', line: '{"ack":true}', kind: 'Ack' },
  { where: 'PN §6.1 polled read (command)', line: '{"stat":null}', kind: 'Garbled', reason: 'unrecognized-shape' },
  { where: 'PN §6.1 polled read (command)', line: '{"vel":null}', kind: 'Garbled', reason: 'unrecognized-shape' },
  { where: 'PN §6.1 polled read (command)', line: '{"hold":null}', kind: 'Garbled', reason: 'unrecognized-shape' },
  { where: 'PN §6.1 polled read (command)', line: '{"qr":null}', kind: 'Garbled', reason: 'bad-value' },
  { where: 'PN §6.1 polled read (command)', line: '{"mpo":null}', kind: 'Garbled', reason: 'unrecognized-shape' },
  // A command, not a report: `null` is not an rx count, so it is refused as a bad value.
  { where: 'PN §7.3 rx resync (command)', line: '{rx:null}', kind: 'Garbled', reason: 'bad-value' },
  { where: 'PN §7.4 gc wrapper (command)', line: '{"gc":"…"}', kind: 'Garbled', reason: 'unrecognized-shape' },
  { where: 'PN §12.2 me (command template)', line: '{me:N}', kind: 'Garbled', reason: 'malformed-json' },
  { where: 'PN §12.3 group read (command)', line: '{"x":null}', kind: 'Garbled', reason: 'unrecognized-shape' },
  { where: 'PN §12.3 group read (command)', line: '{"sys":null}', kind: 'Garbled', reason: 'unrecognized-shape' },
  { where: 'PN §13.1 boot (command)', line: '{"boot":1}', kind: 'Garbled', reason: 'unrecognized-shape' },
  { where: 'PN §14 heartbeat (command template)', line: '{"hbt":<ms>}', kind: 'Garbled', reason: 'malformed-json' },
];

/** Concrete instances of the shapes PN describes. Sources are named per row. */
export const PN_CONCRETE: readonly PnExample[] = [
  // §2.2 banners.
  {
    where: 'PN §2.2 TG r-footer banner (EN-HIL test_harness_offline.py:10-11, captured on 440.20)',
    line: '{"r":{"fv":0.970,"fb":440.20,"hp":1,"hv":8,"id":"0BENCH-ONE","msg":"SYSTEM READY"},"f":[1,0,0,8416]}',
    kind: 'Banner',
  },
  {
    where: 'PN §2.2 EN bare-sr banner, strict (constructed from EN report.c:65-78)',
    line: '{"sr":{"fv":0.97,"fb":449.01,"hp":1,"hv":8,"id":"0BENCH-TWO","msg":"SYSTEM READY"}}',
    kind: 'Banner',
  },
  {
    where: 'PN §2.2 stock edge-0.97 bare-sr banner, relaxed (EN-HIL test_harness_offline.py:33)',
    line: '{sr:{fv:0.970,fb:449.01,msg:"SYSTEM READY"}}',
    kind: 'Banner',
  },
  {
    where: 'PN §2.2 g2 banner with fbs and a string hp (constructed from OLD-PN §2.2)',
    line: '{"r":{"fv":0.99,"fb":101.03,"fbs":"101.03-1-g1fb5940","fbc":"settings_default.h","hp":"gQuadratic","hv":"b","id":"3X3566-GHM","msg":"SYSTEM READY"},"f":[1,0,10]}',
    kind: 'Banner',
  },
  // §2.3 probe answers.
  { where: 'PN §2.3 step 2 GET fb on EN, rev 3 (EN-HIL test_harness_offline.py:27)', line: '{"r":{"fb":449.01},"f":[3,0,11]}', kind: 'Response' },
  { where: 'PN §2.3 step 2 GET fb on TG, rev 1 (EN-HIL test_harness_offline.py:8)', line: '{"r":{"fb":440.20},"f":[1,0,12,1645]}', kind: 'Response' },
  { where: 'PN §2.3 step 3 unrecognized token, status 100 (EN-HIL test_e099 docstring)', line: '{"r":{},"f":[3,100,11]}', kind: 'Response' },
  { where: 'PN §2.3 step 4 spph stubbed, status 17 (constructed)', line: '{"r":{"spph":null},"f":[3,17,11]}', kind: 'Response' },
  // §5.1 footer placement.
  {
    where: 'PN §5.1 TG fd=1, footer nested in r (forum fixture interruptedcorrupt-status-reports)',
    line: '{"r":{"gc":"G28.2X0Y0","f":[1,0,21,2913]}}',
    kind: 'Response',
  },
  // §5.2 footer revisions.
  { where: 'PN §5.2 rev 1 (EN-HIL test_harness_offline.py:9)', line: '{"r":{},"f":[1,132,5,6965]}', kind: 'Response' },
  { where: 'PN §5.2 rev 1, g2 three fields (forum fixture arduino-due-tinyg-g2-liteplacer)', line: '{"r":{},"f":[1,0,20]}', kind: 'Response' },
  { where: 'PN §5.2 rev 2 (EN-HIL E031 transcript)', line: '{"r":{"stat":5},"f":[2,0,14]}', kind: 'Response' },
  { where: 'PN §5.2 rev 3 (EN-HIL test_harness_offline.py:27)', line: '{"r":{"fb":449.01},"f":[3,0,11]}', kind: 'Response' },
  // §5.3 tid.
  { where: 'PN §5.3 top-level tid (EN json_parser.c:833-842)', line: '{"r":{"fb":449.01},"tid":33,"f":[3,0,11]}', kind: 'Response' },
  { where: 'PN §5.3 tid on an error (EN-HIL test_e049)', line: '{"r":{},"tid":17,"f":[3,132,11]}', kind: 'Response' },
  // §5.5 exceptions.
  {
    where: 'PN §5.5 EN exception (EN-HIL E031 transcript)',
    line: '{"er":{"fb":449.01,"st":203,"msg":"Limit hit [$clear to reset, $lim=0 to override] - input 1"}}',
    kind: 'Exception',
  },
  // §6 reports.
  { where: 'PN §6.1 filtered status report (EN-HIL E031 transcript)', line: '{"sr":{"posx":-0.037}}', kind: 'StatusReport' },
  { where: 'PN §6.2 queue report qv=1 (EN report.c:747)', line: '{"qr":32}', kind: 'QueueReport' },
  { where: 'PN §6.2 queue report qv=2 (forum fixture error-st_prep_line-move-time-is-nan)', line: '{"qr":28,"qi":1,"qo":1}', kind: 'QueueReport' },
  // OLD-PN, still relied on.
  {
    where: 'OLD-PN §5 TG exception, relaxed (ROADMAP P0-07 acceptance; TG report.c:60-61)',
    line: '{er:{fb:440.21,st:204,msg:"Limit switch hit - Shutdown occurred"}}',
    kind: 'Exception',
  },
  {
    where: 'OLD-PN §5 TG exception, strict (forum fixture 0-97-triggered-limit-switch-json)',
    line: '{"er":{"fb":435.10,"st":204,"msg":"Limit switch hit - Shutdown occurred"}}',
    kind: 'Exception',
  },
  {
    where: 'OLD-PN §5 g2 exception with " - " detail (constructed from G2 report.cpp:63)',
    line: '{"er":{"fb":101.03,"st":204,"msg":"Command rejected by ALARM - feedhold"}}',
    kind: 'Exception',
  },
];
