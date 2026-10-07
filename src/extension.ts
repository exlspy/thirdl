/**
 * Точка входа расширения CodeScaffold.
 *
 * Регистрирует три команды:
 *  - `codescaffold.generate`      — ввести DSL-строку и вставить сгенерированный код;
 *  - `codescaffold.wrapSelection` — обернуть выделенный код в конструкцию;
 *  - `codescaffold.showHistory`   — выбрать шаблон из истории (LRU).
 *
 * Вся логика разбора и генерации вынесена в модули без зависимости от VS Code
 * (parser, generator, languages, indent, history) — они покрыты unit-тестами.
 */

import * as vscode from 'vscode';
import { DslError } from './ast';
import { generate } from './generator';
import { History } from './history';
import { commonIndent, dedent, indentLines, isBlank, leadingWhitespace } from './indent';
import { LanguageProfile, listProfiles, resolveProfile } from './languages';
import { parseDsl, summarize } from './parser';

/** Ключ хранилища `globalState` для истории шаблонов. */
const HISTORY_KEY = 'codescaffold.history';

/** Режим применения шаблона. */
type Mode = 'insert' | 'wrap';

/** Активация расширения: создаёт историю и регистрирует команды. */
export function activate(context: vscode.ExtensionContext): void {
  const history = History.restore(context.globalState.get<string[]>(HISTORY_KEY, []), historyCapacity());

  /** Применяет шаблон и запоминает его в истории при успехе. */
  const run = async (editor: vscode.TextEditor, dsl: string, mode: Mode): Promise<void> => {
    const profile = await pickProfile(editor);
    if (!profile) return;
    try {
      const ast = parseDsl(dsl);
      const indentUnit = getIndentUnit(editor);
      if (mode === 'insert') {
        const text = generate(ast, profile, { indentUnit, snippet: true });
        await editor.insertSnippet(new vscode.SnippetString(text));
      } else {
        await wrapSelection(editor, dsl, profile, indentUnit);
      }
      history.setCapacity(historyCapacity());
      history.push(dsl);
      await context.globalState.update(HISTORY_KEY, history.items());
    } catch (err) {
      if (err instanceof DslError) {
        vscode.window.showErrorMessage(`CodeScaffold: ${err.message}`);
      } else {
        throw err;
      }
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('codescaffold.generate', async () => {
      const editor = requireEditor();
      if (!editor) return;
      const dsl = await askDsl('Что сгенерировать?');
      if (dsl) await run(editor, dsl, 'insert');
    }),

    vscode.commands.registerCommand('codescaffold.wrapSelection', async () => {
      const editor = requireEditor();
      if (!editor) return;
      if (editor.selection.isEmpty) {
        vscode.window.showWarningMessage('CodeScaffold: сначала выделите код, который нужно обернуть.');
        return;
      }
      const dsl = await askDsl('Во что обернуть выделение?', 'try finally');
      if (dsl) await run(editor, dsl, 'wrap');
    }),

    vscode.commands.registerCommand('codescaffold.showHistory', async () => {
      const editor = requireEditor();
      if (!editor) return;
      if (history.size === 0) {
        vscode.window.showInformationMessage('CodeScaffold: история пока пуста.');
        return;
      }
      const items = history.items().map((dsl) => ({ label: dsl, description: describe(dsl) }));
      const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Выберите шаблон из истории' });
      if (!picked) return;
      // Если есть выделение — предлагаем обернуть его, иначе вставляем.
      await run(editor, picked.label, editor.selection.isEmpty ? 'insert' : 'wrap');
    }),
  );
}

/** Деактивация (ресурсы освобождаются через context.subscriptions). */
export function deactivate(): void {
  /* ничего не требуется */
}

// ---------- вспомогательные функции ----------

/** Размер истории из настроек. */
function historyCapacity(): number {
  return vscode.workspace.getConfiguration('codescaffold').get<number>('historySize', 10);
}

/** Возвращает активный редактор либо показывает предупреждение. */
function requireEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('CodeScaffold: откройте файл в редакторе.');
  }
  return editor;
}

/** Единица отступа в соответствии с настройками редактора (табуляция или N пробелов). */
function getIndentUnit(editor: vscode.TextEditor): string {
  const { insertSpaces, tabSize } = editor.options;
  if (insertSpaces === false) return '\t';
  const size = typeof tabSize === 'number' ? tabSize : parseInt(String(tabSize ?? 4), 10) || 4;
  return ' '.repeat(size);
}

/** Краткое описание шаблона для подсказок; для некорректного шаблона — текст ошибки. */
function describe(dsl: string): string {
  try {
    return summarize(parseDsl(dsl));
  } catch (err) {
    return err instanceof DslError ? `⚠ ${err.message}` : '';
  }
}

/** Запрашивает DSL-строку; пока пользователь печатает, подсказывает структуру или ошибку. */
async function askDsl(prompt: string, value?: string): Promise<string | undefined> {
  const result = await vscode.window.showInputBox({
    title: 'CodeScaffold',
    prompt: `${prompt}  Вложенность — через «;».  Пример: for i 0..n; if i%2==0 else`,
    placeHolder: 'if | for | foreach | while | switch | func | try',
    value,
    validateInput: (text): vscode.InputBoxValidationMessage | undefined => {
      if (!text.trim()) return undefined;
      try {
        return { message: `→ ${summarize(parseDsl(text))}`, severity: vscode.InputBoxValidationSeverity.Info };
      } catch (err) {
        if (err instanceof DslError) {
          return { message: err.message, severity: vscode.InputBoxValidationSeverity.Error };
        }
        return undefined;
      }
    },
  });
  return result?.trim() || undefined;
}

/** Определяет профиль по языку документа; для неизвестного языка предлагает выбрать вручную. */
async function pickProfile(editor: vscode.TextEditor): Promise<LanguageProfile | undefined> {
  const known = resolveProfile(editor.document.languageId);
  if (known) return known;
  const picked = await vscode.window.showQuickPick(
    listProfiles().map((p) => ({ label: p.label, profile: p })),
    { placeHolder: `Язык «${editor.document.languageId}» не распознан. Выберите профиль генерации` },
  );
  return picked?.profile;
}

/**
 * Оборачивает выделенные строки в конструкцию из DSL.
 *
 * Алгоритм: расширяем выделение до целых строк → убираем общий отступ →
 * генерируем конструкцию с выделением в самом внутреннем теле →
 * возвращаем исходный базовый отступ первой строки.
 */
async function wrapSelection(
  editor: vscode.TextEditor,
  dsl: string,
  profile: LanguageProfile,
  indentUnit: string,
): Promise<void> {
  const doc = editor.document;
  const sel = editor.selection;
  // Если выделение закончилось в начале строки, эта строка в него фактически не входит.
  const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
  const range = new vscode.Range(sel.start.line, 0, endLine, doc.lineAt(endLine).text.length);

  const rawLines = doc.getText(range).split(/\r?\n/);
  if (rawLines.every(isBlank)) {
    throw new DslError('Выделение состоит только из пустых строк');
  }
  const firstNonBlank = rawLines.find((l) => !isBlank(l)) ?? '';
  const baseIndent = leadingWhitespace(firstNonBlank) || commonIndent(rawLines);
  const inner = dedent(rawLines);

  const generated = generate(parseDsl(dsl), profile, { indentUnit, snippet: false, inner });
  const result = indentLines(generated.split('\n'), baseIndent).join('\n');
  await editor.edit((edit) => edit.replace(range, result));
}
