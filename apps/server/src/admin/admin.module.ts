import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { PromptService } from './prompt.service.js';
import { AdminController } from './admin.controller.js';

const DEFAULT_PROMPTS: [string, string][] = [
  ['P01', '把候选人原始简历整理为结构化简历理解（含教育、经历、项目、技能、待澄清要点）。'],
  ['P02', '结合简历与目标岗位，输出目标岗位分析（必备技能、考察重点、岗位风险）。'],
  ['P03', '依据岗位与简历，给出可多选的考察方向及推荐理由，必要时提出澄清问题。'],
  ['P04', '按所选方向与时长档位，输出分阶段的面试大纲与主问题计划，注意时长预算。'],
  ['P05', '根据自我介绍新增内容，给出后续大纲的增删改建议并说明原因。'],
  ['P06', '围绕当前考察方向，生成一道有区分度的主问题，附考察点与可选追问线索。'],
  ['P07', '用八维量表对一次回答评分，输出含各维得分、证据、理由与改进建议的评价。'],
  ['P08', '依据回答与评价，决定是否追问，并生成追问题目与目的。'],
  ['P09', '给出更高分的示范回答结构与针对本次回答的优化建议。'],
  ['P10', '基于整场转写与各轮评价，生成复盘报告（维度总览、亮点、行动项）。'],
];

@Injectable()
class PromptSeed implements OnModuleInit {
  constructor(@Inject(PromptService) private readonly prompts: PromptService) {}
  onModuleInit(): void {
    if (this.prompts.listTemplates().length > 0) return;
    for (const [taskCode, basePrompt] of DEFAULT_PROMPTS) {
      this.prompts.createTemplate({ taskCode, name: `任务 ${taskCode}`, basePrompt, variables: ['context', 'resume', 'outline'] });
    }
  }
}

@Module({
  imports: [AiModule],
  controllers: [AdminController],
  providers: [PromptService, PromptSeed],
  exports: [PromptService],
})
export class AdminModule {}