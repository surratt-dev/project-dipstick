// ---------------------------------------------------------------------------
// topicOrder — reorder-topics, design.md Decision 8, tasks.md Task 6.1.
//
// Pure array helpers behind the Topic Management screen's move buttons. Each
// returns a new array and never mutates its input. A move that would go past
// either end (or an out-of-range index) returns the input array itself, so
// callers can detect a no-op by identity.
// ---------------------------------------------------------------------------

function moveTo<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return items as T[];
  }
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

export function moveUp<T>(items: readonly T[], index: number): T[] {
  return moveTo(items, index, index - 1);
}

export function moveDown<T>(items: readonly T[], index: number): T[] {
  return moveTo(items, index, index + 1);
}

export function moveToTop<T>(items: readonly T[], index: number): T[] {
  return moveTo(items, index, 0);
}

export function moveToBottom<T>(items: readonly T[], index: number): T[] {
  return moveTo(items, index, items.length - 1);
}

export function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
