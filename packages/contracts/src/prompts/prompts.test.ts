import { describe, expect, it } from 'vitest';
import {
  evaluationOutputSchema,
  promptFor,
  promptVersions,
  questionOutputSchema,
} from './index.js';

describe('versioned prompts', () => {
  it('ships P01-P10 with stable versions', () =>
    expect(Object.keys(promptVersions)).toHaveLength(10));
  it('parses structured question output', () =>
    expect(
      questionOutputSchema.parse({ question: 'Q', competency: 'Java', difficulty: 'medium' })
        .question,
    ).toBe('Q'));
  it('rejects malformed evaluation output', () =>
    expect(() => evaluationOutputSchema.parse({ score: 120 })).toThrow());
  it('includes version marker', () => expect(promptFor('P01', 'ctx')).toContain('P01 v1'));
});
