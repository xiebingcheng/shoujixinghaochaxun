/* 交互自测：node tools/e2e.js（需要先启动 python -m http.server 8123 --directory docs） */
const path = require("path");
const nm = "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const { chromium } = require(path.join(nm, "playwright"));

const BASE = "http://127.0.0.1:8123/";
const out = (name) => path.join(__dirname, "..", ".preview", name);
const logs = [];

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") logs.push("console: " + m.text()); });

  await page.goto(BASE, { waitUntil: "networkidle" });

  // 1. 切到 Y 开头
  await page.click('.tab[data-prefix="Y"]');
  await page.waitForTimeout(200);
  const yCards = await page.locator("#results .card").count();
  console.log("Y 标签卡片数:", yCards, "(应为 18)");
  console.log("摘要:", await page.textContent("#summary"));

  // 2. 搜索 + 展开相近结果
  await page.click('.tab[data-prefix="ALL"]');
  await page.fill("#q", "苹果13");
  await page.waitForTimeout(350);
  console.log("搜索摘要:", await page.textContent("#summary"));
  const fuzzyBtn = page.locator("#fuzzy-toggle");
  if (await fuzzyBtn.count()) {
    await fuzzyBtn.click();
    await page.waitForTimeout(200);
    console.log("展开后卡片数:", await page.locator("#results .card").count());
  }

  // 3. 点卡片复制
  await page.click("#results .card");
  await page.waitForTimeout(250);
  console.log("提示:", (await page.textContent("#toast")).trim());
  console.log("URL:", page.url());

  // 4. 单字查询不应报错
  await page.fill("#q", "S");
  await page.waitForTimeout(300);
  console.log("单字查询:", await page.textContent("#summary"));

  // 5. 320px 窄屏截图
  const narrow = await browser.newPage({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
  await narrow.goto(BASE + "?q=" + encodeURIComponent("X60Pro"), { waitUntil: "networkidle" });
  await narrow.waitForTimeout(400);
  await narrow.screenshot({ path: out("shot-narrow.png") });
  const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log("320px 横向溢出:", overflow);

  console.log("控制台错误:", logs.length ? logs.join(" | ") : "无");
  await browser.close();
})();
