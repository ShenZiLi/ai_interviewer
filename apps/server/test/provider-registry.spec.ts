import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../src/ai/provider-registry.js';

const configFile = join(tmpdir(), `ai-interviewer-model-${Date.now()}.json`);
afterEach(() => { if (existsSync(configFile)) rmSync(configFile, { force: true }); });

describe('ProviderRegistry 运行期热切换', () => {
  it('无 env 时默认 mock', () => {
    const r = new ProviderRegistry();
    expect(r.status().mode).toBe('mock');
  });

  it('切换到自定义 API 后 status 反映 baseUrl/model', () => {
    const r = new ProviderRegistry();
    const st = r.setConfig({ mode: 'custom', baseUrl: 'https://api.x/v1', model: 'glm-4-flash', apiKey: 'k' });
    expect(st).toMatchObject({ mode: 'custom', baseUrl: 'https://api.x/v1', model: 'glm-4-flash' });
    expect(r.status()).toEqual(st);
  });

  it('切回平台默认（无 env 时回落 mock）', () => {
    const r = new ProviderRegistry();
    r.setConfig({ mode: 'custom', baseUrl: 'http://x', model: 'm' });
    r.setConfig({ mode: 'platform' });
    expect(r.status().mode).toBe('mock');
  });

  it('custom 缺少 baseUrl/model 抛错并保持现状', () => {
    const r = new ProviderRegistry();
    expect(() => r.setConfig({ mode: 'custom', model: 'm' })).toThrow();
    expect(() => r.setConfig({ mode: 'custom', baseUrl: 'http://x' })).toThrow();
  });

  it('自定义模型配置会在新实例（模拟重启）中恢复，且状态不回显密钥', () => {
    const first = new ProviderRegistry(configFile);
    first.setConfig({ mode: 'custom', baseUrl: 'https://api.example/v1', model: 'model-a', apiKey: 'secret-key' });

    const restarted = new ProviderRegistry(configFile);
    expect(restarted.status()).toEqual({ mode: 'custom', baseUrl: 'https://api.example/v1', model: 'model-a' });
    expect(JSON.stringify(restarted.status())).not.toContain('secret-key');
  });
});
