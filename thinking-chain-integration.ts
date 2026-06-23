// ============================================
// 1. Agent 核心 - 流式执行引擎
// ============================================

import Anthropic from '@anthropic-ai/sdk';

export class ThinkingChainAgent {
  private anthropic: Anthropic;
  private eventEmitter: EventEmitter;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.eventEmitter = new EventEmitter();
  }

  // 核心方法：执行任务并实时推送状态
  async executeTask(userPrompt: string) {
    try {
      // 发送任务开始事件
      this.emit('task:start', { prompt: userPrompt });

      const messages = [
        {
          role: 'user',
          content: userPrompt
        }
      ];

      // 启用流式响应和思维模式
      const stream = await this.anthropic.messages.stream({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8000,
        messages,
        // 关键：启用思维模式
        thinking: {
          type: 'enabled',
          budget_tokens: 5000
        },
        // 工具定义
        tools: [
          {
            name: 'read_file',
            description: '读取文件内容',
            input_schema: {
              type: 'object',
              properties: {
                file_path: { type: 'string' }
              },
              required: ['file_path']
            }
          },
          {
            name: 'edit_file',
            description: '编辑文件',
            input_schema: {
              type: 'object',
              properties: {
                file_path: { type: 'string' },
                old_string: { type: 'string' },
                new_string: { type: 'string' }
              },
              required: ['file_path', 'old_string', 'new_string']
            }
          },
          {
            name: 'grep',
            description: '搜索代码',
            input_schema: {
              type: 'object',
              properties: {
                pattern: { type: 'string' }
              },
              required: ['pattern']
            }
          },
          {
            name: 'bash',
            description: '执行命令',
            input_schema: {
              type: 'object',
              properties: {
                command: { type: 'string' }
              },
              required: ['command']
            }
          }
        ],
        stream: true
      });

      // 处理流式响应
      for await (const event of stream) {
        await this.handleStreamEvent(event);
      }

      // 任务完成
      this.emit('task:complete', { success: true });

    } catch (error) {
      this.emit('task:error', { error: error.message });
      throw error;
    }
  }

  // 处理流式事件
  private async handleStreamEvent(event: any) {
    switch (event.type) {
      case 'content_block_start':
        if (event.content_block.type === 'thinking') {
          this.emit('thinking:start', {});
        } else if (event.content_block.type === 'text') {
          this.emit('text:start', {});
        } else if (event.content_block.type === 'tool_use') {
          this.emit('tool:start', {
            id: event.content_block.id,
            tool: event.content_block.name,
            args: event.content_block.input
          });
        }
        break;

      case 'content_block_delta':
        if (event.delta.type === 'thinking_delta') {
          // 实时推送思考内容
          this.emit('thinking:delta', {
            text: event.delta.thinking
          });
        } else if (event.delta.type === 'text_delta') {
          // 实时推送输出内容
          this.emit('text:delta', {
            text: event.delta.text
          });
        } else if (event.delta.type === 'input_json_delta') {
          // 工具参数增量更新
          this.emit('tool:input_delta', {
            partial_json: event.delta.partial_json
          });
        }
        break;

      case 'content_block_stop':
        if (event.content_block?.type === 'tool_use') {
          // 工具参数接收完整，开始执行
          const result = await this.executeTool(
            event.content_block.name,
            event.content_block.input
          );

          this.emit('tool:complete', {
            id: event.content_block.id,
            tool: event.content_block.name,
            result
          });
        }
        break;
    }
  }

  // 执行工具调用
  private async executeTool(toolName: string, args: any): Promise<string> {
    this.emit('tool:executing', { tool: toolName, args });

    try {
      let result: string;

      switch (toolName) {
        case 'read_file':
          result = await this.readFile(args.file_path);
          break;
        case 'edit_file':
          result = await this.editFile(args.file_path, args.old_string, args.new_string);
          break;
        case 'grep':
          result = await this.grep(args.pattern);
          break;
        case 'bash':
          result = await this.bash(args.command);
          break;
        default:
          result = `Unknown tool: ${toolName}`;
      }

      return result;
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  // 工具实现（简化版）
  private async readFile(filePath: string): Promise<string> {
    const fs = require('fs').promises;
    const content = await fs.readFile(filePath, 'utf-8');
    return `Read ${content.split('\n').length} lines from ${filePath}`;
  }

  private async editFile(filePath: string, oldStr: string, newStr: string): Promise<string> {
    const fs = require('fs').promises;
    let content = await fs.readFile(filePath, 'utf-8');
    content = content.replace(oldStr, newStr);
    await fs.writeFile(filePath, content);
    return `Successfully edited ${filePath}`;
  }

  private async grep(pattern: string): Promise<string> {
    const { execSync } = require('child_process');
    const result = execSync(`rg -n "${pattern}"`, { encoding: 'utf-8' });
    return result;
  }

  private async bash(command: string): Promise<string> {
    const { execSync } = require('child_process');
    const result = execSync(command, { encoding: 'utf-8' });
    return result;
  }

  // 事件订阅接口
  on(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.on(event, listener);
  }

  private emit(event: string, data: any) {
    this.eventEmitter.emit(event, data);
  }
}

// ============================================
// 2. Electron Main Process - IPC 桥接
// ============================================

import { ipcMain, BrowserWindow } from 'electron';

export function setupAgentIPC(mainWindow: BrowserWindow) {
  const agent = new ThinkingChainAgent();

  // 监听来自渲染进程的任务请求
  ipcMain.handle('agent:execute', async (event, userPrompt: string) => {
    // 将所有 Agent 事件转发到渲染进程
    const forwardEvent = (eventName: string, data: any) => {
      mainWindow.webContents.send('agent:event', {
        type: eventName,
        data,
        timestamp: Date.now()
      });
    };

    agent.on('task:start', data => forwardEvent('task:start', data));
    agent.on('thinking:start', data => forwardEvent('thinking:start', data));
    agent.on('thinking:delta', data => forwardEvent('thinking:delta', data));
    agent.on('text:delta', data => forwardEvent('text:delta', data));
    agent.on('tool:start', data => forwardEvent('tool:start', data));
    agent.on('tool:executing', data => forwardEvent('tool:executing', data));
    agent.on('tool:complete', data => forwardEvent('tool:complete', data));
    agent.on('task:complete', data => forwardEvent('task:complete', data));
    agent.on('task:error', data => forwardEvent('task:error', data));

    // 开始执行
    try {
      await agent.executeTask(userPrompt);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

// ============================================
// 3. React 组件 - UI 展示层
// ============================================

import React, { useState, useEffect, useRef } from 'react';
import { Loader2, CheckCircle, ChevronDown } from 'lucide-react';

interface AgentEvent {
  type: string;
  data: any;
  timestamp: number;
}

interface ToolStep {
  id: string;
  tool: string;
  description: string;
  status: 'running' | 'done';
  result?: string;
  timestamp: number;
}

export function ThinkingChainWorkspace() {
  const [isRunning, setIsRunning] = useState(false);
  const [thinkingText, setThinkingText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [steps, setSteps] = useState<ToolStep[]>([]);
  const [stepsExpanded, setStepsExpanded] = useState(true);
  const [userPrompt, setUserPrompt] = useState('');

  useEffect(() => {
    // 监听来自主进程的事件
    window.electronAPI.onAgentEvent((event: AgentEvent) => {
      handleAgentEvent(event);
    });

    return () => {
      window.electronAPI.removeAgentListener();
    };
  }, []);

  const handleAgentEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'task:start':
        setIsRunning(true);
        setThinkingText('');
        setOutputText('');
        setSteps([]);
        break;

      case 'thinking:delta':
        setThinkingText(prev => prev + event.data.text);
        break;

      case 'text:delta':
        setOutputText(prev => prev + event.data.text);
        break;

      case 'tool:start':
        const newStep: ToolStep = {
          id: event.data.id,
          tool: event.data.tool,
          description: formatToolDescription(event.data.tool, event.data.args),
          status: 'running',
          timestamp: event.timestamp
        };
        setSteps(prev => [...prev, newStep]);
        break;

      case 'tool:complete':
        setSteps(prev =>
          prev.map(step =>
            step.id === event.data.id
              ? { ...step, status: 'done', result: event.data.result }
              : step
          )
        );
        break;

      case 'task:complete':
        setIsRunning(false);
        break;

      case 'task:error':
        setIsRunning(false);
        alert(`错误: ${event.data.error}`);
        break;
    }
  };

  const formatToolDescription = (tool: string, args: any): string => {
    switch (tool) {
      case 'read_file':
        return `读取文件: ${args.file_path}`;
      case 'edit_file':
        return `编辑文件: ${args.file_path}`;
      case 'grep':
        return `搜索代码: ${args.pattern}`;
      case 'bash':
        return `执行命令: ${args.command}`;
      default:
        return tool;
    }
  };

  const executeTask = async () => {
    if (!userPrompt.trim()) return;
    await window.electronAPI.executeAgent(userPrompt);
  };

  return (
    <div className="workspace">
      {/* 输入区 */}
      <div className="input-section">
        <textarea
          value={userPrompt}
          onChange={e => setUserPrompt(e.target.value)}
          placeholder="输入你的任务，比如：修复 model-picker 组件的下拉菜单样式问题"
          disabled={isRunning}
          rows={3}
        />
        <button
          onClick={executeTask}
          disabled={isRunning || !userPrompt.trim()}
          className="execute-btn"
        >
          {isRunning ? (
            <>
              <Loader2 className="spinning" size={16} />
              执行中...
            </>
          ) : (
            '开始执行'
          )}
        </button>
      </div>

      {/* 任务状态 */}
      {isRunning && (
        <div className="task-status">
          <Loader2 className="spinning" size={20} />
          <span>正在处理任务...</span>
        </div>
      )}

      {/* 思考过程 */}
      {thinkingText && (
        <div className="thinking-section">
          <div className="section-label">💭 思考过程</div>
          <div className="thinking-content">
            {thinkingText}
            {isRunning && <span className="cursor">|</span>}
          </div>
        </div>
      )}

      {/* 工具执行步骤 */}
      {steps.length > 0 && (
        <div className="steps-section">
          <div
            className="steps-header"
            onClick={() => setStepsExpanded(!stepsExpanded)}
          >
            <span>📋 已执行 {steps.length} 个操作</span>
            <ChevronDown
              size={20}
              style={{
                transform: stepsExpanded ? 'rotate(180deg)' : 'rotate(0)',
                transition: 'transform 0.2s'
              }}
            />
          </div>

          {stepsExpanded && (
            <div className="steps-list">
              {steps.map(step => (
                <div key={step.id} className={`step-item ${step.status}`}>
                  <div className="step-icon">
                    {step.status === 'done' ? (
                      <CheckCircle size={18} color="#10b981" />
                    ) : (
                      <Loader2 size={18} className="spinning" />
                    )}
                  </div>
                  <div className="step-content">
                    <div className="step-tool">{step.tool}</div>
                    <div className="step-description">{step.description}</div>
                    {step.result && (
                      <div className="step-result">→ {step.result}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 最终输出 */}
      {outputText && (
        <div className="output-section">
          <div className="section-label">📄 输出结果</div>
          <div className="output-content">{outputText}</div>
        </div>
      )}
    </div>
  );
}

// ============================================
// 4. Electron Preload - 安全通信层
// ============================================

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 执行 Agent 任务
  executeAgent: (prompt: string) => {
    return ipcRenderer.invoke('agent:execute', prompt);
  },

  // 监听 Agent 事件
  onAgentEvent: (callback: (event: any) => void) => {
    ipcRenderer.on('agent:event', (_, event) => callback(event));
  },

  // 移除监听器
  removeAgentListener: () => {
    ipcRenderer.removeAllListeners('agent:event');
  }
});
