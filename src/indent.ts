/**
 * Утилиты для работы с отступами. Не зависят от VS Code, поэтому легко тестируются.
 */

/** Возвращает ведущие пробельные символы строки. */
export function leadingWhitespace(line: string): string {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : '';
}

/** Строка состоит только из пробельных символов (или пуста). */
export function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * Находит общий ведущий отступ всех непустых строк (наибольший общий префикс).
 *
 * @param lines строки текста
 * @returns общий отступ (пустая строка, если его нет)
 */
export function commonIndent(lines: string[]): string {
  let prefix: string | undefined;
  for (const l of lines) {
    if (isBlank(l)) continue;
    const ws = leadingWhitespace(l);
    if (prefix === undefined) {
      prefix = ws;
      continue;
    }
    let i = 0;
    while (i < prefix.length && i < ws.length && prefix[i] === ws[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix ?? '';
}

/**
 * Убирает общий отступ у всех строк; пустые строки очищаются от пробелов.
 *
 * @param lines строки текста
 */
export function dedent(lines: string[]): string[] {
  const common = commonIndent(lines);
  return lines.map((l) => (isBlank(l) ? '' : l.slice(common.length)));
}

/** Добавляет `prefix` ко всем непустым строкам. */
export function indentLines(lines: string[], prefix: string): string[] {
  return lines.map((l) => (l.length === 0 ? l : prefix + l));
}
