import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error?: Error;
}

/** 全局错误边界：任一页面运行时异常不白屏，展示可读错误与「刷新重试」。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 640, margin: '80px auto', padding: '0 20px' }}>
          <div className="card">
            <h2>页面出错了</h2>
            <p className="muted">界面遇到未预期的错误，数据未受影响，可刷新后重试。</p>
            <p className="quote" style={{ marginTop: 10 }}>{this.state.error.message}</p>
            <div className="actions">
              <button className="primary" onClick={() => window.location.reload()}>刷新重试</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
