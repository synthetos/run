/**
 * The gate DSL (ROADMAP TB-01; old P1-01 "Gate expressions are a tiny DSL
 * (`all(...)`, `any(...)`, `fact(key)`, `override(key)`) that is parsed and
 * evaluated purely"; OLD TOOLS_PLAN §5.2 "There is one gate").
 *
 *   gate     := all | any | fact | override
 *   all      := "all(" gate ("," gate)* ")"
 *   any      := "any(" gate ("," gate)* ")"
 *   fact     := "fact(" template ")"        e.g. fact(homing.<axesInJob>)
 *   override := "override(" name ")"        e.g. override(run-unhomed)
 *
 * A template is a fact key whose segments may be `<param>` placeholders.
 * At evaluation each placeholder takes its value from `params`: a string
 * substitutes; a list expands the fact to one per value, and EVERY one must
 * be valid. There is deliberately no `not`, no wildcard and no literal true:
 * a gate can only ever require facts, so a missing fact can never open it.
 *
 * Fail closed everywhere:
 * - a placeholder with no value, an empty list, or a value that is not a
 *   plain key segment (`*`, `x.y`) leaves the gate unmet;
 * - only a `valid` fact satisfies `fact(...)` (stale, session recheck,
 *   needs re-verify and absent do not);
 * - `override(name)` is met only by an override recorded for this session
 *   (a logged typed confirmation, kept by the caller). A gate without
 *   `override(...)` is non-overridable by construction.
 *
 * Evaluation reports every unmet requirement, so a locked journey stage can
 * say why it is locked (OLD TOOLS_PLAN §5.2).
 */
import { isFactKey } from './keys.ts';
import type { FactStatus, FactView } from './store.ts';

export type Gate =
  | { readonly op: 'all' | 'any'; readonly args: readonly Gate[] }
  | { readonly op: 'fact'; readonly template: string }
  | { readonly op: 'override'; readonly name: string };

export type Unmet =
  | { readonly kind: 'fact'; readonly key: string; readonly status: Exclude<FactStatus, 'valid'> }
  | { readonly kind: 'override'; readonly name: string }
  | { readonly kind: 'param'; readonly template: string; readonly param: string; readonly problem: 'missing' | 'empty' | 'malformed' };

export interface GateResult {
  readonly ok: boolean;
  /** Empty when `ok`. For a failed `any`, what each alternative lacked. */
  readonly unmet: readonly Unmet[];
}

export interface GateContext {
  readonly facts: FactView;
  /** Overrides recorded for this session (typed confirmation logged). */
  readonly overrides: ReadonlySet<string>;
  readonly params: Readonly<Record<string, string | readonly string[]>>;
}

export class GateSyntaxError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = 'GateSyntaxError';
    this.offset = offset;
  }
}

export const GATE_MAX_LENGTH = 2000;
export const GATE_MAX_DEPTH = 12;

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const PARAM = /^<([a-zA-Z][a-zA-Z0-9]{0,31})>$/u;
const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/** Whether a template is a fact key once each placeholder is replaced by a plain segment. */
function isTemplate(t: string): boolean {
  return isFactKey(
    t
      .split('.')
      .map((s) => (PARAM.test(s) ? 'p' : s))
      .join('.'),
  );
}

/** Parse a gate expression. Throws `GateSyntaxError`. */
export function parseGate(source: string): Gate {
  if (typeof source !== 'string' || source.length > GATE_MAX_LENGTH) throw new GateSyntaxError(`a gate is a string of at most ${GATE_MAX_LENGTH} characters`, 0);
  let i = 0;
  const skip = () => {
    while (source[i] === ' ' || source[i] === '\n' || source[i] === '\t') i++;
  };
  const expect = (ch: string) => {
    skip();
    if (source[i] !== ch) throw new GateSyntaxError(`expected "${ch}"`, i);
    i++;
  };
  const word = (): string => {
    skip();
    const start = i;
    while (i < source.length && /[a-z]/u.test(source[i] as string)) i++;
    return source.slice(start, i);
  };
  const argument = (): string => {
    skip();
    const start = i;
    while (i < source.length && source[i] !== ')' && source[i] !== ',' && source[i] !== '(') i++;
    return source.slice(start, i).trim();
  };
  const gate = (depth: number): Gate => {
    if (depth > GATE_MAX_DEPTH) throw new GateSyntaxError(`nested deeper than ${GATE_MAX_DEPTH}`, i);
    skip();
    const at = i;
    const op = word();
    if (op !== 'all' && op !== 'any' && op !== 'fact' && op !== 'override') throw new GateSyntaxError(`unknown operator ${JSON.stringify(op)}`, at);
    expect('(');
    let node: Gate;
    if (op === 'all' || op === 'any') {
      const args = [gate(depth + 1)];
      skip();
      while (source[i] === ',') {
        i++;
        args.push(gate(depth + 1));
        skip();
      }
      node = Object.freeze({ op, args: Object.freeze(args) });
    } else if (op === 'fact') {
      const start = i;
      const template = argument();
      if (!isTemplate(template)) throw new GateSyntaxError(`malformed fact template ${JSON.stringify(template)}`, start);
      node = Object.freeze({ op, template });
    } else {
      const start = i;
      const name = argument();
      if (!NAME.test(name)) throw new GateSyntaxError(`malformed override name ${JSON.stringify(name)}`, start);
      node = Object.freeze({ op, name });
    }
    expect(')');
    return node;
  };
  const root = gate(1);
  skip();
  if (i !== source.length) throw new GateSyntaxError('unexpected text after the gate', i);
  return root;
}

/** The concrete keys of a template, or the first parameter problem. */
function expand(template: string, params: GateContext['params']): { keys: string[] } | { unmet: Unmet } {
  let keys = [''];
  for (const seg of template.split('.')) {
    const m = PARAM.exec(seg);
    let values: readonly string[];
    if (m === null) values = [seg];
    else {
      const param = m[1] as string;
      const v = Object.hasOwn(params, param) ? params[param] : undefined;
      if (v === undefined) return { unmet: { kind: 'param', template, param, problem: 'missing' } };
      values = typeof v === 'string' ? [v] : v;
      if (values.length === 0) return { unmet: { kind: 'param', template, param, problem: 'empty' } };
      if (!values.every((x) => typeof x === 'string' && SEGMENT.test(x))) return { unmet: { kind: 'param', template, param, problem: 'malformed' } };
    }
    keys = keys.flatMap((k) => values.map((v) => (k === '' ? v : `${k}.${v}`)));
  }
  return { keys };
}

/** Evaluate a parsed gate against the facts of the connected machine and board. Pure. */
export function evaluateGate(gate: Gate, ctx: GateContext): GateResult {
  const unmet = collect(gate, ctx);
  return Object.freeze({ ok: unmet.length === 0, unmet: Object.freeze(unmet.map((u) => Object.freeze(u))) });
}

function collect(gate: Gate, ctx: GateContext): Unmet[] {
  switch (gate.op) {
    case 'fact': {
      const e = expand(gate.template, ctx.params);
      if ('unmet' in e) return [e.unmet];
      return e.keys.flatMap((key): Unmet[] => {
        const status = ctx.facts.status(key);
        return status === 'valid' ? [] : [{ kind: 'fact', key, status }];
      });
    }
    case 'override':
      return ctx.overrides.has(gate.name) ? [] : [{ kind: 'override', name: gate.name }];
    case 'all':
      return gate.args.flatMap((g) => collect(g, ctx));
    case 'any': {
      const each = gate.args.map((g) => collect(g, ctx));
      return each.some((u) => u.length === 0) ? [] : each.flat();
    }
  }
}

/** Parse and evaluate in one step (for gates defined as strings in data). */
export function checkGate(source: string, ctx: GateContext): GateResult {
  return evaluateGate(parseGate(source), ctx);
}
