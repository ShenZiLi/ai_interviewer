import { describe, expect, it } from 'vitest';
import { durLabel } from './durations';

describe('durLabel', () => {
  it('不足 1 秒显示 <1 秒', () => {
    expect(durLabel(0)).toBe('<1 秒');
    expect(durLabel(800)).toBe('<1 秒');
  });
  it('纯秒', () => {
    expect(durLabel(12_000)).toBe('12 秒');
  });
  it('分 + 秒', () => {
    expect(durLabel(80_000)).toBe('1 分 20 秒');
    expect(durLabel(2 * 60_000 + 500)).toBe('2 分 1 秒');
  });
  it('负数视为 0', () => {
    expect(durLabel(-5_000)).toBe('<1 秒');
  });
});