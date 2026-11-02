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

## Object identity and the event guard

Step 3 compares `SerialPort` objects by reference. That is sound only if the
browser never hands back the same object after a device leaves and returns:
if it did, a different board plugged into the same slot, or the same board
after a reset, could pass the check. The Web Serial standard does not promise
either way, so the chooser does not rely on it.

From the moment `requestPort()` resolves with the user's choice until the
one-use confirmation answers, the chooser listens for `connect` and
`disconnect` on the window's `navigator.serial`. Any such event, at any point
in that window (while the grants are first listed, while the worker
prepares, or while confirmation re-enumerates), makes the chooser refuse:
during the description it answers `changed`; afterwards `confirm()` returns
false and the UI never sends `open`. Nothing is opened either way, and the
user is asked to choose again. Events before the choice (for example plugging
the board in while the browser's chooser is open) are not counted: they are
already reflected in the grant list read after the choice.

The listeners are removed on every exit: a refusal while describing,
`confirm()` (whatever it answers), and `release()`, which LIVE entry calls in
a `finally` around the open step so a refused prepare, a missing worker or a
thrown error also removes them. A Web Serial object that cannot be listened to
is refused, so the guard cannot silently be absent.

## Ports without a USB identity

Step 1 needs a USB vendor and product id for every granted port, not only the
chosen one, because the worker matches the whole ordered snapshot. Any other
granted port that reports no USB identity (a Bluetooth RFCOMM serial port, for
example) therefore makes the chooser refuse even when the chosen board is
USB. This is an availability effect, not a safety one: the refusal opens
nothing. The user can revoke the site's access to the other port and choose
again.

## Supersession and expiry

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
The event guard is covered in `web-serial-chooser.test.ts` (an event after
the choice refuses confirmation even when the grants look unchanged; no event
still confirms; listeners are removed on refusal, confirmation and release)
and `apps/web/test/liveEntry.test.ts` (release on every exit from open).
Independent safety review is required before this finding is closed.
