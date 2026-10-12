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
const EXPECT = {
  S48: ["S59"], S49: ["S33"], S50: ["S76"], S51: ["S59"], S52: ["S39"],
  S55: ["S34"], S60: ["S57"], S61: ["S58"], S63: ["S43"], S66: ["S28"],
  S68: ["S58"], S69: ["S35"], S70: ["S42"], S72: ["S35"], S75: ["S41"],
};
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

// 替代关系解析的容错（全角横线、空格、数组写法）
const parsed = api.parseSubstitutes({
  pairs: ["s49－S33", " S50 - S76 ", ["S51", "S59"], "S49-S44", "乱写的"],
});
const parsedOk = parsed.get("S49").join(",") === "S33,S44" && parsed.get("S50").join(",") === "S76" &&
  parsed.get("S51").join(",") === "S59" && !parsed.get("乱写的");
console.log(`  写法容错（全角/空格/数组/多条）：${parsedOk ? "✓" : "✗ " + JSON.stringify([...parsed])}`);
if (!parsedOk) bad += 1;

console.log(bad ? `\n[FAIL] ${bad} 项不符` : "\n[OK] 替代关系全部通过");
