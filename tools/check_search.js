/* 搜索逻辑自测：node tools/check_search.js */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const api = require(path.join(root, "docs", "assets", "search.js"));
const data = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "boxes.json"), "utf8"));
const subsRaw = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "substitutes.json"), "utf8"));
const index = api.makeIndex(data, subsRaw);

function show(query) {
  const started = process.hrtime.bigint();
  const res = api.search(index, query);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const fmt = (list) => list
    .slice(0, 8)
    .map((r) => `${r.box.id}[${r.hits.slice(0, 4).map((h) => h.m.t).join(" / ")}]`)
    .join("  ");
  console.log(`\n查询「${query}」 (${ms.toFixed(1)}ms)`);
  console.log(`  精确 ${res.exact.length}: ${fmt(res.exact)}`);
  console.log(`  相近 ${res.fuzzy.length}: ${fmt(res.fuzzy)}`);
}

["X60Pro", "Mate30Pro", "mate30 pro", "苹果13", "红米K80", "xnote", "荣耀魔法2",
  "华为mate70pro", "三星S20+", "S01", "y07", "折叠屏前屏", "小米10至尊版",
  "vivo Y300Pro", "zzz不存在的型号"].forEach(show);

console.log("\n规范化抽查：");
["小米10至尊版", "小米10至臻版", "荣耀 魔术VS 至臻版", "iPhone17 Air", "Galaxy S20+"]
  .forEach((t) => console.log(`  ${t}  ->  ${api.norm(t)}  |  core=${api.core(t)}`));

// 输入联想
const sugg = api.buildSuggestions(index.boxes);
console.log(`\n联想候选共 ${sugg.length} 条\n`);
["i", "ip", "iphone 11", "红米k8", "mate30", "苹果1", "y30"].forEach((q) => {
  const r = api.suggest(sugg, q, 8);
  console.log(`输入「${q}」 共 ${r.total} 条，前几条：`);
  r.items.forEach((it) => console.log(
    `   ${it.text}${it.alt.length ? "（" + it.alt.join("、") + "）" : ""}  → ${it.boxes.slice(0, 4).join(" ")}${it.boxes.length > 4 ? " 等" : ""}`
  ));
});

// 箱号替代关系
console.log("\n替代关系自测：");
const PAIRS = [
  "S44-S04", "S48-S59", "S49-S33", "S50-S76", "S51-S59", "S52-S39", "S55-S34",
  "S60-S57", "S61-S58", "S63-S43", "S64-S59", "S66-S28", "S68-S58", "S69-S35",
  "S70-S42", "S72-S35", "S75-S41", "S78-S56",
];
// 每条关系都是双向的：两个箱号互相写进对方的可替代箱号
const EXPECT = {};
for (const pair of PAIRS) {
  const [a, b] = pair.split("-");
  (EXPECT[a] = EXPECT[a] || []).push(b);
  (EXPECT[b] = EXPECT[b] || []).push(a);
}
let bad = 0;
for (const [front, backs] of Object.entries(EXPECT)) {
  const box = index.boxes.find((b) => b.id === front);
  const got = (box && box.subs) || [];
  const ok = got.join(",") === backs.join(",");
  if (!ok) bad += 1;
  console.log(`  ${ok ? "✓" : "✗"} 搜到 ${front}（${box ? box.name : "不存在"}）` +
    ` → 可替代箱号 ${got.join("、") || "无"}${ok ? "" : "（期望 " + backs.join("、") + "）"}`);
}
console.log(`  关系条数：${index.substitutes.size} / 期望 ${Object.keys(EXPECT).length}` +
  (index.substitutes.size === Object.keys(EXPECT).length ? "" : "  ✗"));
if (index.substitutes.size !== Object.keys(EXPECT).length) bad += 1;

const noSub = api.makeIndex(data);
const anySub = noSub.boxes.some((b) => (b.subs || []).length);
console.log(`  不带替代文件时也能建索引：${anySub ? "✗ 居然有替代数据" : "✓"}`);
if (anySub) bad += 1;

// 替代关系解析的容错（全角横线、空格、数组写法、双向 / 单向）
const parsed = api.parseSubstitutes({
  pairs: ["s49－S33", " S50 - S76 ", ["S51", "S59"], "S49-S44", "S61>S58", "乱写的"],
});
const parsedOk = parsed.get("S49").join(",") === "S33,S44" &&
  parsed.get("S33").join(",") === "S49" &&      // 双向：反方向也自动连上
  parsed.get("S50").join(",") === "S76" && parsed.get("S76").join(",") === "S50" &&
  parsed.get("S51").join(",") === "S59" && parsed.get("S59").join(",") === "S51" &&
  parsed.get("S61").join(",") === "S58" && !parsed.has("S58") &&   // 单向：反方向不连
  !parsed.get("乱写的");
console.log(`  写法容错（全角/空格/数组/双向/单向）：${parsedOk ? "✓" : "✗ " + JSON.stringify([...parsed])}`);
if (!parsedOk) bad += 1;

console.log(bad ? `\n[FAIL] ${bad} 项不符` : "\n[OK] 替代关系全部通过");

// 认真过一遍每个箱号：前箱号里的每个型号，用户搜出来时能不能带出它的可替代箱号
console.log("\n可替代箱号触发检查（只认「精确匹配」，相近结果不带替代箱号）：");
let missTotal = 0;
for (const [front, backs] of index.substitutes) {
  const box = index.boxes.find((b) => b.id === front);
  if (!box) {
    console.log(`  ✗ ${front} 这个箱号在数据里不存在`);
    missTotal += 1;
    continue;
  }
  const hitModels = [];
  const missModels = [];
  for (const m of box.models) {
    const res = api.search(index, m.t);
    if (res.exact.some((r) => r.box.id === front)) hitModels.push(m.t);
    else missModels.push(m.t);
  }
  console.log(`  ${front} → ${backs.join("、")}：${hitModels.length}/${box.models.length} 个型号能带出替代箱号` +
    (missModels.length ? "  ⚠" : ""));
  if (missModels.length) {
    missTotal += missModels.length;
    console.log(`      搜这些型号时带不出来：${missModels.join("、")}`);
  }
}
console.log(missTotal
  ? `  ⚠ 共 ${missTotal} 处搜不出本箱号，这些型号搜完看不到可替代箱号`
  : "  ✓ 每个前箱号里的型号，搜出来都能带出它的可替代箱号");

// 反向确认：某箱号只有作为“相近结果”出现时，绝不会带出替代箱号（用户报的问题）
console.log("\n“相近结果不应带替代箱号”抽查：");
for (const q of ["MATE80PROMAX", "MATE80PRO", "苹果17Pro", "K15PRO"]) {
  const res = api.search(index, q);
  const exactIds = new Set(res.exact.map((r) => r.box.id));
  const leaked = res.fuzzy
    .filter((r) => !exactIds.has(r.box.id) && (r.box.subs || []).length)
    .map((r) => `${r.box.id}→${r.box.subs.join("/")}`);
  console.log(`  搜「${q}」：精确匹配 ${[...exactIds].join(" ") || "无"}` +
    ` | 只出现在相近结果里、带替代箱号的：` +
    (leaked.length ? leaked.join(" ") + "（现在不显示替代箱号）" : "无"));
}
