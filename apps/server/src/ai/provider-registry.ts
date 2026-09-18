import { BadRequestException, Injectable } from '@nestjs/common';
import type { TaskCode } from '@ai-interviewer/contracts';
import { HttpProvider } from './http.provider.js';
import { MockProvider } from './mock.provider.js';
import type { Provider } from './provider.interface.js';

export interface ModelConfigState {
  /** platform=平台默认（env）；custom=用户自定义 API；mock=默认样本（无密钥）。 */
  mode: 'platform' | 'custom' | 'mock';
  baseUrl?: string;
  model?: string;
}

export interface SetModelConfigInput {
  mode?: 'platform' | 'custom';
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

/**
 * 运行期可切换的文本模型供应商：本身实现 Provider，把请求委托给当前选中的实现。
 * compose 只依赖 LLM_PROVIDER token，因此热切换无需重启即可对后续请求生效
 * （满足「主流厂商预设 / 自动配置 / 用户自定义 API」需求）。
 */
@Injectable()
export class ProviderRegistry implements Provider {
  readonly name = 'registry';
  private current: Provider;
  private state: ModelConfigState;

  constructor() {
    const boot = this.fromEnv();
    this.current = boot.provider;
    this.state = boot.state;
  }

  async completeTask(req: { task: TaskCode; context: unknown }): Promise<unknown> {
    return this.current.completeTask(req);
  }

  /** 运行期切换供应商；custom 缺 baseUrl/model 时报错回滚为当前值。 */
  setConfig(input: SetModelConfigInput): ModelConfigState {
    if (input.mode === 'custom') {
      if (!input.baseUrl?.trim() || !input.model?.trim()) {
        throw new BadRequestException('自定义 API 需提供 baseUrl 与 model');
      }
      this.current = new HttpProvider({ baseUrl: input.baseUrl.trim(), model: input.model.trim(), apiKey: input.apiKey });
      this.state = { mode: 'custom', baseUrl: input.baseUrl.trim(), model: input.model.trim() };
      return this.state;
    }
    const boot = this.fromEnv();
    this.current = boot.provider;
    this.state = boot.state;
    return this.state;
  }

  status(): ModelConfigState {
    return this.state;
  }

  /**
   * 连通性测试：对当前选中（或传入的自定义候选）供应商发一次最轻请求，不改变运行时状态。
   * 返回是否连通、延迟与原因；mock 恒通过。
   */
  async test(input?: SetModelConfigInput): Promise<{ ok: boolean; latencyMs: number; mode: ModelConfigState['mode']; error?: string }> {
    const target: Provider = (() => {
      if (input?.mode === 'custom') {
        if (!input.baseUrl?.trim() || !input.model?.trim()) {
          throw new BadRequestException('自定义 API 需先填写 Base URL 与模型');
        }
        return new HttpProvider({ baseUrl: input.baseUrl.trim(), model: input.model.trim(), apiKey: input.apiKey });
      }
      return this.current;
    })();
    const start = performance.now();
    try {
      await target.completeTask({ task: 'P01', context: { text: 'ping' } });
    } catch (e) {
      return { ok: false, latencyMs: Math.round(performance.now() - start), mode: this.state.mode, error: String((e as Error)?.message ?? e) };
    }
    return { ok: true, latencyMs: Math.round(performance.now() - start), mode: input?.mode === 'custom' ? 'custom' : this.state.mode };
  }

  private fromEnv(): { provider: Provider; state: ModelConfigState } {
    const baseUrl = process.env.AI_BASE_URL;
    const model = process.env.AI_MODEL;
    if (baseUrl && model) {
      return {
        provider: new HttpProvider({ baseUrl, model, apiKey: process.env.AI_API_KEY }),
        state: { mode: 'platform', baseUrl, model },
      };
    }
    return { provider: new MockProvider(), state: { mode: 'mock' } };
  }
}