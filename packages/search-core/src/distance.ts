export function damerauLevenshtein(a: string, b: string, maxDistance = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i]![0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0]![j] = j;

  for (let i = 1; i < rows; i += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost
      );

      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        distance = Math.min(distance, matrix[i - 2]![j - 2]! + cost);
      }

      matrix[i]![j] = distance;
      rowMin = Math.min(rowMin, distance);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
  }

  return matrix[a.length]![b.length]!;
}

export function lowerBound(values: string[], target: string): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid]! < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function deletionVariants(term: string, maxDistance: number): string[] {
  const seen = new Set<string>([term]);
  let frontier = new Set<string>([term]);

  for (let distance = 0; distance < maxDistance; distance += 1) {
    const next = new Set<string>();
    for (const value of frontier) {
      if (value.length <= 1) continue;
      for (let index = 0; index < value.length; index += 1) {
        const variant = value.slice(0, index) + value.slice(index + 1);
        if (seen.has(variant)) continue;
        seen.add(variant);
        next.add(variant);
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }

  return [...seen];
}

export function buildDeletionDictionary(
  vocabulary: string[],
  maxDistance: number
): Record<string, string[]> {
  const dictionary = new Map<string, string[]>();

  for (const term of vocabulary) {
    for (const variant of deletionVariants(term, maxDistance)) {
      const values = dictionary.get(variant);
      if (values) {
        values.push(term);
      } else {
        dictionary.set(variant, [term]);
      }
    }
  }

  return Object.fromEntries(
    [...dictionary.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([variant, terms]) => [variant, [...new Set(terms)].sort()])
  );
}
