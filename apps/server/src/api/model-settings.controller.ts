import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { ProviderRegistry } from '../ai/provider-registry.js';

/** 主流厂商的 OpenAI 兼容预设（baseUrl + 模型），供自动带出配置；用户亦可覆盖为自定义。 */
const PRESETS = [
  { id: 'glm', vendor: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: process.env.GLM_MODEL || 'glm-4-flash' },
  { id: 'deepseek', vendor: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { id: 'qwen', vendor: '通义千问 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
];

const modelConfigSchema = z.object({
  mode: z.enum(['platform', 'custom']).optional(),
  baseUrl: z.string().trim().max(300).optional(),
  model: z.string().trim().max(100).optional(),
  apiKey: z.string().max(300).optional(),
});

@Controller('settings/model')
export class ModelSettingsController {
  constructor(@Inject(ProviderRegistry) private readonly registry: ProviderRegistry) {}

  @Get()
  status() {
    return { status: this.registry.status(), presets: PRESETS };
  }

  @Post()
  configure(@Body() body: unknown) {
    const input = modelConfigSchema.parse(body ?? {});
    return { status: this.registry.setConfig(input) };
  }

  /** 连通性测试：对当前（或传入的自定义候选）供应商发一次最轻请求，不切换运行态。 */
  @Post('test')
  async test(@Body() body: unknown) {
    const input = modelConfigSchema.parse(body ?? {});
    return this.registry.test(input);
  }
}