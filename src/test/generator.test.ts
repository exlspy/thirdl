import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDsl } from '../parser';
import { generate } from '../generator';
import { resolveProfile, listProfiles } from '../languages';
import { DslError } from '../ast';

const T = '    ';
const gen = (dsl: string, lang: string, snippet = false, inner?: string[]): string => {
  const p = resolveProfile(lang);
  assert.ok(p, `нет профиля ${lang}`);
  return generate(parseDsl(dsl), p!, { indentUnit: T, snippet, inner });
};

test('TypeScript: вложенные for > if else', () => {
  assert.equal(
    gen('for i 0..n; if i%2==0 else', 'typescript'),
    [
      'for (let i = 0; i < n; i++) {',
      '    if (i%2==0) {',
      '    } else {',
      '    }',
      '}',
    ].join('\n'),
  );
});

test('Snippet-режим: курсор $1 во внутреннем теле, остальные табстопы по порядку', () => {
  const s = gen('if a else', 'javascript', true);
  assert.equal(s, ['if (a) {', '    $1', '} else {', '    $2', '}'].join('\n'));
});

test('Snippet-режим экранирует $ и \\', () => {
  const s = gen('while $x', 'javascript', true);
  assert.ok(s.startsWith('while (\\$x) {'));
});

test('Python: pass-заглушки и range()', () => {
  assert.equal(gen('for i 0..n', 'python'), 'for i in range(n):\n    pass');
  assert.equal(gen('for i 2..9 step 3', 'python'), 'for i in range(2, 9, 3):\n    pass');
  assert.equal(gen('if x else', 'python', true), 'if x:\n    ${1:pass}\nelse:\n    ${2:pass}');
});

test('Отрицательный шаг даёт обратный цикл', () => {
  assert.equal(
    gen('for i 10..0 step -1', 'cpp'),
    'for (int i = 10; i > 0; i--) {\n}',
  );
  assert.equal(
    gen('for i 0..10 step 2', 'java'),
    'for (int i = 0; i < 10; i += 2) {\n}',
  );
});

test('switch: break в C-подобных, без break в Go, match в Python', () => {
  assert.equal(
    gen('switch x: 1, 2 default', 'c'),
    [
      'switch (x) {',
      '    case 1:',
      '        break;',
      '    case 2:',
      '        break;',
      '    default:',
      '        break;',
      '}',
    ].join('\n'),
  );
  // gofmt: case выравнивается по switch, тело case — на уровень глубже.
  assert.equal(gen('switch x: 1; if y', 'go'), 'switch x {\ncase 1:\n    if y {\n    }\n}');
  assert.equal(gen('switch x: 1 default', 'python'), 'match x:\n    case 1:\n        pass\n    case _:\n        pass');
});

test('Вложенный узел попадает в первый case', () => {
  const out = gen('switch x: 1, 2; if y', 'typescript');
  const lines = out.split('\n');
  assert.equal(lines[1], '    case 1:');
  assert.equal(lines[2], '        if (y) {');
});

test('func: типы параметров по умолчанию', () => {
  assert.equal(gen('func add(a, b: number)', 'typescript'), 'function add(a: any, b: number): void {\n}');
  assert.equal(gen('func add(a, b)', 'java'), 'static void add(Object a, Object b) {\n}');
  assert.equal(gen('func main', 'c'), 'void main(void) {\n}');
  assert.equal(gen('func f(a, b)', 'go'), 'func f(a any, b any) {\n}');
  assert.equal(gen('func f(a)', 'python'), 'def f(a):\n    pass');
});

test('try: catch/finally; в C и Go — ошибка', () => {
  assert.equal(
    gen('try finally', 'java'),
    'try {\n} catch (Exception e) {\n} finally {\n}',
  );
  assert.equal(gen('try', 'python'), 'try:\n    pass\nexcept Exception as e:\n    pass');
  assert.throws(() => gen('try', 'c'), DslError);
  assert.throws(() => gen('try', 'go'), DslError);
});

test('foreach в разных языках', () => {
  assert.equal(gen('foreach x in xs', 'typescript'), 'for (const x of xs) {\n}');
  assert.equal(gen('foreach x in xs', 'cpp'), 'for (const auto& x : xs) {\n}');
  assert.equal(gen('foreach x in xs', 'go'), 'for _, x := range xs {\n}');
  assert.ok(gen('foreach x in xs', 'c').includes('sizeof(xs)'));
});

test('Обёртывание: inner попадает во внутренний слот с нужным отступом', () => {
  const out = gen('try; if ok', 'typescript', false, ['doWork();', 'if (z) {', '    more();', '}']);
  assert.equal(
    out,
    [
      'try {',
      '    if (ok) {',
      '        doWork();',
      '        if (z) {',
      '            more();',
      '        }',
      '    }',
      '} catch (error) {',
      '}',
    ].join('\n'),
  );
});

test('Профили: все языковые id зарегистрированы', () => {
  for (const id of ['typescript', 'javascript', 'java', 'cpp', 'c', 'go', 'python', 'typescriptreact']) {
    assert.ok(resolveProfile(id), id);
  }
  assert.equal(resolveProfile('brainfuck'), undefined);
  assert.equal(listProfiles().length, 7);
});
