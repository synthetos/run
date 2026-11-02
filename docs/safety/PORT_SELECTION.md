# Binding a chooser selection to the worker

A USB vendor/product pair describes a device type, not a particular machine.
An index in `getPorts()` is not stable identity either. The [Web Serial
standard](https://serial.spec.whatwg.org/#dom-serial-getports) describes the
available granted ports; this protocol does not assume that two enumerations
necessarily have the same order.

The connection flow is:

1. The approved window chooser calls `requestPort()` inside the C1 click.
   It retains the selected object privately and records the ordered USB
   identities of all grants. It refuses multiple grants with the selected
   identity, missing USB identities, or more than 256 grants.
2. `prepare` in the worker compares the entire ordered snapshot and requires
   a unique selected USB identity. It retains that unopened transport and
   returns a ticket, valid for 15 seconds. No serial reads, writes, probes,
   or opens happen at this step.
3. The chooser's one-use confirmation re-enumerates in the window and checks
   the original objects by reference, including the chosen object, and the
   USB snapshot. A same-ID replacement is a different object and is refused.
4. Only then does the UI send `open` with the ticket. The worker consumes it
   for that exact selector and hands its held transport to `MachineSession`
   and `GuardedTransport`. It never reselects a port. A disconnected held
   port fails rather than falling back to another device.

New preparations supersede old ones. Late preparation replies cannot replace
newer selections. Disconnect invalidates preparations, and reused, expired,
or mismatched tickets cannot open anything. A live serial source cannot be
opened through the old snapshot-less RPC. Simulated sources retain the direct
open path for the existing test kit; when given a preparation they use it too.

This is device-selection validation, not account authentication. AuthGate stays
in the UI, and Pause/Stop do not wait for this handshake. The chooser still
exports no raw port and the main-thread importer and serial chunk rules are
unchanged. Phase 1 remains read-only.

Regression coverage lives in `web-serial-chooser.test.ts`,
`web-serial-transport.test.ts`, `review-p0.test.ts`, and
`apps/web/test/machineWorker.test.ts`. Tests cover duplicate grants, order and
membership changes, replacement objects, failed confirmation, ticket expiry,
replay, supersession, and opening the held object without another selection.
Independent safety review is required before this finding is closed.
