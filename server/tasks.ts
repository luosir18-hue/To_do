import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { TaskStore } from "./task-store.ts";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const prioritySchema = z.enum(["low", "medium", "high"]);
const effortSchema = z.enum(["small", "medium", "large"]);

const subtaskSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  done: z.boolean(),
});

const createTaskSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  due_date: z.string().regex(dateRegex).optional(),
  priority: prioritySchema.optional(),
  effort: effortSchema.optional(),
  subtasks: z.array(subtaskSchema).optional(),
});

const updateTaskSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    done: z.boolean().optional(),
    due_date: z.string().regex(dateRegex).nullable().optional(),
    priority: prioritySchema.nullable().optional(),
    effort: effortSchema.nullable().optional(),
    subtasks: z.array(subtaskSchema).optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0);

const createSubtaskSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
});

const updateSubtaskSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    done: z.boolean().optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0);

const taskNotFound = { error: "找不到这条任务。" };
const subtaskNotFound = { error: "找不到这条子任务。" };

export function taskRouter(tasks: TaskStore) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(tasks.list());
  });

  router.post("/", (req, res) => {
    const input = createTaskSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: "请提供 1 至 200 个字符的任务标题。" });
    }
    const { title, due_date, priority, effort, subtasks } = input.data;
    res.status(201).json(tasks.create(title, { due_date, priority, effort, subtasks }));
  });

  router.patch("/:id", (req, res) => {
    const input = updateTaskSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: "请提供有效的任务更新字段。" });
    }

    const updated = tasks.update(req.params.id, input.data);
    if (!updated) return res.status(404).json(taskNotFound);
    res.json(updated);
  });

  router.delete("/:id", (req, res) => {
    if (!tasks.remove(req.params.id)) return res.status(404).json(taskNotFound);
    res.sendStatus(204);
  });

  // ─── 子任务接口 ────────────────────────────────────────────────────────────

  router.post("/:id/subtasks", (req, res) => {
    const input = createSubtaskSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: "请提供 1 至 200 个字符的子任务标题。" });
    }

    const task = tasks.list().find((item) => item.id === req.params.id);
    if (!task) return res.status(404).json(taskNotFound);

    const subtask = { id: randomUUID(), title: input.data.title, done: false };
    const updated = tasks.update(task.id, {
      subtasks: [...(task.subtasks ?? []), subtask],
    });
    res.status(201).json(updated);
  });

  router.patch("/:id/subtasks/:subId", (req, res) => {
    const input = updateSubtaskSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: "请提供有效的 title 或 done 字段。" });
    }

    const task = tasks.list().find((item) => item.id === req.params.id);
    if (!task) return res.status(404).json(taskNotFound);

    const subtasks = task.subtasks ?? [];
    const index = subtasks.findIndex((sub) => sub.id === req.params.subId);
    if (index === -1) return res.status(404).json(subtaskNotFound);

    const nextSubtasks = subtasks.map((sub, i) =>
      i === index ? { ...sub, ...input.data } : sub,
    );
    const updated = tasks.update(task.id, { subtasks: nextSubtasks });
    res.json(updated);
  });

  router.delete("/:id/subtasks/:subId", (req, res) => {
    const task = tasks.list().find((item) => item.id === req.params.id);
    if (!task) return res.status(404).json(taskNotFound);

    const subtasks = task.subtasks ?? [];
    const remaining = subtasks.filter((sub) => sub.id !== req.params.subId);
    if (remaining.length === subtasks.length) {
      return res.status(404).json(subtaskNotFound);
    }

    const updated = tasks.update(task.id, { subtasks: remaining });
    res.json(updated);
  });

  return router;
}
