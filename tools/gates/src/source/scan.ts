/**
 * Source capability check: the second step of `pnpm deps` (P0 review fix
 * pass, P0-13 and P0-14).
 *
 * dependency-cruiser sees import edges with literal specifiers and nothing
 * else. Two things it cannot see were found to pass every gate:
 *
 * - `capability-lookup`: a computed or reflective lookup of a browser
 *   capability, `Reflect.get(navigator, ['ser', 'ial'].join(''))`.
 * - `dynamic-import`: an `import()` whose specifier is computed at run time,
 *   `import(path)`, an edge with no node in the dependency graph.
 *
 * This check parses every runtime source file with the TypeScript compiler
 * and applies the admitted-forms policy in tools/gates/src/shared/capabilities.ts.
 * It is a separate implementation from the ESLint rules (eslint/rules/
 * noCapabilityLookup.ts, noDynamicImport.ts), on purpose: a defect in one
 * parser or visitor does not open both gates.
 *
 * Scope resolution is deliberately simple. `navigator`, `clientInformation`,
 * `globalThis`, `window`, `self` and `Reflect` are always the global here (a
 * local with one of those names is renamed, not reasoned about). The other
 * window aliases (`top`, `parent`, ...) count as local only in a file that
 * declares a runtime binding of that name; the ESLint rule resolves them
 * exactly.
 */
import ts from 'typescript';
import {
  GLOBAL_OBJECT_NAMES,
  NAVIGATOR_ALLOWED_PROPERTIES,
  NAVIGATOR_NAMES,
  REFLECTIVE_GLOBALS,
  SHADOWABLE_GLOBAL_NAMES,
  WINDOW_PROPERTY_NAMES,
} from '../shared/capabilities.ts';

export type SourceRule = 'capability-lookup' | 'dynamic-import';

export interface SourceFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: SourceRule;
  readonly message: string;
}

export interface SourceScanOptions {
  /** Apply the capability rule (false for the dev-only test kit, which only gets the dynamic-import rule). */
  readonly capabilities: boolean;
}

const NAVIGATOR = new Set(NAVIGATOR_NAMES);
const NAVIGATOR_OK = new Set(NAVIGATOR_ALLOWED_PROPERTIES);
const GLOBALS = new Set(GLOBAL_OBJECT_NAMES);
const SHADOWABLE = new Set(SHADOWABLE_GLOBAL_NAMES);
const WINDOW_PROPERTIES = new Set(WINDOW_PROPERTY_NAMES);
const REFLECTIVE = new Set(REFLECTIVE_GLOBALS);

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Parentheses and type-only wrappers keep the value. */
function isTransparent(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

function valueNode(node: ts.Node): ts.Node {
  let current = node;
  while (isTransparent(current.parent) && (current.parent as ts.Expression & { expression: ts.Node }).expression === current) current = current.parent;
  return current;
}

/** The literal text of a string or no-substitution template, else undefined. */
function literalText(node: ts.Node): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

/** How `node`'s value is used as the object of a member access: its static key, or `null` for a computed one. */
function memberUse(node: ts.Node): { readonly member: ts.Node; readonly key: string | null } | undefined {
  const outer = valueNode(node);
  const parent = outer.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === outer) return { member: parent, key: parent.name.text };
  if (ts.isElementAccessExpression(parent) && parent.expression === outer) return { member: parent, key: literalText(parent.argumentExpression) ?? null };
  return undefined;
}

function isTypeofOperand(node: ts.Node): boolean {
  return ts.isTypeOfExpression(valueNode(node).parent);
}

function isStaticInTarget(node: ts.Node): boolean {
  const outer = valueNode(node);
  const parent = outer.parent;
  return ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InKeyword && parent.right === outer && literalText(parent.left) !== undefined;
}

function hasDeclareModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
}

/** True inside a type, or inside ambient (`declare`) code, which has no runtime value. */
function inTypeOrAmbient(node: ts.Node): boolean {
  for (let child: ts.Node = node, p = node.parent; p !== undefined; child = p, p = p.parent) {
    if (ts.isTypeNode(p) && !ts.isExpressionWithTypeArguments(p)) return true;
    if (ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true;
    if ((ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p)) && p.type === child) return true;
    if (hasDeclareModifier(p)) return true;
    if (ts.isSourceFile(p)) return false;
  }
  return false;
}

/** Identifier positions that are a name, not a reference to a binding. */
function isNamePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === id) return true;
  if (ts.isBindingElement(p) && p.propertyName === id) return true;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
  if (ts.isQualifiedName(p)) return true;
  return false;
}

/** Names this file declares as runtime bindings (variables, parameters, functions, classes, imports). */
function runtimeBindings(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) addBinding(element.name);
  };
  const visit = (node: ts.Node): void => {
    if (hasDeclareModifier(node)) return;
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) addBinding(node.name);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name !== undefined) names.add(node.name.text);
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) names.add(node.name.text);
    else if (ts.isImportClause(node) && node.name !== undefined) names.add(node.name.text);
    else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) addBinding(node.variableDeclaration.name);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** Scans one source file's text. Exported for the tests. */
export function scanSource(path: string, text: string, options: SourceScanOptions = { capabilities: true }): SourceFinding[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  const findings: SourceFinding[] = [];
  const seen = new Set<string>();
  const add = (node: ts.Node, rule: SourceRule, message: string): void => {
    const key = `${rule}:${node.getStart(file)}:${node.getEnd()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push({ file: path, line, rule, message: `${message}: ${node.getText(file).slice(0, 60)}` });
  };
  const locals = options.capabilities ? runtimeBindings(file) : new Set<string>();

  const checkNavigator = (node: ts.Node): void => {
    if (isTypeofOperand(node)) return;
    const use = memberUse(node);
    if (use !== undefined && use.key !== null && NAVIGATOR_OK.has(use.key)) return;
    add(node, 'capability-lookup', `navigator used other than as a static read of ${NAVIGATOR_ALLOWED_PROPERTIES.join('/')}`);
  };
  const checkWindow = (node: ts.Node, name: string): void => {
    if (isTypeofOperand(node) || isStaticInTarget(node)) return;
    const use = memberUse(node);
    if (use !== undefined && use.key !== null) return;
    add(use?.member ?? node, 'capability-lookup', `window alias '${name}' with a computed key or used as a value`);
  };

  const visit = (node: ts.Node): void => {
    // P0-14: import() with anything but a literal specifier.
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (specifier === undefined || literalText(specifier) === undefined) add(node, 'dynamic-import', 'import() with a computed specifier');
    }
    if (options.capabilities && !inTypeOrAmbient(node)) {
      if (ts.isIdentifier(node) && !isNamePosition(node)) {
        const name = node.text;
        if (REFLECTIVE.has(name)) add(node, 'capability-lookup', 'Reflect is banned in runtime source');
        else if (NAVIGATOR.has(name)) checkNavigator(node);
        else if (GLOBALS.has(name) && !(SHADOWABLE.has(name) && locals.has(name))) checkWindow(node, name);
      } else if (ts.isShorthandPropertyAssignment(node)) {
        // `{ navigator }` in an object literal is a reference to the global.
        const name = node.name.text;
        if (NAVIGATOR.has(name)) add(node, 'capability-lookup', 'navigator used as a value');
        else if (GLOBALS.has(name) && !(SHADOWABLE.has(name) && locals.has(name))) add(node, 'capability-lookup', `window alias '${name}' used as a value`);
      } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const key = ts.isPropertyAccessExpression(node) ? node.name.text : literalText(node.argumentExpression);
        if (key !== undefined && NAVIGATOR.has(key)) checkNavigator(node);
        else if (key !== undefined && WINDOW_PROPERTIES.has(key)) checkWindow(node, key);
      } else if (ts.isBindingElement(node)) {
        // `const { navigator: n } = globalThis`, `const { defaultView } = document`.
        const keyNode = node.propertyName ?? node.name;
        const key = ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode) ? keyNode.text : undefined;
        if (key !== undefined && NAVIGATOR.has(key)) add(keyNode, 'capability-lookup', 'navigator pulled out by destructuring');
        else if (key !== undefined && WINDOW_PROPERTIES.has(key)) add(keyNode, 'capability-lookup', `window alias '${key}' pulled out by destructuring`);
      } else if (literalText(node) !== undefined && NAVIGATOR.has(literalText(node) as string)) {
        const parent = node.parent;
        const isStaticKey = ts.isElementAccessExpression(parent) && parent.argumentExpression === node;
        const isModuleSpecifier = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
        if (!isStaticKey && !isModuleSpecifier) add(node, 'capability-lookup', 'the navigator name as a string');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}
