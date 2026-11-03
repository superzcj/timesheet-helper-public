(function (root, factory) {
  const runner = factory();
  if (typeof module === "object" && module.exports) module.exports = runner;
  root.TimesheetRunner = runner;
})(globalThis, function () {
  "use strict";

  async function runQueue({ items, projectName, getHistory, prepare, send, matches, onState = () => {} }) {
    let completed = 0;
    let skipped = 0;
    try {
      for (const item of items) {
        onState("checking", item);
        const existing = await getHistory(item.date);
        if (existing.length) {
          item.reported = existing;
          item.selected = false;
          item.outcome = "提交前发现已有记录，已跳过。";
          skipped++;
          onState("skipped", item);
          continue;
        }
        const body = await prepare(item.date);
        onState("submitting", item);
        let post = {};
        try { post = await send(body); }
        catch (_) { post = { error: "网络中断或请求超时" }; }
        let after;
        try { after = await getHistory(item.date); }
        catch (_) { throw new Error(`${item.date} 已发送，回查失败，结果不明。请先到工时列表核对，再重新预览。`); }
        if (!matches(after, projectName)) {
          if (post.resultCode === -4) throw new Error(`${item.date} 未确认成功：系统只允许提报本年度工时。`);
          if (post.resultCode === -3 || (post.resultCode != null && post.resultCode <= 0)) {
            throw new Error(`${item.date} 未确认成功：系统拒绝了本次提报，请检查历史记录。`);
          }
          throw new Error(`${item.date} 的提交结果不明${post.error ? `（${post.error}）` : ""}，请先到工时列表核对，再重新预览。`);
        }
        item.reported = after;
        item.selected = false;
        item.outcome = "提交后已回查确认。";
        completed++;
        onState("completed", item);
      }
      return { completed, skipped };
    } catch (error) {
      error.completed = completed;
      error.skipped = skipped;
      throw error;
    }
  }

  return { runQueue };
});
