/** Whether the review panel and its C5 confirmation are open (Board settings spec §5.2). Window state only. */
import { signal } from '@preact/signals';

export const reviewOpen = signal(false);
export const confirming = signal(false);
