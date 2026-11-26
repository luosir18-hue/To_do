import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Effort, Priority, Subtask } from "../shared/task.ts";

const subtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

const storedTask = z.looseObject({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  due_date: z.string().optional(),
  priority: z.unknown().optional(),
  effort: z.unknown().optional(),
  subtasks: z.array(subtaskSchema).optional(),
});

const taskList = z.array(storedTask);
export type StoredTask = z.infer<typeof storedTask>;

export interface TaskExtras {
  due_date?: string;
  priority?: Priority;
  effort?: Effort;
  subtasks?: Subtask[];
}

export interface TaskChanges {
  title?: string;
  done?: boolean;
  due_date?: string | null;
  priority?: Priority | null;
  effort?: Effort | null;
  subtasks?: Subtask[];
}

export interface TaskStore {
  list(): StoredTask[];
  create(title: string, extras?: TaskExtras): StoredTask;
  update(id: string, changes: TaskChanges): StoredTask | undefined;
  remove(id: string): boolean;
}

export function createJsonTaskStore(filename: string): TaskStore {
  function list(): StoredTask[] {
    if (!existsSync(filename)) return [];
    return taskList.parse(JSON.parse(readFileSync(filename, "utf8")));
  }

  // 同一服务进程内同步完成读写；替换文件前，原清单始终完整可读。
  function save(tasks: StoredTask[]) {
    mkdirSync(dirname(filename), { recursive: true });
    const temporary = filename + ".tmp";
    writeFileSync(temporary, JSON.stringify(tasks, null, 2) + "\n");
    renameSync(temporary, filename);
  }

  return {
    list,

    create(title, extras) {
      const task: StoredTask = { id: randomUUID(), title, done: false };
      if (extras?.due_date !== undefined) task.due_date = extras.due_date;
      if (extras?.priority !== undefined) task.priority = extras.priority;
      if (extras?.effort !== undefined) task.effort = extras.effort;
      if (extras?.subtasks !== undefined) task.subtasks = extras.subtasks;
      save([...list(), task]);
      return task;
    },

    update(id, changes) {
      const tasks = list();
      const task = tasks.find((item) => item.id === id);
      if (!task) return undefined;

      if (changes.title !== undefined) task.title = changes.title;
      if (changes.done !== undefined) task.done = changes.done;
      if (changes.due_date === null) delete task.due_date;
      else if (changes.due_date !== undefined) task.due_date = changes.due_date;
      if (changes.priority === null) delete task.priority;
      else if (changes.priority !== undefined) task.priority = changes.priority;
      if (changes.effort === null) delete task.effort;
      else if (changes.effort !== undefined) task.effort = changes.effort;
      if (changes.subtasks !== undefined) task.subtasks = changes.subtasks;

      save(tasks);
      return task;
    },

    remove(id) {
      const tasks = list();
      const remaining = tasks.filter((task) => task.id !== id);
      if (remaining.length === tasks.length) return false;

      save(remaining);
      return true;
    },
  };
}
