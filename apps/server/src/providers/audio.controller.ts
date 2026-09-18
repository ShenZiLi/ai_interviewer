import { Body, Controller, Post, Res } from '@nestjs/common';
import { GlmAudioProvider } from './glm-audio.provider.js';
@Controller('api/v1/audio')
export class AudioController {
  constructor(private readonly audio: GlmAudioProvider) {}
  @Post('transcribe') async transcribe(@Body() body: { audioBase64: string }) {
    return this.audio.transcribe(Buffer.from(body.audioBase64, 'base64'));
  }
  @Post('speech') async speech(@Body() body: { text: string }, @Res() res: any) {
    res.header('Content-Type', 'audio/wav');
    return res.send(await this.audio.speech(body.text));
  }
}
