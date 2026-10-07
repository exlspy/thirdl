/**
 * Языковые профили.
 *
 * Профиль описывает, как каждый вид конструкции выглядит на конкретном языке.
 * Описание задаётся «раскладкой» (layout) — массивом элементов двух типов:
 *  - строка кода ({@link LayoutLine}) с относительным отступом;
 *  - слот ({@link LayoutSlot}) — место, куда подставляется вложенная
 *    конструкция, выделенный пользовательский код либо пустая заглушка.
 *
 * Такой подход (паттерн «Стратегия») позволяет добавить новый язык, не трогая
 * парсер и генератор.
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

/** Строка кода внутри раскладки. */
export interface LayoutLine {
  type: 'line';
  text: string;
  /** Относительный отступ в «уровнях» (1 уровень = 1 indentUnit). */
  depth: number;
}

/** Слот для тела конструкции. */
export interface LayoutSlot {
  type: 'slot';
  /** Первичный слот — тот, в который попадает вложенный узел / выделение. */
  primary: boolean;
  depth: number;
  /** Что вставлять, если слот пуст (`pass` для Python, пусто — для остальных). */
  empty: string;
}

/** Элемент раскладки. */
export type LayoutItem = LayoutLine | LayoutSlot;

/** Функция, строящая раскладку для узла заданного вида. */
export type LayoutBuilder<N extends AstNode> = (node: N) => LayoutItem[];

/** Набор построителей раскладки — по одному на каждый вид конструкции. */
export type Layouts = {
  [K in NodeKind]: LayoutBuilder<Extract<AstNode, { kind: K }>>;
};

/** Профиль языка. */
export interface LanguageProfile {
  /** Короткий идентификатор профиля. */
  id: string;
  /** Название для пользователя. */
  label: string;
  /** Идентификаторы языков VS Code (`document.languageId`), которые обслуживает профиль. */
  languageIds: string[];
  layouts: Layouts;
}

// ---------- вспомогательные конструкторы раскладки ----------

const line = (text: string, depth = 0): LayoutLine => ({ type: 'line', text, depth });
const slot = (primary: boolean, depth = 1, empty = ''): LayoutSlot => ({
  type: 'slot',
  primary,
  depth,
  empty,
});

/** Параметр с типом по умолчанию: `a` → `a: any`, а `a: number` остаётся как есть. */
type ParamFormatter = (param: string) => string;

function unsupported(construct: string, language: string): never {
  throw new DslError(`Конструкция «${construct}» не поддерживается в языке ${language}`);
}

// ---------- семейство «C-подобных» языков (скобки) ----------

/** Параметры, из которых собирается профиль C-подобного языка. */
interface BraceOptions {
  id: string;
  label: string;
  languageIds: string[];
  /** Объявление счётчика цикла: `let i`, `int i`. */
  counterDecl: (v: string) => string;
  /** Раскладка foreach. */
  foreach: (n: ForeachNode) => LayoutItem[];
  /** Заголовок функции без `{`. */
  funcHead: (n: FuncNode) => string;
  /** Блок catch (либо undefined, если try не поддерживается). */
  catchHead?: string;
  /** Пишется ли `break;` в конце case. */
  caseBreak: boolean;
}

function braceFor(n: ForNode, decl: (v: string) => string): string {
  const cmp = n.step > 0 ? '<' : '>';
  let inc: string;
  if (n.step === 1) inc = `${n.variable}++`;
  else if (n.step === -1) inc = `${n.variable}--`;
  else inc = `${n.variable} += ${n.step}`;
  return `for (${decl(n.variable)} = ${n.from}; ${n.variable} ${cmp} ${n.to}; ${inc}) {`;
}

function makeBraceProfile(o: BraceOptions): LanguageProfile {
  return {
    id: o.id,
    label: o.label,
    languageIds: o.languageIds,
    layouts: {
      if: (n: IfNode) => [
        line(`if (${n.cond}) {`),
        slot(true),
        ...(n.hasElse ? [line('} else {'), slot(false)] : []),
        line('}'),
      ],
      for: (n: ForNode) => [line(braceFor(n, o.counterDecl)), slot(true), line('}')],
      foreach: o.foreach,
      while: (n: WhileNode) => [line(`while (${n.cond}) {`), slot(true), line('}')],
      switch: (n: SwitchNode) => {
        const items: LayoutItem[] = [line(`switch (${n.expr}) {`)];
        // Первый case (или default, если case нет) получает вложенный узел.
        let first = true;
        for (const c of n.cases) {
          items.push(line(`case ${c}:`, 1), slot(first, 2));
          if (o.caseBreak) items.push(line('break;', 2));
          first = false;
        }
        if (n.hasDefault) {
          items.push(line('default:', 1), slot(first, 2));
          if (o.caseBreak) items.push(line('break;', 2));
        }
        items.push(line('}'));
        return items;
      },
      func: (n: FuncNode) => [line(`${o.funcHead(n)} {`), slot(true), line('}')],
      try: (n: TryNode) => {
        if (!o.catchHead) unsupported('try', o.label);
        return [
          line('try {'),
          slot(true),
          line(`} ${o.catchHead} {`),
          slot(false),
          ...(n.hasFinally ? [line('} finally {'), slot(false)] : []),
          line('}'),
        ];
      },
    },
  };
}

/** Форматирует список параметров с типом по умолчанию. */
function params(n: FuncNode, fmt: ParamFormatter): string {
  return n.params.map(fmt).join(', ');
}

/** Параметр уже содержит тип, если в нём есть пробел или двоеточие. */
const hasType = (p: string): boolean => /[\s:]/.test(p);

// ---------- конкретные профили ----------

const typescript = makeBraceProfile({
  id: 'typescript',
  label: 'TypeScript',
  languageIds: ['typescript', 'typescriptreact'],
  counterDecl: (v) => `let ${v}`,
  foreach: (n) => [line(`for (const ${n.item} of ${n.collection}) {`), slot(true), line('}')],
  funcHead: (n) => `function ${n.name}(${params(n, (p) => (hasType(p) ? p : `${p}: any`))}): void`,
  catchHead: 'catch (error)',
  caseBreak: true,
});

const javascript = makeBraceProfile({
  id: 'javascript',
  label: 'JavaScript',
  languageIds: ['javascript', 'javascriptreact'],
  counterDecl: (v) => `let ${v}`,
  foreach: (n) => [line(`for (const ${n.item} of ${n.collection}) {`), slot(true), line('}')],
  funcHead: (n) => `function ${n.name}(${n.params.join(', ')})`,
  catchHead: 'catch (error)',
  caseBreak: true,
});

const java = makeBraceProfile({
  id: 'java',
  label: 'Java',
  languageIds: ['java'],
  counterDecl: (v) => `int ${v}`,
  foreach: (n) => [line(`for (var ${n.item} : ${n.collection}) {`), slot(true), line('}')],
  funcHead: (n) => `static void ${n.name}(${params(n, (p) => (hasType(p) ? p : `Object ${p}`))})`,
  catchHead: 'catch (Exception e)',
  caseBreak: true,
});

const cpp = makeBraceProfile({
  id: 'cpp',
  label: 'C++',
  languageIds: ['cpp'],
  counterDecl: (v) => `int ${v}`,
  foreach: (n) => [line(`for (const auto& ${n.item} : ${n.collection}) {`), slot(true), line('}')],
  funcHead: (n) => `void ${n.name}(${params(n, (p) => (hasType(p) ? p : `auto ${p}`))})`,
  catchHead: 'catch (const std::exception& e)',
  caseBreak: true,
});

const c = makeBraceProfile({
  id: 'c',
  label: 'C',
  languageIds: ['c'],
  counterDecl: (v) => `int ${v}`,
  // В C нет range-for: итерируемся по массиву через sizeof (работает только для настоящих массивов).
  foreach: (n) => [
    line(
      `for (size_t ${n.item}_i = 0; ${n.item}_i < sizeof(${n.collection}) / sizeof((${n.collection})[0]); ${n.item}_i++) {`,
    ),
    line(`__typeof__((${n.collection})[0]) ${n.item} = (${n.collection})[${n.item}_i];`, 1),
    slot(true),
    line('}'),
  ],
  funcHead: (n) => `void ${n.name}(${n.params.length ? params(n, (p) => (hasType(p) ? p : `int ${p}`)) : 'void'})`,
  catchHead: undefined,
  caseBreak: true,
});

/** Go устроен иначе (нет while/try, `:=`, switch без break) — профиль пишется вручную. */
const go: LanguageProfile = {
  id: 'go',
  label: 'Go',
  languageIds: ['go'],
  layouts: {
    if: (n) => [
      line(`if ${n.cond} {`),
      slot(true),
      ...(n.hasElse ? [line('} else {'), slot(false)] : []),
      line('}'),
    ],
    for: (n) => {
      const cmp = n.step > 0 ? '<' : '>';
      const inc =
        n.step === 1 ? `${n.variable}++` : n.step === -1 ? `${n.variable}--` : `${n.variable} += ${n.step}`;
      return [
        line(`for ${n.variable} := ${n.from}; ${n.variable} ${cmp} ${n.to}; ${inc} {`),
        slot(true),
        line('}'),
      ];
    },
    foreach: (n) => [line(`for _, ${n.item} := range ${n.collection} {`), slot(true), line('}')],
    while: (n) => [line(`for ${n.cond} {`), slot(true), line('}')],
    switch: (n) => {
      const items: LayoutItem[] = [line(`switch ${n.expr} {`)];
      let first = true;
      for (const cs of n.cases) {
        items.push(line(`case ${cs}:`), slot(first, 1));
        first = false;
      }
      if (n.hasDefault) items.push(line('default:'), slot(first, 1));
      items.push(line('}'));
      return items;
    },
    func: (n) => [
      line(`func ${n.name}(${n.params.map((p) => (hasType(p) ? p : `${p} any`)).join(', ')}) {`),
      slot(true),
      line('}'),
    ],
    try: () => unsupported('try', 'Go (используйте обработку ошибок через error)'),
  },
};

/** Python: отступы вместо скобок, `pass` в пустых телах, `match` вместо switch. */
const python: LanguageProfile = {
  id: 'python',
  label: 'Python',
  languageIds: ['python'],
  layouts: {
    if: (n) => [
      line(`if ${n.cond}:`),
      slot(true, 1, 'pass'),
      ...(n.hasElse ? [line('else:'), slot(false, 1, 'pass')] : []),
    ],
    for: (n) => {
      let rng: string;
      if (n.step === 1) rng = n.from === '0' ? `range(${n.to})` : `range(${n.from}, ${n.to})`;
      else rng = `range(${n.from}, ${n.to}, ${n.step})`;
      return [line(`for ${n.variable} in ${rng}:`), slot(true, 1, 'pass')];
    },
    foreach: (n) => [line(`for ${n.item} in ${n.collection}:`), slot(true, 1, 'pass')],
    while: (n) => [line(`while ${n.cond}:`), slot(true, 1, 'pass')],
    switch: (n) => {
      const items: LayoutItem[] = [line(`match ${n.expr}:`)];
      let first = true;
      for (const cs of n.cases) {
        items.push(line(`case ${cs}:`, 1), slot(first, 2, 'pass'));
        first = false;
      }
      if (n.hasDefault) items.push(line('case _:', 1), slot(first, 2, 'pass'));
      return items;
    },
    func: (n) => [line(`def ${n.name}(${n.params.join(', ')}):`), slot(true, 1, 'pass')],
    try: (n: TryNode) => [
      line('try:'),
      slot(true, 1, 'pass'),
      line('except Exception as e:'),
      slot(false, 1, 'pass'),
      ...(n.hasFinally ? [line('finally:'), slot(false, 1, 'pass')] : []),
    ],
  },
};

/** Реестр профилей: `languageId` VS Code → профиль. */
const REGISTRY: ReadonlyMap<string, LanguageProfile> = (() => {
  const map = new Map<string, LanguageProfile>();
  for (const p of [typescript, javascript, java, cpp, c, go, python]) {
    for (const id of p.languageIds) map.set(id, p);
  }
  return map;
})();

/** Список всех уникальных профилей (для выбора вручную). */
export function listProfiles(): LanguageProfile[] {
  return Array.from(new Set(REGISTRY.values()));
}

/**
 * Находит профиль по идентификатору языка VS Code.
 *
 * @returns профиль либо undefined, если язык не поддерживается
 */
export function resolveProfile(languageId: string): LanguageProfile | undefined {
  return REGISTRY.get(languageId);
}
