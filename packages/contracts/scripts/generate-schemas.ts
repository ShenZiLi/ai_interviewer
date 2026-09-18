import { mkdir, writeFile } from 'node:fs/promises';
await mkdir(new URL('../../../schemas/', import.meta.url), { recursive: true });
for (const code of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10']) {
  const schema =
    code === 'P07'
      ? { type: 'object', required: ['score', 'strengths', 'weaknesses', 'feedback'] }
      : { type: 'object', required: ['question', 'competency', 'difficulty'] };
  await writeFile(
    new URL(`../../../schemas/${code.toLowerCase()}.json`, import.meta.url),
    JSON.stringify(
      { $schema: 'https://json-schema.org/draft/2020-12/schema', title: code, ...schema },
      null,
      2,
    ),
  );
}
