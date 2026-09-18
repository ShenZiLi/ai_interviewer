import { randomUUID } from 'node:crypto';

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
  createdAt: string;
}

export interface Turn {
  id: string;
  phase: 'intro' | 'tech' | 'biz' | 'hr';
  seqNo: number;
  question: string;
  attempts: Attempt[];
  createdAt: string;
}

export interface InterviewRecord {
  id: string;
  resumeId: string;
  targetRole: string;
  level: 'junior' | 'mid' | 'senior';
  kind: 'coach' | 'mock';
  durationTier: '15m' | '30m' | '45m';
  directions: string[];
  status: InterviewStatus;
  position?: Record<string, unknown>;
  directionsResult?: Record<string, unknown>;
  outline?: Record<string, unknown>;
  outlineAdjustedAt?: string;
  turns: Turn[];
  report?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** MVP 内存仓库（进程内，重启丢失；后续换 Prisma/Postgres）。 */
export class InMemoryStore {
  private resumes = new Map<string, ResumeRecord>();
  private interviews = new Map<string, InterviewRecord>();

  saveResume(r: ResumeRecord): ResumeRecord {
    this.resumes.set(r.id, r);
    return r;
  }
  getResume(id: string): ResumeRecord | undefined {
    return this.resumes.get(id);
  }

  saveInterview(i: InterviewRecord): InterviewRecord {
    i.updatedAt = now();
    this.interviews.set(i.id, i);
    return i;
  }
  getInterview(id: string): InterviewRecord | undefined {
    return this.interviews.get(id);
  }
  listInterviews(): InterviewRecord[] {
    return [...this.interviews.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}