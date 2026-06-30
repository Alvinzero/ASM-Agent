import { describe, expect, it } from 'vitest';
import { AgentService } from '../../src/shared/agent/AgentService';
import { completeOpenAiCompatibleChat, DisabledModelAdapter, OpenAiCompatibleModelAdapter } from '../../src/shared/agent/ModelAdapter';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

const repository = new BuiltInSpecRepository();

describe('AgentService', () => {
  it('creates a Timer0 interrupt plan that toggles PA0 with only built-in registers', async () => {
    const service = new AgentService(repository);
    const spec = repository.getByChipId('HK64S8x');
    const registerNames = new Set(spec.registers.map((register) => register.name));

    const result = await service.createPlan({
      chipId: 'HK64S8x',
      requirement: '生成 Timer0 中断翻转 PA0 的 GPIO ASM 工程'
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected ready plan');

    expect(result.plan.chipId).toBe('HK64S8x');
    expect(result.plan.files).toEqual(
      expect.arrayContaining([
        'startup/reset.asm',
        'startup/interrupt.asm',
        'src/main.asm',
        'src/gpio.asm',
        'src/timer0.asm',
        'include/registers.inc',
        'docs/spec-compliance.md'
      ])
    );
    expect(result.plan.features).toEqual(expect.arrayContaining(['Timer0', 'GPIO', 'Interrupt']));
    expect(result.plan.usesInterrupt).toBe(true);
    expect(result.plan.requiredRegisters).toEqual(expect.arrayContaining(['T0_PS', 'PA_PIO']));
    expect(result.plan.requiredRegisters.every((register) => registerNames.has(register))).toBe(true);
  });

  it('asks for timing inputs when precise 1ms Timer0 planning lacks clock and prescaler details', async () => {
    const service = new AgentService(repository);

    const result = await service.createPlan({
      chipId: 'HK64S8x',
      requirement: '精确 1ms Timer0 中断工程'
    });

    expect(result.status).toBe('needsInput');
    if (result.status !== 'needsInput') throw new Error('Expected needsInput');
    expect(result.questions.some((question) => /时钟源|分频/.test(question))).toBe(true);
  });

  it('does not block precise Timer0 planning when clock source and prescaler are provided', async () => {
    const service = new AgentService(repository);

    const result = await service.createPlan({
      chipId: 'HK64S8x',
      requirement: '使用 4MHz OSC 时钟源和 1:64 分频生成精确 1ms Timer0 中断翻转 PA0 工程'
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected ready plan');
    expect(result.plan.features).toEqual(expect.arrayContaining(['Timer0', 'GPIO', 'Interrupt']));
  });

  it('does not infer GPIO from io substrings in English Timer0 requirements', async () => {
    const service = new AgentService(repository);

    const result = await service.createPlan({
      chipId: 'HK64S8x',
      requirement: 'precision Timer0 interrupt with OSC clock and 1:64 prescaler'
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected ready plan');
    expect(result.plan.features).not.toContain('GPIO');
    expect(result.plan.requiredRegisters).not.toContain('PA_PIO');
  });

  it('does not infer GPIO from io substrings in English WDT requirements', async () => {
    const service = new AgentService(repository);

    const result = await service.createPlan({
      chipId: 'HK64S8x',
      requirement: 'periodic WDT clear'
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected ready plan');
    expect(result.plan.features).toContain('WDT');
    expect(result.plan.features).not.toContain('GPIO');
  });

  it('asks for timing inputs for Chinese millisecond Timer0 requirements without clock and prescaler', async () => {
    const service = new AgentService(repository);

    const result = await service.createPlan({
      chipId: 'HK64S8x',
      requirement: '1毫秒 Timer0 中断工程'
    });

    expect(result.status).toBe('needsInput');
    if (result.status !== 'needsInput') throw new Error('Expected needsInput');
    expect(result.questions.some((question) => /时钟源|分频/.test(question))).toBe(true);
  });

  it('asks for timing inputs for target-frequency Timer0 requirements without clock and prescaler', async () => {
    const service = new AgentService(repository);

    const result = await service.createPlan({
      chipId: 'HK64S8x',
      requirement: '1Hz Timer0 中断工程'
    });

    expect(result.status).toBe('needsInput');
    if (result.status !== 'needsInput') throw new Error('Expected needsInput');
    expect(result.questions.some((question) => /时钟源|分频/.test(question))).toBe(true);
  });

  it('asks for timing inputs for precision Timer0 requirements without clock and prescaler', async () => {
    const service = new AgentService(repository);

    const result = await service.createPlan({
      chipId: 'HK64S8x',
      requirement: 'precision Timer0 interrupt'
    });

    expect(result.status).toBe('needsInput');
    if (result.status !== 'needsInput') throw new Error('Expected needsInput');
    expect(result.questions.some((question) => /时钟源|分频/.test(question))).toBe(true);
  });

  it('requires prescaler details even when a precise Timer0 request includes an OSC clock', async () => {
    const service = new AgentService(repository);

    const result = await service.createPlan({
      chipId: 'HK64S8x',
      requirement: '使用 4MHz OSC 生成精确 1ms Timer0 中断工程'
    });

    expect(result.status).toBe('needsInput');
    if (result.status !== 'needsInput') throw new Error('Expected needsInput');
    expect(result.questions.some((question) => /时钟源|分频/.test(question))).toBe(true);
  });

  it('recognizes WDT requirements with real built-in WDT registers', async () => {
    const service = new AgentService(repository);
    const spec = repository.getByChipId('HK64S8x');
    const registerNames = new Set(spec.registers.map((register) => register.name));

    const result = await service.createPlan({
      chipId: 'HK64S8x',
      requirement: '生成启用 WDT 看门狗并定期清狗的 ASM 工程'
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected ready plan');
    expect(result.plan.features).toContain('WDT');
    expect(result.plan.requiredRegisters).toEqual(expect.arrayContaining(['WDT_PS']));
    expect(result.plan.requiredRegisters.every((register) => registerNames.has(register))).toBe(true);
    expect(result.plan.assumptions.join('\n')).toMatch(/内置规范|HK64S8x/);
  });

  it('asks for a target function when the requirement is empty or too short', async () => {
    const service = new AgentService(repository);

    await expect(
      service.createPlan({ chipId: 'HK64S8x', requirement: '  ' })
    ).resolves.toMatchObject({
      status: 'needsInput',
      questions: [expect.stringMatching(/目标功能|需求/)]
    });

    await expect(
      service.createPlan({ chipId: 'HK64S8x', requirement: '做' })
    ).resolves.toMatchObject({
      status: 'needsInput',
      questions: [expect.stringMatching(/目标功能|需求/)]
    });
  });

  it('surfaces unsupported chip errors from the built-in spec repository', async () => {
    const service = new AgentService(repository);

    await expect(
      service.createPlan({ chipId: 'UNKNOWN_CHIP', requirement: '生成 Timer0 工程' })
    ).rejects.toThrow('Unsupported chip platform: UNKNOWN_CHIP');
  });
});

describe('DisabledModelAdapter', () => {
  it('rejects completion because local model integration is disabled in the MVP', async () => {
    const adapter = new DisabledModelAdapter();

    await expect(adapter.complete({ system: 'system', user: 'user' })).rejects.toThrow(
      'Local model adapter is not configured in this MVP build.'
    );
  });
});

describe('OpenAiCompatibleModelAdapter', () => {
  it('posts OpenAI-compatible chat completions and returns the first assistant message', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '模型回答' } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    const adapter = new OpenAiCompatibleModelAdapter(
      {
        provider: 'custom',
        label: '自定义模型',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat'
      },
      fetchImpl
    );

    await expect(adapter.complete({ system: '系统提示', user: '用户问题' })).resolves.toBe('模型回答');
    expect(capturedUrl).toBe('https://api.example.com/v1/chat/completions');
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer sk-test-key',
      'Content-Type': 'application/json'
    });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: 'custom-chat',
      messages: [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '用户问题' }
      ]
    });
  });

  it('posts recent conversation messages when a complete chat request includes memory context', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'model answer with memory' } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await expect(
      completeOpenAiCompatibleChat(
        {
          provider: 'custom',
          label: 'Custom model',
          apiKey: 'sk-test-key',
          baseUrl: 'https://api.example.com/v1',
          modelId: 'custom-chat',
          systemPrompt: 'System prompt',
          prompt: 'What is my name?',
          messages: [
            { role: 'user', content: 'My name is Zhang San.' },
            { role: 'assistant', content: 'I will remember it.' },
            { role: 'user', content: 'What is my name?' }
          ]
        },
        fetchImpl
      )
    ).resolves.toBe('model answer with memory');

    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: 'custom-chat',
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'My name is Zhang San.' },
        { role: 'assistant', content: 'I will remember it.' },
        { role: 'user', content: 'What is my name?' }
      ]
    });
  });

  it('surfaces OpenAI-compatible API errors with provider context', async () => {
    const fetchImpl = async () =>
      new Response('invalid api key', {
        status: 401,
        statusText: 'Unauthorized'
      });
    const adapter = new OpenAiCompatibleModelAdapter(
      {
        provider: 'deepseek',
        label: 'DeepSeek',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.deepseek.com/v1',
        modelId: 'deepseek-chat'
      },
      fetchImpl
    );

    await expect(adapter.complete({ system: 'system', user: 'user' })).rejects.toThrow(
      'DeepSeek API 请求失败：HTTP 401，invalid api key'
    );
  });

  it('reports a clear configuration hint when the API endpoint returns an HTML page', async () => {
    const fetchImpl = async () =>
      new Response('<!doctype html><html><body>console login</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    const adapter = new OpenAiCompatibleModelAdapter(
      {
        provider: 'custom',
        label: '自定义模型',
        apiKey: 'sk-test-key',
        baseUrl: 'https://example.com',
        modelId: 'custom-chat'
      },
      fetchImpl
    );

    await expect(adapter.complete({ system: 'system', user: 'user' })).rejects.toThrow(
      '自定义模型 API 返回的不是 JSON，而是 HTML 页面。请检查 Base URL 是否为 OpenAI 兼容接口地址'
    );
  });
});
