import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDsl, splitSegments, summarize, MAX_DEPTH } from '../parser';
import { DslError } from '../ast';

test('splitSegments: не режет ; внутри скобок и кавычек', () => {
  assert.deepEqual(splitSegments('for i 0..n; if f(a;b) ; while s == ";"'), [
    'for i 0..n',
    'if f(a;b)',
    'while s == ";"',
  ]);
});

test('splitSegments: ошибки скобок и кавычек', () => {
  assert.throws(() => splitSegments('if (a'), DslError);
  assert.throws(() => splitSegments('if a)'), DslError);
  assert.throws(() => splitSegments('if "a'), DslError);
});

test('parse if / else', () => {
  const n = parseDsl('if a > b else');
  assert.equal(n.kind, 'if');
  if (n.kind === 'if') {
    assert.equal(n.cond, 'a > b');
    assert.equal(n.hasElse, true);
  }
  assert.throws(() => parseDsl('if'), DslError);
});

test('parse for: полная, короткая форма и шаг', () => {
  const a = parseDsl('for j 2..n step 2');
  assert.deepEqual(a, { kind: 'for', variable: 'j', from: '2', to: 'n', step: 2 });
  const b = parseDsl('for 10');
  assert.deepEqual(b, { kind: 'for', variable: 'i', from: '0', to: '10', step: 1 });
  const c = parseDsl('for 10..0 step -1');
  assert.equal(c.kind === 'for' && c.step, -1);
  assert.throws(() => parseDsl('for i 0..5 step 0'), DslError);
  assert.throws(() => parseDsl('for a b'), DslError);
});

test('parse foreach, while, switch, func, try', () => {
  assert.deepEqual(parseDsl('foreach x in items'), { kind: 'foreach', item: 'x', collection: 'items' });
  assert.deepEqual(parseDsl('each x in a.b'), { kind: 'foreach', item: 'x', collection: 'a.b' });
  assert.deepEqual(parseDsl('while n > 0'), { kind: 'while', cond: 'n > 0' });
  assert.deepEqual(parseDsl('switch x: 1, 2 default'), {
    kind: 'switch', expr: 'x', cases: ['1', '2'], hasDefault: true,
  });
  assert.deepEqual(parseDsl('func add(a, b)'), { kind: 'func', name: 'add', params: ['a', 'b'] });
  assert.deepEqual(parseDsl('fn run'), { kind: 'func', name: 'run', params: [] });
  assert.deepEqual(parseDsl('try finally'), { kind: 'try', hasFinally: true });
  assert.throws(() => parseDsl('try oops'), DslError);
  assert.throws(() => parseDsl('switch x'), DslError);
  assert.throws(() => parseDsl('foreach x'), DslError);
});

test('цепочка связывается через body, summarize и лимит глубины', () => {
  const root = parseDsl('for i 0..n; if i%2==0 else; while x<3');
  assert.equal(root.body?.kind, 'if');
  assert.equal(root.body?.body?.kind, 'while');
  assert.equal(summarize(root), 'for › if (else) › while');
  const tooDeep = Array(MAX_DEPTH + 1).fill('if x').join(';');
  assert.throws(() => parseDsl(tooDeep), DslError);
  assert.throws(() => parseDsl('   '), DslError);
  assert.throws(() => parseDsl('loop x'), DslError);
});
