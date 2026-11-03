(function (root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  root.TimesheetCore = core;
})(globalThis, function () {
  "use strict";

  const DAY = 86400000;
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

  function parseDate(value, label = "日期") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
      throw new Error(`${label}请使用 YYYY-MM-DD 格式。`);
    }
    const [year, month, day] = value.split("-").map(Number);
    if (year < 1900 || year > 2100) throw new Error(`${label}年份超出范围。`);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new Error(`${label}不是有效日期。`);
    }
    return date;
  }

  function formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function shanghaiToday(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function parseDateList(value, label) {
    const dates = new Set();
    for (const item of (value || "").split(/[\s,，;；、]+/).filter(Boolean)) {
      parseDate(item, label);
      dates.add(item);
    }
    return dates;
  }

  function validateWorkdays(config, today = shanghaiToday()) {
    parseDate(today, "今天");
    if (!config || typeof config !== "object" || Array.isArray(config) || config.schemaVersion !== 1) {
      throw new Error("日期配置格式不支持，schemaVersion 必须为 1。");
    }
    if (!Array.isArray(config.workdays) || config.workdays.length > 1000) {
      throw new Error("日期配置的 workdays 必须是日期数组，最多包含 1000 项。");
    }
    const updatedAt = config.updatedAt;
    if (typeof updatedAt !== "string" || (config.workdays.length && !updatedAt)) {
      throw new Error("日期配置需要填写 updatedAt 更新日期。");
    }
    if (updatedAt) parseDate(updatedAt, "配置更新日期");
    const coverage = config.coverage;
    if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
      throw new Error("日期配置需要填写 coverage 覆盖范围。");
    }
    const coverageStart = parseDate(coverage.start, "配置开始日期");
    const coverageEnd = parseDate(coverage.end, "配置结束日期");
    if (coverageStart > coverageEnd || (coverageEnd - coverageStart) / DAY > 365) {
      throw new Error("配置覆盖范围无效或超过 366 天。");
    }
    for (const date of config.workdays) {
      if (typeof date !== "string") throw new Error("日期配置中的工作日期必须是字符串。");
      parseDate(date, "配置中的工作日期");
      if (date < coverage.start || date > coverage.end) throw new Error("工作日期超出配置覆盖范围。");
    }
    const dates = [...new Set(config.workdays)].sort();
    if (dates.length > 1 && (parseDate(dates[dates.length - 1]) - parseDate(dates[0])) / DAY > 365) {
      throw new Error("日期配置的跨度不能超过 366 天，请按年度或更短周期维护。");
    }
    return {
      updatedAt, dates, available: dates.filter(date => date <= today),
      futureCount: dates.filter(date => date > today).length,
      duplicates: config.workdays.length - dates.length, coverage: { start: coverage.start, end: coverage.end }
    };
  }

  function monthSchedule(month, workdays = [], overrides = {}, today = shanghaiToday(), coverage = null) {
    if (!/^\d{4}-\d{2}$/.test(month || "")) throw new Error("请选择有效月份。");
    const first = parseDate(`${month}-01`, "月份");
    parseDate(today, "今天");
    const year = first.getUTCFullYear();
    const monthIndex = first.getUTCMonth();
    const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const work = new Set(workdays);
    const days = [];
    for (let day = 1; day <= count; day++) {
      const date = formatDate(new Date(Date.UTC(year, monthIndex, day)));
      const configured = work.has(date);
      const covered = Boolean(coverage && date >= coverage.start && date <= coverage.end);
      const personalRest = configured && overrides[date] === false;
      days.push({ date, day, weekday: weekdays[new Date(Date.UTC(year, monthIndex, day)).getUTCDay()], configured,
        covered, working: configured && !personalRest, future: date > today });
    }
    return { month, offset: (first.getUTCDay() + 6) % 7, days };
  }

  function buildPlan({ dateText = "", records = [], today = shanghaiToday() }) {
    parseDate(today, "今天");
    const dates = [...parseDateList(dateText, "填报日期")].sort();
    if (!dates.length) throw new Error("请至少输入或选择一个填报日期。");
    if (dates.some(date => date > today)) throw new Error("填报日期不能晚于今天。");
    if ((parseDate(dates[dates.length - 1]) - parseDate(dates[0])) / DAY > 365) {
      throw new Error("单次选择的日期跨度不能超过 366 天，请分批填报。");
    }

    const byDate = new Map();
    for (const row of records) {
      parseDate(row.ReportDateStr, "历史记录日期");
      const date = row.ReportDateStr;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(row);
    }

    return dates.map(iso => {
      const date = parseDate(iso);
      const weekday = date.getUTCDay();
      const reported = byDate.get(iso) || [];
      return { date: iso, weekday: weekdays[weekday], reported, selected: reported.length === 0 };
    });
  }

  return { DAY, parseDate, formatDate, parseDateList, validateWorkdays, monthSchedule, shanghaiToday, buildPlan };
});
