import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { evaluationSchema } from '../src/schemas.js';

const outDir = join(process.cwd(), 'schemas');
mkdirSync(outDir, { recursive: true });

const p07 = zodToJsonSchema(evaluationSchema, { name: 'P07Evaluation', $refStrategy: 'none' });
writeFileSync(join(outDir, 'p07-evaluation.json'), JSON.stringify(p07, null, 2) + '\n');

console.log('已生成 schemas/（当前仅 P07；其余任务随 schema 收紧后加入）');