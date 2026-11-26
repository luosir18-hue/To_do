import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ChatMessage } from "../shared/chat.ts";
import type { Task } from "../shared/task.ts";
import { requestReply } from "./chat-client.ts";
import { ChatHistory } from "./ChatHistory.tsx";
import { SLASH_COMMANDS, SlashCommandMenu, type SlashCommand } from "./SlashCommandMenu.tsx";
import { deleteTaskById, fetchTasks, toggleSubtaskDone, toggleTaskDone } from "./task-client.ts";
import { TaskPanel } from "./TaskPanel.tsx";

const CHAT_STORAGE_KEY = "todo-agent-chat-v1";

function formatNowTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function loadSavedMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ChatMessage =>
        typeof item === "object" &&
        item !== null &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        (item.timestamp === undefined || typeof item.timestamp === "string"),
    );
  } catch {
    return [];
  }
}

function isSendShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  // 中文输入法会用 Enter 确认选词，部分浏览器此时只报告键码 229。
  const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
  return event.key === "Enter" && !event.shiftKey && !composing;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadSavedMessages);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [panelOpen, setPanelOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 960 : true,
  );
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  const refreshTasks = useCallback(async () => {
    try {
      const list = await fetchTasks();
      setTasks(list);
    } catch {
      // 静默忽略后台刷新失败，避免打断对话
    }
  }, []);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // 忽略存储空间不足
    }
  }, [messages]);

  // 自动调整输入框高度
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  // 匹配 `/` 斜杠指令：以 `/` 开头且不含空格或换行时弹出
  const slashQuery = useMemo(() => {
    if (!draft.startsWith("/") || draft.includes(" ") || draft.includes("\n")) return null;
    return draft.slice(1).toLowerCase();
  }, [draft]);

  const filteredCommands = useMemo(() => {
    if (slashQuery === null || slashDismissed) return [];
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.command.slice(1).includes(slashQuery) ||
        cmd.label.toLowerCase().includes(slashQuery),
    );
  }, [slashQuery, slashDismissed]);

  const showSlashMenu = filteredCommands.length > 0;

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const outgoing: ChatMessage[] = [
      ...messages,
      { role: "user", content, timestamp: formatNowTimestamp() },
    ];
    setMessages(outgoing);
    setDraft("");
    setSlashDismissed(false);
    setPending(true);
    setError("");
    try {
      const answer = await requestReply(outgoing);
      setMessages([
        ...outgoing,
        { role: "assistant", content: answer, timestamp: formatNowTimestamp() },
      ]);
      await refreshTasks();
    } catch (cause) {
      setMessages(messages);
      setDraft(text);
      setError(cause instanceof Error ? `发送失败：${cause.message}` : "发送失败，请重试。");
    } finally {
      setPending(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  }

  function clearConversation() {
    setMessages([]);
    setDraft("");
    setError("");
    setSlashDismissed(false);
    localStorage.removeItem(CHAT_STORAGE_KEY);
    requestAnimationFrame(() => input.current?.focus());
  }

  function handleSelectCommand(command: SlashCommand) {
    setSlashDismissed(false);
    setSlashIndex(0);
    if (command.mode === "clear") {
      clearConversation();
      return;
    }
    if (command.mode === "send") {
      setDraft("");
      void send(command.prompt);
      return;
    }
    setDraft(command.prompt);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(command.prompt.length, command.prompt.length);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (showSlashMenu) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashDismissed(true);
        return;
      }
      if (event.key === "Tab" || isSendShortcut(event)) {
        event.preventDefault();
        const selected = filteredCommands[slashIndex] ?? filteredCommands[0];
        if (selected) handleSelectCommand(selected);
        return;
      }
    }

    if (isSendShortcut(event)) {
      event.preventDefault();
      void send(draft);
    }
  }

  async function handleToggleTask(id: string, done: boolean) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done } : t)));
    try {
      await toggleTaskDone(id, done);
      await refreshTasks();
    } catch {
      await refreshTasks();
    }
  }

  async function handleDeleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await deleteTaskById(id);
      await refreshTasks();
    } catch {
      await refreshTasks();
    }
  }

  async function handleToggleSubtask(taskId: string, subtaskId: string, done: boolean) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              subtasks: (t.subtasks ?? []).map((s) =>
                s.id === subtaskId ? { ...s, done } : s,
              ),
            }
          : t,
      ),
    );
    try {
      await toggleSubtaskDone(taskId, subtaskId, done);
      await refreshTasks();
    } catch {
      await refreshTasks();
    }
  }

  const pendingTaskCount = tasks.filter((t) => !t.done).length;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <img src="/logo.svg" alt="TokeNow To Do Agent" />
          <strong>TokeNow</strong>
          <span className="brand-sub">To Do Agent</span>
        </div>

        <div className="header-actions">
          {messages.length > 0 && (
            <button type="button" className="header-btn" onClick={clearConversation}>
              新对话
            </button>
          )}
          <button
            type="button"
            className={`header-btn ${panelOpen ? "active" : ""}`}
            onClick={() => setPanelOpen((prev) => !prev)}
            aria-expanded={panelOpen}
          >
            <span>待办清单</span>
            {pendingTaskCount > 0 && <span className="count-pill">{pendingTaskCount}</span>}
          </button>
        </div>
      </header>

      <div className="workspace">
        <main>
          <ChatHistory messages={messages} pending={pending} onSelectPrompt={send} />

          <div className="compose">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}

            <div className="compose-anchor">
              {showSlashMenu && (
                <SlashCommandMenu
                  commands={filteredCommands}
                  activeIndex={Math.min(slashIndex, filteredCommands.length - 1)}
                  onSelect={handleSelectCommand}
                  onHover={setSlashIndex}
                />
              )}

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(draft);
                }}
              >
                <textarea
                  aria-label="消息"
                  ref={input}
                  placeholder="输入待办或问题… 敲 / 唤起快捷指令"
                  rows={1}
                  value={draft}
                  readOnly={pending}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setSlashDismissed(false);
                    setSlashIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                />
                <button className="send" disabled={pending || !draft.trim()} aria-label="发送消息">
                  ↑
                </button>
              </form>
            </div>

            <div className="compose-hints">
              <small>Enter 发送 · Shift + Enter 换行</small>
              <button
                type="button"
                className="slash-trigger"
                onClick={() => {
                  setDraft("/");
                  setSlashDismissed(false);
                  setSlashIndex(0);
                  requestAnimationFrame(() => input.current?.focus());
                }}
              >
                <kbd>/</kbd> 快捷指令
              </button>
            </div>
          </div>
        </main>

        <TaskPanel
          tasks={tasks}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          onToggleTask={handleToggleTask}
          onDeleteTask={handleDeleteTask}
          onToggleSubtask={handleToggleSubtask}
          onQuickPrompt={(prompt) => void send(prompt)}
        />

        {!panelOpen && (
          <button
            type="button"
            className="panel-reopen-tab"
            onClick={() => setPanelOpen(true)}
            aria-label="展开待办清单"
            title="展开待办清单"
          >
            <span>«</span>
            <span className="reopen-label">待办</span>
            {pendingTaskCount > 0 && <span className="count-pill">{pendingTaskCount}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
