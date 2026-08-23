// public/i18n.js — HUD 界面文案中英字典。浏览器与 Node 测试共用，纯数据 + 少量插值函数。
// 新增文案务必同时补 zh / en 两份（i18n.test.js 会校验 key 集合一致）。

export const LABELS = {
  zh: {
    timelineHeader: '活动时间线 · LIVE',
    timelineEmpty: '等待事件…',
    tasksTitle: '任务进度',
    tasksEmpty: '暂无任务',
    toolsTitle: '本会话工具调用',
    toolsEmpty: '暂无调用',
    changesTitle: '代码改动 · 花费',
    files: (n) => `${n} 个文件`,
    usageTitle: '账户额度',
    usage5h: '5 小时窗口',
    usage7d: '7 天窗口',
    reset: (cd) => `⟳ ${cd} 后重置`,
    syncing: '同步中…',
    noAuth: '无凭据 · 需 CLI 登录一次',
    syncNote: 'SYNC 每 5min · /api/oauth/usage',
    fProject: '项目',
    fDuration: '会话时长',
    fSessions: '活动会话',
    fLink: '连接',
    linkReconnecting: 'SSE ○ 重连中',
    cdNow: '现在',
  },
  en: {
    timelineHeader: 'Activity Timeline · LIVE',
    timelineEmpty: 'Waiting for events…',
    tasksTitle: 'Tasks',
    tasksEmpty: 'No tasks',
    toolsTitle: 'Tool Calls (session)',
    toolsEmpty: 'No calls yet',
    changesTitle: 'Changes · Cost',
    files: (n) => `${n} ${n === 1 ? 'file' : 'files'}`,
    usageTitle: 'Account Usage',
    usage5h: '5-Hour Window',
    usage7d: '7-Day Window',
    reset: (cd) => `⟳ resets in ${cd}`,
    syncing: 'Syncing…',
    noAuth: 'No credentials · sign in via CLI once',
    syncNote: 'SYNC every 5min · /api/oauth/usage',
    fProject: 'Project',
    fDuration: 'Duration',
    fSessions: 'Sessions',
    fLink: 'Link',
    linkReconnecting: 'SSE ○ reconnecting',
    cdNow: 'now',
  },
};

// 取某语言文案表；未知 / 空回退中文。
export function dict(lang) {
  return LABELS[lang] || LABELS.zh;
}

// 从 URL query string（如 location.search）解析显示语言。
// 只认字典已有的语言；未知 / 缺省回退 zh，保证返回值恒为合法语言码。
export function pickLang(search) {
  const v = new URLSearchParams(search || '').get('lang');
  return LABELS[v] ? v : 'zh';
}
