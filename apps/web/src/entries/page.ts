/**
 * Entry point for the static pages (/safety/, /privacy/, the 404 page). Their
 * content, including the safety bar, is prerendered at build time and needs
 * no script; this entry only claims the Trusted Types policy names (first
 * statement, security/tt.ts) and wires the theme toggle. Entries must never
 * import @synthetos/testkit (RUN_PLAN §5.3).
 */
import { installTrustedTypes } from '../security/tt.ts';
import { startTheme } from '../theme/theme.ts';
import '../styles/base.css';

installTrustedTypes();
startTheme();
document.documentElement.dataset['ready'] = 'true';
