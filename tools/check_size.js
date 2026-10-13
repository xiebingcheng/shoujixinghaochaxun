/* 尺寸查箱号功能的交互自测：node tools/check_size.js
   需要先启动 python -m http.server 8123 --directory docs */
const path = require("path");
const nm = "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const { chromium } = require(path.join(nm, "playwright"));

const BASE = "http://127.0.0.1:8123/";
const logs = [];
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok " : "  FAIL"} ${label}: ${JSON.stringify(actual)}` +
    (ok ? "" : ` (应为 ${JSON.stringify(expected)})`));
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") logs.push("console: " + m.text()); });

  await page.goto(BASE, { waitUntil: "networkidle" });

  // 1. 默认是「型号查箱号」，切到「尺寸查箱号」
  check("默认模式", await page.getAttribute('.mode[data-mode="model"]', "aria-pressed"), "true");
  await page.click('.mode[data-mode="size"]');
  await page.waitForTimeout(250);
  check("切换后模式", await page.getAttribute('.mode[data-mode="size"]', "aria-pressed"), "true");
  check("URL 带 mode=size", new URL(page.url()).searchParams.get("mode"), "size");
  console.log("  占位提示:", await page.getAttribute("#q", "placeholder"));
  console.log("  副标题:", await page.textContent(".app-sub"));

  // 2. 空输入时给出尺寸快捷入口（由数据生成）
  const sizeBtns = await page.locator("#results [data-size]").allTextContents();
  console.log("  尺寸快捷入口:", sizeBtns.join(" "));
  check("有尺寸快捷入口", sizeBtns.length > 0, true);

  // 3. 直接按尺寸查
  await page.fill("#q", "6.5");
  await page.waitForTimeout(350);
  console.log("  摘要:", await page.textContent("#summary"));
  console.log("  分组:", await page.locator("#results .group-title").allTextContents());
  const cards = page.locator("#results .card");
  const n = await cards.count();
  check("6.5 有结果", n > 0, true);
  const first = cards.first();
  check("卡片带尺寸标签", await first.locator(".box-size").count(), 1);
  check("箱号徽标上不再叠尺寸", await first.locator(".badge .box-size").count(), 0);
  console.log("  第一张卡片:", (await first.innerText()).replace(/\s+/g, " ").trim().slice(0, 80));
  check("有免责提示", (await page.locator("#results .notice").count()) > 0, true);

  // 4. 输型号 -> 先查它的屏幕尺寸
  await page.fill("#q", "红米10A");
  await page.waitForTimeout(350);
  console.log("  摘要:", await page.textContent("#summary"));
  check("按型号给出了尺寸", /屏幕约/.test(await page.textContent("#summary")), true);

  // 4b. 只输型号主体（表里存的是「华为P40」），也要能靠模糊匹配查到
  await page.fill("#q", "P40");
  await page.waitForTimeout(350);
  console.log("  摘要:", await page.textContent("#summary"));
  check("P40 能匹配到华为P40", /匹配到「华为P40」/.test(await page.textContent("#summary")), true);
  check("P40 有相近箱号结果", (await page.locator("#results .card").count()) > 0, true);
  await page.fill("#q", "x60pro");
  await page.waitForTimeout(350);
  console.log("  摘要:", await page.textContent("#summary"));
  check("x60pro 能匹配到机型", /匹配到/.test(await page.textContent("#summary")), true);

  // 5. 查不到的型号要有明确提示
  await page.fill("#q", "完全不存在的型号ZZZ");
  await page.waitForTimeout(350);
  check("未知型号提示", /查不到这个型号的屏幕尺寸/.test(await page.textContent("#results")), true);

  // 6. 点快捷尺寸按钮
  await page.fill("#q", "");
  await page.waitForTimeout(250);
  await page.locator("#results [data-size]").first().click();
  await page.waitForTimeout(350);
  console.log("  点快捷尺寸后输入框:", await page.inputValue("#q"));
  check("快捷尺寸能出结果", (await page.locator("#results .group-title").count()) > 0, true);

  // 7. 前缀筛选在尺寸模式下也生效
  const all = await page.locator("#results .card").count();
  await page.click('.tab[data-prefix="Y"]');
  await page.waitForTimeout(250);
  const yOnly = await page.locator("#results .card").count();
  const prefixes = await page.locator("#results .card .badge").allInnerTexts();
  const badPrefix = prefixes.filter((t) => !t.trim().startsWith("Y"));
  check("Y 筛选后只剩 Y", badPrefix.length, 0);
  console.log(`  全部 ${all} 张 -> Y 开头 ${yOnly} 张`);
  await page.click('.tab[data-prefix="ALL"]');
  await page.waitForTimeout(200);

  // 8. 切回型号查箱号，浏览列表里箱号右上角也应带尺寸
  await page.fill("#q", "");
  await page.waitForTimeout(150);
  await page.click('.mode[data-mode="model"]');
  await page.waitForTimeout(350);
  check("URL 去掉 mode", new URL(page.url()).searchParams.get("mode"), null);
  const chips = await page.locator("#results .card .box-size").count();
  check("浏览视图有尺寸标签", chips > 0, true);
  console.log("  浏览视图尺寸标签数:", chips, "/ 卡片数:", await page.locator("#results .card").count());
  const foldText = await page.locator('#results .card[data-id="Y18"] .box-size').textContent();
  check("折叠屏箱号 Y18 标出内/外", /内\s*7\.8″\s*\/\s*外\s*6\.3″/.test(foldText), true);
  console.log("  Y18 标签:", foldText);

  // 8b. 折叠屏：搜外屏尺寸要标「外屏匹配」，搜内屏尺寸标「内屏匹配」
  await page.click('.mode[data-mode="size"]');
  await page.waitForTimeout(250);
  await page.fill("#q", "7.82");
  await page.waitForTimeout(400);
  const y18in = page.locator('#results .card[data-id="Y18"]');
  check("搜 7.82 标记内屏", await y18in.locator(".tag.kind-inner").count(), 1);
  console.log("  ", (await y18in.innerText()).replace(/\s+/g, " ").trim().slice(0, 72));
  await page.fill("#q", "6.31");
  await page.waitForTimeout(400);
  const y18out = page.locator('#results .card[data-id="Y18"]');
  check("搜 6.31 标记外屏", await y18out.locator(".tag.kind-outer").count(), 1);
  console.log("  ", (await y18out.innerText()).replace(/\s+/g, " ").trim().slice(0, 72));
  // 竖折（Pura X）外屏只有 3.5 英寸，尺寸下限要覆盖到
  await page.fill("#q", "3.5");
  await page.waitForTimeout(400);
  const s89 = page.locator('#results .card[data-id="S89"]');
  check("搜 3.5（竖折外屏）命中 S89", await s89.locator(".tag.kind-outer").count(), 1);
  console.log("  ", (await s89.innerText()).replace(/\s+/g, " ").trim().slice(0, 72));

  // 尺寸模式卡片不能继承尺寸标签的样式（曾经因为 .card-size 类名撞车，整张卡片变粗体+浅蓝底）
  await page.fill("#q", "6.5");
  await page.waitForTimeout(400);
  const s16 = page.locator('#results .card[data-id="S16"]');
  await s16.locator(".badge-btn").click();
  await page.waitForTimeout(300);
  const s16style = await s16.evaluate((el) => {
    const li = el.querySelector(".hits li");
    return { weight: getComputedStyle(li).fontWeight, bg: getComputedStyle(el).backgroundColor };
  });
  check("展开后型号文字没被带粗", s16style.weight, "400");
  check("尺寸模式卡片背景没被标签样式改掉", s16style.bg, "rgb(255, 255, 255)");
  await s16.locator(".badge-btn").click();
  await page.waitForTimeout(200);

  await page.click('.mode[data-mode="model"]');
  await page.waitForTimeout(250);
  await page.fill("#q", "");
  await page.waitForTimeout(200);

  // 9. 原有搜索不受影响
  await page.fill("#q", "苹果13");
  await page.waitForTimeout(350);
  console.log("  型号模式摘要:", await page.textContent("#summary"));
  check("型号搜索仍可用", (await page.locator("#results .card").count()) > 0, true);

  check("控制台错误", logs, []);
  await browser.close();
  console.log(failed ? `\n共 ${failed} 项失败` : "\n全部通过");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
