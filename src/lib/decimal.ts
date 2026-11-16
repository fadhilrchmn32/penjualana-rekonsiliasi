import Decimal from 'decimal.js';

Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
});

export function toDec(value: string | number | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  try {
    if (value instanceof Decimal) return value;
    return new Decimal(String(value).trim());
  } catch {
    return new Decimal(0);
  }
}

export function addDec(a: string | number | Decimal, b: string | number | Decimal): Decimal {
  return toDec(a).plus(toDec(b));
}

export function subDec(a: string | number | Decimal, b: string | number | Decimal): Decimal {
  return toDec(a).minus(toDec(b));
}

export function mulDec(a: string | number | Decimal, b: string | number | Decimal): Decimal {
  return toDec(a).times(toDec(b));
}

export function roundHalfUp(value: string | number | Decimal, scale = 0): Decimal {
  return toDec(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
}

export function decStr(value: string | number | Decimal, scale = 2): string {
  return toDec(value).toFixed(scale, Decimal.ROUND_HALF_UP);
}

export function formatIDR(value: string | number | Decimal | null | undefined): string {
  const num = roundHalfUp(toDec(value), 0).toNumber();
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatQty(value: string | number | Decimal | null | undefined): string {
  const d = toDec(value);
  const num = d.toNumber();
  const hasFraction = !d.isInteger();
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 6,
  }).format(num);
}

export function parseLocalizedDecimal(
  raw: string | number | null | undefined,
  decimalFormat: 'id_comma' | 'en_dot'
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return String(raw);
  }
  const s = String(raw).trim().replace(/^Rp\s*/i, '').replace(/\s+/g, '');
  if (!s) return null;

  let normalized = s;
  if (decimalFormat === 'id_comma') {
    // 1.250.000,50 -> 1250000.50
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    // 1,250,000.50 -> 1250000.50
    normalized = normalized.replace(/,/g, '');
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return normalized;
}
