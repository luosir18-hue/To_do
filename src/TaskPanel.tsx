import { useState } from "react";
import type { Effort, Priority, Task } from "../shared/task.ts";

type FilterTab = "all" | "pending" | "today" | "done";

interface TaskPanelProps {
  tasks: Task[];
  open: boolean;
  onClose: () => void;
  onToggleTask: (id: string, done: boolean) => void;
  onDeleteTask: (id: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string, done: boolean) => void;
  onQuickPrompt: (prompt: string) => void;
}

function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const PRIORITY_LABEL: Record<Priority, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

const EFFORT_LABEL: Record<Effort, string> = {
  small: "工作量·小",
  medium: "工作量·中",
  large: "工作量·大",
};

function formatDueLabel(dueDate: string, todayIso: string): { text: string; tone: string } {
  if (dueDate === todayIso) return { text: "今天到期", tone: "today" };
  if (dueDate < todayIso) return { text: `已逾期 ${dueDate.slice(5)}`, tone: "overdue" };
  return { text: dueDate.slice(5), tone: "upcoming" };
}

export function TaskPanel({
  tasks,
  open,
  onClose,
  onToggleTask,
  onDeleteTask,
  onToggleSubtask,
  onQuickPrompt,
}: TaskPanelProps) {
  const [filter, setFilter] = useState<FilterTab>("all");
  const todayIso = getTodayIso();

  const pendingCount = tasks.filter((t) => !t.done).length;
  const doneCount = tasks.length - pendingCount;
  const todayCount = tasks.filter((t) => !t.done && t.due_date === todayIso).length;

  const filteredTasks = tasks.filter((task) => {
    if (filter === "pending") return !task.done;
    if (filter === "done") return task.done;
    if (filter === "today") return task.due_date === todayIso;
    return true;
  });

  // 待办排在前面，已完成排在后面
  const sortedTasks = [...filteredTasks].sort((a, b) => Number(a.done) - Number(b.done));

  return (
    <aside
      className={`task-panel ${open ? "open" : "collapsed"}`}
      aria-label="实时待办清单"
      aria-hidden={!open}
    >
      <div className="panel-inner">
        <div className="panel-header">
          <div>
            <h2>待办清单</h2>
            <p className="panel-stats">
              {pendingCount} 项待办 · {doneCount} 项已完成
              {todayCount > 0 ? ` · ${todayCount} 项今日到期` : ""}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="收起清单面板"
            title="收起面板"
          >
            »
          </button>
        </div>

      <div className="panel-tabs" role="tablist" aria-label="任务筛选">
        {(
          [
            ["all", `全部 (${tasks.length})`],
            ["pending", `待办 (${pendingCount})`],
            ["today", `今日到期 (${todayCount})`],
            ["done", `已完成 (${doneCount})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={`tab-btn ${filter === key ? "active" : ""}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="task-list">
        {sortedTasks.length === 0 ? (
          <div className="task-empty">
            <p>
              {filter === "today"
                ? "今天没有到期的任务"
                : filter === "done"
                  ? "还没有已完成的任务"
                  : "清单还是空的"}
            </p>
            <button
              type="button"
              className="ghost-action"
              onClick={() => onQuickPrompt("帮我记一下买牛奶，高优先级，工作量小，今天到期")}
            >
              + 试试让 To Do Agent 记一条
            </button>
          </div>
        ) : (
          sortedTasks.map((task) => {
            const subtasks = task.subtasks ?? [];
            const doneSubCount = subtasks.filter((s) => s.done).length;
            const dueInfo = task.due_date ? formatDueLabel(task.due_date, todayIso) : null;

            return (
              <div key={task.id} className={`task-card ${task.done ? "done" : ""}`}>
                <div className="task-row">
                  <button
                    type="button"
                    className={`checkbox ${task.done ? "checked" : ""}`}
                    onClick={() => onToggleTask(task.id, !task.done)}
                    aria-label={task.done ? `将「${task.title}」标为待办` : `完成「${task.title}」`}
                  >
                    {task.done && <span aria-hidden="true">✓</span>}
                  </button>

                  <div className="task-body">
                    <span className="task-title">{task.title}</span>

                    {(task.priority || task.effort || dueInfo || subtasks.length > 0) && (
                      <div className="task-badges">
                        {task.priority && (
                          <span className={`badge priority-${task.priority}`}>
                            {PRIORITY_LABEL[task.priority]}
                          </span>
                        )}
                        {task.effort && (
                          <span className="badge effort">{EFFORT_LABEL[task.effort]}</span>
                        )}
                        {dueInfo && (
                          <span className={`badge due-${dueInfo.tone}`}>📅 {dueInfo.text}</span>
                        )}
                        {subtasks.length > 0 && (
                          <span className="badge subtask-progress">
                            子任务 {doneSubCount}/{subtasks.length}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="delete-btn"
                    onClick={() => onDeleteTask(task.id)}
                    aria-label={`删除「${task.title}」`}
                    title="删除任务"
                  >
                    ×
                  </button>
                </div>

                {subtasks.length > 0 && (
                  <ul className="subtask-list">
                    {subtasks.map((sub) => (
                      <li key={sub.id} className={sub.done ? "done" : ""}>
                        <button
                          type="button"
                          className={`checkbox small ${sub.done ? "checked" : ""}`}
                          onClick={() => onToggleSubtask(task.id, sub.id, !sub.done)}
                          aria-label={sub.done ? `取消完成子任务「${sub.title}」` : `完成子任务「${sub.title}」`}
                        >
                          {sub.done && <span aria-hidden="true">✓</span>}
                        </button>
                        <span>{sub.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
        </div>
      </div>
    </aside>
  );
}
