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

  // 3. 点箱号展开箱内机型（而不是复制）
  const firstCard = page.locator("#results .card").first();
  const before = await firstCard.locator(".hits li").count();
  await firstCard.locator(".badge-btn").click();
  await page.waitForTimeout(250);
  const after = await firstCard.locator(".hits li").count();
  console.log("点箱号展开：型号行数", before, "→", after,
    "| aria-expanded:", await firstCard.locator(".badge-btn").getAttribute("aria-expanded"),
    "| 提示:", JSON.stringify((await page.textContent("#toast")).trim()));
  await firstCard.locator(".badge-btn").click();
  await page.waitForTimeout(200);
  console.log("再点一次收起 → 型号行数:", await firstCard.locator(".hits li").count());

  // 3.5 复制箱号要走独立的「复制箱号」按钮
  await page.click("#results .card .copy-btn");
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
  const s49 = page.locator('#results .card:not(.card-sub)[data-id="S49"]');
  console.log("搜「红米K80」时 S49 的替代标签:", JSON.stringify(await s49.locator(".subs-label").allTextContents()));
  console.log("  S49 卡片上的可替代箱号:", JSON.stringify(await s49.locator(".sub-link").allTextContents()));
  console.log("  分组标题:", await page.locator("#results .group-title").allTextContents());
  const subCard = page.locator("#results .card-sub");
  console.log("  可替代卡片数:", await subCard.count(),
    "| 标记:", JSON.stringify(await page.locator("#results .tag.sub").allTextContents()),
    "| 说明:", JSON.stringify((await page.locator(".card-sub-note").allTextContents()).map((t) => t.trim())));
  console.log("  摘要:", await page.textContent("#summary"));
  await s49.locator(".sub-link").first().click();
  await page.waitForTimeout(400);
  console.log("  点替代标签后输入框:", await page.inputValue("#q"), "| 摘要:", await page.textContent("#summary"));
  console.log("  URL:", page.url());
  await page.screenshot({ path: out("shot-subs.png") });

  await page.fill("#q", "S61");
  await page.waitForTimeout(350);
  console.log("搜「S61」可替代箱号:", JSON.stringify(await page.locator('#results .card-sub[data-id="S58"] .card-sub-note').allTextContents()));

  // S59 既是别人的可替代箱号，自己也有可替代箱号 S64
  await page.fill("#q", "荣耀X70");
  await page.waitForTimeout(400);
  const s59 = page.locator('#results .card:not(.card-sub)[data-id="S59"]');
  console.log("搜「荣耀X70」→ S59 卡片上的替代箱号:", JSON.stringify(await s59.locator(".sub-link").allTextContents()));
  console.log("  可替代卡片:", JSON.stringify(await page.locator('#results .card-sub[data-id="S64"] .card-sub-note').allTextContents()));
  await page.fill("#q", "荣耀Magic7");
  await page.waitForTimeout(400);
  console.log("搜「荣耀Magic7」→ S48 的可替代卡片:",
    JSON.stringify(await page.locator('#results .card-sub').allTextContents()),
    "| 说明:", JSON.stringify(await page.locator('#results .card-sub-note').allTextContents()));

  // 关键回归：搜 MATE80PROMAX 时 S70 只是“相近结果”，不能把 S70 的可替代箱号 S42 带出来
  await page.fill("#q", "MATE80PROMAX");
  await page.waitForTimeout(400);
  console.log("搜「MATE80PROMAX」分组标题:", await page.locator("#results .group-title").allTextContents());
  console.log("  可替代卡片数（应为 0）:", await page.locator("#results .card-sub").count(),
    "| 相近结果里的替代行（应为 0）:", await page.locator('#results .card[data-id="S70"] .subs').count(),
    "| 摘要:", (await page.textContent("#summary")).trim());

  // 同一个可替代箱号被两个箱子指向时，说明里要都写出来
  await page.fill("#q", "K15PRO+");
  await page.waitForTimeout(350);
  console.log("搜「K15PRO+」→ 分组标题:", await page.locator("#results .group-title").allTextContents(),
    "| S58 卡片说明:",
    JSON.stringify(await page.locator('#results .card-sub[data-id="S58"] .card-sub-note').allTextContents()));

  await page.fill("#q", "");
  await page.waitForTimeout(350);
  console.log("浏览视图里有替代关系的卡片数:", await page.locator("#results .card:has(.sub-link)").count(), "(应为 16)");
  console.log("  浏览视图里没有可替代分组:", await page.locator("#results .card-sub").count(), "(应为 0)");

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

  // 6.5 点放大镜：要搜出结果，而且联想下拉必须收起，不能挡住结果
  await page.fill("#q", "");
  await page.click("#q");
  await page.type("#q", "reno15pro", { delay: 30 });
  await page.waitForTimeout(400);
  console.log("点放大镜前下拉可见:", await page.locator("#suggest").isVisible(), "(应为 true)");
  await page.click(".search-btn");
  await page.waitForTimeout(400);
  console.log("点放大镜后下拉可见:", await page.locator("#suggest").isVisible(), "(应为 false)",
    "| 结果卡片数:", await page.locator("#results .card").count(),
    "| 摘要:", (await page.textContent("#summary")).trim());

  // 7. 头部滚动折叠：连续下滚只该收起一次，而且折叠不能改变文档高度
  //    （一改高度就会被浏览器的滚动锚定拽回去，头部在展开／收起之间来回弹）
  await page.fill("#q", "");
  await page.waitForTimeout(300);
  const header = await page.evaluate(async () => {
    const el = document.getElementById("header");
    let flips = 0;
    const mo = new MutationObserver(() => { flips += 1; });
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
    const docH0 = document.documentElement.scrollHeight;
    for (let y = 0; y <= 300; y += 5) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 16));
    }
    await new Promise((r) => setTimeout(r, 400));
    const docH1 = document.documentElement.scrollHeight;
    mo.disconnect();
    window.scrollTo(0, 0);
    return { flips, docH0, docH1 };
  });
  console.log("连续下滚 0→300px 头部折叠次数:", header.flips, "(应为 1)");
  console.log("  下滚前后文档高度:", header.docH0, "→", header.docH1, "(应相等)");

  console.log("控制台错误:", logs.length ? logs.join(" | ") : "无");
  await browser.close();
})();
