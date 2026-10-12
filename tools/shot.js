/* 截图检查页面渲染：node tools/shot.js [查询词] */
const path = require("path");
const nm = "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const { chromium } = require(path.join(nm, "playwright"));

const query = process.argv[2] || "";
const out = process.argv[3] || path.join(__dirname, "..", ".preview", "shot.png");
const url = "http://127.0.0.1:8123/" + (query ? "?q=" + encodeURIComponent(query) : "");

(async () => {
  let browser;
  for (const channel of ["msedge", "chrome", undefined]) {
    try {
      browser = await chromium.launch({ channel, headless: true });
      console.log("launched:", channel || "bundled");
      break;
    } catch (e) {
      console.log("launch failed:", channel || "bundled", e.message.split("\n")[0]);
    }
  }
  if (!browser) process.exit(1);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: out, fullPage: false });
  console.log("saved:", out, "| 控制台错误:", errors.length ? errors.join(" | ") : "无");
  console.log("摘要:", await page.textContent("#summary"));
  if (process.env.SHOT_HTML) {
    const html = await page.$$eval("#results .card", (els) => els.slice(0, 2).map((e) => e.outerHTML));
    console.log(html.join("\n---\n"));
  }
  await browser.close();
})();
