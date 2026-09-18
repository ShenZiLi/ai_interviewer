# Real API MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the authenticated, PostgreSQL-backed Web MVP with real GLM text, ASR, and TTS adapters.

**Architecture:** Use a pnpm monorepo with a React/Vite Web app, a NestJS/Fastify modular monolith, shared Zod contracts, and Prisma/PostgreSQL. Keep GLM behind provider ports, drive the interview with a server-side state machine, and deliver in vertical slices with tests before implementation.

**Tech Stack:** Node 24, pnpm 12, TypeScript, React, Vite, TanStack Query, NestJS, Fastify, Prisma, PostgreSQL 17, Zod, Argon2, Vitest, Supertest, Playwright.

---

## Planned file map

- Root build/config: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.env.example`.
- Shared contracts: `packages/contracts/src/*.ts`; one responsibility per domain plus P01—P10 schemas.
- API: `apps/server/src/{auth,resumes,interviews,reports,providers,common}`; each module owns its controller, service, persistence and tests.
- Database: `apps/server/prisma/schema.prisma` and migrations.
- Web: `apps/web/src/features/*` with route-level feature boundaries and a small `shared` layer.
- Verification: co-located unit tests, server integration tests, Playwright browser tests and optional live GLM smoke tests.

### Task 1: Scaffold the monorepo and quality gates

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.env.example`
- Create: `packages/contracts/package.json`
- Create: `apps/server/package.json`
- Create: `apps/web/package.json`

- [ ] **Step 1: Add root workspace scripts**

```json
{
  "name": "ai-interviewer",
  "private": true,
  "packageManager": "pnpm@12.4.2",
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm --parallel --filter @ai-interviewer/server --filter @ai-interviewer/web dev",
    "lint": "eslint .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "test:e2e": "pnpm --filter @ai-interviewer/web test:e2e",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "@eslint/js": "latest",
    "eslint": "latest",
    "eslint-config-prettier": "latest",
    "globals": "latest",
    "prettier": "latest",
    "typescript": "latest",
    "typescript-eslint": "latest"
  }
}
```

- [ ] **Step 2: Add package manifests**

```json
{
  "name": "@ai-interviewer/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "generate:schemas": "tsx scripts/generate-schemas.ts"
  },
  "dependencies": {
    "zod": "latest",
    "zod-to-json-schema": "latest"
  },
  "devDependencies": {
    "tsx": "latest",
    "vitest": "latest"
  }
}
```

```json
{
  "name": "@ai-interviewer/server",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:live:glm": "vitest run src/providers/glm/glm-live.test.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@ai-interviewer/contracts": "workspace:*",
    "@fastify/cors": "latest",
    "@fastify/multipart": "latest",
    "@nestjs/common": "latest",
    "@nestjs/core": "latest",
    "@nestjs/jwt": "latest",
    "@nestjs/platform-fastify": "latest",
    "@prisma/client": "latest",
    "argon2": "latest",
    "mammoth": "latest",
    "pdf-parse": "latest",
    "reflect-metadata": "latest",
    "rxjs": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@nestjs/cli": "latest",
    "@nestjs/testing": "latest",
    "@types/node": "latest",
    "prisma": "latest",
    "supertest": "latest",
    "tsx": "latest",
    "vitest": "latest"
  }
}
```

```json
{
  "name": "@ai-interviewer/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@ai-interviewer/contracts": "workspace:*",
    "@tanstack/react-query": "latest",
    "react": "latest",
    "react-dom": "latest",
    "react-router-dom": "latest"
  },
  "devDependencies": {
    "@playwright/test": "latest",
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "@vitejs/plugin-react": "latest",
    "jsdom": "latest",
    "vite": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 3: Define workspace and shared TypeScript settings**

```yaml
packages:
  - apps/*
  - packages/*
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 4: Add lint and format configuration**

```js
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'prototype/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  prettier,
);
```

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 5: Add safe environment template**

```dotenv
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_interviewer
JWT_SECRET=replace-with-at-least-32-random-characters
DATA_ENCRYPTION_KEY=replace-with-64-hex-characters
GLM_API_KEY=
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_TEXT_MODEL=glm-5.3-flash
GLM_ASR_MODEL=glm-asr-2512
GLM_TTS_MODEL=glm-tts
GLM_TTS_VOICE=tongtong
WEB_ORIGIN=http://127.0.0.1:5173
PORT=3000
```

- [ ] **Step 6: Install dependencies**

Run: `pnpm install`

Expected: lockfile created, install exits 0, no `.env` created.

- [ ] **Step 7: Verify the empty workspace gates**

Run: `pnpm format:check`

Expected: PASS after formatting configuration files.

- [ ] **Step 8: Commit**

```powershell
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json .env.example apps packages
git commit -m "build: scaffold TypeScript monorepo"
```

### Task 2: Define shared contracts and generated JSON schemas

**Files:**
- Create: `packages/contracts/src/common.ts`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/resume.ts`
- Create: `packages/contracts/src/interview.ts`
- Create: `packages/contracts/src/prompts/p01.ts` through `p10.ts`
- Create: `packages/contracts/src/prompts/index.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/prompts/prompts.test.ts`
- Create: `packages/contracts/scripts/generate-schemas.ts`
- Create: `schemas/p01.json` through `schemas/p10.json`

- [ ] **Step 1: Write failing scoring boundary tests**

```ts
import { describe, expect, it } from 'vitest';
import { gradeForScore, weightedScore } from './index.js';

describe('score contract', () => {
  it.each([[59, 'C'], [60, 'B'], [69, 'B'], [70, 'B+'], [79, 'B+'], [80, 'A'], [89, 'A'], [90, 'A+']])(
    'maps %s to %s',
    (score, grade) => expect(gradeForScore(score)).toBe(grade),
  );

  it('computes the weighted 0-100 score from 0-5 dimensions', () => {
    expect(weightedScore([{ score: 4, weight: 0.6 }, { score: 3, weight: 0.4 }])).toBe(72);
  });
});
```

- [ ] **Step 2: Run the contracts test and confirm failure**

Run: `pnpm --filter @ai-interviewer/contracts test`

Expected: FAIL because `gradeForScore` and prompt schemas do not exist.

- [ ] **Step 3: Implement shared enums, DTOs, all P01—P10 Zod schemas and score helpers**

Each prompt schema must match `docs/output-schemas.md`, use `.strict()`, share the eight dimension enum, and export a `promptSchemas` map keyed by `P01` through `P10`.

```ts
export const gradeForScore = (score: number) =>
  score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B+' : score >= 60 ? 'B' : 'C';

export const weightedScore = (dimensions: ReadonlyArray<{ score: number; weight: number }>) =>
  Math.round(dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) * 20);
```

- [ ] **Step 4: Generate JSON schemas**

Run: `pnpm --filter @ai-interviewer/contracts generate:schemas`

Expected: ten deterministic files in `schemas/`.

- [ ] **Step 5: Run contract tests and typecheck**

Run: `pnpm --filter @ai-interviewer/contracts test && pnpm --filter @ai-interviewer/contracts typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/contracts schemas
git commit -m "feat(contracts): add MVP API and prompt schemas"
```

### Task 3: Create the NestJS server, configuration and Prisma model

**Files:**
- Create: `apps/server/src/main.ts`
- Create: `apps/server/src/app.module.ts`
- Create: `apps/server/src/common/config.ts`
- Create: `apps/server/src/common/prisma.service.ts`
- Create: `apps/server/src/common/http-error.filter.ts`
- Create: `apps/server/prisma/schema.prisma`
- Create: `apps/server/src/common/config.test.ts`

- [ ] **Step 1: Write a failing configuration test**

```ts
it('rejects weak secrets', () => {
  expect(() => parseConfig({ DATABASE_URL: 'postgresql://x', JWT_SECRET: 'short', DATA_ENCRYPTION_KEY: 'bad' })).toThrow();
});
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @ai-interviewer/server test -- config.test.ts`

Expected: FAIL because `parseConfig` does not exist.

- [ ] **Step 3: Implement strict config parsing**

Use Zod to require a PostgreSQL URL, JWT secret of at least 32 characters, 64 hex characters for AES-256, valid URLs, integer port, and optional `GLM_API_KEY` so non-live tests can run.

- [ ] **Step 4: Define Prisma models and enums**

Define `User`, `Credential`, `Resume`, `Interview`, `Turn`, `Attempt`, `Report`, and `IdempotencyRecord`; add unique constraints for username and report interview ID, cascade ownership relations, JSON fields for validated structured data, and indexes on owner/status/update time.

- [ ] **Step 5: Generate Prisma client and migration**

Run: `pnpm --filter @ai-interviewer/server prisma:generate`

Run: `pnpm --filter @ai-interviewer/server prisma:migrate -- --name init`

Expected: Prisma client generated and migration applies to local PostgreSQL 17.

- [ ] **Step 6: Start and probe the health endpoint**

Run: `pnpm --filter @ai-interviewer/server test -- app.e2e.test.ts`

Expected: `GET /v1/health` returns 200 `{ "status": "ok" }`.

- [ ] **Step 7: Commit**

```powershell
git add apps/server
git commit -m "feat(server): add NestJS and Prisma foundation"
```

### Task 4: Implement encryption and authenticated accounts

**Files:**
- Create: `apps/server/src/common/encryption.service.ts`
- Create: `apps/server/src/common/encryption.service.test.ts`
- Create: `apps/server/src/auth/auth.module.ts`
- Create: `apps/server/src/auth/auth.controller.ts`
- Create: `apps/server/src/auth/auth.service.ts`
- Create: `apps/server/src/auth/jwt.guard.ts`
- Create: `apps/server/src/auth/current-user.decorator.ts`
- Create: `apps/server/src/auth/auth.e2e.test.ts`

- [ ] **Step 1: Write failing encryption and auth tests**

```ts
it('round-trips encrypted text without storing plaintext', () => {
  const value = service.encrypt('private resume');
  expect(value).not.toContain('private resume');
  expect(service.decrypt(value)).toBe('private resume');
});
```

The e2e test must assert register returns 201, duplicate username returns `ACCOUNT_TAKEN`, a wrong password returns 401, `/auth/me` works with a bearer token, and unauthenticated requests return 401.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @ai-interviewer/server test -- encryption.service.test.ts auth.e2e.test.ts`

Expected: FAIL because auth endpoints and encryption are missing.

- [ ] **Step 3: Implement AES-256-GCM and Argon2id/JWT auth**

Normalize usernames with `trim().toLowerCase()`, require 3-32 safe characters and passwords 10-128 characters, hash with Argon2id, issue two-hour JWTs, and never serialize `passwordHash`.

- [ ] **Step 4: Run auth tests**

Run: `pnpm --filter @ai-interviewer/server test -- encryption.service.test.ts auth.e2e.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/auth apps/server/src/common
git commit -m "feat(auth): add secure account registration and login"
```

### Task 5: Implement GLM provider adapters

**Files:**
- Create: `apps/server/src/providers/provider.ports.ts`
- Create: `apps/server/src/providers/glm/glm-text.client.ts`
- Create: `apps/server/src/providers/glm/glm-asr.client.ts`
- Create: `apps/server/src/providers/glm/glm-tts.client.ts`
- Create: `apps/server/src/providers/glm/glm-clients.test.ts`
- Create: `apps/server/src/providers/glm/glm-live.test.ts`
- Create: `apps/server/src/providers/providers.module.ts`

- [ ] **Step 1: Write failing request-shape tests against a local HTTP stub**

Assert text uses `/chat/completions`, bearer auth, configured model and `json_object`; ASR uses multipart `/audio/transcriptions`; TTS uses `/audio/speech` and returns WAV bytes. The stub test key must be literal `test-key`, never an environment secret.

- [ ] **Step 2: Run the tests and confirm failure**

Run: `pnpm --filter @ai-interviewer/server test -- glm-clients.test.ts`

Expected: FAIL because clients are missing.

- [ ] **Step 3: Implement clients with fetch, AbortSignal timeouts and normalized errors**

Use 60 seconds for text/ASR, 30 seconds for TTS, one retry for 429/5xx/timeout, request IDs, and error bodies capped at 1 KB without request content.

- [ ] **Step 4: Add opt-in live smoke**

`glm-live.test.ts` must skip when `GLM_API_KEY` is absent and otherwise call one tiny JSON completion, a committed synthetic one-second WAV fixture, and short TTS text.

- [ ] **Step 5: Run provider tests**

Run: `pnpm --filter @ai-interviewer/server test -- glm-clients.test.ts`

Expected: PASS without real network use.

- [ ] **Step 6: Commit**

```powershell
git add apps/server/src/providers apps/server/test/fixtures
git commit -m "feat(glm): add text ASR and TTS adapters"
```

### Task 6: Implement resume import, consent and P01

**Files:**
- Create: `apps/server/src/resumes/resumes.module.ts`
- Create: `apps/server/src/resumes/resumes.controller.ts`
- Create: `apps/server/src/resumes/resumes.service.ts`
- Create: `apps/server/src/resumes/resume-parser.ts`
- Create: `apps/server/src/resumes/resume-parser.test.ts`
- Create: `apps/server/src/resumes/resumes.e2e.test.ts`
- Create: `apps/server/src/interviews/prompts/p01.ts`

- [ ] **Step 1: Write failing parser and consent tests**

Cover TXT/MD/DOCX/PDF text extraction, unsupported/scanned documents, 5 MB limit, missing consent rejection, owner isolation, encrypted raw text and persisted consent version/time.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @ai-interviewer/server test -- resume-parser.test.ts resumes.e2e.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement extraction and import endpoints**

Use `mammoth` for DOCX, `pdf-parse` for PDF and UTF-8 decoding for MD/TXT. Discard file buffers after extraction, cap extracted text at 100,000 characters, and reject blank/scanned PDF text.

- [ ] **Step 4: Implement P01 call and validation**

Send the P01 system prompt and extracted text through `TextModelPort`; validate with `p01Schema`; persist only validated analysis and encrypted raw text.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @ai-interviewer/server test -- resume-parser.test.ts resumes.e2e.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/server/src/resumes apps/server/src/interviews/prompts/p01.ts
git commit -m "feat(resumes): add consented GLM resume analysis"
```

### Task 7: Implement prompt orchestration and output repair

**Files:**
- Create: `apps/server/src/interviews/prompt-orchestrator.ts`
- Create: `apps/server/src/interviews/prompt-orchestrator.test.ts`
- Create: `apps/server/src/interviews/prompts/p02.ts` through `p10.ts`
- Create: `apps/server/src/interviews/prompts/index.ts`

- [ ] **Step 1: Write failing orchestration tests**

Assert valid JSON succeeds once, invalid JSON receives one repair call, a second failure becomes `UPSTREAM_UNAVAILABLE`, prompt version is `mvp-v1`, and logged metadata excludes input/output bodies.

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @ai-interviewer/server test -- prompt-orchestrator.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement P02—P10 templates and orchestrator**

Each template must list allowed inputs, explicitly forbid invented resume facts, require JSON only, and repeat critical mode rules in code-controlled context. Parse fenced JSON defensively, validate via `promptSchemas[taskCode]`, and repair once with concise Zod issue paths.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @ai-interviewer/server test -- prompt-orchestrator.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/interviews
git commit -m "feat(orchestration): add validated P01 to P10 prompts"
```

### Task 8: Implement interview state machine and persistence

**Files:**
- Create: `apps/server/src/interviews/interview-state.ts`
- Create: `apps/server/src/interviews/interview-state.test.ts`
- Create: `apps/server/src/interviews/interviews.module.ts`
- Create: `apps/server/src/interviews/interviews.controller.ts`
- Create: `apps/server/src/interviews/interviews.service.ts`
- Create: `apps/server/src/interviews/interviews.e2e.test.ts`
- Create: `apps/server/src/reports/reports.module.ts`
- Create: `apps/server/src/reports/reports.controller.ts`

- [ ] **Step 1: Write failing state and mode-isolation tests**

Cover `draft → analyzed → directions → outlined → active → finished`, reject skips, practice feedback visibility, mock feedback suppression, P05 confirmation rules, attempts `first|after_hint`, and P10 report creation.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @ai-interviewer/server test -- interview-state.test.ts interviews.e2e.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement all MVP interview endpoints**

Implement the endpoints in `docs/api-spec.md`, always query by `id + userId`, wrap state transitions and persistence in Prisma transactions, and snapshot `mvp-v1`/`rubric-v1` on start.

- [ ] **Step 4: Add idempotency for answer and finish**

Store `(userId, route, key, requestHash, responseJson)`; return the saved response for an identical retry and 409 for a reused key with a different request hash.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @ai-interviewer/server test -- interview-state.test.ts interviews.e2e.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/server/src/interviews apps/server/src/reports apps/server/prisma
git commit -m "feat(interviews): add persisted interview state machine"
```

### Task 9: Implement audio submission and TTS playback endpoints

**Files:**
- Create: `apps/server/src/interviews/audio.service.ts`
- Create: `apps/server/src/interviews/audio.service.test.ts`
- Modify: `apps/server/src/interviews/interviews.controller.ts`
- Modify: `apps/server/src/interviews/interviews.service.ts`

- [ ] **Step 1: Write failing audio tests**

Assert ordered 25-second chunks are transcribed with previous text as prompt, transcript is joined exactly once, unsupported mime/oversize chunks fail, mock responses omit evaluation, and question TTS returns `audio/wav`.

- [ ] **Step 2: Run the tests and confirm failure**

Run: `pnpm --filter @ai-interviewer/server test -- audio.service.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement ASR aggregation and TTS response**

Accept WAV or MP3 chunks no larger than 25 MB, sequence them by explicit index, call GLM-ASR serially, persist the joined transcript, then call the mode-specific orchestration path. Generate WAV for every new interview question without persisting the audio.

- [ ] **Step 4: Run audio and interview tests**

Run: `pnpm --filter @ai-interviewer/server test -- audio.service.test.ts interviews.e2e.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/interviews
git commit -m "feat(audio): connect GLM transcription and speech"
```

### Task 10: Build the React application shell and authentication

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/shared/api.ts`
- Create: `apps/web/src/shared/auth-store.ts`
- Create: `apps/web/src/shared/styles.css`
- Create: `apps/web/src/features/auth/AuthPage.tsx`
- Create: `apps/web/src/features/auth/AuthPage.test.tsx`
- Create: `apps/web/src/features/home/HomePage.tsx`

- [ ] **Step 1: Write failing auth UI tests**

Assert register/login validation, token persistence, `/auth/me` restoration, 401 logout and protected-route redirect.

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @ai-interviewer/web test -- AuthPage.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement app shell and auth feature**

Use React Router, TanStack Query and a typed API client based on shared contracts. Recreate the prototype's light palette, typography, cards, focus states and responsive behavior; do not copy its fixed data behavior.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ai-interviewer/web test && pnpm --filter @ai-interviewer/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web
git commit -m "feat(web): add authenticated application shell"
```

### Task 11: Build resume and interview preparation UI

**Files:**
- Create: `apps/web/src/features/resumes/ResumePage.tsx`
- Create: `apps/web/src/features/resumes/ResumePage.test.tsx`
- Create: `apps/web/src/features/interviews/PreparePage.tsx`
- Create: `apps/web/src/features/interviews/PreparePage.test.tsx`
- Create: `apps/web/src/features/interviews/FlowPage.tsx`

- [ ] **Step 1: Write failing journey tests**

Assert no submission without consent, exact notice version sent, file/paste paths, parse error rendering, editable analysis confirmation, direction selection, mode/duration choice and outline confirmation.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @ai-interviewer/web test -- ResumePage.test.tsx PreparePage.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement resume and preparation pages**

Reuse labels and hierarchy from `prototype/`, add real loading/errors, disable duplicate submissions, show the one-time GLM disclosure next to the analyze action, and preserve selected configuration while navigating back.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @ai-interviewer/web test -- ResumePage.test.tsx PreparePage.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/features/resumes apps/web/src/features/interviews
git commit -m "feat(web): add resume and interview preparation flow"
```

### Task 12: Build interview room, WAV capture and report UI

**Files:**
- Create: `apps/web/src/features/interviews/wav-recorder.ts`
- Create: `apps/web/src/features/interviews/wav-recorder.test.ts`
- Create: `apps/web/src/features/interviews/InterviewRoomPage.tsx`
- Create: `apps/web/src/features/interviews/InterviewRoomPage.test.tsx`
- Create: `apps/web/src/features/reports/ReportPage.tsx`
- Create: `apps/web/src/features/reports/ReportPage.test.tsx`

- [ ] **Step 1: Write failing recording and mode tests**

Assert WAV header/sample format, 25-second chunking, microphone denial, manual start/stop, practice feedback display, mock feedback hiding, P05 confirmation and report rendering.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @ai-interviewer/web test -- wav-recorder.test.ts InterviewRoomPage.test.tsx ReportPage.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement WAV capture and room UI**

Use Web Audio API with one mono channel at 16 kHz, export PCM16 WAV chunks, stop tracks after each answer, upload chunks in order, play TTS from object URLs and revoke URLs after playback.

- [ ] **Step 4: Implement report and resume behavior**

Render eight dimensions, evidence, strengths, gaps and training plan from validated P10 data. On load, fetch the active interview and position the UI at the latest persisted turn.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @ai-interviewer/web test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/features/interviews apps/web/src/features/reports
git commit -m "feat(web): add voice interview room and reports"
```

### Task 13: Add full-system browser tests and documentation

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/mvp.spec.ts`
- Modify: `README.md`
- Modify: `docs/dev-standard.md`
- Create: `docs/mvp-verification.md`

- [ ] **Step 1: Write the end-to-end scenarios**

The test must start isolated server/web processes with a GLM stub, register a unique user, create and consent to a pasted resume, complete preparation, submit the synthetic WAV, verify practice feedback, finish, view report, reload and see persisted history. A second scenario verifies mock mode hides feedback.

- [ ] **Step 2: Run the browser test and confirm failure before wiring fixtures**

Run: `pnpm test:e2e`

Expected: FAIL until the isolated database/stub setup is complete.

- [ ] **Step 3: Wire deterministic test environment**

Use a dedicated `ai_interviewer_test` PostgreSQL database and local GLM stub. Never fall back from missing test configuration to a development or production database.

- [ ] **Step 4: Document setup and live smoke**

README must include PostgreSQL 17 setup, copying `.env.example` to `.env`, migration, dev start, normal verification commands, and opt-in `pnpm --filter @ai-interviewer/server test:live:glm`.

- [ ] **Step 5: Run the complete verification suite**

Run: `pnpm format:check`

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm test:e2e`

Expected: all commands exit 0.

- [ ] **Step 6: Audit tracked files for secrets and sensitive data**

Run: `git status --short && git diff --check && git grep -n -E "(GLM_API_KEY=.+|BEGIN (RSA |EC )?PRIVATE KEY|真实简历)" -- . ':!docs/superpowers/plans/2026-09-18-real-api-mvp.md'`

Expected: only `.idea/` remains untracked; secret scan has no matches.

- [ ] **Step 7: Commit**

```powershell
git add README.md docs apps/web/e2e apps/web/playwright.config.ts
git commit -m "test: verify complete MVP journey"
```

### Task 14: Run optional real GLM acceptance and final audit

**Files:**
- Modify only if verification exposes defects.

- [ ] **Step 1: Run live provider smoke when credentials exist**

Run: `pnpm --filter @ai-interviewer/server test:live:glm`

Expected with `GLM_API_KEY`: one text JSON result, one ASR transcript and one non-empty WAV response; PASS. Expected without key: explicit SKIP, not a false PASS.

- [ ] **Step 2: Run final Git and requirement audit**

Verify AC1—AC11 in `docs/dev-standard.md` against specific tests and record commands/results in `docs/mvp-verification.md`.

- [ ] **Step 3: Commit any verification-only fixes**

```powershell
git add apps packages schemas README.md docs
git commit -m "fix: resolve MVP acceptance findings"
```

- [ ] **Step 4: Confirm clean intended worktree**

Run: `git status --short --branch`

Expected: branch `dev-gpt`; only the pre-existing untracked `.idea/` may remain.
