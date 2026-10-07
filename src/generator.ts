/**
 * Генератор кода: обходит AST и по раскладке языкового профиля выводит текст.
 *
 * Два режима:
 *  - `snippet: true`  — результат в синтаксисе сниппетов VS Code: пустые тела
 *    заменяются табстопами (`$1`, `$2`, …), `$` и `\` экранируются;
 *  - `snippet: false` — обычный текст (используется при «обёртывании» выделения).
 */

import { AstNode } from './ast';
import { LanguageProfile, LayoutItem, LayoutSlot } from './languages';
import { innermost } from './parser';

/** Параметры генерации. */
export interface GenerateOptions {
  /** Единица отступа: символ табуляции либо N пробелов. */
  indentUnit: string;
  /** Генерировать табстопы синтаксиса сниппетов VS Code. */
  snippet: boolean;
  /**
   * Готовые строки, которые нужно поместить в тело самой внутренней
   * конструкции (используется командой «Обернуть выделение»).
   */
  inner?: string[];
}

/** Внутреннее состояние обхода дерева. */
interface Context {
  profile: LanguageProfile;
  opts: GenerateOptions;
  /** Самый вложенный узел: именно в его первичный слот попадает курсор (`$1`) или выделение. */
  target: AstNode;
  /** Следующий свободный номер табстопа (1 зарезервирован под target). */
  nextStop: number;
}

/** Экранирует спецсимволы синтаксиса сниппетов VS Code. */
export function escapeSnippet(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
}

/**
 * Генерирует код для цепочки конструкций.
 *
 * @param root    корень AST (результат `parseDsl`)
 * @param profile языковой профиль
 * @param opts    параметры генерации
 * @returns многострочный текст (разделитель строк — `\n`)
 */
export function generate(root: AstNode, profile: LanguageProfile, opts: GenerateOptions): string {
  const ctx: Context = { profile, opts, target: innermost(root), nextStop: 2 };
  return render(root, ctx).join('\n');
}

/** Строка отступа заданной глубины. */
function pad(ctx: Context, depth: number): string {
  return ctx.opts.indentUnit.repeat(depth);
}

/**
 * Рекурсивно строит строки для узла: строки раскладки + содержимое слотов.
 * Вложенный узел рендерится в собственном «нулевом» отступе и затем сдвигается
 * на глубину слота родителя.
 */
function render(node: AstNode, ctx: Context): string[] {
  const layout: LayoutItem[] = ctx.profile.layouts[node.kind](node as never);
  const out: string[] = [];
  for (const item of layout) {
    if (item.type === 'line') {
      const text = ctx.opts.snippet ? escapeSnippet(item.text) : item.text;
      out.push(pad(ctx, item.depth) + text);
      continue;
    }
    let content: string[];
    if (item.primary && node.body) {
      content = render(node.body, ctx);
    } else if (item.primary && node === ctx.target && ctx.opts.inner) {
      content = ctx.opts.inner;
    } else {
      content = emptySlot(item, node === ctx.target, ctx);
    }
    const prefix = pad(ctx, item.depth);
    for (const l of content) {
      out.push(l.length > 0 ? prefix + l : l);
    }
  }
  return out;
}

/** Содержимое пустого слота: табстоп (режим сниппета) либо заглушка/ничего. */
function emptySlot(item: LayoutSlot, isTarget: boolean, ctx: Context): string[] {
  if (!ctx.opts.snippet) {
    return item.empty ? [item.empty] : [];
  }
  const stop = item.primary && isTarget ? 1 : ctx.nextStop++;
  return [item.empty ? `\${${stop}:${item.empty}}` : `$${stop}`];
}
