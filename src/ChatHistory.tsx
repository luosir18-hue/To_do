import { useEffect, useRef, type ReactNode } from "react";
import type { ChatMessage } from "../shared/chat.ts";

const examplePrompts = [
  "帮我记一下买牛奶",
  "加一条高优先级任务：准备周报，工作量大，今天到期",
  "帮我创建一个「周末露营」任务，拆成订营地、买食材两个子任务",
  "今天有哪些任务到期？",
];

interface ChatHistoryProps {
  messages: ChatMessage[];
  pending: boolean;
  onSelectPrompt: (prompt: string) => void;
}

/** 渲染行内 **加粗** 与 `行内代码` */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={idx}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function formatContent(text: string): ReactNode[] {
  return text.split("\n").map((line, i) => {
    if (!line.trim()) return <div key={i} className="msg-gap" />;
    return (
      <p key={i} className={line.startsWith("  -") || line.startsWith("- ") ? "msg-list-line" : undefined}>
        {renderInline(line)}
      </p>
    );
  });
}

export function ChatHistory({ messages, pending, onSelectPrompt }: ChatHistoryProps) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [messages, pending]);

  return (
    <div className="scroll" ref={viewport}>
      {messages.length === 0 ? (
        <section className="welcome">
          <img src="/logo.svg" alt="To Do Agent Logo" />
          <h1>To Do Agent</h1>
          <p>小明你好，用中文自然对话就能管理待办、子任务、优先级与到期提醒</p>
          <div className="examples">
            {examplePrompts.map((prompt) => (
              <button key={prompt} type="button" onClick={() => onSelectPrompt(prompt)}>
                <span>{prompt}</span>
                <span className="arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            ))}
          </div>
          <p className="welcome-tip">
            小技巧：在下方输入框敲 <kbd>/</kbd> 可随时唤起快捷指令菜单
          </p>
        </section>
      ) : (
        <div className="thread" role="log" aria-label="对话记录" aria-live="polite">
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              <small>
                {message.role === "user" ? "小明" : "To Do Agent"}
                {message.timestamp ? ` · ${message.timestamp.slice(5)}` : ""}
              </small>
              <div className="bubble">{formatContent(message.content)}</div>
            </div>
          ))}
          {pending && (
            <div className="message assistant">
              <small>To Do Agent</small>
              <div className="bubble thinking" role="status">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <span>正在思考并处理任务…</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
