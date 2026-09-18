import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

describe('ErrorBoundary 全局错误边界', () => {
  it('getDerivedStateFromError 捕获渲染期错误为状态', () => {
    const err = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it('render 在无错误时正常透传子节点（不拦截）', () => {
    const inst = new ErrorBoundary({ children: 'child' });
    inst.state = {};
    // 无错误状态时返回 children
    expect((inst.render() as string)).toBe('child');
    // 有错误时渲染错误页（含刷新重试按钮文案）
    inst.state = { error: new Error('x') };
    const el = inst.render() as { props: { children: unknown[] } };
    const texts = JSON.stringify(el.props.children);
    expect(texts).toContain('页面出错了');
    expect(texts).toContain('刷新重试');
  });
});
