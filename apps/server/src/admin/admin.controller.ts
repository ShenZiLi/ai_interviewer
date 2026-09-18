import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { PromptService } from './prompt.service.js';

const createTemplateSchema = z.object({
  taskCode: z.string().min(2).max(3),
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  basePrompt: z.string().min(1).max(50_000),
  variables: z.array(z.string().max(50)).max(30).optional(),
});
const updateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(200).optional(),
  basePrompt: z.string().min(1).max(50_000).optional(),
  variables: z.array(z.string().max(50)).max(30).optional(),
});
const actionSchema = z.object({
  action: z.enum(['test', 'publish', 'rollback']),
  targetVersionId: z.string().optional(),
});

/** 管理员提示词管理（api-spec §6）。授权：MVP 阶段未接入鉴权，生产需 role=admin 守卫。 */
@Controller('admin/templates')
export class AdminController {
  constructor(@Inject(PromptService) private readonly prompts: PromptService) {}

  @Get()
  list() {
    return { items: this.prompts.listTemplates() };
  }

  @Post()
  create(@Body() body: unknown) {
    const input = createTemplateSchema.parse(body);
    return { template: this.prompts.createTemplate(input) };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return { template: this.prompts.getTemplate(id) };
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const input = updateSchema.parse(body);
    return this.prompts.updateDraft(id, input);
  }

  @Get(':id/versions')
  versions(@Param('id') id: string) {
    return { items: this.prompts.listVersions(id) };
  }

  @Post(':id/versions')
  async action(@Param('id') id: string, @Body() body: unknown) {
    const { action, targetVersionId } = actionSchema.parse(body);
    switch (action) {
      case 'test':
        return { version: await this.prompts.test(id) };
      case 'publish':
        return { version: this.prompts.publish(id) };
      case 'rollback':
        if (!targetVersionId) throw new BadRequestException('回滚需要 targetVersionId');
        return this.prompts.rollback(id, targetVersionId);
    }
  }
}