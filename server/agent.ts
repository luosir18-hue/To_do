import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import type { ChatMessage } from "../shared/chat.ts";
import { getModelClient, model } from "./model.ts";

export type { ChatMessage } from "../shared/chat.ts";

// 内部调用 Task API 时使用的基础地址（和服务自身同一进程）
const BASE_URL = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

/** 防止模型陷入工具调用死循环 */
const MAX_TOOL_CALLS = 12;

// ─── 工具定义 ────────────────────────────────────────────────────────────────

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "列出所有任务（包括待办、已完成以及子任务），返回任务数组，每条包含 id、title、done，以及可选的 due_date、priority、effort、subtasks 字段。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "创建一条新待办任务，可选设置截止日期、优先级、工作量和初始子任务。",
      parameters: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", description: "任务标题，1 到 200 个字符" },
          due_date: {
            type: "string",
            description:
              "截止日期，ISO 格式 YYYY-MM-DD。用户说「今天」「明天」时请根据当前日期推算。",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "优先级：low 低 / medium 中 / high 高",
          },
          effort: {
            type: "string",
            enum: ["small", "medium", "large"],
            description: "工作量：small 小 / medium 中 / large 大",
          },
          subtasks: {
            type: "array",
            items: { type: "string" },
            description: "可选的子任务标题列表，例如 [\"订车票\", \"收拾行李\"]",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "把指定任务标记为已完成（done: true）。",
      parameters: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "任务的 UUID" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "uncomplete_task",
      description: "把已完成任务重新标记为待办（done: false）。",
      parameters: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "任务的 UUID" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "修改任务的标题、截止日期、优先级或工作量。",
      parameters: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "任务的 UUID" },
          title: { type: "string", description: "新标题" },
          due_date: {
            type: ["string", "null"],
            description: "新截止日期（YYYY-MM-DD），传 null 表示清除截止日期",
          },
          priority: {
            type: ["string", "null"],
            enum: ["low", "medium", "high", null],
            description: "新优先级，传 null 表示清除",
          },
          effort: {
            type: ["string", "null"],
            enum: ["small", "medium", "large", null],
            description: "新工作量，传 null 表示清除",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "永久删除一条任务。删除前无需确认。",
      parameters: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "任务的 UUID" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_subtask",
      description: "为已有任务添加一条子任务。",
      parameters: {
        type: "object",
        required: ["task_id", "title"],
        properties: {
          task_id: { type: "string", description: "父任务的 UUID" },
          title: { type: "string", description: "子任务标题，1 到 200 个字符" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_subtask",
      description: "修改子任务的完成状态或标题。",
      parameters: {
        type: "object",
        required: ["task_id", "subtask_id"],
        properties: {
          task_id: { type: "string", description: "父任务的 UUID" },
          subtask_id: { type: "string", description: "子任务的 UUID" },
          done: { type: "boolean", description: "是否完成" },
          title: { type: "string", description: "可选的新标题" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_subtask",
      description: "删除某条任务下的指定子任务。",
      parameters: {
        type: "object",
        required: ["task_id", "subtask_id"],
        properties: {
          task_id: { type: "string", description: "父任务的 UUID" },
          subtask_id: { type: "string", description: "子任务的 UUID" },
        },
      },
    },
  },
];

// ─── 系统提示词 ───────────────────────────────────────────────────────────────

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildCalendarReference(now: Date): string {
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const labels = ["今天", "明天", "后天"];
  const lines: string[] = [];
  for (let offset = 0; offset < 8; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const iso = formatLocalIsoDate(d);
    const weekday = weekdays[d.getDay()];
    const prefix = labels[offset] ?? `${offset}天后`;
    lines.push(`- ${prefix}（${weekday}）：${iso}`);
  }
  return lines.join("\n");
}

function buildSystemPrompt(): string {
  const now = new Date();
  const todayIso = formatLocalIsoDate(now);
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const calendarRef = buildCalendarReference(now);

  return `你是 To Do Agent，小明专属的中文待办清单助手（对话的用户就是小明）。
当前本地时间：${todayIso} ${timeStr}

## 日期对照表（用于精确换算「今天」「明天」「后天」「下周几」）
${calendarRef}

## 行为准则
- 始终用中文回复，语气自然友好、简洁清晰。
- 时间理解规则：
  - 创建任务时若包含相对时间（如「明天」「后天」「这周五」），必须参照上方日期对照表换算成准确的 YYYY-MM-DD 写入 due_date。
  - 若历史消息中带有 [发送时间：...]，请注意结合当时的发送日期和当前日期判断语义（例如昨天说的「明天」就是今天 ${todayIso}）。
  - 「今天有哪些任务到期？」→ 调用 list_tasks，筛选出 due_date 等于今天（${todayIso}）的任务（若还有已逾期未完成的任务也可顺带提醒）。
- 对用户的口语表达要灵活理解：
  - 「帮我记一下买牛奶」「牛奶别忘了买」→ 创建任务「买牛奶」
  - 「牛奶买好了」→ 先查清单找到「买牛奶」，再标记为已完成
  - 「第一条删掉」→ 先查清单，再删除对应任务
  - 用户要求拆分子任务时，可直接在 create_task 中传入 subtasks，或用 add_subtask 添加到已有任务下
- 如果用户指令缺少关键信息（如「帮我加一条」但没说具体内容），简短追问。

## 展示格式
列出任务时，使用清晰易读的排版，帮助用户一眼看出哪些还需要处理：
- 先展示待办任务（⬜），再展示已完成任务（✅）；若全为空则鼓励用户添加。
- 格式示例：
  ⬜ **买牛奶**（🔴高优先级 · 工作量：小 · 📅 ${todayIso}）
    - ⬜ 买全脂牛奶
    - ✅ 买酸奶
  ✅ 寄快递`;
}

// ─── 工具执行 ─────────────────────────────────────────────────────────────────

type ToolResult = unknown;

async function executeTool(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall,
): Promise<ToolResult> {
  const name = toolCall.function.name;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    return { error: "参数解析失败" };
  }

  try {
    switch (name) {
      case "list_tasks": {
        const res = await fetch(`${BASE_URL}/api/tasks`);
        return res.json();
      }

      case "create_task": {
        const { title, due_date, priority, effort, subtasks } = args;
        const payload: Record<string, unknown> = { title };
        if (due_date !== undefined) payload.due_date = due_date;
        if (priority !== undefined) payload.priority = priority;
        if (effort !== undefined) payload.effort = effort;
        if (Array.isArray(subtasks) && subtasks.length > 0) {
          payload.subtasks = subtasks
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .map((subTitle) => ({
              id: randomUUID(),
              title: subTitle.trim(),
              done: false,
            }));
        }

        const res = await fetch(`${BASE_URL}/api/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        return res.json();
      }

      case "complete_task": {
        const res = await fetch(`${BASE_URL}/api/tasks/${args.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ done: true }),
        });
        return res.json();
      }

      case "uncomplete_task": {
        const res = await fetch(`${BASE_URL}/api/tasks/${args.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ done: false }),
        });
        return res.json();
      }

      case "update_task": {
        const { id, ...changes } = args;
        const res = await fetch(`${BASE_URL}/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
        return res.json();
      }

      case "delete_task": {
        const res = await fetch(`${BASE_URL}/api/tasks/${args.id}`, {
          method: "DELETE",
        });
        if (res.status === 204) return { success: true };
        return res.json();
      }

      case "add_subtask": {
        const res = await fetch(`${BASE_URL}/api/tasks/${args.task_id}/subtasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: args.title }),
        });
        return res.json();
      }

      case "toggle_subtask": {
        const { task_id, subtask_id, ...changes } = args;
        const res = await fetch(`${BASE_URL}/api/tasks/${task_id}/subtasks/${subtask_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
        return res.json();
      }

      case "delete_subtask": {
        const res = await fetch(
          `${BASE_URL}/api/tasks/${args.task_id}/subtasks/${args.subtask_id}`,
          { method: "DELETE" },
        );
        return res.json();
      }

      default:
        return { error: `未知工具：${name}` };
    }
  } catch (err) {
    console.error(`[agent] 工具 ${name} 执行失败:`, err);
    return { error: "操作失败，请稍后重试" };
  }
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

// 从这里开始实现智能体。messages 包含本轮对话历史，最后一条是最新的用户消息。
export async function reply(messages: ChatMessage[]): Promise<string> {
  const client = getModelClient();

  const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
    ...messages.map(
      (m) =>
        ({
          role: m.role,
          content:
            m.role === "user" && m.timestamp
              ? `[发送时间：${m.timestamp}]\n${m.content}`
              : m.content,
        }) as OpenAI.Chat.Completions.ChatCompletionMessageParam,
    ),
  ];

  let toolCallCount = 0;

  while (true) {
    const response = await client.chat.completions.create({
      model,
      messages: chatMessages,
      tools,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    if (!choice) {
      return "抱歉，我暂时无法处理这个请求，请稍后再试。";
    }

    chatMessages.push(choice.message);

    if (choice.finish_reason === "stop" || !choice.message.tool_calls?.length) {
      return choice.message.content?.trim() || "抱歉，我没有理解你的意思，请再试一次。";
    }

    toolCallCount += choice.message.tool_calls.length;
    if (toolCallCount > MAX_TOOL_CALLS) {
      console.warn("[agent] 工具调用次数超限，强制返回");
      return "操作过于复杂，请把任务拆分成更简单的步骤再试。";
    }

    const functionCalls = choice.message.tool_calls.filter(
      (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
        tc.type === "function",
    );
    const results = await Promise.all(functionCalls.map(executeTool));

    for (let i = 0; i < functionCalls.length; i++) {
      chatMessages.push({
        role: "tool",
        tool_call_id: functionCalls[i].id,
        content: JSON.stringify(results[i]),
      });
    }
  }
}
