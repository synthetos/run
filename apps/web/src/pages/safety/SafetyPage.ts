import { h, type ComponentChildren, type ComponentChild } from 'preact';
import { CANNOT_GUARANTEE, w10, w16, w2Label } from '@synthetos/safety';
import { type BuildInfo, versionLabel } from '../../build-info/buildInfo.ts';
import { OUTBOUND } from '../outbound.ts';
import { StaticPage } from '../StaticPage.ts';

/**
 * https://run.synthetos.com/safety/ (ROADMAP P0-05): SAFETY §1 in plain
 * language, the §7 list verbatim (from @synthetos/safety, tested against
 * SAFETY.md), the stop categories, the E-stop requirements, tab and OS
 * hygiene, and how to report a safety issue. Prerendered at build time.
 */

const out = (href: string, text: string): ComponentChild => h('a', { href, rel: 'noopener noreferrer' }, text);

function Sheet(props: { readonly id: string; readonly number: string; readonly title: string; readonly children?: ComponentChildren }): ComponentChild {
  return h(
    'section',
    { class: 'sheet', id: props.id, 'aria-labelledby': `${props.id}-title` },
    h(
      'div',
      { class: 'title-block' },
      h('span', { class: 'label' }, 'Section'),
      h('span', { class: 'value' }, props.number),
      h('h2', { id: `${props.id}-title` }, props.title),
    ),
    h('div', { class: 'sheet-body' }, props.children),
  );
}

/** One row of the stop-categories table; the cells carry their column name for the stacked narrow layout. */
function stopRow(control: ComponentChildren, what: ComponentChildren, estop: ComponentChildren): ComponentChild {
  return h(
    'tr',
    null,
    h('th', { scope: 'row' }, control),
    h('td', { 'data-label': 'What it does' }, what),
    h('td', { 'data-label': 'Emergency stop' }, estop),
  );
}

export function SafetyPage({ build }: { readonly build: BuildInfo }): ComponentChild {
  return h(
    StaticPage,
    { build, current: '/safety/' },
    h(
      'div',
      { class: 'page-head' },
      h('p', { class: 'label' }, 'run.synthetos.com · Safety contract'),
      h('h1', null, 'Safety contract'),
      h(
        'p',
        { class: 'lede' },
        'run.synthetos.com is being built to drive real CNC machines. A CNC machine can crush, cut and burn, and it can start a fire. Read this page before you connect a machine, and keep your emergency stop within reach whenever the machine is powered.',
      ),
      h(
        'p',
        { class: 'notice-phase' },
        h('strong', null, 'This version cannot connect to a machine. '),
        'It is a foundation build: nothing in it can open a serial port, so nothing on this site can move your machine yet. The rules below are the contract every later version keeps.',
      ),
    ),

    h(
      Sheet,
      { id: 'what-it-is', number: '1', title: 'What this software is, and what it is not' },
      h(
        'p',
        null,
        'run.synthetos.com is a browser workspace for setting up, wiring, flashing and running hobby and light-industrial CNC machines with Synthetos TinyG controllers (and g2core later). You sign in with a Synthetos account to connect a machine, start a job and save your projects.',
      ),
      h('h3', null, 'It is not an emergency stop'),
      h(
        'ul',
        null,
        h('li', null, 'The on-screen Pause and Stop job buttons are ordinary controlled stops, sent over USB through your browser and operating system. They are not safety-rated. They can arrive late, or not at all.'),
        h('li', null, 'It is not a guard. It cannot see people, smoke or fire, and it cannot remove power from your motors or spindle.'),
        h('li', null, 'It is not certified to any safety standard.'),
        h('li', null, 'Only a hardwired emergency stop (E-stop) can stop your machine in an emergency.'),
      ),
      h('h3', null, 'Your account is never in the stop path'),
      h(
        'ul',
        null,
        h('li', null, 'Only the browser tab connected to the machine controls it. Nothing on Synthetos servers can start, stop or change your machine.'),
        h('li', null, 'Pause, Stop job, spindle off and the recovery controls never need you to be signed in. Signing out, an expired session or a lost internet connection never stops or changes a job that is already running; it only prevents starting new ones.'),
        h('li', null, 'Files and settings saved in your account are not checked for safety. Review every change before you use it on a machine.'),
      ),
      h('h3', null, 'Who it is for'),
      h(
        'p',
        null,
        'An informed adult who built or owns the machine, has installed a hardwired E-stop, has read this page, and stays at the machine, paying attention, whenever it is powered. Do not use it unattended, from another room, through remote-desktop software, or from a phone or tablet.',
      ),
    ),

    h(
      Sheet,
      { id: 'cannot-guarantee', number: '2', title: 'What the software cannot guarantee' },
      h('p', { class: 'muted' }, 'This list is reproduced word for word from the safety case (SAFETY.md §7).'),
      h('ol', { class: 'guarantee-list', 'data-safety': 'S7' }, ...CANNOT_GUARANTEE.map((item) => h('li', null, item))),
    ),

    h(
      Sheet,
      { id: 'stopping', number: '3', title: 'Ways to stop a machine' },
      h(
        'p',
        null,
        'IEC 60204-1 sorts stops into categories: category 0 removes power at once; category 1 brings the machine to a controlled stop and then removes power; category 2 is a controlled stop that leaves power on. An emergency stop must be category 0 or 1, and it must work in hardware.',
      ),
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          { class: 'spec-table' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Control'), h('th', { scope: 'col' }, 'What it does'), h('th', { scope: 'col' }, 'Is it an emergency stop?'))),
          h(
            'tbody',
            null,
            stopRow('Hardwired E-stop', 'Removes motor and spindle power in hardware (category 0 or 1). Works when the computer, the browser or the controller has failed.', [h('strong', null, 'Yes. '), 'The only one.']),
            stopRow('Stop job (on screen, when connected)', 'Ends the job and commands the spindle and coolant off. A controlled stop, similar to category 2, sent over a link that is not safety-rated.', 'No.'),
            stopRow([h('span', null, w2Label()), h('br', null), h('span', { class: 'muted' }, '(also the Escape key)')], ['A feedhold: motion decelerates and pauses. ', w10()], 'No.'),
            stopRow('Reset button on the board', w16(), 'No.'),
            stopRow('Closing the tab, or unplugging USB', 'Does not stop anything. The controller keeps running the moves it has queued, and the spindle stays as it was.', 'No.'),
          ),
        ),
      ),
    ),

    h(
      Sheet,
      { id: 'e-stop', number: '4', title: 'Emergency stop requirements' },
      h('p', null, 'Every machine driven by run.synthetos.com must have a hardwired emergency stop that meets all of these:'),
      h(
        'ul',
        null,
        h('li', null, h('strong', null, 'Latching. '), 'Once pressed it stays pressed until you deliberately reset it, and resetting it never restarts the machine by itself.'),
        h('li', null, h('strong', null, 'Normally-closed contacts. '), 'The circuit is closed in normal running, so a broken wire or a failed contact stops the machine instead of disabling the stop.'),
        h('li', null, h('strong', null, 'Removes power in hardware. '), 'It cuts motor power (Vmot) and spindle or VFD power through contactors or relays in the power path. A signal to the controller, or to this software, is not enough.'),
        h('li', null, h('strong', null, 'Never the reset button. '), 'Do not wire the E-stop to the board\'s reset button and do not use the reset button as a stop. ', w16()),
        h('li', null, h('strong', null, 'In reach and tested. '), 'Within reach whenever the machine is powered, and tested before each session.'),
      ),
      h('p', { class: 'callout' }, h('strong', null, 'Consult a qualified electrician. '), 'Emergency stop circuits must remove motor and spindle power in hardware. Have a qualified electrician design, install and check the circuit, especially where mains power, a VFD or a spindle is involved.'),
    ),

    h(
      Sheet,
      { id: 'computer', number: '5', title: 'Your computer, browser and tab' },
      h('p', null, 'If the tab is closed, frozen or put to sleep while a job runs, the machine keeps moving and the spindle keeps running. Set up the computer so that cannot happen:'),
      h(
        'ul',
        null,
        h('li', null, 'Use desktop Chrome or Edge, on mains power, connected by USB to one controller.'),
        h('li', null, 'Keep run.synthetos.com visible in its own window. Open it in one tab only. The installed app window counts as a tab: closing it is closing the tab.'),
        h('li', null, 'Turn off sleep and screen lock in your operating system while the machine is powered.'),
        h(
          'li',
          null,
          'Chrome: in Settings, Performance, add run.synthetos.com to ',
          h('strong', null, 'Always keep these sites active'),
          ' so Memory Saver never discards the tab (',
          out(OUTBOUND.chromeKeepActive, 'Chrome Help'),
          '). Edge: in Settings, System and performance, add it to ',
          h('strong', null, 'Never put these sites to sleep'),
          '.',
        ),
        h('li', null, 'Do not control the machine through remote-desktop software, and do not use a phone or tablet: they hide, throttle or freeze tabs.'),
        h('li', null, 'Close other programs that talk to the controller (CNCjs, serial-port-json-server, your own scripts) before you connect.'),
      ),
    ),

    h(
      Sheet,
      { id: 'report', number: '6', title: 'Report a safety issue' },
      h('p', null, h('strong', null, 'If a machine is behaving unsafely right now, stop it with your E-stop first.'), ' Then tell us.'),
      h(
        'ul',
        null,
        h('li', null, 'Report it privately: ', out(OUTBOUND.reportVulnerability, 'report a vulnerability on GitHub'), ' (synthetos/run, Security tab). Please do not open a public issue for a safety defect.'),
        h('li', null, 'Include what you did, what you expected and what the machine or page did; the version and commit shown in the safety bar (this page: ', h('span', { class: 'mono' }, versionLabel(build)), '); the controller, firmware build and browser; and the steps to reproduce it.'),
        h('li', null, 'We treat safety defects as security vulnerabilities and fix them first (', out(OUTBOUND.securityPolicy, 'security policy'), ').'),
      ),
    ),
  );
}
