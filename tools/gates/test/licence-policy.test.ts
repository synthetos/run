import { describe, expect, it } from 'vitest';
import { DEV_LICENCE_EXCEPTIONS, type LicenceException } from '../src/licence/exceptions.ts';
import {
  type PackageLicence,
  type PnpmLicenceReport,
  checkPackage,
  checkReports,
  validateExceptions,
} from '../src/licence/policy.ts';

const prod = (name: string, licence: string): PackageLicence => ({ name, version: '1.0.0', licence, scope: 'production' });
const dev = (name: string, licence: string): PackageLicence => ({ name, version: '1.0.0', licence, scope: 'dev' });

describe('licence policy: production dependencies', () => {
  it.each(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'OFL-1.1', 'MIT OR Apache-2.0'])(
    'allows %s',
    (licence) => {
      expect(checkPackage(prod('ok', licence))).toBeUndefined();
    },
  );

  it.each(['GPL-3.0-only', 'GPL-2.0-or-later', 'AGPL-3.0-only', 'LGPL-3.0-or-later', 'MPL-2.0', 'CC0-1.0', 'BlueOak-1.0.0', 'Unknown', 'UNLICENSED'])(
    'rejects %s',
    (licence) => {
      expect(checkPackage(prod('bad', licence))?.reason).toMatch(/production dependency licence|not a valid SPDX/);
    },
  );

  it('never applies a dev exception to a production dependency', () => {
    const exceptions: LicenceException[] = [{ name: 'minimatch', licence: 'BlueOak-1.0.0', reason: 'reviewed permissive licence for dev' }];
    expect(checkPackage(dev('minimatch', 'BlueOak-1.0.0'), exceptions)).toBeUndefined();
    expect(checkPackage(prod('minimatch', 'BlueOak-1.0.0'), exceptions)).toBeDefined();
  });
});

describe('licence policy: dev-only dependencies', () => {
  it('allows the production list plus MPL-2.0', () => {
    expect(checkPackage(dev('lightningcss', 'MPL-2.0'))).toBeUndefined();
    expect(checkPackage(dev('x', 'Apache-2.0'))).toBeUndefined();
  });

  it('rejects GPL and AGPL even when an exception names them', () => {
    const exceptions: LicenceException[] = [{ name: 'gpl-tool', licence: 'GPL-3.0-only', reason: 'an attempt to except GPL' }];
    expect(checkPackage(dev('gpl-tool', 'GPL-3.0-only'), exceptions)?.reason).toMatch(/never allowed/);
    expect(checkPackage(dev('agpl-tool', 'AGPL-3.0-or-later'))?.reason).toMatch(/never allowed/);
  });

  it('allows a dual licence whose permitted route avoids GPL', () => {
    expect(checkPackage(dev('dual', 'GPL-2.0-only OR MIT'))).toBeUndefined();
  });

  it('requires an exact name and licence match for an exception', () => {
    const exceptions: LicenceException[] = [{ name: '@speed-highlight/core', licence: 'CC0-1.0', reason: 'public domain dedication, dev only' }];
    expect(checkPackage(dev('@speed-highlight/core', 'CC0-1.0'), exceptions)).toBeUndefined();
    expect(checkPackage(dev('other', 'CC0-1.0'), exceptions)?.reason).toMatch(/no reviewed exception/);
    // The licence changed upstream: the exception no longer matches.
    expect(checkPackage(dev('@speed-highlight/core', 'WTFPL'), exceptions)?.reason).toMatch(/no reviewed exception/);
  });

  it('rejects unknown and missing licences', () => {
    expect(checkPackage(dev('x', 'Unknown'))).toBeDefined();
    expect(checkPackage(dev('x', ''))).toBeDefined();
  });
});

describe('the committed exception list', () => {
  it('is valid under the policy: no GPL/AGPL family, parseable, reasoned, unique', () => {
    expect(validateExceptions(DEV_LICENCE_EXCEPTIONS)).toEqual([]);
  });

  it('is rejected by validation when it contains a GPL entry or a missing reason', () => {
    expect(validateExceptions([{ name: 'a', licence: 'GPL-2.0-only', reason: 'this should never be accepted' }])).toHaveLength(1);
    expect(validateExceptions([{ name: 'b', licence: 'CC0-1.0', reason: '' }])).toHaveLength(1);
  });
});

describe('checkReports (pnpm licenses list --json)', () => {
  const allReport: PnpmLicenceReport = {
    MIT: [{ name: 'preact', versions: ['11.0.1'] }, { name: 'vitest', versions: ['5.0.3'] }],
    'MPL-2.0': [{ name: 'lightningcss', versions: ['1.33.0'] }],
  };

  it('classifies packages in the --prod report as production and the rest as dev', () => {
    const prodReport: PnpmLicenceReport = { MIT: [{ name: 'preact', versions: ['11.0.1'] }] };
    const { checked, violations } = checkReports(prodReport, allReport);
    expect(violations).toEqual([]);
    expect(checked.find((p) => p.name === 'preact')?.scope).toBe('production');
    expect(checked.find((p) => p.name === 'lightningcss')?.scope).toBe('dev');
  });

  it('fails an MPL-2.0 package that becomes a production dependency', () => {
    const prodReport: PnpmLicenceReport = { 'MPL-2.0': [{ name: 'lightningcss', versions: ['1.33.0'] }] };
    const { violations } = checkReports(prodReport, allReport);
    expect(violations.map((v) => v.pkg.name)).toEqual(['lightningcss']);
  });

  it('fails a GPL production dependency', () => {
    const withGpl: PnpmLicenceReport = { ...allReport, 'GPL-3.0-only': [{ name: 'copyleft', versions: ['2.0.0'] }] };
    const { violations } = checkReports({ 'GPL-3.0-only': [{ name: 'copyleft', versions: ['2.0.0'] }] }, withGpl);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.pkg).toMatchObject({ name: 'copyleft', scope: 'production' });
  });

  it('fails closed when pnpm reports nothing or the reports disagree', () => {
    expect(() => checkReports({}, {})).toThrow(/no installed packages/);
    expect(() => checkReports({ MIT: [{ name: 'ghost', versions: ['1.0.0'] }] }, allReport)).toThrow(/disagree/);
  });

  it('refuses to run with an invalid exception list', () => {
    expect(() =>
      checkReports({}, allReport, [{ name: 'x', licence: 'AGPL-3.0-only', reason: 'never acceptable at all' }]),
    ).toThrow(/invalid licence exception list/);
  });
});
