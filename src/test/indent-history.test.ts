import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonIndent, dedent, indentLines, leadingWhitespace } from '../indent';
import { History } from '../history';

test('commonIndent / dedent игнорируют пустые строки', () => {
  const lines = ['    a', '', '      b', '    c'];
  assert.equal(commonIndent(lines), '    ');
  assert.deepEqual(dedent(lines), ['a', '', '  b', 'c']);
});

test('commonIndent со смешанными табами и пробелами берёт общий префикс', () => {
  assert.equal(commonIndent(['\t\ta', '\t b']), '\t');
  assert.equal(leadingWhitespace('  x'), '  ');
});

test('indentLines не трогает пустые строки', () => {
  assert.deepEqual(indentLines(['a', '', 'b'], '  '), ['  a', '', '  b']);
});

test('History: LRU, дубликаты и ёмкость', () => {
  const h = new History(3);
  h.push('a'); h.push('b'); h.push('c');
  h.push('a');
  assert.deepEqual(h.items(), ['a', 'c', 'b']);
  h.push('d');
  assert.deepEqual(h.items(), ['d', 'a', 'c']);
  h.push('   ');
  assert.equal(h.size, 3);
  h.setCapacity(1);
  assert.deepEqual(h.items(), ['d']);
});

test('History.restore отбрасывает мусор', () => {
  const h = History.restore(['x', 5, null, 'y'], 10);
  assert.deepEqual(h.items(), ['x', 'y']);
  assert.equal(History.restore('oops', 5).size, 0);
});
