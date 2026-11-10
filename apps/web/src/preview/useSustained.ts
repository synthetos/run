/**
 * True once `on` has held for `ms` without a break (owner, 2026-11-10: the "Planner starved" chip shows only when
 * starving lasts longer than about half a second, so a passing dip does not flash it). Display only.
 */
import { useEffect, useState } from 'preact/hooks';

export function useSustained(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) {
      setHeld(false);
      return;
    }
    const t = setTimeout(() => { setHeld(true); }, ms);
    return () => { clearTimeout(t); };
  }, [on, ms]);
  return on && held;
}
