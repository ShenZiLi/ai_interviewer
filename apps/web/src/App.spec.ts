import { describe, expect, it } from 'vitest';
import { gradeOf, overallScore } from '@ai-interviewer/contracts';

describe('共享契约在前端的复用', () => {
  it('八维全 4 → 80 → 等级 A', () => {
    expect(overallScore([4, 4, 4, 4, 4, 4, 4, 4])).toBe(80);
    expect(gradeOf(80)).toBe('A');
  });
});