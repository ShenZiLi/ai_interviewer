import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryStore, newId, now, type InterviewRecord, type ResumeRecord } from '../src/core/store.js';

const file = join(tmpdir(), `ai_interviewer_store_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);

afterEach(() => {
  delete process.env.DATA_FILE;
  if (existsSync(file)) rmSync(file, { force: true });
});

describe('InMemoryStore 可选手持 JSON 持久化（DATA_FILE）', () => {
  it('写入后在另一实例（模拟重启）可读回同一批数据', () => {
    process.env.DATA_FILE = file;
    const a = new InMemoryStore();
    const resume: ResumeRecord = { id: newId('resume'), title: 'r1', text: 'x', status: 'parsed', analysis: { summary: 's' }, createdAt: now() };
    a.saveResume(resume);
    const interview: InterviewRecord = {
      id: newId('interview'), resumeId: resume.id, targetRole: 'R', level: 'mid', kind: 'coach', durationTier: '30m',
      keepAudio: true, directions: ['concurrency'], status: 'active', promptLocks: {}, turns: [], createdAt: now(), updatedAt: now(),
    };
    a.saveInterview(interview);

    // 新实例读回
    const b = new InMemoryStore();
    expect(b.getResume(resume.id)?.title).toBe('r1');
    const got = b.getInterview(interview.id);
    expect(got?.keepAudio).toBe(true);
    expect(b.listInterviews().map((i) => i.id)).toContain(interview.id);
  });

  it('未设 DATA_FILE 时不落盘（纯内存）', () => {
    delete process.env.DATA_FILE;
    const s = new InMemoryStore();
    s.saveResume({ id: 'r', title: 't', text: '', status: 'parsed', createdAt: now() });
    expect(existsSync(file)).toBe(false);
  });
});