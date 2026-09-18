import { Module } from '@nestjs/common';
import { MockProvider, MockVoiceGateway } from './mock.provider.js';
import { HttpProvider } from './http.provider.js';
import { LLM_PROVIDER, ComposeService } from './compose.service.js';

/**
 * 供应商选择规则（env 驱动）：
 * - 配置了 `AI_BASE_URL` + `AI_MODEL` → 使用 OpenAI 兼容的 HttpProvider（真实厂商）。
 * - 否则默认 MockProvider（无需密钥即可跑通闭环与测试）。
 * 语音网关 MVP 固定 MockVoiceGateway；后续按语音供应商 env 切换。
 */
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      useFactory: () =>
        process.env.AI_BASE_URL && process.env.AI_MODEL
          ? new HttpProvider({
              baseUrl: process.env.AI_BASE_URL,
              apiKey: process.env.AI_API_KEY,
              model: process.env.AI_MODEL,
            })
          : new MockProvider(),
    },
    MockVoiceGateway,
    ComposeService,
  ],
  exports: [LLM_PROVIDER, MockVoiceGateway, ComposeService],
})
export class AiModule {}