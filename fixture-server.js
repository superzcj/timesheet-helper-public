// Local-only mock. It never connects to the work system.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = 18763;
const base = `http://127.0.0.1:${port}`;
const files = new Set(["core.js", "api.js", "runner.js", "content.js"]);
const form = `<form action="/Data/AddWorkReport" method="post">
<input name="__RequestVerificationToken" value="fixture-token" type="hidden">
<input id="hidUserId" name="UserId" value="fixture-user" type="hidden">
<input id="txtUserName" name="UserName" value="模拟人员" readonly>
<input name="ReportDate"><input name="ProjectId"><input name="WorkHour">
</form><ul id="ProjectId"><li><a data-value="fixture-project">模拟项目</a></li></ul>`;

function page(isList) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>工时助手模拟页面</title>
<body><h1>工时助手模拟页面（仅模拟数据）</h1>
${isList ? '<p>工时列表</p><a href="/Data/AddWorkReport">新增</a>' : form}
<script>
  window.confirm = () => true; // Only the fixture auto-confirms simulated submissions.
  window.chrome = window.chrome || {};
  window.chrome.runtime = {getURL: name => location.origin + "/" + name};
  const fixtureForm = ${JSON.stringify(form)};
  const rows = [{Id: 1, UserId: "fixture-user", ReportDateStr: "2026-10-20", ProjectNo: "模拟项目", WorkHour: "8.00"}];
  const response = (body, type, url) => { const r = new Response(body, {status: 200, headers: {"Content-Type": type}}); Object.defineProperty(r, "url", {value: url}); return r; };
  window.fetch = async (address, options = {}) => {
    const url = new URL(address, location.origin);
    if (url.origin !== location.origin) throw Error("Mock blocks external network");
    if (url.pathname === "/workdays.json") return response(JSON.stringify({schemaVersion:1,updatedAt:"2026-11-03",coverage:{start:"2026-10-01",end:"2026-11-30"},workdays:["2026-10-19","2026-10-20","2026-10-21","2026-11-02","2026-11-03","2026-11-10"]}), "application/json", url.href);
    if (url.pathname === "/Data/GetWorkReportList") {
      const selected = rows.filter(r => r.ReportDateStr >= url.searchParams.get("startdate") && r.ReportDateStr <= url.searchParams.get("enddate"));
      const page = Number(url.searchParams.get("pageIndex")); const size = Number(url.searchParams.get("pageSize"));
      return response(JSON.stringify({total:selected.length, rows:selected.slice((page-1)*size,page*size)}), "application/json", url.href);
    }
    if (url.pathname === "/Data/AddWorkReport" && options.method === "POST") {
      const data = options.body;
      if (data.get("__RequestVerificationToken") !== "fixture-token" || data.get("UserId") !== "fixture-user" || data.get("ProjectId") !== "fixture-project" || data.get("WorkHour") !== "8") throw Error("Bad mock form");
      rows.push({Id: rows.length + 1, UserId: "fixture-user", ReportDateStr: data.get("ReportDate"), ProjectNo: "模拟项目", WorkHour: "8.00"});
      return response("<script>var result = '1';<" + "/script>", "text/html", url.href);
    }
    if (url.pathname === "/Data/AddWorkReport") return response(fixtureForm, "text/html", url.href);
    throw Error("Mock route not found");
  };
</script><script src="/core.js"></script><script src="/api.js"></script><script src="/runner.js"></script><script src="/content.js"></script></body></html>`;
}

http.createServer((req, res) => {
  const name = new URL(req.url, base).pathname.slice(1);
  if (name === "Data/AddWorkReport" || name === "Data/WorkReportList") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(page(name === "Data/WorkReportList"));
  }
  if (files.has(name)) {
    let content = fs.readFileSync(path.join(__dirname, name), "utf8");
    if (name === "content.js") content = content.replace('location.origin !== "http://192.168.0.21:83"', `location.origin !== "${base}"`);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    return res.end(content);
  }
  res.statusCode = 404;
  res.end("Not found");
}).listen(port, "127.0.0.1", () => console.log(`Mock fixture: ${base}/Data/WorkReportList`));
