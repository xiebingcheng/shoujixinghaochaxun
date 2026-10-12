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
  console.log("分组标题:", await page.locator("#results .group-title").allTextContents());
  console.log("卡片数:", await page.locator("#results .card").count());

  // 3. 点卡片复制
  await page.click("#results .card");
  await page.waitForTimeout(250);
  console.log("提示:", (await page.textContent("#toast")).trim());
  console.log("URL:", page.url());

  // 4. 单字查询不应报错
  await page.fill("#q", "S");
  await page.waitForTimeout(300);
  console.log("单字查询:", await page.textContent("#summary"));

  // 4.5 箱号替代关系
  await page.fill("#q", "红米K80");
  await page.waitForTimeout(350);
  const s49 = page.locator('#results .card[data-id="S49"]');
  console.log("搜「红米K80」时 S49 的替代标签:", JSON.stringify(await s49.locator(".subs-label").allTextContents()));
  console.log("  S49 可替代箱号:", JSON.stringify(await s49.locator(".sub-chip").allTextContents()));
  await s49.locator(".sub-chip").first().click();
  await page.waitForTimeout(400);
  console.log("  点替代标签后输入框:", await page.inputValue("#q"), "| 摘要:", await page.textContent("#summary"));
  console.log("  URL:", page.url());
  await page.screenshot({ path: out("shot-subs.png") });

  await page.fill("#q", "S61");
  await page.waitForTimeout(350);
  console.log("搜「S61」可替代箱号:", JSON.stringify(await page.locator('#results .card[data-id="S61"] .sub-chip').allTextContents()));

  await page.fill("#q", "");
  await page.waitForTimeout(350);
  console.log("浏览视图里有替代关系的卡片数:", await page.locator("#results .card:has(.sub-chip)").count(), "(应为 15)");

  // 5. 320px 窄屏截图
  const narrow = await browser.newPage({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
  await narrow.goto(BASE + "?q=" + encodeURIComponent("X60Pro"), { waitUntil: "networkidle" });
  await narrow.waitForTimeout(400);
  await narrow.screenshot({ path: out("shot-narrow.png") });
  const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log("320px 横向溢出:", overflow);

  // 6. 输入联想
  await page.fill("#q", "");
  await page.fill("#q", "i");
  await page.waitForTimeout(350);
  const items = await page.locator("#suggest .s-item").count();
  const firstTexts = await page.locator("#suggest .s-item .s-text").evaluateAll(
    (els) => els.slice(0, 6).map((e) => e.textContent.trim())
  );
  const more = await page.locator("#suggest .s-more").textContent().catch(() => "");
  console.log(`输入「i」下拉 ${items} 条，前几条: ${JSON.stringify(firstTexts)}`);
  console.log("  提示行:", (more || "").trim());
  await page.screenshot({ path: out("shot-suggest.png") });

  // 键盘选择：下箭头两次 + 回车
  await page.press("#q", "ArrowDown");
  await page.press("#q", "ArrowDown");
  await page.press("#q", "Enter");
  await page.waitForTimeout(300);
  console.log("键盘选中后输入框:", await page.inputValue("#q"));
  console.log("  摘要:", await page.textContent("#summary"));

  // 中文输入 + 点击选择
  await page.fill("#q", "苹果1");
  await page.waitForTimeout(300);
  const cn = await page.locator("#suggest .s-item .s-text").evaluateAll(
    (els) => els.slice(0, 4).map((e) => e.textContent.trim())
  );
  console.log("输入「苹果1」下拉:", JSON.stringify(cn));
  await page.click("#suggest .s-item:nth-child(4)");
  await page.waitForTimeout(300);
  console.log("点击选中后输入框:", await page.inputValue("#q"), "| 摘要:", await page.textContent("#summary"));
  console.log("下拉是否关闭:", await page.locator("#suggest").isHidden());

  console.log("控制台错误:", logs.length ? logs.join(" | ") : "无");
  await browser.close();
})();
