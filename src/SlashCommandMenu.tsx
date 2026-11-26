export interface SlashCommand {
  id: string;
  command: string;
  label: string;
  description: string;
  icon: string;
  mode: "send" | "fill" | "clear";
  prompt: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "list",
    command: "/list",
    label: "查看清单",
    description: "列出所有待办、已完成任务及子任务",
    icon: "📋",
    mode: "send",
    prompt: "我有哪些任务？",
  },
  {
    id: "today",
    command: "/today",
    label: "今日到期",
    description: "筛选今天到期和已逾期的任务",
    icon: "📅",
    mode: "send",
    prompt: "今天有哪些任务到期？",
  },
  {
    id: "add",
    command: "/add",
    label: "新建待办",
    description: "快速添加任务，可附带优先级、工作量和截止日期",
    icon: "✨",
    mode: "fill",
    prompt: "帮我记一下：",
  },
  {
    id: "subtask",
    command: "/subtask",
    label: "拆分子任务",
    description: "把复杂任务拆分成多个可执行子任务",
    icon: "🌿",
    mode: "fill",
    prompt: "帮我给任务拆分子任务：",
  },
  {
    id: "clear",
    command: "/clear",
    label: "清空对话",
    description: "开启新对话（已保存的待办任务不会丢失）",
    icon: "🧹",
    mode: "clear",
    prompt: "",
  },
];

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  activeIndex: number;
  onSelect: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}

export function SlashCommandMenu({
  commands,
  activeIndex,
  onSelect,
  onHover,
}: SlashCommandMenuProps) {
  if (commands.length === 0) return null;

  return (
    <div className="slash-menu" role="listbox" aria-label="快捷指令">
      <div className="slash-menu-header">
        <span>快捷指令</span>
        <kbd>↑↓ 选择 · Enter 确认 · Esc 关闭</kbd>
      </div>
      <div className="slash-menu-list">
        {commands.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={`slash-item ${index === activeIndex ? "active" : ""}`}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(e) => {
              // 防止点击时 textarea 失焦闪烁
              e.preventDefault();
              onSelect(item);
            }}
          >
            <span className="slash-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="slash-meta">
              <span className="slash-title">
                <code>{item.command}</code>
                <strong>{item.label}</strong>
              </span>
              <small>{item.description}</small>
            </span>
            <span className="slash-badge">
              {item.mode === "send" ? "发送" : item.mode === "clear" ? "执行" : "填入"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
