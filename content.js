(function () {
  "use strict";
  if (window.top !== window.self || location.origin !== "http://192.168.0.21:83" ||
      !/^\/Data\/(?:AddWorkReport|WorkReportList)\/?$/i.test(location.pathname)) return;
  if (document.getElementById("timesheet-helper-root")) return;

  const core = globalThis.TimesheetCore;
  const api = globalThis.TimesheetAPI;
  const runner = globalThis.TimesheetRunner;
  const root = document.createElement("div");
  root.id = "timesheet-helper-root";
  document.documentElement.appendChild(root);
  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{all:initial;font:14px/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1d3039}
      *{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.5}[hidden]{display:none!important}
      .launch{position:fixed;right:24px;bottom:24px;z-index:2147483000;border:0;border-radius:24px;padding:12px 18px;background:#176f8e;color:#fff;font-weight:700;box-shadow:0 6px 22px #163b4e40}
      .panel{position:fixed;right:24px;bottom:24px;z-index:2147483001;width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #d9e4e8;border-radius:14px;background:#fff;box-shadow:0 14px 50px #17394a40}
      header{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;background:#16475a;color:#fff}header strong{font-size:17px}.close{border:0;background:transparent;color:#fff;font-size:23px;line-height:1}
      main{padding:16px 18px;overflow:auto}.meta{color:#5f7680;font-size:12px;margin:0 0 12px}.project,.month{display:flex;align-items:center;gap:10px;font-weight:600}select,input[type=month]{border:1px solid #bacbd2;border-radius:6px;background:#fff;color:#233942;padding:7px;min-width:0}select{flex:1}.month{margin:14px 0 4px}.month input{margin-left:auto}.calendar-help{font-size:12px;color:#657b84;margin:5px 0 8px}.calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.weekday{text-align:center;color:#73858d;font-size:12px;padding:4px}.day{border:1px solid #e4eaed;border-radius:7px;background:#f7f9fa;color:#7a8a91;min-height:43px;padding:4px 1px;line-height:1.2}.day.work{border-color:#87c6d2;background:#e8f6f8;color:#155d70}.day.unknown{background:#fff8ec;border-color:#f0dfbe;color:#977342}.day small{display:block;font-size:10px;margin-top:2px}.day.filled{box-shadow:inset 0 -2px #3b9b73}.day.future{opacity:.75}.day:focus-visible{outline:2px solid #176f8e;outline-offset:1px}
      .day:disabled{opacity:1;cursor:default}.day.future{opacity:.75}.calendar-note{font-size:12px;color:#936027;margin:8px 0 0}.actions{display:flex;gap:8px;margin-top:14px}.primary,.secondary{border-radius:7px;padding:9px 13px;font-weight:650}.primary{background:#176f8e;color:#fff;border:1px solid #176f8e}.secondary{background:#fff;color:#176f8e;border:1px solid #a6c9d3}.actions .primary{flex:1}
      .status{margin:12px 0 0;color:#526a76;white-space:pre-wrap;font-size:13px;min-height:18px}.status.error{color:#b2332a}.result{border-top:1px solid #e1eaed;margin-top:13px;padding-top:12px}.summary{font-weight:700;margin:0 0 8px}.rows{max-height:225px;overflow:auto;border:1px solid #e3ecef;border-radius:7px}.row{display:flex;align-items:center;gap:9px;padding:7px 9px;border-bottom:1px solid #edf2f4}.row:last-child{border:0}.row input{accent-color:#176f8e}.row small{color:#71858c;margin-left:auto}.empty{padding:10px;color:#667d86}.filled{margin-top:9px;color:#71858c;font-size:12px}
      summary{cursor:pointer;color:#356a7d;font-weight:600}
      @media(max-width:440px){.panel{right:8px;bottom:8px;width:calc(100vw - 16px)}}
    </style>
    <button class="launch" type="button">工时助手</button>
    <section class="panel" aria-label="工时填报助手" hidden>
      <header><strong>工时填报</strong><button class="close" type="button" aria-label="关闭">×</button></header>
      <main>
        <p class="meta" id="meta">正在读取账号和日期配置…</p>
        <label class="project">项目 <select id="project" disabled><option value="">正在读取…</option></select></label>
        <label class="month">选择月份 <input id="month" type="month" disabled></label>
        <p class="calendar-help">点击上班日可标记个人休息；绿线表示已填，问号表示排班未配置。</p>
        <div class="calendar" id="calendar" aria-label="月度排班"></div>
        <p class="calendar-note" id="calendar-note" hidden></p>
        <div class="actions"><button class="secondary" id="check" type="button" disabled>检查待填</button><button class="primary" id="submit" type="button" disabled>提交所选</button></div>
        <p class="status" id="status" role="status" aria-live="polite"></p>
        <section class="result" id="result" hidden>
          <p class="summary" id="summary"></p>
          <div class="rows" id="rows"></div>
          <details class="filled" id="filled-details" hidden><summary id="filled-summary"></summary><div id="filled"></div></details>
        </section>
      </main>
    </section>`;

  const $ = selector => shadow.querySelector(selector);
  const SETTINGS_KEY = "timesheet-helper-settings-v1";
  const OVERRIDES_KEY = "timesheet-helper-overrides-v1";
  let context = null;
  let contextDoc = null;
  let contextPromise = null;
  let frame = null;
  let config = null;
  let overrides = {};
  let calendarDays = [];
  let lastRecords = null;
  let lastRecordsMonth = "";
  let plan = null;
  let busy = false;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch (_) {}
  try { core.monthSchedule(saved.month); $("#month").value = saved.month; }
  catch (_) { $("#month").value = core.shanghaiToday().slice(0, 7); }

  function status(message, isError = false) {
    $("#status").textContent = message;
    $("#status").classList.toggle("error", isError);
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ project: $("#project").value, month: $("#month").value })); } catch (_) {}
  }
  function projects() {
    return [...(contextDoc?.querySelectorAll("#ProjectId a[data-value]") || [])]
      .map(el => ({ id: el.getAttribute("data-value")?.trim(), name: el.textContent.trim() }))
      .filter(item => item.id && item.name);
  }
  function updateProjectOptions() {
    const options = projects();
    const select = $("#project");
    const old = select.value || saved.project || "";
    select.replaceChildren(new Option(options.length ? "请选择项目" : "没有可选项目", ""));
    for (const item of options) select.add(new Option(item.name, item.id));
    select.value = options.some(item => item.id === old) ? old : options.length === 1 ? options[0].id : "";
    select.disabled = busy || options.length === 0;
    updateControls();
  }
  function updateMeta() {
    const who = context?.name || "读取账号中";
    const date = config?.updatedAt || "未设置";
    $("#meta").textContent = `${who} · 每天 8 小时 · 排班更新 ${date}`;
  }
  function invalidate() {
    plan = null;
    $("#result").hidden = true;
    updateControls();
  }
  function updateControls() {
    const selected = plan ? plan.filter(item => item.selected).length : 0;
    $("#check").disabled = busy || !context;
    $("#submit").disabled = busy || !plan || selected === 0;
    $("#submit").textContent = selected ? `提交所选 ${selected} 天` : "提交所选";
  }
  function setBusy(value) {
    busy = value;
    $("#project").disabled = value || !context || !projects().length;
    $("#month").disabled = value || !context;
    $(".close").disabled = value;
    shadow.querySelectorAll(".day").forEach(button => { button.disabled = value || button.dataset.configured !== "true"; });
    updateControls();
  }
  function readOverrides() {
    if (!context) return {};
    try {
      const all = JSON.parse(localStorage.getItem(`${OVERRIDES_KEY}:${context.userId}`) || "{}");
      const value = all && typeof all === "object" && !Array.isArray(all) ? all[$("#month").value] : null;
      return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
    } catch (_) { return {}; }
  }
  function saveOverrides() {
    if (!context) return false;
    try {
      const key = `${OVERRIDES_KEY}:${context.userId}`;
      let all = JSON.parse(localStorage.getItem(key) || "{}");
      if (!all || typeof all !== "object" || Array.isArray(all)) all = {};
      all[$("#month").value] = overrides;
      localStorage.setItem(key, JSON.stringify(all));
      return true;
    } catch (_) { return false; }
  }
  function renderCalendar() {
    const schedule = core.monthSchedule($("#month").value, config?.workdays || [], overrides, core.shanghaiToday(), config?.coverage || null);
    calendarDays = schedule.days;
    const missing = schedule.days.filter(day => !day.covered).length;
    const extra = schedule.days.filter(day => overrides[day.date] === true && !day.configured).length;
    const notes = [];
    if (missing) notes.push(`${missing} 天排班未配置，不会填报；请更新工具。`);
    if (extra) notes.push(`此前有 ${extra} 天手动标为上班，但不在排班配置中；请更新排班。`);
    $("#calendar-note").textContent = notes.join(" ");
    $("#calendar-note").hidden = notes.length === 0;
    const reported = new Set((lastRecords || []).map(item => item.ReportDateStr));
    const grid = $("#calendar");
    grid.replaceChildren();
    for (const label of ["一", "二", "三", "四", "五", "六", "日"]) {
      const heading = document.createElement("span");
      heading.className = "weekday";
      heading.textContent = label;
      grid.appendChild(heading);
    }
    for (let i = 0; i < schedule.offset; i++) grid.appendChild(document.createElement("span"));
    for (const day of schedule.days) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `day${day.working ? " work" : ""}${!day.covered ? " unknown" : ""}${day.future ? " future" : ""}${reported.has(day.date) ? " filled" : ""}`;
      button.dataset.configured = String(day.configured);
      button.disabled = busy || !day.configured;
      button.setAttribute("aria-pressed", String(day.working));
      button.setAttribute("aria-label", `${day.date} ${!day.covered ? "未配置" : day.working ? "上班" : "休息"}${reported.has(day.date) ? "，已填" : ""}`);
      const number = document.createElement("span"); number.textContent = String(day.day);
      const state = document.createElement("small"); state.textContent = !day.covered ? "?" : day.working ? "班" : "休";
      button.append(number, state);
      button.addEventListener("click", () => {
        if (day.working) overrides[day.date] = false;
        else delete overrides[day.date];
        const persisted = saveOverrides();
        renderCalendar();
        afterCalendarChange(persisted);
      });
      grid.appendChild(button);
    }
  }
  function activateMonth() {
    overrides = readOverrides();
    lastRecords = null;
    lastRecordsMonth = "";
    invalidate();
    renderCalendar();
  }
  function rebuildPlan() {
    const dates = calendarDays.filter(day => day.working && !day.future).map(day => day.date);
    plan = dates.length ? core.buildPlan({ dateText: dates.join("\n"), records: lastRecords || [] }) : [];
    renderRows();
    $("#result").hidden = false;
  }
  function afterCalendarChange(persisted = true) {
    if (lastRecords && lastRecordsMonth === $("#month").value) {
      rebuildPlan();
      status(persisted ? "日期已调整，提交前会再次查重。" : "休息日无法保存，下次打开时请重新核对。", !persisted);
    } else {
      invalidate();
      status(persisted ? "日期已调整，请检查待填。" : "休息日无法保存，下次打开时请重新核对。", !persisted);
    }
  }
  function renderRows() {
    const pending = (plan || []).filter(item => !item.reported.length);
    const filled = [...new Set([...(lastRecords || []), ...(plan || []).flatMap(item => item.reported)]
      .map(item => item.ReportDateStr))].sort();
    $("#summary").textContent = `待填 ${pending.length} 天 · 已填 ${filled.length} 天`;
    const rows = $("#rows");
    rows.replaceChildren();
    for (const item of pending) {
      const row = document.createElement("div");
      row.className = "row";
      const date = document.createElement("span");
      date.textContent = `${item.date} 周${item.weekday}`;
      const hours = document.createElement("small");
      hours.textContent = "8 小时";
      row.append(date, hours);
      rows.appendChild(row);
    }
    if (!pending.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "没有待填日期。";
      rows.appendChild(empty);
    }
    $("#filled-details").hidden = !filled.length;
    $("#filled-summary").textContent = `查看已填日期（${filled.length}）`;
    $("#filled").textContent = filled.join("、");
    updateControls();
  }
  async function timedFetch(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }
  function waitForProjects(doc) {
    if (projects().length) return Promise.resolve();
    const container = doc.querySelector("#ProjectId");
    if (!container) return Promise.reject(new Error("无法读取项目列表，请刷新页面。"));
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (projects().length) { clearTimeout(timer); observer.disconnect(); resolve(); }
      });
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error("没有读取到可用项目，请检查账号或刷新页面。")); }, 8000);
      observer.observe(container, { childList: true, subtree: true, attributes: true });
      if (projects().length) { clearTimeout(timer); observer.disconnect(); resolve(); }
    });
  }
  async function getContextDocument() {
    if (document.querySelector("#hidUserId") && document.querySelector("#ProjectId")) return document;
    frame = document.createElement("iframe");
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.src = "/Data/AddWorkReport";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("读取账号信息超时，请刷新页面。")), 15000);
      frame.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
      frame.addEventListener("error", () => { clearTimeout(timer); reject(new Error("无法读取账号信息，请刷新页面。")); }, { once: true });
      document.body.appendChild(frame);
    });
    try { return frame.contentDocument; } catch (_) { return null; }
  }
  async function loadContext() {
    if (contextPromise) return contextPromise;
    contextPromise = (async () => {
      contextDoc = await getContextDocument();
      const userId = contextDoc?.querySelector("#hidUserId")?.value?.trim();
      const name = contextDoc?.querySelector("#txtUserName")?.value?.trim();
      if (!userId || !name) throw new Error("无法识别登录账号，请重新登录后刷新。");
      context = { userId, name };
      await waitForProjects(contextDoc);
      updateProjectOptions();
      updateMeta();
    })();
    try { await contextPromise; }
    catch (error) { context = null; contextPromise = null; frame?.remove(); frame = null; throw error; }
  }
  function setConfig(raw) {
    core.validateWorkdays(raw);
    config = raw;
    updateMeta();
  }
  async function loadConfig() {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.getURL) throw new Error();
      const response = await timedFetch(chrome.runtime.getURL("workdays.json"), { cache: "no-store" });
      if (!response.ok) throw new Error();
      setConfig(await response.json());
    } catch (_) { config = null; updateMeta(); }
  }
  async function history(start, end) {
    return api.readHistory({ fetcher: timedFetch, base: location.origin, start, end, userId: context.userId });
  }
  async function createPostData(date, projectId) {
    const response = await timedFetch(`${location.origin}/Data/AddWorkReport`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok || new URL(response.url).origin !== location.origin || !/\/Data\/AddWorkReport\/?$/i.test(new URL(response.url).pathname)) throw new Error("无法读取新增表单，请检查登录状态。");
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const form = doc.querySelector('form[action="/Data/AddWorkReport"]');
    const token = form?.querySelector('[name="__RequestVerificationToken"]')?.value;
    const user = form?.querySelector('[name="UserId"]')?.value?.trim();
    const name = form?.querySelector('[name="UserName"]')?.value?.trim();
    if (!form || !token || user !== context.userId || name !== context.name) throw new Error("登录账号或表单信息已变化，请刷新页面。");
    if (!projects().some(project => project.id === projectId)) throw new Error("项目列表已变化，请重新检查。");
    const data = new URLSearchParams(new FormData(form));
    data.set("ReportDate", date); data.set("ProjectId", projectId); data.set("WorkHour", "8");
    return data;
  }
  async function preview() {
    if (busy) return;
    try {
      if (!context) throw new Error("无法识别登录账号，请刷新页面。");
      if (!$("#project").value) throw new Error("请选择项目。");
      const month = $("#month").value;
      const schedule = core.monthSchedule(month, config?.workdays || [], overrides, core.shanghaiToday(), config?.coverage || null);
      setBusy(true);
      invalidate();
      status("正在检查已填记录…");
      const today = core.shanghaiToday();
      const first = schedule.days[0].date;
      const last = schedule.days[schedule.days.length - 1].date;
      lastRecords = first <= today ? await history(first, last < today ? last : today) : [];
      lastRecordsMonth = month;
      renderCalendar();
      rebuildPlan();
      saveSettings();
      status("点击上班日可标记个人休息；未来日期暂不填报。");
    } catch (error) {
      lastRecords = null;
      lastRecordsMonth = "";
      invalidate();
      status(error.message || "查询失败，请重试。", true);
    } finally { setBusy(false); if (plan) renderRows(); }
  }
  async function submit() {
    if (busy || !plan) return;
    const queue = plan.filter(item => item.selected);
    if (!queue.length) return;
    const projectId = $("#project").value;
    const projectName = $("#project").selectedOptions[0].textContent.trim();
    if (!window.confirm(`将为 ${context.name} 向项目 ${projectName} 提交 ${queue.length} 天工时，每天 8 小时。\n\n${queue.map(item => item.date).join("、")}\n\n确定继续吗？`)) return;
    setBusy(true);
    try {
      const result = await runner.runQueue({
        items: queue, projectName, getHistory: date => history(date, date),
        prepare: date => createPostData(date, projectId), matches: api.matchingSubmission,
        onState: (state, item) => {
          if (state === "checking") status(`正在检查 ${item.date}…`);
          if (state === "submitting") status(`正在提交 ${item.date}…`);
          if (state === "skipped" || state === "completed") {
            const known = new Set((lastRecords || []).map(row => String(row.Id)));
            for (const row of item.reported) if (!known.has(String(row.Id))) (lastRecords || (lastRecords = [])).push(row);
            renderCalendar();
            renderRows();
          }
        },
        send: async body => {
          const response = await timedFetch(`${location.origin}/Data/AddWorkReport`, { method: "POST", credentials: "same-origin", body, redirect: "follow", cache: "no-store" });
          const error = response.ok ? null : `HTTP ${response.status}`;
          const html = await response.text();
          const match = html.match(/\bvar\s+result\s*=\s*(['"]?)(-?\d+)\1\s*;/);
          return { error, resultCode: match ? Number(match[2]) : null };
        }
      });
      status(`完成：已确认 ${result.completed} 天，跳过 ${result.skipped} 天。`);
    } catch (error) {
      status(`${error.message || "操作中断。"}\n已确认 ${error.completed || 0} 天；后续日期未提交。`, true);
      lastRecords = null;
      lastRecordsMonth = "";
      plan.forEach(item => { item.selected = false; });
    } finally { setBusy(false); renderRows(); }
  }

  $(".launch").addEventListener("click", async () => {
    $(".panel").hidden = false;
    $(".launch").hidden = true;
    status("正在读取账号和项目…");
    setBusy(true);
    try {
      await Promise.all([loadContext(), loadConfig()]);
      setBusy(false);
      activateMonth();
      if (!$("#project").value) status("请选择项目，然后检查待填日期。");
      else await preview();
    } catch (error) { setBusy(false); status(error.message || "读取失败，请刷新页面。", true); }
  });
  $(".close").addEventListener("click", () => { if (!busy) { $(".panel").hidden = true; $(".launch").hidden = false; } });
  $("#project").addEventListener("change", () => { invalidate(); saveSettings(); status("项目已更改，请重新检查。"); });
  $("#month").addEventListener("change", async () => {
    try {
      activateMonth();
      saveSettings();
      if (context && $("#project").value) await preview();
      else status("请选择项目，然后检查待填日期。");
    } catch (error) { invalidate(); status(error.message || "请选择有效月份。", true); }
  });
  $("#check").addEventListener("click", preview);
  $("#submit").addEventListener("click", submit);
})();
