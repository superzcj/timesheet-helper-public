(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TimesheetAPI = api;
})(globalThis, function () {
  "use strict";

  const PAGE_SIZE = 200;

  async function getPage(fetcher, base, start, end, page) {
    const url = new URL("/Data/GetWorkReportList", base);
    const params = { pageSize: PAGE_SIZE, pageIndex: page, orderName: "Id", orderStyle: "desc", keyWord: "", status: "", startdate: start, enddate: end };
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    let response;
    try {
      response = await fetcher(url.href, { method: "GET", credentials: "same-origin", cache: "no-store" });
    } catch (_) {
      throw new Error("无法读取历史记录，请检查网络和登录状态。");
    }
    if (!response.ok) throw new Error(`读取历史记录失败（HTTP ${response.status}）。`);
    let result;
    try { result = await response.json(); }
    catch (_) { throw new Error("历史记录返回格式异常，可能需要重新登录。"); }
    const total = Number(result && result.total);
    if (!result || !Number.isSafeInteger(total) || total < 0 || !Array.isArray(result.rows)) {
      throw new Error("历史记录返回格式异常，已停止以免漏查。");
    }
    const expected = Math.min(PAGE_SIZE, Math.max(0, total - (page - 1) * PAGE_SIZE));
    if (result.rows.length !== expected) throw new Error("历史记录页数不完整，已停止以免漏查。");
    for (const row of result.rows) {
      if (!row || row.Id == null || typeof row.UserId !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(row.ReportDateStr || "") ||
          row.ReportDateStr < start || row.ReportDateStr > end) {
        throw new Error("历史记录字段或日期范围异常，已停止以免漏查。");
      }
    }
    return { total, rows: result.rows };
  }

  async function readHistory({ fetcher = fetch, base, start, end, userId }) {
    if (!userId) throw new Error("无法识别当前登录人员。");
    const first = await getPage(fetcher, base, start, end, 1);
    if (first.total > 10000) throw new Error("历史记录过多，请缩小日期范围。");
    const all = [...first.rows];
    const seen = new Set(all.map(row => String(row.Id)));
    if (seen.size !== all.length) throw new Error("历史记录出现重复条目，已停止以免漏查。");
    const pages = Math.ceil(first.total / PAGE_SIZE);
    for (let page = 2; page <= pages; page++) {
      const part = await getPage(fetcher, base, start, end, page);
      if (part.total !== first.total) throw new Error("读取期间历史记录发生变化，请重新预览。");
      for (const row of part.rows) {
        const id = String(row.Id);
        if (seen.has(id)) throw new Error("历史记录分页发生变化，请重新预览。");
        seen.add(id);
        all.push(row);
      }
    }
    if (pages > 1) {
      const check = await getPage(fetcher, base, start, end, 1);
      if (check.total !== first.total || check.rows.some((row, i) => String(row.Id) !== String(first.rows[i].Id))) {
        throw new Error("读取期间历史记录发生变化，请重新预览。");
      }
    }
    return all.filter(row => row.UserId === userId);
  }

  function matchingSubmission(records, projectNo) {
    return records.some(row => String(row.ProjectNo || "").trim() === projectNo && Number(row.WorkHour) === 8);
  }

  return { PAGE_SIZE, readHistory, matchingSubmission };
});
