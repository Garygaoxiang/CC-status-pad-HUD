// 纯函数状态 reducer。所有导出函数返回新对象，不改入参。
export const MAX_TIMELINE = 20;
export const STALE_MS = 10 * 60 * 1000;

const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const truncate = (str, n) => {
  str = String(str ?? '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
};

export function createSession(sessionId) {
  return {
    sessionId, status: 'idle', currentTool: null,
    model: null, plan: null, cwd: null, projectName: null, branch: null,
    timeline: [], tasks: [], toolCounts: {},
    contextPct: 0, linesAdded: 0, linesRemoved: 0, filesChanged: 0,
    costUsd: 0, durationMs: 0, lastSeen: 0,
  };
}

export function formatTool(name = 'Tool', input = {}) {
  switch (name) {
    case 'Bash': return `Bash · ${truncate(input.command, 48)}`;
    case 'Edit': case 'Write': case 'Read': case 'NotebookEdit':
      return `${name} · ${basename(input.file_path || input.notebook_path)}`;
    case 'Grep': return `Grep · ${truncate(input.pattern, 32)}`;
    case 'Glob': return `Glob · ${truncate(input.pattern, 32)}`;
    case 'Task': return `Task · ${truncate(input.description, 36)}`;
    default: return name;
  }
}

function applyTaskTool(tasks, name, input = {}, response = '') {
  if (name === 'TodoWrite') {
    // TodoWrite 每次提交整张待办表，整体替换、不累加
    const todos = Array.isArray(input.todos) ? input.todos : [];
    return todos.map((t, i) => ({
      id: String(i + 1),
      subject: (t && (t.content || t.activeForm)) || '(task)',
      status: (t && t.status) || 'pending',
    }));
  }
  if (name === 'TaskCreate') {
    const m = String(response || '').match(/#(\d+)/);
    const id = m ? m[1] : String(tasks.length + 1);
    return [...tasks, { id, subject: input.subject || '(task)', status: 'pending' }];
  }
  if (name === 'TaskUpdate') {
    return tasks.map((t) =>
      t.id === String(input.taskId ?? '')
        ? {
            ...t,
            ...(input.status ? { status: input.status } : {}),
            ...(input.subject ? { subject: input.subject } : {}),
          }
        : t,
    );
  }
  return tasks;
}

export function applyEvent(session, event, now = Date.now()) {
  const s = {
    ...session,
    timeline: [...session.timeline],
    toolCounts: { ...session.toolCounts },
    tasks: session.tasks.map((t) => ({ ...t })),
    lastSeen: now,
  };
  if (event.cwd) { s.cwd = event.cwd; s.projectName = basename(event.cwd); }
  switch (event.hook_event_name) {
    case 'UserPromptSubmit': // 用户 prompt 不是工具调用，不写入时间线
      s.status = 'working'; s.currentTool = null; break;
    case 'PreToolUse':
      s.status = 'running';
      s.currentTool = formatTool(event.tool_name, event.tool_input);
      break;
    case 'PostToolUse': {
      s.status = 'working'; s.currentTool = null;
      const name = event.tool_name || 'Tool';
      s.toolCounts[name] = (s.toolCounts[name] || 0) + 1;
      s.timeline.push({ ts: now, tool: name, label: formatTool(name, event.tool_input) });
      if (s.timeline.length > MAX_TIMELINE) s.timeline = s.timeline.slice(-MAX_TIMELINE);
      if (name === 'TaskCreate' || name === 'TaskUpdate' || name === 'TodoWrite')
        s.tasks = applyTaskTool(s.tasks, name, event.tool_input, event.tool_response);
      break;
    }
    case 'Notification': s.status = 'waiting'; break;
    case 'Stop': s.status = 'idle'; s.currentTool = null; break;
    case 'SessionEnd': s.status = 'ended'; break;
  }
  return s;
}

export function applyStatusline(session, sl, now = Date.now()) {
  const s = { ...session, lastSeen: now };
  if (sl.model?.display_name) s.model = sl.model.display_name;
  if (sl.workspace?.current_dir) {
    s.cwd = sl.workspace.current_dir;
    s.projectName = basename(s.cwd);
  }
  const c = sl.cost || {};
  if (c.total_cost_usd != null) s.costUsd = c.total_cost_usd;
  if (c.total_duration_ms != null) s.durationMs = c.total_duration_ms;
  if (c.total_lines_added != null) s.linesAdded = c.total_lines_added;
  if (c.total_lines_removed != null) s.linesRemoved = c.total_lines_removed;
  return s;
}

export function pruneStale(sessions, now = Date.now()) {
  for (const [id, s] of sessions)
    if (s.status === 'ended' || now - s.lastSeen > STALE_MS) sessions.delete(id);
}

export function pickFocus(sessions) {
  let focus = null;
  for (const s of sessions.values())
    if (!focus || s.lastSeen > focus.lastSeen) focus = s;
  return focus;
}
