import test from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, statusText, clock, toolColor, barWidth, countdown, taskProgress, duration,
  effortLabel, effortClass,
  workflowChipText, workflowClass, workflowPct, workflowPhaseText,
  fitScale, modelDisplay,
} from '../public/format.js';

test('esc 转义 HTML 特殊字符', () => {
  assert.equal(esc('<a>&"'), '&lt;a&gt;&amp;&quot;');
  assert.equal(esc(null), '');
});

test('statusText 运行中拆出工具名与命令', () => {
  assert.deepEqual(
    statusText({ status: 'running', currentTool: 'Bash · npm test' }),
    { big: 'RUNNING · BASH', sub: 'npm test' },
  );
});

test('statusText 无工具时回退到项目名', () => {
  assert.deepEqual(
    statusText({ status: 'idle', projectName: 'proj-api' }),
    { big: 'IDLE', sub: 'proj-api' },
  );
  assert.equal(statusText({ status: 'waiting' }).big, 'WAITING');
});

test('clock 格式化为 HH:MM:SS', () => {
  const t = new Date(2026, 4, 18, 14, 2, 31).getTime();
  assert.equal(clock(t), '14:02:31');
  assert.equal(clock(NaN), '--:--:--');
});

test('toolColor 已知工具有色、未知回退', () => {
  assert.equal(toolColor('Bash'), '#27d3f5');
  assert.equal(toolColor('Edit'), '#f0a35e');
  assert.equal(toolColor('Mystery'), '#5878a3');
});

test('barWidth 钳制在 0-100', () => {
  assert.equal(barWidth(44), '44%');
  assert.equal(barWidth(150), '100%');
  assert.equal(barWidth(-5), '0%');
  assert.equal(barWidth(null), '0%');
});

test('countdown 把重置时间转成倒计时', () => {
  const now = Date.now();
  assert.equal(countdown(new Date(now + 121 * 60000).toISOString(), now), '2h 01m');
  assert.equal(countdown(new Date(now + 7560 * 60000).toISOString(), now), '5d 06h');
  assert.equal(countdown(new Date(now + 3 * 60000).toISOString(), now), '3m');
  assert.equal(countdown(new Date(now - 1000).toISOString(), now), '现在');
  assert.equal(countdown(null, now), '—');
});

test('countdown 到期文案可由 nowWord 覆盖（i18n）', () => {
  const now = Date.now();
  assert.equal(countdown(new Date(now - 1000).toISOString(), now, 'now'), 'now');
  // 未到期不受 nowWord 影响
  assert.equal(countdown(new Date(now + 3 * 60000).toISOString(), now, 'now'), '3m');
});

test('taskProgress 统计完成度', () => {
  assert.deepEqual(
    taskProgress([{ status: 'completed' }, { status: 'pending' }, { status: 'completed' }]),
    { done: 2, total: 3, pct: 67 },
  );
  assert.deepEqual(taskProgress([]), { done: 0, total: 0, pct: 0 });
});

test('duration 格式化时长', () => {
  assert.equal(duration(23 * 60000 + 11000), '23:11');
  assert.equal(duration(3661000), '1:01:01');
  assert.equal(duration(0), '0:00');
});

test('effortLabel 映射等级、未知大写、空值空串', () => {
  assert.equal(effortLabel('low'), 'LOW');
  assert.equal(effortLabel('medium'), 'MED');
  assert.equal(effortLabel('high'), 'HIGH');
  assert.equal(effortLabel('xhigh'), 'XHIGH');
  assert.equal(effortLabel('max'), 'MAX');
  assert.equal(effortLabel('weird'), 'WEIRD');
  assert.equal(effortLabel(null), '');
});

test('effortClass 三档分色、空与未知不上色', () => {
  assert.equal(effortClass('low'), 'e-lo');
  assert.equal(effortClass('medium'), 'e-lo');
  assert.equal(effortClass('high'), 'e-hi');
  assert.equal(effortClass('xhigh'), 'e-max');
  assert.equal(effortClass('max'), 'e-max');
  assert.equal(effortClass(null), '');
  assert.equal(effortClass('weird'), '');
});

test('effortLabel ultracode 时显 ULTRA、覆盖等级与空值', () => {
  assert.equal(effortLabel('high', true), 'ULTRA');
  assert.equal(effortLabel('max', true), 'ULTRA');
  assert.equal(effortLabel(null, true), 'ULTRA');
  // 非 ultra 维持原行为
  assert.equal(effortLabel('high', false), 'HIGH');
  assert.equal(effortLabel('high'), 'HIGH');
});

test('effortClass ultracode 时用 e-ultra、覆盖等级', () => {
  assert.equal(effortClass('high', true), 'e-ultra');
  assert.equal(effortClass('max', true), 'e-ultra');
  assert.equal(effortClass(null, true), 'e-ultra');
  // 非 ultra 维持原行为
  assert.equal(effortClass('high', false), 'e-hi');
});

test('workflow 标量：running/done/null 与边界', () => {
  const run = { status: 'running', doneAgents: 3, totalAgents: 8, phaseTotal: 4 };
  const done = { status: 'done', doneAgents: 8, totalAgents: 8, phaseTotal: null };
  assert.equal(workflowChipText(run), '⚙ WF 3/8');
  assert.equal(workflowChipText(done), '⚙ WF ✓ 8/8');
  assert.equal(workflowChipText(null), '');
  assert.equal(workflowClass(run), 'wf-run');
  assert.equal(workflowClass(done), 'wf-done');
  assert.equal(workflowClass(null), '');
  assert.equal(workflowPct(run), 38);
  assert.equal(workflowPct(done), 100);
  assert.equal(workflowPct({ status: 'running', doneAgents: 0, totalAgents: 0 }), 0);
  assert.equal(workflowPhaseText(run), 'phase ·/4');
  assert.equal(workflowPhaseText(done), '');
});

test('fitScale 取宽/高较小比、保宽高比、非法回退 1', () => {
  assert.equal(fitScale(1920, 480), 1);            // 原生尺寸
  assert.equal(fitScale(960, 240), 0.5);           // 等比缩小
  assert.equal(fitScale(3840, 960), 2);            // 等比放大
  assert.equal(fitScale(1920, 515), 1);            // 略高：受宽限制
  assert.equal(fitScale(2560, 480), 1);            // 略宽：受高限制
  assert.equal(fitScale(800, 480), 800 / 1920);    // 窄屏：受宽限制
  assert.equal(fitScale(0, 0), 1);                 // 防御：非法回退 1
  assert.equal(fitScale(1000, 1000, 500, 500), 2); // 自定义基准
});

test('modelDisplay 把 transcript 兜底的 claude-<family>-<M>-<m> 美化', () => {
  // Desktop 兜底常见 model ID（transcript.js:lastModelFromTranscript 返回值）
  assert.equal(modelDisplay('claude-opus-4-7'), 'Opus 4.7');
  assert.equal(modelDisplay('claude-opus-4-8'), 'Opus 4.8');
  assert.equal(modelDisplay('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(modelDisplay('claude-fable-5'), 'Fable 5');
  // 带日期后缀（Haiku 4.5 官方 ID 形如 claude-haiku-4-5-20251001）
  assert.equal(modelDisplay('claude-haiku-4-5-20251001'), 'Haiku 4.5');
});

test('modelDisplay statusline 已美化文本原样透传', () => {
  // statusline 送的 display_name 已经是「Opus 4.7 (1M context)」这种，不该二次处理
  assert.equal(modelDisplay('Opus 4.7 (1M context)'), 'Opus 4.7 (1M context)');
  assert.equal(modelDisplay('Sonnet 5'), 'Sonnet 5');
});

test('modelDisplay 空/未知输入安全回退', () => {
  assert.equal(modelDisplay(null), null);
  assert.equal(modelDisplay(''), null);
  assert.equal(modelDisplay(undefined), null);
  // 无法解析的 claude- 前缀原样返回，避免吞掉真实值
  assert.equal(modelDisplay('claude-experimental'), 'claude-experimental');
});
