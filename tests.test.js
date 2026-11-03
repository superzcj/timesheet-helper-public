const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./core.js");
const api = require("./api.js");
const runner = require("./runner.js");

test("手动输入的日期会排序、去重，并保留用户选择的周末", () => {
  const plan = core.buildPlan({ dateText: "2026-11-02，2026-10-17\n2026-10-17、2026-10-18", today: "2026-11-03" });
  assert.deepEqual(plan.map(item => [item.date, item.weekday, item.selected]), [
    ["2026-10-17", "六", true], ["2026-10-18", "日", true], ["2026-11-02", "一", true]
  ]);
});

test("已有其他项目或不足 8 小时的记录也跳过", () => {
  const plan = core.buildPlan({
    dateText: "2026-10-10,2026-10-11,2026-10-12", today: "2026-11-03",
    records: [{ ReportDateStr: "2026-10-12", ProjectNo: "OTHER", WorkHour: "4.00" }]
  });
  assert.equal(plan.find(item => item.date === "2026-10-10").selected, true);
  assert.equal(plan.find(item => item.date === "2026-10-11").selected, true);
  assert.equal(plan.find(item => item.date === "2026-10-12").selected, false);
});

test("必须输入有效日期，不能超出今天或一次选择过长跨度", () => {
  const settings = { today: "2026-11-03" };
  assert.throws(() => core.buildPlan({ ...settings, dateText: "" }), /至少输入/);
  assert.throws(() => core.buildPlan({ ...settings, dateText: "2026-02-30" }), /有效日期/);
  assert.throws(() => core.buildPlan({ ...settings, dateText: "2026-11-04" }), /今天/);
  assert.throws(() => core.buildPlan({ ...settings, dateText: "2024-01-01,2026-10-03" }), /跨度/);
  assert.equal(core.shanghaiToday(new Date("2026-11-02T16:01:00Z")), "2026-11-03");
});

test("统一配置按明确日期去重，未来日期只显示不填报", () => {
  const config = core.validateWorkdays({
    schemaVersion: 1, updatedAt: "2026-11-03",
    coverage: { start: "2026-10-01", end: "2026-11-30" },
    workdays: ["2026-11-04", "2026-11-02", "2026-11-02", "2026-11-03"]
  }, "2026-11-03");
  assert.deepEqual(config.dates, ["2026-11-02", "2026-11-03", "2026-11-04"]);
  assert.deepEqual(config.available, ["2026-11-02", "2026-11-03"]);
  assert.equal(config.futureCount, 1);
  assert.equal(config.duplicates, 1);
});

test("配置为空时不产生日期，配置错误会阻止使用", () => {
  const coverage = { start: "2026-01-01", end: "2026-12-31" };
  assert.deepEqual(core.validateWorkdays({ schemaVersion: 1, updatedAt: "", coverage, workdays: [] }, "2026-11-03").available, []);
  assert.throws(() => core.validateWorkdays({ schemaVersion: 2, updatedAt: "", workdays: [] }), /schemaVersion/);
  assert.throws(() => core.validateWorkdays({ schemaVersion: 1, updatedAt: "", coverage, workdays: ["2026-10-31"] }), /updatedAt/);
  assert.throws(() => core.validateWorkdays({ schemaVersion: 1, updatedAt: "2026-11-03", coverage, workdays: ["2026-02-30"] }), /有效日期/);
  assert.throws(() => core.validateWorkdays({ schemaVersion: 1, updatedAt: "2026-11-03", coverage, workdays: ["2024-01-01"] }), /超出/);
  assert.throws(() => core.validateWorkdays({ schemaVersion: 1, updatedAt: "2026-11-03", workdays: [] }), /覆盖范围/);
});

test("仓库中的工作日配置符合格式", () => {
  const config = require("./workdays.json");
  assert.doesNotThrow(() => core.validateWorkdays(config));
});

test("按月显示配置日期，个人休息不改变节假日安排", () => {
  const schedule = core.monthSchedule("2026-11", ["2026-11-02", "2026-11-03"],
    { "2026-11-02": false, "2026-11-07": true }, "2026-11-03", { start: "2026-11-01", end: "2026-11-30" });
  assert.equal(schedule.offset, 6);
  assert.equal(schedule.days.length, 30);
  assert.equal(schedule.days.find(day => day.date === "2026-11-02").working, false);
  assert.equal(schedule.days.find(day => day.date === "2026-11-03").working, true);
  assert.equal(schedule.days.find(day => day.date === "2026-11-07").working, false);
  assert.equal(schedule.days.find(day => day.date === "2026-11-07").covered, true);
  assert.equal(schedule.days.find(day => day.date === "2026-11-07").future, true);
  assert.equal(core.monthSchedule("2028-02", [], {}, "2028-03-01").days.length, 29);
  assert.throws(() => core.monthSchedule("2026-13"), /有效日期/);
});

test("节假日和调休只使用明确日期，未覆盖月份不推断", () => {
  const schedule = core.monthSchedule("2026-10", ["2026-10-10", "2026-10-17", "2026-10-31"], {}, "2026-11-03", { start: "2026-10-01", end: "2026-11-30" });
  for (const date of ["2026-10-10", "2026-10-17", "2026-10-31"]) assert.equal(schedule.days.find(day => day.date === date).working, true);
  for (const date of ["2026-10-01", "2026-10-03", "2026-10-24"]) assert.equal(schedule.days.find(day => day.date === date).working, false);
  const unknown = core.monthSchedule("2026-12", [], {}, "2026-11-03", { start: "2026-10-01", end: "2026-11-30" });
  assert.ok(unknown.days.every(day => !day.covered && !day.working));
});

function row(id, userId = "me") {
  return { Id: id, UserId: userId, ReportDateStr: "2026-10-17", ProjectNo: "P", WorkHour: "8.00" };
}
function jsonResponse(data) { return { ok: true, json: async () => data }; }

test("历史接口读取全部分页并只保留当前用户", async () => {
  const data = Array.from({ length: 235 }, (_, i) => row(500 - i, i % 2 ? "other" : "me"));
  const calls = [];
  const fetcher = async address => {
    const url = new URL(address);
    const page = Number(url.searchParams.get("pageIndex"));
    calls.push(page);
    assert.equal(url.searchParams.get("startdate"), "2026-10-01");
    assert.equal(url.searchParams.get("enddate"), "2026-10-31");
    assert.equal(url.searchParams.get("status"), "");
    return jsonResponse({ total: data.length, rows: data.slice((page - 1) * 200, page * 200) });
  };
  const result = await api.readHistory({ fetcher, base: "http://example.test", start: "2026-10-01", end: "2026-10-31", userId: "me" });
  assert.equal(result.length, 118);
  assert.deepEqual(calls, [1, 2, 1]);
  assert.ok(result.every(item => item.UserId === "me"));
});

test("不完整、变动或格式不明的历史记录会中止", async () => {
  const args = { base: "http://example.test", start: "2026-10-01", end: "2026-10-31", userId: "me" };
  await assert.rejects(api.readHistory({ ...args, fetcher: async () => jsonResponse({ total: 2, rows: [row(1)] }) }), /不完整/);
  await assert.rejects(api.readHistory({ ...args, fetcher: async () => jsonResponse({ total: 1, rows: [{ ...row(1), ReportDateStr: "2026-09-30" }] }) }), /日期范围异常/);
  await assert.rejects(api.readHistory({ ...args, fetcher: async () => ({ ok: true, json: async () => { throw Error(); } }) }), /重新登录/);
  const data = Array.from({ length: 201 }, (_, i) => row(500 - i));
  let pageOneCalls = 0;
  const changing = async address => {
    const page = Number(new URL(address).searchParams.get("pageIndex"));
    if (page === 1) pageOneCalls++;
    const rows = data.slice((page - 1) * 200, page * 200);
    if (page === 1 && pageOneCalls === 2) rows[0] = row(999);
    return jsonResponse({ total: data.length, rows });
  };
  await assert.rejects(api.readHistory({ ...args, fetcher: changing }), /发生变化/);
});

function item(date) { return { date, selected: true, reported: [] }; }

test("提交前再次查重；提交后回查并确认项目和工时", async () => {
  const items = [item("2026-10-19"), item("2026-10-20")];
  const calls = [];
  const seen = new Map();
  const result = await runner.runQueue({
    items, projectName: "P", matches: api.matchingSubmission,
    getHistory: async date => {
      calls.push(`check:${date}`);
      if (date === "2026-10-19") return [row(1)];
      return seen.has(date) ? [row(2)] : [];
    },
    prepare: async date => date,
    send: async date => { calls.push(`submit:${date}`); seen.set(date, true); return { resultCode: 1 }; }
  });
  assert.deepEqual(result, { completed: 1, skipped: 1 });
  assert.deepEqual(calls, ["check:2026-10-19", "check:2026-10-20", "submit:2026-10-20", "check:2026-10-20"]);
  assert.equal(items[1].selected, false);
});

test("再次运行相同配置时，所有已填日期都跳过且不发送提交", async () => {
  const existing = [row(1), { ...row(2), ProjectNo: "OTHER", WorkHour: "4.00" }];
  let sends = 0;
  const result = await runner.runQueue({
    items: [item("2026-10-19"), item("2026-10-20")], projectName: "P", matches: api.matchingSubmission,
    getHistory: async date => date === "2026-10-19" ? [existing[0]] : [existing[1]],
    prepare: async () => ({}), send: async () => { sends++; return {}; }
  });
  assert.deepEqual(result, { completed: 0, skipped: 2 });
  assert.equal(sends, 0);
});

test("发送超时但回查成功时不重复发送", async () => {
  let checks = 0;
  let sends = 0;
  const result = await runner.runQueue({
    items: [item("2026-10-19")], projectName: "P", matches: api.matchingSubmission,
    getHistory: async () => ++checks === 1 ? [] : [row(1)],
    prepare: async () => ({}),
    send: async () => { sends++; throw new Error("timeout"); }
  });
  assert.equal(result.completed, 1);
  assert.equal(sends, 1);
});

test("提交结果不明时立即停止，不重试或处理后续日期", async () => {
  const items = [item("2026-10-19"), item("2026-10-20")];
  let checks = 0;
  let sends = 0;
  await assert.rejects(runner.runQueue({
    items, projectName: "P", matches: api.matchingSubmission,
    getHistory: async () => { if (++checks === 2) throw new Error("offline"); return []; },
    prepare: async () => ({}), send: async () => { sends++; return {}; }
  }), /回查失败，结果不明/);
  assert.equal(sends, 1);
  assert.equal(checks, 2);
});

test("服务器拒绝当前日期时保留已确认数量并停止", async () => {
  let sends = 0;
  let historyCalls = 0;
  const items = [item("2026-10-19"), item("2026-10-20"), item("2026-10-21")];
  await assert.rejects(runner.runQueue({
    items, projectName: "P", matches: api.matchingSubmission,
    getHistory: async () => ++historyCalls === 2 ? [row(1)] : [],
    prepare: async () => ({}), send: async () => ({ resultCode: ++sends === 1 ? 1 : -4 })
  }), error => error.completed === 1 && /本年度/.test(error.message));
  assert.equal(sends, 2);
});
