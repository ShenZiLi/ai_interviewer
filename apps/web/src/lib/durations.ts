/** 把毫秒转简短时长文案（用于「反馈阅读/重答耗时」展示），不足 1 秒显示为「<1 秒」。 */
export function durLabel(ms: number): string {
  if (ms < 1000) return '<1 秒';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m <= 0) return `${s} 秒`;
  return `${m} 分 ${s} 秒`;
}