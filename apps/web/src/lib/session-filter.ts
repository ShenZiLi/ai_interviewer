export interface SessionLike {
  targetRole: string;
}

/** 从场次列表提取去重的目标岗位（保持出现顺序）。 */
export function uniqueRoles(items: SessionLike[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!seen.has(it.targetRole)) {
      seen.add(it.targetRole);
      out.push(it.targetRole);
    }
  }
  return out;
}

/** 按目标岗位筛选；role 为 'all' 时不过滤。保留原元素类型。 */
export function filterByRole<T extends SessionLike>(items: T[], role: string): T[] {
  if (role === 'all') return items;
  return items.filter((it) => it.targetRole === role);
}