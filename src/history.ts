/**
 * История введённых шаблонов — LRU-список ограниченной ёмкости.
 *
 * Недавно использованный элемент перемещается в начало, дубликаты не
 * накапливаются, при переполнении самый старый элемент вытесняется.
 * Класс не зависит от VS Code: состояние сериализуется обычным массивом строк
 * и сохраняется расширением в `globalState`.
 */
export class History {
  private entries: string[] = [];

  /** @param capacity максимальное число элементов (минимум 1) */
  constructor(private capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  /** Восстанавливает историю из сохранённого массива (самые свежие — первыми). */
  static restore(saved: unknown, capacity: number): History {
    const h = new History(capacity);
    if (Array.isArray(saved)) {
      h.entries = saved.filter((s): s is string => typeof s === 'string').slice(0, h.capacity);
    }
    return h;
  }

  /** Добавляет шаблон в начало; повторный шаблон «всплывает» наверх. */
  push(item: string): void {
    const value = item.trim();
    if (!value) return;
    this.entries = [value, ...this.entries.filter((e) => e !== value)].slice(0, this.capacity);
  }

  /** Изменяет ёмкость и при необходимости обрезает хвост. */
  setCapacity(capacity: number): void {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.entries = this.entries.slice(0, this.capacity);
  }

  /** Копия списка: самые свежие элементы — в начале. */
  items(): string[] {
    return [...this.entries];
  }

  /** Число элементов в истории. */
  get size(): number {
    return this.entries.length;
  }
}
