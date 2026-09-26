import { describe, expect, it } from 'vitest';
import { filterByRole, uniqueRoles } from './session-filter';

describe('uniqueRoles', () => {
  it('去重且保持出现顺序', () => {
    const items = [
      { targetRole: 'Java 后端' },
      { targetRole: '前端' },
      { targetRole: 'Java 后端' },
      { targetRole: '算法' },
    ];
    expect(uniqueRoles(items)).toEqual(['Java 后端', '前端', '算法']);
  });
  it('空数组返回空', () => {
    expect(uniqueRoles([])).toEqual([]);
  });
});

describe('filterByRole', () => {
  const items = [
    { targetRole: 'Java 后端' },
    { targetRole: '前端' },
    { targetRole: 'Java 后端' },
  ];
  it('按岗位过滤', () => {
    expect(filterByRole(items, 'Java 后端')).toEqual([items[0], items[2]]);
    expect(filterByRole(items, '前端')).toEqual([items[1]]);
  });
  it('"all" 不过滤', () => {
    expect(filterByRole(items, 'all')).toEqual(items);
  });
});