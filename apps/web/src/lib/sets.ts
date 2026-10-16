/** A copy of `set` with `item` added (`on`) or taken out; without `on`, its presence flips. */
export function toggled<T>(set: Set<T>, item: T, on = !set.has(item)) {
  const next = new Set(set);
  if (on) next.add(item);
  else next.delete(item);
  return next;
}
