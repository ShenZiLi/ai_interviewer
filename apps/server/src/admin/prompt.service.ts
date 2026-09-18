import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { TaskCode } from '@ai-interviewer/contracts';
import { ComposeService } from '../ai/compose.service.js';
import { newId, now } from '../core/store.js';

export type VersionStatus = 'draft' | 'tested' | 'published' | 'rolled_back';

export interface PromptTemplate {
  id: string;
  taskCode: string; // P01—P10
  name: string;
  description: string;
  basePrompt: string;
  variables: string[];
  createdAt: string;
}

export interface PromptVersion {
  id: string;
  templateId: string;
  versionNo: number;
  content: string;
  status: VersionStatus;
  testResult?: { passed: boolean; note: string };
  basedOnId?: string;
  createdBy: string;
  createdAt: string;
}

export interface UpdatePromptInput {
  name?: string;
  description?: string;
  basePrompt?: string;
  variables?: string[];
}

/** 允许手工发布（跳过测试）。生产可收紧；MVP 保留以便联调。 */
const ALLOW_PUBLISH_WITHOUT_TEST = false;

/**
 * 提示词模板 / 版本生命周期（进程内内存实现）。
 * 状态机：draft →(test) tested →(publish) published；草稿再编辑回到 draft（需重测）；
 * rollback 依目标版本内容创建新 published 版本并记录 basedOnId。
 * 对齐 docs/prompt-management.md 草稿→测试→发布→回滚。
 */
@Injectable()
export class PromptService {
  private templates = new Map<string, PromptTemplate>();
  private versions = new Map<string, PromptVersion>();
  private readonly author = 'admin';

  constructor(@Inject(ComposeService) private readonly compose: ComposeService) {}

  /* ---------- 模板 ---------- */

  listTemplates(): PromptTemplate[] {
    return [...this.templates.values()];
  }

  createTemplate(input: { taskCode: string; name: string; description?: string; basePrompt: string; variables?: string[] }): PromptTemplate {
    if ([...this.templates.values()].some((t) => t.taskCode === input.taskCode)) {
      throw new ConflictException(`任务编码已存在: ${input.taskCode}`);
    }
    const tpl: PromptTemplate = {
      id: newId('tpl'),
      taskCode: input.taskCode,
      name: input.name,
      description: input.description ?? '',
      basePrompt: input.basePrompt,
      variables: input.variables ?? [],
      createdAt: now(),
    };
    this.templates.set(tpl.id, tpl);
    // 建模板即建首个空草稿版本
    this.saveVersion({ id: newId('ver'), templateId: tpl.id, versionNo: 1, content: tpl.basePrompt, status: 'draft', createdBy: this.author, createdAt: now() });
    return tpl;
  }

  getTemplate(id: string): PromptTemplate {
    const t = this.templates.get(id);
    if (!t) throw new NotFoundException('模板不存在');
    return t;
  }

  /**
   * 更新「工作草稿」：取最新 draft|tested 版本；若无则从最近发布复制新建草稿。
   * 一旦有内容被改，测试态回到 draft（需重测）。
   */
  updateDraft(id: string, input: UpdatePromptInput): { template: PromptTemplate; version: PromptVersion } {
    const t = this.getTemplate(id);
    if (input.name !== undefined) t.name = input.name;
    if (input.description !== undefined) t.description = input.description;
    if (input.variables !== undefined) t.variables = input.variables;
    if (input.basePrompt !== undefined) t.basePrompt = input.basePrompt;

    let draft = this.workingDraft(id);
    const content = input.basePrompt ?? draft.content;
    if (content !== draft.content) {
      draft.status = 'draft';
      delete draft.testResult;
    }
    draft.content = content;
    this.versions.set(draft.id, draft);
    return { template: t, version: draft };
  }

  /* ---------- 版本动作 ---------- */

  listVersions(templateId: string): PromptVersion[] {
    this.getTemplate(templateId);
    return [...this.versions.values()]
      .filter((v) => v.templateId === templateId)
      .sort((a, b) => b.versionNo - a.versionNo);
  }

  /** 取某任务编码的最新已发布版本快照（面试起始锁定用）。 */
  getPublishedVersionForTask(taskCode: string): { templateId: string; versionId: string; versionNo: number } | undefined {
    const tpl = [...this.templates.values()].find((t) => t.taskCode === taskCode);
    if (!tpl) return undefined;
    const latest = [...this.versions.values()]
      .filter((v) => v.templateId === tpl.id && v.status === 'published')
      .sort((a, b) => b.versionNo - a.versionNo)[0];
    return latest ? { templateId: tpl.id, versionId: latest.id, versionNo: latest.versionNo } : undefined;
  }

  /** 按版本 id 返回版本（含内容），供 compose 以锁定版本拼提示词。 */
  getVersion(id: string): PromptVersion | undefined {
    return this.versions.get(id);
  }

  async test(templateId: string): Promise<PromptVersion> {
    const tpl = this.getTemplate(templateId);
    const draft = this.workingDraft(templateId);
    if (!draft.content.trim()) throw new ConflictException('草稿为空，无法测试');
    // 真正运行一次该任务 (+ 草稿模板作为 promptTemplate)，输出通过 taskSchema 才算通过。
    try {
      await this.compose.compose(tpl.taskCode as TaskCode, { promptTemplate: draft.content });
    } catch {
      throw new ConflictException('示例测试未通过：输出未通过该校验，请调整后重试');
    }
    draft.status = 'tested';
    draft.testResult = { passed: true, note: '示例测试通过（已实际生成并校验）' };
    this.versions.set(draft.id, draft);
    return draft;
  }

  publish(templateId: string): PromptVersion {
    this.getTemplate(templateId);
    const draft = this.workingDraft(templateId);
    if (!ALLOW_PUBLISH_WITHOUT_TEST && draft.status !== 'tested') {
      throw new ConflictException('草稿需先测试通过再发布');
    }
    if (!draft.content.trim()) throw new ConflictException('草稿为空，无法发布');
    // 冻结既有已发布版本中的最新一个（MVP 仅标记；真实产品按版本锁定场次）
    const nextNo = this.nextVersionNo(templateId);
    const published: PromptVersion = {
      ...draft,
      id: newId('ver'),
      versionNo: nextNo,
      status: 'published',
      createdAt: now(),
    };
    // 原草稿标记为已发布（占位），便于后续回滚基于它
    this.versions.delete(draft.id);
    this.saveVersion(published);
    return published;
  }

  rollback(templateId: string, targetVersionId: string): { version: PromptVersion; basedOn: PromptVersion } {
    this.getTemplate(templateId);
    const target = [...this.versions.values()].find((v) => v.id === targetVersionId && v.templateId === templateId);
    if (!target) throw new NotFoundException('回滚目标版本不存在');
    const version: PromptVersion = {
      id: newId('ver'),
      templateId,
      versionNo: this.nextVersionNo(templateId),
      content: target.content,
      status: 'published',
      basedOnId: target.id,
      createdBy: this.author,
      createdAt: now(),
    };
    this.saveVersion(version);
    return { version, basedOn: target };
  }

  /* ---------- 内部 ---------- */

  private workingDraft(templateId: string): PromptVersion {
    const existing = [...this.versions.values()]
      .filter((v) => v.templateId === templateId && (v.status === 'draft' || v.status === 'tested'))
      .sort((a, b) => b.versionNo - a.versionNo)?.[0];
    if (existing) return existing;
    // 无草稿：从最近发布复制（若存在）
    const latestPublished = [...this.versions.values()]
      .filter((v) => v.templateId === templateId && v.status === 'published')
      .sort((a, b) => b.versionNo - a.versionNo)[0];
    const tpl = this.getTemplate(templateId);
    const version: PromptVersion = {
      id: newId('ver'),
      templateId,
      versionNo: this.nextVersionNo(templateId),
      content: latestPublished?.content ?? tpl.basePrompt,
      status: 'draft',
      createdBy: this.author,
      createdAt: now(),
    };
    this.saveVersion(version);
    return version;
  }

  private nextVersionNo(templateId: string): number {
    const max = [...this.versions.values()]
      .filter((v) => v.templateId === templateId)
      .reduce((m, v) => Math.max(m, v.versionNo), 0);
    return max + 1;
  }

  private saveVersion(v: PromptVersion): void {
    this.versions.set(v.id, v);
  }
}