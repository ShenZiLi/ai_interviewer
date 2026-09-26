import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { taskSchemas, type TaskCode } from '../src/index.js';

const outDir = join(process.cwd(), 'schemas');
mkdirSync(outDir, { recursive: true });

const order: TaskCode[] = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10'];
for (const code of order) {
  const json = zodToJsonSchema(taskSchemas[code], { name: `${code}Output`, $refStrategy: 'none' });
  writeFileSync(join(outDir, `${code.toLowerCase()}-output.json`), JSON.stringify(json, null, 2) + '\n');
}

console.log(`已生成 schemas/（${order.length} 个任务输出）`);