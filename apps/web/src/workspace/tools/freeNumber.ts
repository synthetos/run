/** First unused positive T number, including gaps in an unsorted table. */
export function freeToolNumber(list: readonly { readonly number: number }[]): number {
  const used = new Set(list.map(t => t.number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}
