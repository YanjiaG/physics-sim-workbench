import type { ParamValue } from '@psw/core';

export function fmtNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  const fixed = value.toFixed(digits);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

export function fmtWithUnit(value: number, unit?: string, digits = 3): string {
  const text = fmtNumber(value, digits);
  return unit ? `${text} ${unit}` : text;
}

export function fmtParamValue(value: ParamValue | undefined): string {
  if (value === undefined) return '—';
  if (typeof value === 'number') return fmtNumber(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return value;
}

export function fmtTime(t: number): string {
  return `${fmtNumber(t, 2)} s`;
}

/** 把 ISO 时间戳或毫秒数格式化成「2026-11-22 19:06」。 */
export function fmtDateTime(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
