import { describe, expect, it } from 'vitest';
import { recentScores } from './session-trend';

describe('recentScores', () => {
  it('取最近 N 场综合分并按时序（旧→新）返回', () => {
    const items = [
      { report: { overview: { avgScore: 74 } } }, // 最新
      { report: { overview: { avgScore: 71 } } },
      { report: { overview: { avgScore: 68 } } }, // 最早
    ];
    expect(recentScores(items, 5)).toEqual([68, 71, 74]);
  });

  it('跳过无报告的场次', () => {
    const items = [
      { report: { overview: { avgScore: 70 } } },
      {},
      { report: { overview: { avgScore: 65 } } },
    ];
    expect(recentScores(items, 5)).toEqual([65, 70]);
  });

  it('限制数量且按四舍五入取整', () => {
    // 入参为倒序（新→旧，最近在前）；取最近 3 场
    const items = [
      { report: { overview: { avgScore: 65.4 } } }, // 最新
      { report: { overview: { avgScore: 64.4 } } },
      { report: { overview: { avgScore: 63.7 } } }, // 63.7 → 64
      { report: { overview: { avgScore: 62.4 } } }, // 第 4 新，应被截断
    ];
    expect(recentScores(items, 3)).toEqual([64, 64, 65]);
  });

  it('无报告时返回空数组', () => {
    expect(recentScores([{}, {}], 5)).toEqual([]);
    expect(recentScores([], 5)).toEqual([]);
  });
});