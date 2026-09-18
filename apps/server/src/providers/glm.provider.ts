import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { evaluationOutputSchema, promptFor, questionOutputSchema } from '@ai-interviewer/contracts';
@Injectable()
export class GlmProvider {
  private readonly base = process.env.GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4';
  private async call(path: string, body: unknown) {
    const key = process.env.GLM_API_KEY;
    if (!key) throw new ServiceUnavailableException('GLM_API_KEY_NOT_CONFIGURED');
    const r = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new ServiceUnavailableException(`GLM_${r.status}`);
    return r.json() as Promise<any>;
  }
  async nextQuestion(context: string) {
    const r = await this.call('/chat/completions', {
      model: process.env.GLM_TEXT_MODEL ?? 'glm-5.3-flash',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: promptFor('P01', context) },
        { role: 'user', content: '生成下一道面试题' },
      ],
    });
    return questionOutputSchema.parse(JSON.parse(r.choices?.[0]?.message?.content ?? '{}'));
  }
  async evaluate(context: string) {
    const r = await this.call('/chat/completions', {
      model: process.env.GLM_TEXT_MODEL ?? 'glm-5.3-flash',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: promptFor('P07', context) },
        { role: 'user', content: '评估答案' },
      ],
    });
    return evaluationOutputSchema.parse(JSON.parse(r.choices?.[0]?.message?.content ?? '{}'));
  }
}
