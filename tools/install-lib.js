// HUD 安装/启动期纯逻辑。所有导出函数无副作用、返回新对象。
// 同时作为 CLI 被 PowerShell 脚本调用（见文件末尾 CLI 入口，Task 3 补充）。

// 从屏幕列表中选出 HUD 该铺的副屏。
// 策略：精确匹配目标宽高 → 回退首个非主屏 → null。
export function pickScreen(screens, target = {}) {
  const list = Array.isArray(screens) ? screens : [];
  const hit = list.find(
    (s) => !s.primary && s.width === target.width && s.height === target.height,
  );
  if (hit) return { ...hit, exact: true };
  const fallback = list.find((s) => !s.primary);
  return fallback ? { ...fallback, exact: false } : null;
}
