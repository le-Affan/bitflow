/** First 6 and last 4 characters, e.g. "abcdef…wxyz". Short values are returned unchanged. */
export function shorten(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
