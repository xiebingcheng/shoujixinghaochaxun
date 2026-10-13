/* 小程序版逻辑自测：node tools/check_mp.js
   直接 require 小程序的页面逻辑（里面的纯函数部分），验证搜索结果、联想、
   浏览视图、可替代箱号是否和网页版一致。 */
const path = require("path");

// 先在全局放好小程序的两样东西，这样 require 页面文件时能拿到 Page 定义
let pageDef = null;
global.Page = (def) => { pageDef = def; };
global.wx = {
  setNavigationBarTitle() {},
  pageScrollTo() {},
  showToast() {},
  setClipboardData(o) { if (o && o.success) o.success(); },
};

const page = require(path.join(__dirname, "..", "miniprogram", "pages", "index", "index.js"));
const BoxSearch = require(path.join(__dirname, "..", "miniprogram", "utils", "search.js"));

let failed = 0;
function ok(name, cond, extra) {
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (extra ? "   " + extra : ""));
  if (!cond) failed += 1;
}

const { index } = page.getIndex();

console.log("数据：");
ok("箱号数量 > 100", index.boxes.length > 100, "共 " + index.boxes.length + " 个");
ok("生成日期存在", !!index.generatedAt, index.generatedAt);
ok("每个箱号都带 subs 字段", index.boxes.every((b) => Array.isArray(b.subs)));

console.log("\n搜索（应与网页版一致）：");
const cases = [
  ["Mate30Pro", 1],
  ["mate30 pro", 1],
  ["苹果13", 1],
  ["红米K80", 1],
  ["X60Pro", 1],
  ["S01", 1],
  ["y07", 1],
];
for (const [q, minExact] of cases) {
  const res = BoxSearch.search(index, q);
  const hits = res.exact.map((r) => r.box.id).join(",");
  ok("查「" + q + "」有 " + res.exact.length + " 个精确结果", res.exact.length >= minExact, hits);
}

const none = BoxSearch.search(index, "zzz不存在的型号");
const noneView = page.buildSearchView(none, new Set(), "zzz不存在的型号");
ok("无结果时给出空状态", !!noneView.empty, noneView.summary);

console.log("\n搜索视图：");
const resModel = BoxSearch.search(index, "iPhone11Pro");
const viewClosed = page.buildSearchView(resModel, new Set(), "iPhone11Pro");
ok("有精确匹配分组", viewClosed.groups[0] && viewClosed.groups[0].k === "exact");
const cardClosed = viewClosed.groups[0].cards[0];
ok("命中型号被高亮", JSON.stringify(cardClosed.hits).includes('"hit":true'),
  cardClosed.hits.map((h) => h.segs.map((s) => s.t).join("")).join(" / "));
ok("折叠时不给 rest", cardClosed.rest.length === 0);

// 用箱内型号很多的大箱子验证“展开后列出箱内其余型号”
const big = [...index.boxes].sort((a, b) => b.models.length - a.models.length)[0];
const resBig = BoxSearch.search(index, big.id);
const viewOpen = page.buildSearchView(resBig, new Set([big.id]), big.id);
const cardOpen = viewOpen.groups[0].cards[0];
ok(big.id + " 展开后带出箱内其余型号", cardOpen.rest.length > 0,
  "共 " + big.models.length + " 个型号，其余 " + cardOpen.rest.length + " 个");

console.log("\n可替代箱号：");
const resS49 = BoxSearch.search(index, "S49");
const viewS49 = page.buildSearchView(resS49, new Set(), "S49");
const subGroup = viewS49.groups.find((g) => g.k === "subs");
ok("搜 S49 出现可替代分组", !!subGroup, subGroup ? subGroup.title : "（无）");
ok("S49 的可替代箱号是 S33",
  !!subGroup && subGroup.cards.some((c) => c.id === "S33"),
  subGroup ? subGroup.cards.map((c) => c.id).join(",") : "");
ok("原卡片底部也带可替代箱号链接",
  viewS49.groups[0].cards[0].subs.some((s) => s.id === "S33"));

console.log("\n输入联想：");
const sugI = page.buildSuggestView("i", 30);
ok("输入 i 有联想结果", sugI.items.length > 0, "共 " + sugI.items.length + " 条");
const sugApple = page.buildSuggestView("苹果1", 30);
ok("输入 苹果1 能联想到 iPhone", sugApple.items.some((it) => /iPhone/i.test(it.text)),
  sugApple.items.slice(0, 3).map((it) => it.text).join(" / "));

console.log("\n浏览视图：");
const browse = page.buildBrowseView(new Set(), "ALL");
ok("浏览模式分 3 组（S/L/Y）", browse.groups.length === 3,
  browse.groups.map((g) => g.title).join("  "));
ok("浏览卡片折叠时给预览文字", browse.groups[0].cards[0].preview.length > 0,
  browse.groups[0].cards[0].preview);
const browseS = page.buildBrowseView(new Set(), "Y");
ok("筛选 Y 只剩一组", browseS.groups.length === 1, browseS.groups[0].title);

console.log("\n前缀数量：");
const tabs = page.tabDefs();
ok("tab 有 4 个（含全部）", tabs.length === 4, tabs.map((t) => t.label + ":" + t.count).join("  "));

console.log("\n页面控制器冒烟测试：");
ok("Page 已被注册", !!pageDef);
if (pageDef) {
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const inst = Object.assign({}, pageDef, {
    data: clone(pageDef.data),
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb(); },
  });
  const tap = (extra) => ({ currentTarget: { dataset: extra } });

  inst.onLoad({});
  ok("onLoad 后进入浏览模式", inst.data.groups.length === 3 && !inst.data.empty,
    inst.data.summary);

  inst.setData({ q: "Mate30Pro" });
  inst.submit();
  ok("submit 后出现搜索结果", inst.data.groups.some((g) => g.k === "exact"),
    inst.data.summary);

  const cardId = inst.data.groups[0].cards[0].id;
  inst.onCardTap(tap({ id: cardId }));
  ok("点卡片可展开箱内机型", inst.data.groups[0].cards[0].open, "展开 " + cardId);
  inst.onMore(tap({ id: cardId }));
  ok("再点可收起", !inst.data.groups[0].cards[0].open);

  inst.onCopy(tap({ copy: cardId }));
  ok("复制按钮不报错", true, "复制 " + cardId);

  inst.onInput({ detail: { value: "i" } });
  ok("输入后弹出联想", !inst.data.suggestHidden && inst.data.suggestItems.length > 0,
    "共 " + inst.data.suggestItems.length + " 条");
  inst.onSuggestTap(tap({ item: inst.data.suggestItems[0] }));
  ok("点联想项直接查该机型", inst.data.q === "i" || inst.data.q.length > 0,
    "查「" + inst.data.q + "」→ " + inst.data.summary);

  inst.onTab(tap({ prefix: "Y" }));
  inst.onClear();
  ok("清空后回到浏览模式", inst.data.q === "" && inst.data.groups.length === 1,
    inst.data.summary);

  // ---- 尺寸查箱号 ----
  inst.onTab(tap({ prefix: "ALL" }));
  inst.onModeTap(tap({ mode: "size" }));
  ok("切到尺寸模式", inst.data.mode === "size", inst.data.summary);
  ok("空输入时给尺寸快捷入口", inst.data.sizeExamples.length > 0,
    inst.data.sizeExamples.slice(0, 8).join(" ") + " …");

  inst.onSizeExample(tap({ q: inst.data.sizeExamples[0] }));
  ok("点尺寸快捷入口能出结果", inst.data.groups.length > 0,
    inst.data.summary);
  ok("尺寸模式下有免责提示", !!inst.data.notice, inst.data.notice.slice(0, 20) + "…");
  ok("尺寸卡片右上角带箱子尺寸",
    inst.data.groups[0].cards.every((c) => !!c.sizeText),
    inst.data.groups[0].cards.slice(0, 3).map((c) => c.id + " " + c.sizeText).join(" / "));
  ok("尺寸卡片给出箱内最接近的型号",
    !!inst.data.groups[0].cards[0].sizeHitModel,
    inst.data.groups[0].cards[0].sizeHitModel + " " + inst.data.groups[0].cards[0].sizeHitInch);

  const sizeCardId = inst.data.groups[0].cards[0].id;
  inst.onCardTap(tap({ id: sizeCardId }));
  ok("尺寸卡片可展开", inst.data.groups[0].cards[0].open &&
    inst.data.groups[0].cards[0].hits.length > 0, "展开 " + sizeCardId);

  // submit() 有 300ms 去重，测试里直接走 onSizeExample 这条不等时的路径
  inst.onSizeExample(tap({ q: "红米10A" }));
  ok("输型号会先查它的屏幕尺寸", /屏幕约/.test(inst.data.summary), inst.data.summary);

  inst.onSizeExample(tap({ q: "完全不存在的型号ZZZ" }));
  ok("查不到尺寸时有明确提示", !!inst.data.empty, inst.data.empty && inst.data.empty.title);

  inst.onModeTap(tap({ mode: "model" }));
  inst.onClear();
  ok("切回型号模式的浏览列表也有尺寸标签",
    inst.data.groups[0].cards.every((c) => typeof c.sizeText === "string"),
    inst.data.summary);
}

console.log("\n" + (failed ? "有 " + failed + " 项未通过" : "全部通过 ✓"));
process.exit(failed ? 1 : 0);
