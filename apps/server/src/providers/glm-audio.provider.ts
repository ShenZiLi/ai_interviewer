import { Injectable, ServiceUnavailableException } from '@nestjs/common';
@Injectable()
export class GlmAudioProvider {
  private readonly base = process.env.GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4';
  private key() {
    const key = process.env.GLM_API_KEY;
    if (!key) throw new ServiceUnavailableException('GLM_API_KEY_NOT_CONFIGURED');
    return key;
  }
  async transcribe(audio: Buffer, fileName = 'answer.wav') {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), fileName);
    form.append('model', process.env.GLM_ASR_MODEL ?? 'glm-asr-2512');
    const r = await fetch(`${this.base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key()}` },
      body: form,
    });
    if (!r.ok) throw new ServiceUnavailableException(`GLM_ASR_${r.status}`);
    return r.json();
  }
  async speech(input: string) {
    const r = await fetch(`${this.base}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GLM_TTS_MODEL ?? 'glm-tts',
        input,
        voice: process.env.GLM_TTS_VOICE ?? 'tongtong',
        response_format: 'wav',
      }),
    });
    if (!r.ok) throw new ServiceUnavailableException(`GLM_TTS_${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
}
