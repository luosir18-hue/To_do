import type { Task } from "../shared/task.ts";

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch("/api/tasks");
  if (!res.ok) throw new Error("获取任务列表失败");
  return res.json() as Promise<Task[]>;
}

export async function toggleTaskDone(id: string, done: boolean): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  if (!res.ok) throw new Error("更新任务状态失败");
  return res.json() as Promise<Task>;
}

export async function deleteTaskById(id: string): Promise<void> {
  const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除任务失败");
}

export async function toggleSubtaskDone(
  taskId: string,
  subtaskId: string,
  done: boolean,
): Promise<Task> {
  const res = await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  if (!res.ok) throw new Error("更新子任务失败");
  return res.json() as Promise<Task>;
}
