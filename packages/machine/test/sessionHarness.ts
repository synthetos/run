/**
 * Drives a `MachineSession` against a test-kit firmware model on a virtual
 * clock: the session, the link and the model share one `VirtualClock`, and
 * promise callbacks run between timer callbacks.
 */
import { SimEndpoint, TinyG440Model, TinyGEdgeNextModel, VirtualClock, type FaultPlan, type TinyGModelOptions } from '@synthetos/testkit';
import { MachineSession, type MachineSessionOptions } from '../src/index.ts';
import { SimTransport, flush, microtasks, simSource } from './simTransport.ts';

export type ModelName = 'en' | '440';

export interface Harness {
  readonly clock: VirtualClock;
  readonly session: MachineSession;
  readonly endpoint: SimEndpoint;
  readonly device: TinyGEdgeNextModel | TinyG440Model;
  /** Every transport the source handed out (one per connect). */
  readonly transports: SimTransport[];
  /** Runs virtual time forward by `ms`, letting the session's promises settle along the way. */
  run(ms: number): Promise<void>;
}

export function harness(
  model: ModelName,
  options: { readonly device?: TinyGModelOptions; readonly faults?: FaultPlan; readonly seed?: number; readonly session?: Partial<MachineSessionOptions> } = {},
): Harness {
  const clock = new VirtualClock();
  const device = model === 'en' ? new TinyGEdgeNextModel(options.device) : new TinyG440Model(options.device);
  const endpoint = new SimEndpoint({ clock, device, ...(options.faults === undefined ? {} : { faults: options.faults }), ...(options.seed === undefined ? {} : { seed: options.seed }) });
  const transports: SimTransport[] = [];
  const source = simSource(() => {
    const t = new SimTransport(endpoint);
    transports.push(t);
    return t;
  });
  const session = new MachineSession({ source, clock, ...options.session });
  return {
    clock,
    session,
    endpoint,
    device,
    transports,
    async run(ms: number): Promise<void> {
      const target = clock.now() + ms;
      await flush();
      for (;;) {
        const next = clock.nextAt();
        if (next === undefined || next > target) break;
        clock.advanceTo(next);
        await microtasks();
      }
      clock.advanceTo(target);
      await flush();
    },
  };
}
