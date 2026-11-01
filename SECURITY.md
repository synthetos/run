# Security and safety policy

This repository is the software behind run.synthetos.com. It is being built to
drive real CNC machines over Web Serial, so we treat **safety defects as
security vulnerabilities**: anything that could make a machine move, keep
moving, start a spindle, or fail to stop when the operator expects it to
stop is in scope, as are ordinary web security issues.

**This software is not an emergency stop.** Every machine driven by it must
have a hardwired, latching emergency stop that removes motor and spindle
power in hardware.

## Reporting a vulnerability or safety issue

Please **do not open a public issue** for a vulnerability or a safety defect.

- Report it privately through GitHub: on this repository, open the
  **Security** tab and choose **Report a vulnerability**.
- The safety contract page, `https://run.synthetos.com/safety/`, lists the
  current contact for safety reports once it is published.

Include, where you can:

- what you did, what you expected, and what the machine or page did instead;
- the app version and commit shown in the page footer or safety bar;
- the controller, firmware build (`fb`, and `fbs` if reported) and browser;
- a transcript export or reproduction steps, with any personal data removed.

If a machine is behaving unsafely right now, **stop it with your hardware
E-stop first**, then report.

## What to expect

- We acknowledge reports as soon as we can and keep you informed while we
  investigate.
- Safety-path defects (anything that touches the machine path, stop
  behaviour or firmware flashing) are triaged first. A confirmed defect in a
  deployed version is handled by revoking that version in the signed safety
  advisory, so open sessions refuse new motion, and by publishing a fix.
- We credit reporters who want credit once a fix is released.

## Supported versions

Only the version currently deployed at run.synthetos.com (and the `main`
branch it is built from) receives fixes. The project is pre-release: nothing
here can open a serial port yet (Phase 0).

## Scope

In scope: this repository, run.synthetos.com and its staging host.
Out of scope: the TinyG and g2core firmware (report those on their own
repositories), and third-party services.
