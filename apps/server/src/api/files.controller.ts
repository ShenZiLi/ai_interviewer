import { BadRequestException, Body, Controller, Get, Header, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { newId } from '../core/store.js';

const uploadSchema = z.object({ data: z.string().min(1), mime: z.string().max(60).optional() });

interface StoredAudio {
  buf: Buffer;
  mime: string;
}

/** 音频上传（api-spec 4.2）。MVP：base64 上传，内存存储，返回 ref 供 ASR。 */
@Controller('files/audio')
export class FilesController {
  private store = new Map<string, StoredAudio>();

  @Post()
  upload(@Body() body: unknown) {
    const input = uploadSchema.parse(body);
    const buf = Buffer.from(input.data, 'base64');
    if (buf.byteLength === 0) throw new BadRequestException('音频数据为空');
    if (buf.byteLength > 20 * 1024 * 1024) throw new BadRequestException('音频过大（上限 20MB）');
    const ref = newId('audio');
    this.store.set(ref, { buf, mime: input.mime ?? 'audio/webm' });
    return { ref, mime: this.store.get(ref)!.mime, bytes: buf.length };
  }

  @Get(':ref')
  @Header('content-type', 'application/octet-stream')
  get(@Param('ref') ref: string): Buffer {
    const audio = this.store.get(ref);
    if (!audio) throw new NotFoundException('音频不存在');
    return audio.buf;
  }
}