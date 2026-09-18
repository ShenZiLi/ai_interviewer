import { Module } from '@nestjs/common';
import { MockVoiceGateway } from './mock.provider.js';
import { LLM_PROVIDER, ComposeService } from './compose.service.js';
import { ProviderRegistry } from './provider-registry.js';

/**
 * 文本供应商（可运行期热切换）：
 * - 启动默认由 env 决定（配置了 `AI_BASE_URL` + `AI_MODEL` → HttpProvider 真实厂商，否则 MockProvider）。
 * - 之后可由设置接口运行期切换到自定义 API（无需重启），见 ModelSettingsController。
 * 语音网关 MVP 固定 MockVoiceGateway；后续按语音供应商 env 切换。
 */
@Module({
  providers: [
    ProviderRegistry,
    { provide: LLM_PROVIDER, useExisting: ProviderRegistry },
    MockVoiceGateway,
    ComposeService,
  ],
  exports: [LLM_PROVIDER, ProviderRegistry, MockVoiceGateway, ComposeService],
})
export class AiModule {}