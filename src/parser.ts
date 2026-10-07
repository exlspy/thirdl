/**
 * Парсер DSL CodeScaffold.
 *
 * Грамматика (неформально):
 *
 *   chain    := segment { ';' segment }          // каждый следующий сегмент вложен в предыдущий
 *   segment  := 'if' COND [ 'else' ]
 *             | 'for' [VAR] FROM '..' TO [ 'step' INT ]
 *             | 'foreach' ITEM 'in' COLLECTION
 *             | 'while' COND
 *             | 'switch' EXPR ':' CASE { ',' CASE } [ 'default' ]
 *             | 'func' NAME [ '(' PARAMS ')' ]
 *             | 'try' [ 'finally' ]
 *
 * Пример: `for i 0..n; if i%2==0 else; while x<3`
 */

import {
  AstNode,
  DslError,
  ForNode,
  ForeachNode,
  FuncNode,
  IfNode,
  NodeKind,
  SwitchNode,
  TryNode,
  WhileNode,
} from './ast';

/** Максимальная глубина вложенности цепочки (защита от опечаток вида `if x;if x;...`). */
export const MAX_DEPTH = 8;

/** Синонимы ключевых слов → канонический вид конструкции. */
const KEYWORDS: ReadonlyMap<string, NodeKind> = new Map<string, NodeKind>([
  ['if', 'if'],
  ['for', 'for'],
  ['foreach', 'foreach'],
  ['each', 'foreach'],
  ['while', 'while'],
  ['switch', 'switch'],
  ['func', 'func'],
  ['fn', 'func'],
  ['def', 'func'],
  ['try', 'try'],
]);

/**
 * Разбивает строку по разделителю `;`, не затрагивая `;` внутри скобок и кавычек.
 * Используется конечный автомат с «стеком» открытых скобок.
 *
 * @param input исходная строка DSL
 * @returns непустые сегменты без внешних пробелов
 */
export function splitSegments(input: string): string[] {
  const segments: string[] = [];
  const stack: string[] = []; // открытые скобки
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let quote: string | null = null;
  let current = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < input.length) {
        current += input[++i]; // экранированный символ внутри строки
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
      current += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length === 0 || stack[stack.length - 1] !== pairs[ch]) {
        throw new DslError(`Лишняя или несогласованная скобка «${ch}»`, input);
      }
      stack.pop();
      current += ch;
    } else if (ch === ';' && stack.length === 0) {
      segments.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (quote) {
    throw new DslError('Незакрытая кавычка', input);
  }
  if (stack.length > 0) {
    throw new DslError(`Не закрыта скобка «${stack[stack.length - 1]}»`, input);
  }
  segments.push(current.trim());
  return segments.filter((s) => s.length > 0);
}

/**
 * Разбирает DSL-строку в цепочку вложенных узлов AST.
 *
 * @param input строка вида `for i 0..n; if i%2==0 else`
 * @returns корневой узел (внешняя конструкция)
 * @throws {DslError} при синтаксической ошибке
 */
export function parseDsl(input: string): AstNode {
  const segments = splitSegments(input);
  if (segments.length === 0) {
    throw new DslError('Пустой шаблон. Пример: for i 0..n; if i%2==0');
  }
  if (segments.length > MAX_DEPTH) {
    throw new DslError(`Слишком глубокая вложенность (максимум ${MAX_DEPTH})`);
  }
  const nodes = segments.map(parseSegment);
  // Связываем узлы в цепочку: nodes[i].body = nodes[i + 1].
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].body = nodes[i + 1];
  }
  return nodes[0];
}

/**
 * Разбирает один сегмент (одну конструкцию без вложенности).
 *
 * @param segment текст сегмента, например `for i 0..10 step 2`
 */
export function parseSegment(segment: string): AstNode {
  const m = /^(\S+)\s*(.*)$/s.exec(segment);
  if (!m) {
    throw new DslError('Пустой сегмент', segment);
  }
  const kind = KEYWORDS.get(m[1].toLowerCase());
  if (!kind) {
    const known = Array.from(new Set(KEYWORDS.keys())).join(', ');
    throw new DslError(`Неизвестная конструкция «${m[1]}». Доступно: ${known}`, segment);
  }
  const rest = m[2].trim();
  switch (kind) {
    case 'if':
      return parseIf(rest, segment);
    case 'for':
      return parseFor(rest, segment);
    case 'foreach':
      return parseForeach(rest, segment);
    case 'while':
      return parseWhile(rest, segment);
    case 'switch':
      return parseSwitch(rest, segment);
    case 'func':
      return parseFunc(rest, segment);
    case 'try':
      return parseTry(rest, segment);
  }
}

/** Отделяет необязательный завершающий флаг-слово (`else`, `finally`, `default`). */
function takeTrailingFlag(text: string, flag: string): { text: string; found: boolean } {
  const re = new RegExp(`(?:^|\\s)${flag}$`, 'i');
  if (re.test(text)) {
    return { text: text.replace(re, '').trim(), found: true };
  }
  return { text, found: false };
}

function parseIf(rest: string, seg: string): IfNode {
  const { text, found } = takeTrailingFlag(rest, 'else');
  if (!text) {
    throw new DslError('if: не указано условие. Пример: if x > 0 else', seg);
  }
  return { kind: 'if', cond: text, hasElse: found };
}

function parseFor(rest: string, seg: string): ForNode {
  if (!rest) {
    throw new DslError('for: укажите диапазон. Пример: for i 0..n или for n', seg);
  }
  // Необязательный шаг в конце: `step 2`, `step -1`.
  let step = 1;
  let body = rest;
  const stepMatch = /\s+step\s+(-?\d+)$/i.exec(body);
  if (stepMatch) {
    step = parseInt(stepMatch[1], 10);
    body = body.slice(0, stepMatch.index).trim();
    if (step === 0) {
      throw new DslError('for: шаг не может быть равен 0', seg);
    }
  }
  // Короткая форма: `for n` == `for i 0..n`.
  if (!body.includes('..')) {
    if (/\s/.test(body)) {
      throw new DslError('for: ожидается диапазон вида «a..b»', seg);
    }
    return { kind: 'for', variable: 'i', from: '0', to: body, step };
  }
  const full = /^(?:([A-Za-z_]\w*)\s+)?(.+?)\s*\.\.\s*(.+)$/.exec(body);
  if (!full) {
    throw new DslError('for: ожидается «[переменная] от..до [step N]»', seg);
  }
  return {
    kind: 'for',
    variable: full[1] ?? 'i',
    from: full[2].trim(),
    to: full[3].trim(),
    step,
  };
}

function parseForeach(rest: string, seg: string): ForeachNode {
  const m = /^([A-Za-z_]\w*)\s+in\s+(.+)$/i.exec(rest);
  if (!m) {
    throw new DslError('foreach: ожидается «элемент in коллекция». Пример: foreach x in items', seg);
  }
  return { kind: 'foreach', item: m[1], collection: m[2].trim() };
}

function parseWhile(rest: string, seg: string): WhileNode {
  if (!rest) {
    throw new DslError('while: не указано условие. Пример: while n > 0', seg);
  }
  return { kind: 'while', cond: rest };
}

function parseSwitch(rest: string, seg: string): SwitchNode {
  const colon = rest.indexOf(':');
  if (colon < 0) {
    throw new DslError('switch: ожидается «выражение: значение1, значение2». Пример: switch x: 1, 2 default', seg);
  }
  const expr = rest.slice(0, colon).trim();
  if (!expr) {
    throw new DslError('switch: не указано выражение перед «:»', seg);
  }
  const { text, found } = takeTrailingFlag(rest.slice(colon + 1).trim(), 'default');
  const cases = text
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (cases.length === 0 && !found) {
    throw new DslError('switch: укажите хотя бы одно значение case или default', seg);
  }
  return { kind: 'switch', expr, cases, hasDefault: found };
}

function parseFunc(rest: string, seg: string): FuncNode {
  const m = /^([A-Za-z_]\w*)\s*(?:\((.*)\))?$/s.exec(rest);
  if (!m) {
    throw new DslError('func: ожидается «имя(параметры)». Пример: func add(a, b)', seg);
  }
  const params = (m[2] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return { kind: 'func', name: m[1], params };
}

function parseTry(rest: string, seg: string): TryNode {
  const { text, found } = takeTrailingFlag(rest, 'finally');
  if (text) {
    throw new DslError(`try: неожиданный текст «${text}». Допустимо только «try finally»`, seg);
  }
  return { kind: 'try', hasFinally: found };
}

/**
 * Краткое текстовое описание цепочки, например «for › if (else) › while».
 * Показывается пользователю при вводе и в истории.
 */
export function summarize(root: AstNode): string {
  const parts: string[] = [];
  for (let n: AstNode | undefined = root; n; n = n.body) {
    switch (n.kind) {
      case 'if':
        parts.push(n.hasElse ? 'if (else)' : 'if');
        break;
      case 'switch':
        parts.push(`switch[${n.cases.length}${n.hasDefault ? '+default' : ''}]`);
        break;
      case 'try':
        parts.push(n.hasFinally ? 'try (finally)' : 'try');
        break;
      case 'func':
        parts.push(`func ${n.name}`);
        break;
      default:
        parts.push(n.kind);
    }
  }
  return parts.join(' › ');
}

/** Возвращает самый вложенный узел цепочки. */
export function innermost(root: AstNode): AstNode {
  let n = root;
  while (n.body) {
    n = n.body;
  }
  return n;
}
