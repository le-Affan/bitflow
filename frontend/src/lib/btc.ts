const SATS_PER_BTC = 100_000_000n;

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats an integer amount of satoshis as BTC with exactly 8 decimals and thousands separators,
 * using integer math only (BigInt), e.g. 123456789012 -> "1,234.56789012".
 */
export function formatSats(sats: number | bigint): string {
  if (typeof sats === "number" && !Number.isSafeInteger(sats)) {
    throw new RangeError(`formatSats expects an integer number of satoshis, got ${sats}`);
  }
  const value = BigInt(sats);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SATS_PER_BTC;
  const fraction = (abs % SATS_PER_BTC).toString().padStart(8, "0");
  return `${negative ? "-" : ""}${groupThousands(whole.toString())}.${fraction}`;
}

export function formatBtc(sats: number | bigint): string {
  return `${formatSats(sats)} BTC`;
}
