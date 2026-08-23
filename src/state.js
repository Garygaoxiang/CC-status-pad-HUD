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
    model: null, effort: null, ultra: false, plan: null, cwd: null, projectName: null, branch: null,
    timeline: [], tasks: [], toolCounts: {},
    contextPct: 0, linesAdded: 0, linesRemoved: 0, filesChanged: 0, filesChangedPaths: [],
    costUsd: 0, durationMs: 0, lastSeen: 0, startedAt: 0, slSeen: false,
    transcriptPath: null,
    workflow: null,
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

// 按工具入参估算本次改动的增删行数。Desktop 版没有 statusline，这是唯一来源。
// Edit/MultiEdit：把「整块替换」算成新块记增、旧块记删；Write：新内容整份记增，
// 旧内容不可知故删记 0。只读工具与缺参一律 0。
// ponytail: 估算值，与 Claude Code 自己的 diff 统计不完全一致（宁可少算不虚报）；
//           要精确值只能靠 statusline —— 而那只有 CLI 才调。
const lineCount = (t) => (t ? String(t).split('\n').length : 0);

export function estimateLines(name, input = {}) {
  const i = input || {};
  if (name === 'Edit') {
    return { added: lineCount(i.new_string), removed: lineCount(i.old_string) };
  }
  if (name === 'Write') return { added: lineCount(i.content), removed: 0 };
  if (name === 'MultiEdit') {
    return (Array.isArray(i.edits) ? i.edits : []).reduce((acc, e) => ({
      added: acc.added + lineCount(e && e.new_string),
      removed: acc.removed + lineCount(e && e.old_string),
    }), { added: 0, removed: 0 });
  }
  return { added: 0, removed: 0 };
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
  // Desktop 版不调 statusline，transcript_path 与 effort 只能从 hook 载荷取（CLI 也照送，无害）。
  // effort 沿用 statusline 语义：键在就以本次为准（缺 level 即清空），键缺席才保持原值。
  if (!s.startedAt) s.startedAt = now;
  if (event.transcript_path) s.transcriptPath = event.transcript_path;
  if ('effort' in event) s.effort = event.effort?.level ?? null;
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
      // filesChanged：Edit/Write/MultiEdit 去重累加改动过的 file_path
      if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') {
        const fp = event.tool_input?.file_path;
        if (fp && !session.filesChangedPaths.includes(fp)) {
          s.filesChangedPaths = [...session.filesChangedPaths, fp];
          s.filesChanged = s.filesChangedPaths.length;
        }
        // statusline 供过数就以它为准（CLI）；没供过才自己估（Desktop）
        if (!s.slSeen) {
          const d = estimateLines(name, event.tool_input);
          s.linesAdded += d.added;
          s.linesRemoved += d.removed;
        }
      }
      break;
    }
    case 'Notification': s.status = 'waiting'; break;
    case 'Stop': s.status = 'idle'; s.currentTool = null; break;
    case 'SessionEnd': s.status = 'ended'; break;
  }
  // 会话时长：statusline 没供过就用「首个事件 → 本次事件」的墙钟兜底（Desktop）
  if (!s.slSeen) s.durationMs = now - s.startedAt;
  return s;
}

export function applyStatusline(session, sl, now = Date.now()) {
  // slSeen：本会话有 statusline 供数（= CLI）。置位后 applyEvent 不再自行估行数/时长。
  const s = { ...session, lastSeen: now, slSeen: true };
  if (sl.model?.display_name) s.model = sl.model.display_name;
  // effort 与其他字段不同：反映当次真实值。statusline 是完整快照，
  // effort 缺省即"当前模型不支持/未设"，必须能从有清回无，否则切模型后残留旧档。
  s.effort = sl.effort?.level ?? null;
  if (sl.transcript_path) s.transcriptPath = sl.transcript_path;
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
