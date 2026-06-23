/**
 * SessionTaskManager - 会话任务管理器
 *
 * 职责：
 * 1. 为每个 sessionId 独立维护任务执行状态（ActiveRun）
 * 2. 支持多个会话同时运行任务
 * 3. 提供任务状态查询接口，用于 UI 显示转圈图标
 * 4. 确保切换会话时任务不被中断
 */

interface ActiveRun {
  id: string;
  controller: AbortController;
  startedAt: number;
}

class SessionTaskManager {
  private activeTasks = new Map<string, ActiveRun>();
  private listeners = new Set<() => void>();

  /**
   * 为指定会话创建新任务
   */
  createTask(sessionId: string): ActiveRun {
    // 如果该会话已有运行中的任务，先中止它
    const existingTask = this.activeTasks.get(sessionId);
    if (existingTask) {
      existingTask.controller.abort();
    }

    const task: ActiveRun = {
      id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      controller: new AbortController(),
      startedAt: Date.now()
    };

    this.activeTasks.set(sessionId, task);
    this.notifyListeners();
    return task;
  }

  /**
   * 获取指定会话的活动任务
   */
  getTask(sessionId: string): ActiveRun | null {
    return this.activeTasks.get(sessionId) ?? null;
  }

  /**
   * 检查指定任务是否仍然是该会话的当前任务
   */
  isCurrentTask(sessionId: string, taskId: string): boolean {
    const activeTask = this.activeTasks.get(sessionId);
    return activeTask?.id === taskId && !activeTask.controller.signal.aborted;
  }

  /**
   * 中止指定会话的任务
   */
  cancelTask(sessionId: string): boolean {
    const task = this.activeTasks.get(sessionId);
    if (!task) return false;

    task.controller.abort();
    this.activeTasks.delete(sessionId);
    this.notifyListeners();
    return true;
  }

  /**
   * 完成指定会话的任务（正常结束）
   */
  completeTask(sessionId: string, taskId: string): void {
    const task = this.activeTasks.get(sessionId);
    if (task?.id === taskId) {
      this.activeTasks.delete(sessionId);
      this.notifyListeners();
    }
  }

  /**
   * 检查指定会话是否有运行中的任务
   */
  hasActiveTask(sessionId: string): boolean {
    const task = this.activeTasks.get(sessionId);
    return task !== undefined && !task.controller.signal.aborted;
  }

  /**
   * 获取所有有活动任务的会话 ID 列表
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.activeTasks.keys()).filter((sessionId) => {
      const task = this.activeTasks.get(sessionId);
      return task && !task.controller.signal.aborted;
    });
  }

  /**
   * 订阅任务状态变化
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * 清理所有任务（用于应用退出时）
   */
  dispose(): void {
    this.activeTasks.forEach((task) => task.controller.abort());
    this.activeTasks.clear();
    this.listeners.clear();
  }
}

// 全局单例
export const sessionTaskManager = new SessionTaskManager();
