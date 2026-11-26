export type Priority = "low" | "medium" | "high";
export type Effort = "small" | "medium" | "large";

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  done: boolean;
  due_date?: string;
  priority?: Priority;
  effort?: Effort;
  subtasks?: Subtask[];
}
