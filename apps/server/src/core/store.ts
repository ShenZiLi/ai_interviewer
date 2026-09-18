import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const now = () => new Date().toISOString();

export function newId(prefix?: string): string {
  return prefix ? `${prefix}:${randomUUID()}` : randomUUID();
}

/* ---------- Resume ---------- */
export interface ResumeRecord {
  id: string;
  title: string;
  text: string;
  status: 'parsing' | 'parsed' | 'confirmed';
  analysis?: Record<string, unknown>;
  createdAt: string;
}

/* ---------- Interview ---------- */
export type InterviewStatus = 'draft' | 'active' | 'finished';

export interface Attempt {
  id: string;
  stage: 'first' | 'after_hint';
  transcript: string;
  evaluation?: Record<string, unknown>;
  followUp?: Record<string, unknown>;
  /** 用户录音的音频引用；会话结束按保留策略（默认即删）清理。 */
  audioRef?: string;
  createdAt: string;
}

export interface Turn {
  id: string;
  phase: 'intro' | 'tech' | 'biz' | 'hr';
  seqNo: number;
  question: string;
  /** 主问题主题（追问轮继承父轮），用于方向覆盖统计。 */
  topic?: string;
  /** 出题难度（begin/mid/deep），随 P06/P08 出题生成，供面试室展示。 */
  difficulty?: string;
  /** 本题考察维度（如「方案取舍」），随 P06 主问题生成。 */
  targetAspect?: string;
  parentTurnId?: string;
  ttsRef?: string;
  attempts: Attempt[];
  createdAt: string;
}

export interface ConfigLock {
  versionId: string;
  versionNo: number;
}

export interface InterviewRecord {
  id: string;
  resumeId: string;
  targetRole: string;
  level: 'junior' | 'mid' | 'senior';
  kind: 'coach' | 'mock';
  durationTier: '15m' | '30m' | '45m';
  /** 用户在本场是否显式选择保留录音（默认 session 即删）。 */
  keepAudio?: boolean;
  directions: string[];
  status: InterviewStatus;
  position?: Record<string, unknown>;
  directionsResult?: Record<string, unknown>;
  outline?: Record<string, unknown>;
  outlineAdjustedAt?: string;
  /** 开考时间戳（时长预算的起点；用于「到时提示收尾」）。 */
  startedAt?: string;
  promptLocks: Record<string, ConfigLock>;
  turns: Turn[];
  report?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** 上传的录音二进制元数据（不随 JSON 持久化，按保留策略生命周期清理）。 */
export interface StoredAudio {
  buf: Buffer;
  mime: string;
}

/** MVP 内存仓库。设置 `DATA_FILE` 环境变量后启用 JSON 文件持久化（重启不丢）；未设置则纯内存（便于测试隔离）。 */
export class InMemoryStore {
  private resumes = new Map<string, ResumeRecord>();
  private interviews = new Map<string, InterviewRecord>();
  /** 音频为敏感且大体积数据，仅内存与保留策略管控，不持久化。 */
  private readonly audios = new Map<string, StoredAudio>();
  private readonly file?: string;

  constructor() {
    const f = process.env.DATA_FILE?.trim();
    if (!f) return;
    this.file = f;
    if (existsSync(f)) {
      try {
        const data = JSON.parse(readFileSync(f, 'utf8')) as { resumes: ResumeRecord[]; interviews: InterviewRecord[] };
        for (const r of data.resumes ?? []) this.resumes.set(r.id, r);
        for (const i of data.interviews ?? []) this.interviews.set(i.id, i);
      } catch {
        /* 损坏的持久化文件忽略，按空库启动 */
      }
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ resumes: [...this.resumes.values()], interviews: [...this.interviews.values()] }), 'utf8');
    } catch {
      /* 持久化失败不阻塞业务 */
    }
  }

  saveResume(r: ResumeRecord): ResumeRecord {
    this.resumes.set(r.id, r);
    this.persist();
    return r;
  }
  getResume(id: string): ResumeRecord | undefined {
    return this.resumes.get(id);
  }

  saveInterview(i: InterviewRecord): InterviewRecord {
    i.updatedAt = now();
    this.interviews.set(i.id, i);
    this.persist();
    return i;
  }
  getInterview(id: string): InterviewRecord | undefined {
    return this.interviews.get(id);
  }
  listInterviews(): InterviewRecord[] {
    return [...this.interviews.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  deleteInterview(id: string): boolean {
    const existed = this.interviews.delete(id);
    if (existed) this.persist();
    return existed;
  }

  /* ---------- 音频（不持久化，按保留策略清理） ---------- */
  saveAudio(ref: string, audio: StoredAudio): void {
    this.audios.set(ref, audio);
  }
  getAudio(ref: string): StoredAudio | undefined {
    return this.audios.get(ref);
  }
  deleteAudio(ref: string): boolean {
    return this.audios.delete(ref);
  }
}