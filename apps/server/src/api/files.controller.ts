import { BadRequestException, Body, Controller, Get, Header, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { InMemoryStore, newId, type StoredAudio } from '../core/store.js';

const uploadSchema = z.object({ data: z.string().min(1), mime: z.string().max(60).optional() });

/** 音频上传（api-spec 4.2）。MVP：base64 上传，共享仓库按保留策略管理，返回 ref 供 ASR。 */
@Controller('files/audio')
export class FilesController {
  constructor(@Inject(InMemoryStore) private readonly store: InMemoryStore) {}

  @Post()
  upload(@Body() body: unknown) {
    const input = uploadSchema.parse(body);
    const buf = Buffer.from(input.data, 'base64');
    if (buf.byteLength === 0) throw new BadRequestException('音频数据为空');
    if (buf.byteLength > 20 * 1024 * 1024) throw new BadRequestException('音频过大（上限 20MB）');
    const ref = newId('audio');
    const audio: StoredAudio = { buf, mime: input.mime ?? 'audio/webm' };
    this.store.saveAudio(ref, audio);
    return { ref, mime: audio.mime, bytes: buf.length };
  }

  @Get(':ref')
  @Header('content-type', 'application/octet-stream')
  get(@Param('ref') ref: string): Buffer {
    const audio = this.store.getAudio(ref);
    if (!audio) throw new NotFoundException('音频不存在');
    return audio.buf;
  }
}