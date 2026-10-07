/**
 * Типы узлов абстрактного синтаксического дерева (AST) для DSL CodeScaffold.
 *
 * DSL-строка разбирается парсером в цепочку вложенных узлов: каждый следующий
 * узел находится в теле предыдущего. Затем генератор обходит дерево
 * рекурсивно и выводит код на выбранном языке.
 */

/** Вид конструкции. */
export type NodeKind = 'if' | 'for' | 'foreach' | 'while' | 'switch' | 'func' | 'try';

/** Базовый узел: у любого узла может быть вложенное тело (`body`). */
export interface BaseNode {
  kind: NodeKind;
  /** Вложенная конструкция (следующая в цепочке `>`), либо undefined. */
  body?: AstNode;
}

/** `if <cond> [else]` */
export interface IfNode extends BaseNode {
  kind: 'if';
  cond: string;
  hasElse: boolean;
}

/** `for <var> <from>..<to> [step N]` — цикл со счётчиком. */
export interface ForNode extends BaseNode {
  kind: 'for';
  variable: string;
  from: string;
  to: string;
  step: number;
}

/** `foreach <item> in <collection>` — цикл по коллекции. */
export interface ForeachNode extends BaseNode {
  kind: 'foreach';
  item: string;
  collection: string;
}

/** `while <cond>` */
export interface WhileNode extends BaseNode {
  kind: 'while';
  cond: string;
}

/** `switch <expr>: a, b, c [default]` */
export interface SwitchNode extends BaseNode {
  kind: 'switch';
  expr: string;
  cases: string[];
  hasDefault: boolean;
}

/** `func name(a, b)` */
export interface FuncNode extends BaseNode {
  kind: 'func';
  name: string;
  params: string[];
}

/** `try [finally]` */
export interface TryNode extends BaseNode {
  kind: 'try';
  hasFinally: boolean;
}

/** Объединение всех типов узлов. */
export type AstNode =
  | IfNode
  | ForNode
  | ForeachNode
  | WhileNode
  | SwitchNode
  | FuncNode
  | TryNode;

/** Ошибка разбора DSL; `segment` — фрагмент строки, в котором найдена ошибка. */
export class DslError extends Error {
  constructor(message: string, public readonly segment?: string) {
    super(message);
    this.name = 'DslError';
  }
}
