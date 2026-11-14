/**
 * Entry point for the separate firmware update page. Their
 * content, including the safety bar, is prerendered at build time and needs
 * no script; this entry only claims the Trusted Types policy names (first
 * statement, security/tt.ts) and wires the theme toggle. Entries must never
 * import @synthetos/testkit (RUN_PLAN §5.3).
 */
import { startFirmwareWorker } from '../machine-worker/firmwareClient.ts';
import { installTrustedTypes } from '../security/tt.ts';
import { startTheme } from '../theme/theme.ts';
import '../styles/base.css';

const trustedTypes = installTrustedTypes();
startFirmwareWorker(trustedTypes);
startTheme();
document.documentElement.dataset['ready'] = 'true';
