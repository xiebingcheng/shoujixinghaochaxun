/* 手机型号查箱号 · 微信小程序版
   页面逻辑：搜索 + 输入联想 + 按箱号浏览。
   纯计算部分放在文件顶部并导出，方便用 node 做自测（tools/check_mp.js）。 */
const BoxSearch = require("../../utils/search.js");
const boxesData = require("../../data/boxes.js");
const subsData = require("../../data/substitutes.js");
const sizesData = require("../../data/sizes.js");

const FUZZY_LIMIT = 40;
const SUB_LIMIT = 8;
const SIZE_MATCH_LIMIT = 40;
const SIZE_NEAR = 0.05;    // 差 ≤ 0.05 英寸算「尺寸一致」
const SIZE_CLOSE = 0.15;   // 差 ≤ 0.15 英寸算「尺寸接近」
const SIZE_MAX = 0.30;     // 差 > 0.30 英寸就不列出来
const PREFIX_LABEL = { S: "S 开头", L: "L 开头", Y: "Y 开头" };
const EXAMPLES = ["Mate30Pro", "X60Pro", "苹果13", "红米K80", "S01"];
const SIZE_EXAMPLE_MODELS = ["红米10A", "苹果13"];

// ---------------------------------------------------------------- 屏幕尺寸
/** 6.50 -> 6.5，6.53 -> 6.53 */
function fmtInch(n) {
  return Number(n).toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}

/** 箱号上只保留 1 位小数 */
function oneInch(n) {
  return (Math.round(Number(n) * 10) / 10).toFixed(1);
}

/** 箱号右上角显示的屏幕尺寸（一行或多行）；没有可靠尺寸时返回空数组 */
function boxSizeLines(box) {
  const info = sizesData && sizesData.boxes && sizesData.boxes[box.id];
  if (!info || !info.ok || !info.inch) return [];
  if (info.inner && info.outer) {
    return ["内 " + oneInch(info.inner) + "″", "外 " + oneInch(info.outer) + "″"];
  }
  const r = info.range || [];
  if (r.length === 2 && Math.round(r[1] * 10) - Math.round(r[0] * 10) >= 2) {
    return [oneInch(r[0]) + "-" + oneInch(r[1]) + "″"];
  }
  return [oneInch(info.inch) + "″"];
}

/** 箱号卡片右上角的一行文字：普通「6.5″」，折叠屏「内 6.3″ / 外 3.5″」 */
function boxSizeText(box) {
  return boxSizeLines(box).join(" / ");
}

function modelSize(key) {
  const v = sizesData && sizesData.models && sizesData.models[key];
  if (typeof v === "number") return v;
  // 折叠屏取内屏当代表尺寸（外屏在尺寸查询里单独参与匹配）
  if (v && typeof v === "object" && typeof v.inner === "number") return v.inner;
  return null;
}

/** 一个型号的所有屏幕尺寸：单屏 1 条，折叠屏内屏 + 外屏 2 条 */
function modelSizes(key) {
  const v = sizesData && sizesData.models && sizesData.models[key];
  if (typeof v === "number") return [{ inch: v, kind: "single" }];
  if (v && typeof v === "object") {
    const out = [];
    if (typeof v.inner === "number") out.push({ inch: v.inner, kind: "inner" });
    if (typeof v.outer === "number") out.push({ inch: v.outer, kind: "outer" });
    return out;
  }
  return [];
}

/** 型号的尺寸文字：普通机型「6.5″」，折叠屏「内7.8/外6.3″」 */
function sizesLabel(key) {
  const list = modelSizes(key);
  if (!list.length) return "";
  if (list.length === 1) return fmtInch(list[0].inch) + "″";
  return list.map((s) => (s.kind === "inner" ? "内" : "外") + fmtInch(s.inch)).join("/") + "″";
}

/** 输入像 6.5 / 6.5寸 就当尺寸；否则当型号 */
function parseSizeQuery(text) {
  const s = String(text || "").trim().replace(/英寸|寸|"|″/g, "").trim();
  if (!/^\d(?:\.\d{1,2})?$/.test(s)) return null;
  const n = parseFloat(s);
  // 下限放到 3 英寸：竖折机型的外屏只有 3.5 英寸左右
  return n >= 3 && n <= 9.9 ? n : null;
}

function sizeLevel(d) {
  if (d <= SIZE_NEAR) return { key: "same", label: "尺寸一致" };
  if (d <= SIZE_CLOSE) return { key: "close", label: "尺寸接近" };
  return { key: "fit", label: "勉强候选" };
}

/**
 * 查一个型号的屏幕尺寸：先精确查表，查不到就复用搜索的模糊/别名匹配兜底
 *（尺寸表里存的是「华为P40」，用户只输「P40」时也要能查到）。
 * 返回 { size, model }：model 是兜底时匹配到的机型名，精确命中时为 null。
 */
function resolveSize(raw) {
  const direct = modelSize(BoxSearch.norm(raw));
  if (direct !== null) return { size: direct, model: null };
  const res = BoxSearch.search(getIndex().index, raw);
  let best = null;
  for (const [pool, penalty] of [[res.exact, 0], [res.fuzzy, 1000]]) {
    for (const r of pool) {
      for (const h of r.hits) {
        const s = modelSize(h.m.k);
        if (s === null) continue;
        const rank = h.s - penalty;
        if (!best || rank > best.rank) best = { rank, size: s, model: h.m.t };
      }
    }
  }
  return best;
}

/** 所有箱号里出现过的尺寸档（1 位小数），用于快捷入口 */
function quickSizes() {
  const boxes = (sizesData && sizesData.boxes) || {};
  const uniq = [];
  for (const id of Object.keys(boxes)) {
    const e = boxes[id];
    if (!e.ok || !e.inch) continue;
    const v = Math.round(e.inch * 10) / 10;
    if (!uniq.includes(v)) uniq.push(v);
  }
  return uniq.sort((a, b) => a - b).map((v) => v.toFixed(1));
}

/** 每个箱子里「离目标尺寸最近」的那块屏（折叠屏会分别比内屏和外屏） */
function nearestBySize(size, prefix) {
  const { index } = getIndex();
  const list = [];
  for (const box of index.boxes) {
    if (prefix && prefix !== "ALL" && box.prefix !== prefix) continue;
    let best = null;
    for (const m of box.models) {
      for (const s of modelSizes(m.k)) {
        const d = Math.abs(s.inch - size);
        if (!best || d < best.d) best = { model: m, inch: s.inch, kind: s.kind, d };
      }
    }
    if (best && best.d <= SIZE_MAX) {
      list.push({ box, model: best.model, inch: best.inch, kind: best.kind, d: best.d });
    }
  }
  list.sort((a, b) => a.d - b.d || (a.box.id < b.box.id ? -1 : 1));
  return list;
}

// ============================================================ 纯逻辑（可单测）

/** 数据只加载一次，之后各页面共享 */
let cached = null;
/** 当前查询方式：model=型号查箱号，size=尺寸查箱号 */
let currentMode = "model";
function getIndex() {
  if (cached) return cached;
  const index = BoxSearch.makeIndex(boxesData, subsData);
  cached = {
    index,
    boxById: new Map(index.boxes.map((b) => [b.id, b])),
    suggestList: BoxSearch.buildSuggestions(index.boxes),
  };
  return cached;
}

/** 把命中词切成 [{t, hit}]，WXML 里用高亮色的 <text> 拼回去（小程序没有 innerHTML） */
function segments(raw, tokens) {
  const text = String(raw);
  const compact = [];
  let plain = "";
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i])) continue;
    plain += text[i].toLowerCase();
    compact.push(i);
  }
  const list = (tokens || []).slice().sort((a, b) => b.length - a.length);
  for (const token of list) {
    const t = token.toLowerCase().replace(/\s+/g, "");
    if (t.length < 2) continue;
    const pos = plain.indexOf(t);
    if (pos < 0) continue;
    const start = compact[pos];
    const end = compact[pos + t.length - 1] + 1;
    return [
      { t: text.slice(0, start), hit: false },
      { t: text.slice(start, end), hit: true },
      { t: text.slice(end), hit: false },
    ].filter((s) => s.t);
  }
  return [{ t: text, hit: false }];
}

function containsToken(text, tokens) {
  const compact = String(text).toLowerCase().replace(/\s+/g, "");
  return (tokens || []).some((t) => {
    const tk = t.toLowerCase().replace(/\s+/g, "");
    return tk.length >= 2 && compact.includes(tk);
  });
}

/** 型号可能有多种写法，优先显示和用户输入一致的那种 */
function pickVariant(model, tokens) {
  const all = [model.t].concat(model.alt || []);
  const hit = all.find((t) => containsToken(t, tokens));
  const text = hit || model.t;
  return { text, others: all.filter((t) => t !== text) };
}

function altText(list) {
  return list && list.length ? list.join("、") : "";
}

function linesOf(models) {
  return models.map((m, i) => ({
    k: "l" + i,
    t: m.t,
    altText: altText(m.alt),
  }));
}

function resultCard(result, tokens, expanded, withSubs) {
  const box = result.box;
  const open = expanded.has(box.id);
  const limited = Math.min(result.hits.length, open ? 999 : 8);
  const hits = result.hits.slice(0, limited).map((h, i) => {
    const picked = pickVariant(h.m, tokens);
    return {
      k: "h" + i,
      segs: segments(picked.text, tokens).map((s, j) => ({ k: "s" + j, t: s.t, hit: s.hit })),
      altText: altText(picked.others),
      exact: h.s >= 96,
    };
  });

  // 展开时把箱里没命中的型号也列出来，方便看清整箱内容
  let rest = [];
  if (open) {
    const hitSet = new Set(result.hits.map((h) => h.m));
    rest = linesOf(box.models.filter((m) => !hitSet.has(m)));
  }

  let moreLabel = "";
  if (open && result.hits.length > 8) moreLabel = "收起";
  else if (result.hits.length > limited) {
    moreLabel = "展开其余 " + (result.hits.length - limited) + " 个命中型号";
  }

  const subs = (withSubs === false ? [] : box.subs || []).map((id, i) => {
    const target = getIndex().boxById.get(id);
    return { k: "u" + i, id, name: (target && target.name) || "" };
  });

  return {
    id: box.id,
    badgeCls: "badge-" + String(box.prefix).toLowerCase(),
    sizeLines: boxSizeLines(box),
    sizeText: boxSizeText(box),
    name: box.name || "未命名箱",
    open,
    isSub: false,
    hits,
    rest,
    restLabel: rest.length ? "箱内其余型号" : "",
    moreLabel,
    footMeta: "箱号 " + box.id + " · 箱内共 " + box.total + " 个型号",
    copyId: box.id,
    subs,
    subFroms: [],
    subNote: "",
  };
}

/** 搜索结果里单独列出的「可替代箱号」卡片（froms = 它缺货时能顶上的箱子） */
function subCard(box, froms, expanded) {
  const open = expanded.has(box.id);
  const limited = Math.min(box.models.length, open ? 999 : 8);
  let moreLabel = "";
  if (open && box.models.length > 8) moreLabel = "收起";
  else if (box.models.length > limited) {
    moreLabel = "展开其余 " + (box.models.length - limited) + " 个型号";
  }
  return {
    id: box.id,
    badgeCls: "badge-" + String(box.prefix).toLowerCase(),
    sizeLines: boxSizeLines(box),
    sizeText: boxSizeText(box),
    name: box.name || "未命名箱",
    open,
    isSub: true,
    hits: linesOf(box.models.slice(0, limited)),
    rest: [],
    restLabel: "",
    moreLabel,
    footMeta: "箱号 " + box.id + " · 箱内共 " + box.models.length + " 个型号",
    copyId: box.id,
    subs: [],
    subFroms: (froms || []).map((f, i) => ({ k: "f" + i, id: f.id, name: f.name || "未命名箱" })),
    subNote: "缺货时，可以用本箱里的机型替代",
  };
}

/** 浏览模式（没输入查询词时）按箱号展示 */
function browseCard(box, expanded) {
  const open = expanded.has(box.id);
  let preview = "";
  let hits = [];
  let moreLabel = "";
  let footMeta = "点卡片展开箱内机型";

  if (!box.models.length) {
    preview = "暂无型号数据";
    footMeta = "";
  } else if (open) {
    hits = linesOf(box.models);
    footMeta = "箱号 " + box.id + " · 箱内共 " + box.models.length + " 个型号";
    if (box.models.length > 12) moreLabel = "收起";
  } else {
    const head = box.models.slice(0, 6).map((m) => m.t).join("、");
    preview = head + (box.models.length > 6 ? " 等" : "") + "（共 " + box.models.length + " 个）";
  }

  return {
    id: box.id,
    badgeCls: "badge-" + String(box.prefix).toLowerCase(),
    sizeLines: boxSizeLines(box),
    sizeText: boxSizeText(box),
    name: box.name || "未命名箱",
    open,
    isSub: false,
    hits,
    rest: [],
    restLabel: "",
    moreLabel,
    preview,
    footMeta,
    copyId: box.id,
    subs: (box.subs || []).map((id, i) => {
      const target = getIndex().boxById.get(id);
      return { k: "u" + i, id, name: (target && target.name) || "" };
    }),
    subFroms: [],
    subNote: "",
  };
}

/**
 * 组装搜索结果视图。返回 { summary, groups, empty }。
 * 「可替代箱号」只跟着精确匹配走，和网页版规则一致。
 */
function buildSearchView(res, expanded, query) {
  const { index, boxById } = getIndex();
  const tokens = String(query).trim().split(/\s+/).filter(Boolean);
  if (res.q.length < 2) {
    return {
      summary: "继续输入型号或箱号…",
      groups: [],
      empty: {
        title: "从上方的下拉列表选择机型",
        hint: "继续输入会自动列出匹配的机型，也可以直接输入箱号，如 S01",
      },
    };
  }

  const exact = res.exact;
  const fuzzy = res.fuzzy;
  if (!exact.length && !fuzzy.length) {
    return {
      summary: "查询「" + String(query).trim() + "」没有结果",
      groups: [],
      empty: {
        title: "没找到这个型号",
        hint: "换个写法试试，比如只输入型号主体（X60Pro、Mate30Pro）",
      },
    };
  }

  const shownFuzzy = fuzzy.slice(0, FUZZY_LIMIT);

  const subFroms = new Map();
  for (const r of exact) {
    for (const id of r.box.subs || []) {
      const list = subFroms.get(id) || [];
      if (!list.includes(r.box)) list.push(r.box);
      subFroms.set(id, list);
    }
  }
  const subBoxes = Array.from(subFroms.keys())
    .map((id) => boxById.get(id))
    .filter(Boolean);
  const shownSubs = subBoxes.slice(0, SUB_LIMIT);

  let summary = exact.length
    ? "找到 " + exact.length + " 个箱号包含「" + String(query).trim() + "」" +
      (fuzzy.length ? "，另有 " + fuzzy.length + " 个相近结果" : "")
    : "没有完全匹配，以下是 " + fuzzy.length + " 个相近结果";
  if (subBoxes.length) summary += "，可替代箱号 " + subBoxes.length + " 个";

  const groups = [];
  if (exact.length) {
    groups.push({
      k: "exact",
      title: "精确匹配（" + exact.length + "）",
      cards: exact.map((r) => resultCard(r, tokens, expanded, true)),
    });
  }
  if (shownSubs.length) {
    groups.push({
      k: "subs",
      title: "可替代箱号（" + shownSubs.length + "）",
      cards: shownSubs.map((b) => subCard(b, subFroms.get(b.id), expanded)),
    });
  }
  if (fuzzy.length) {
    groups.push({
      k: "fuzzy",
      title: "相近结果（" + fuzzy.length + "）",
      cards: shownFuzzy.map((r) => resultCard(r, tokens, expanded, false)),
    });
  }

  const notes = [];
  if (subBoxes.length > shownSubs.length) {
    notes.push("还有 " + (subBoxes.length - shownSubs.length) +
      " 个可替代箱号，把型号写完整一点就能看到。");
  }
  if (fuzzy.length > shownFuzzy.length) {
    notes.push("相近结果较多，只显示前 " + shownFuzzy.length + " 个，再补充几个字符可以缩小范围。");
  }

  return { summary, groups, notes, empty: null };
}

/** 组装浏览视图。返回 { summary, groups } */
function buildBrowseView(expanded, prefix) {
  const { index } = getIndex();
  const boxes = index.boxes;
  const summary = "共 " + boxes.length + " 个箱号 · " +
    "S " + boxes.filter((b) => b.prefix === "S").length + " / " +
    "L " + boxes.filter((b) => b.prefix === "L").length + " / " +
    "Y " + boxes.filter((b) => b.prefix === "Y").length;

  const list = boxes.filter((b) => prefix === "ALL" || b.prefix === prefix);
  const order = prefix === "ALL" ? ["S", "L", "Y"] : [prefix];
  const groups = [];
  for (const p of order) {
    const items = list.filter((b) => b.prefix === p);
    if (!items.length) continue;
    groups.push({
      k: p,
      title: PREFIX_LABEL[p] + "（" + items.length + " 个箱号）",
      cards: items.map((b) => browseCard(b, expanded)),
    });
  }
  return { summary, groups, notes: [], empty: null };
}

/** 组装输入联想视图 */
function buildSuggestView(rawQuery, limit) {
  const { suggestList } = getIndex();
  const res = BoxSearch.suggest(suggestList, rawQuery, limit || 30);
  const tokens = String(rawQuery).trim().split(/\s+/).filter(Boolean);
  const items = res.items.map((it, i) => {
    const inch = currentMode === "size" ? modelSize(it.id) : null;
    const boxes = inch !== null
      ? fmtInch(inch) + "″"
      : it.boxes.slice(0, 3).join("·") + (it.boxes.length > 3 ? " 等" + it.boxes.length : "");
    return {
      k: "t" + i,
      text: it.text,
      segs: segments(it.text, tokens).map((s, j) => ({ k: "s" + j, t: s.t, hit: s.hit })),
      altText: altText(it.alt),
      boxes,
      isName: it.type === "name",
    };
  });
  return { items, more: Math.max(0, res.total - items.length) };
}

/** 「尺寸查箱号」里的一张箱号卡片（带上跟目标尺寸的距离） */
function sizeCard(item, expanded) {
  const box = item.box;
  const open = expanded.has(box.id);
  const level = sizeLevel(item.d);
  const hits = open
    ? box.models.map((m, i) => {
      return {
        k: "l" + i,
        t: m.t,
        altText: altText(m.alt),
        sizeText: sizesLabel(m.k),
      };
    })
    : [];
  let moreLabel = "";
  if (open && box.models.length > 12) moreLabel = "收起";
  return {
    id: box.id,
    badgeCls: "badge-" + String(box.prefix).toLowerCase(),
    sizeLines: boxSizeLines(box),
    sizeText: boxSizeText(box),
    name: box.name || "未命名箱",
    open,
    isSub: false,
    isSize: true,
    levelKey: level.key,
    levelLabel: level.label,
    kindKey: item.kind === "single" ? "" : item.kind,
    kindLabel: item.kind === "inner" ? "内屏匹配" : (item.kind === "outer" ? "外屏匹配" : ""),
    sizeHitModel: item.model.t,
    sizeHitInch: (item.kind === "inner" ? "内屏 " : (item.kind === "outer" ? "外屏 " : "")) +
      fmtInch(item.inch) + "″",
    sizeHitDiff: item.d < 0.005 ? "尺寸相同" : "差 " + fmtInch(item.d) + "″",
    hits,
    rest: [],
    restLabel: "",
    moreLabel,
    preview: "",
    footMeta: open
      ? "箱号 " + box.id + " · 箱内共 " + box.models.length + " 个型号"
      : "点卡片展开箱内机型",
    copyId: box.id,
    subs: [],
    subFroms: [],
    subNote: "",
  };
}

/** 组装「尺寸查箱号」视图。返回 { summary, notice, groups, notes, empty, sizeExamples } */
function buildSizeView(query, expanded, prefix) {
  const raw = String(query || "").trim();
  const boxes = (sizesData && sizesData.boxes) || {};
  const okIds = Object.keys(boxes).filter((id) => boxes[id].ok && boxes[id].inch);
  const base = { groups: [], notes: [], notice: "", sizeExamples: quickSizes(), empty: null };

  if (!raw) {
    return Object.assign({}, base, {
      summary: "已标出屏幕尺寸的箱号：" + okIds.length + " / " + getIndex().index.boxes.length + " 个",
      empty: {
        title: "输手机型号，或直接输屏幕尺寸",
        hint: "输型号（如 红米10A）会先查它的屏幕尺寸，再列出尺寸相近的箱号；" +
          "也可以直接输 6.5。箱号右上角就是这一箱的屏幕尺寸。",
      },
    });
  }

  let size = parseSizeQuery(raw);
  let head;
  if (size === null) {
    const hit = resolveSize(raw);
    if (!hit) {
      return Object.assign({}, base, {
        summary: "没有「" + raw + "」的屏幕尺寸数据",
        empty: {
          title: "查不到这个型号的屏幕尺寸",
          hint: "换种写法再试（如 红米10A、苹果13），或直接输尺寸，如 6.5",
        },
      });
    }
    size = hit.size;
    head = hit.model
      ? "「" + raw + "」匹配到「" + hit.model + "」，屏幕约 " + fmtInch(size) + "″"
      : "「" + raw + "」屏幕约 " + fmtInch(size) + "″";
  } else {
    head = "屏幕尺寸 " + fmtInch(size) + "″";
  }

  const list = nearestBySize(size, prefix);
  if (!list.length) {
    return Object.assign({}, base, {
      summary: head + "，没找到尺寸相近的箱号",
      empty: { title: "没有尺寸相近的箱号", hint: "换个尺寸再试，比如 6.1、6.5、6.7；或换个型号写法" },
    });
  }

  const same = list.filter((x) => x.d <= SIZE_NEAR);
  const close = list.filter((x) => x.d > SIZE_NEAR && x.d <= SIZE_CLOSE);
  const fit = list.filter((x) => x.d > SIZE_CLOSE);
  const defs = [
    ["尺寸一致", same, SIZE_MATCH_LIMIT],
    ["尺寸接近", close, SIZE_MATCH_LIMIT],
    ["勉强候选（差得较多，需现场比对）", fit, 10],
  ];
  const groups = [];
  const notes = [];
  for (const [title, items, limit] of defs) {
    if (!items.length) continue;
    const shown = items.slice(0, limit);
    groups.push({
      k: title,
      title: title + "（" + items.length + "）",
      cards: shown.map((x) => sizeCard(x, expanded)),
    });
    if (items.length > shown.length) {
      notes.push("「" + title + "」还有 " + (items.length - shown.length) +
        " 个，把尺寸写得更接近一点可以缩小范围。");
    }
  }
  return Object.assign({}, base, {
    summary: head + "，找到 " + list.length + " 个尺寸相近的箱号（一致 " + same.length +
      " / 接近 " + close.length + " / 勉强 " + fit.length + "）",
    notice: "屏幕尺寸相近 ≠ 可以通用。请现场比对屏幕尺寸、比例、排线、开孔后再决定。",
    groups,
    notes,
  });
}

function tabDefs() {
  const { index } = getIndex();
  const counts = { ALL: index.boxes.length };
  for (const b of index.boxes) counts[b.prefix] = (counts[b.prefix] || 0) + 1;
  return [
    { key: "ALL", label: "全部", count: counts.ALL || 0 },
    { key: "S", label: "S 开头", count: counts.S || 0 },
    { key: "L", label: "L 开头", count: counts.L || 0 },
    { key: "Y", label: "Y 开头", count: counts.Y || 0 },
  ];
}

const api = {
  getIndex, segments, pickVariant, resultCard, subCard, browseCard,
  buildSearchView, buildBrowseView, buildSuggestView, buildSizeView, sizeCard,
  tabDefs, boxSizeLines, modelSize, modelSizes, sizesLabel, parseSizeQuery, nearestBySize,
  resolveSize, quickSizes,
  EXAMPLES, SIZE_EXAMPLE_MODELS,
  setMode(mode) { currentMode = mode; },
  getMode() { return currentMode; },
};

// node 自测（tools/check_mp.js）时走这里；小程序里 module 也存在，但下面会被覆盖
if (typeof module === "object" && module.exports) module.exports = api;

// ============================================================ 页面
if (typeof Page === "function") {
  const state = {
    prefix: "ALL",
    mode: "model",
    query: "",
    searching: false,
    expanded: new Set(),
    suggestHidden: true,
  };
  let timer = 0;
  let lastSubmit = 0;

  Page({
    data: {
      q: "",
      mode: "model",
      compact: false,
      toTop: false,
      tabs: [],
      prefix: "ALL",
      suggestHidden: true,
      suggestItems: [],
      suggestMore: 0,
      summary: "",
      notice: "",
      groups: [],
      notes: [],
      sizeExamples: [],
      empty: null,
      examples: EXAMPLES,
      sizeModelExamples: SIZE_EXAMPLE_MODELS,
      generatedAt: "",
      loading: true,
    },

    onLoad(options) {
      const { index } = getIndex();
      const initial = (options && options.q) ? decodeURIComponent(options.q) : "";
      const mode = options && options.mode === "size" ? "size" : "model";
      state.mode = mode;
      currentMode = mode;
      this.setData({
        tabs: tabDefs(),
        generatedAt: index.generatedAt || "",
        loading: false,
        q: initial,
        mode,
      });
      state.query = initial;
      state.searching = !!initial;
      this.update();
      wx.setNavigationBarTitle({ title: "手机型号查箱号" });
    },

    onUnload() {
      clearTimeout(timer);
    },

    onPageScroll(e) {
      const y = e.scrollTop;
      const compact = y > 60;
      const toTop = y > 600;
      if (compact !== this.data.compact || toTop !== this.data.toTop) {
        this.setData({ compact, toTop });
      }
    },

    onShareAppMessage() {
      const q = state.query;
      return {
        title: q ? "手机型号查箱号：" + q : "手机型号查箱号",
        path: "/pages/index/index" +
          (state.mode === "size" ? "?mode=size" : "") +
          (q ? (state.mode === "size" ? "&" : "?") + "q=" + encodeURIComponent(q) : ""),
      };
    },

    onModeTap(e) {
      const mode = e.currentTarget.dataset.mode;
      if (!mode || mode === state.mode) return;
      state.mode = mode;
      currentMode = mode;
      state.expanded.clear();
      clearTimeout(timer);
      this.setData({ mode, suggestHidden: true, suggestItems: [], suggestMore: 0 });
      this.update();
    },

    // -------------------------------------------------------- 搜索
    onInput(e) {
      const q = e.detail.value;
      this.setData({ q });
      this.refreshSuggest(q);
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = q.trim();
        state.searching = !!state.query;
        this.update();
      }, 120);
    },

    onFocus() {
      if (this.data.q.trim()) this.refreshSuggest(this.data.q);
    },

    onBlur() {
      // 手指点在联想项上时先触发 blur，延迟一点再收起，保证点击能生效
      setTimeout(() => {
        if (this.data.suggestHidden) return;
        this.setData({ suggestHidden: true, suggestItems: [], suggestMore: 0 });
      }, 200);
    },

    onConfirm() {
      this.submit();
    },

    submit() {
      const now = Date.now();
      if (now - lastSubmit < 300) return;
      lastSubmit = now;
      clearTimeout(timer);
      const q = this.data.q.trim();
      state.query = q;
      state.searching = !!q;
      this.setData({ suggestHidden: true, suggestItems: [], suggestMore: 0 });
      state.expanded.clear();
      this.update();
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    },

    onSuggestTap(e) {
      const item = e.currentTarget.dataset.item;
      if (!item) return;
      clearTimeout(timer);
      this.setData({ q: item.text, suggestHidden: true, suggestItems: [], suggestMore: 0 });
      state.query = item.text;
      state.searching = true;
      state.expanded.clear();
      this.update();
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    },

    refreshSuggest(raw) {
      const value = String(raw || "").trim();
      if (!value) {
        this.setData({ suggestHidden: true, suggestItems: [], suggestMore: 0 });
        return;
      }
      const view = buildSuggestView(value, 30);
      if (!view.items.length) {
        this.setData({ suggestHidden: true, suggestItems: [], suggestMore: 0 });
        return;
      }
      this.setData({
        suggestHidden: false,
        suggestItems: view.items,
        suggestMore: view.more,
      });
    },

    onClear() {
      clearTimeout(timer);
      state.query = "";
      state.searching = false;
      state.expanded.clear();
      this.setData({ q: "", suggestHidden: true, suggestItems: [], suggestMore: 0 });
      this.update();
    },

    onExample(e) {
      const q = e.currentTarget.dataset.q;
      clearTimeout(timer);
      state.query = q;
      state.searching = true;
      state.expanded.clear();
      this.setData({ q, suggestHidden: true, suggestItems: [], suggestMore: 0 });
      this.update();
    },

    onSizeExample(e) {
      const q = e.currentTarget.dataset.q;
      clearTimeout(timer);
      state.query = q;
      state.searching = true;
      state.expanded.clear();
      this.setData({ q, suggestHidden: true, suggestItems: [], suggestMore: 0 });
      this.update();
    },

    onTab(e) {
      const prefix = e.currentTarget.dataset.prefix;
      state.prefix = prefix;
      this.setData({ prefix });
      this.update();
    },

    // -------------------------------------------------------- 卡片交互
    onCardTap(e) {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      this.update();
    },

    onMore(e) {
      const id = e.currentTarget.dataset.id;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      this.update();
    },

    onSubTap(e) {
      const id = e.currentTarget.dataset.sub;
      if (!id) return;
      clearTimeout(timer);
      state.query = id;
      state.searching = true;
      state.expanded.clear();
      this.setData({ q: id, suggestHidden: true, suggestItems: [], suggestMore: 0 });
      this.update();
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    },

    onCopy(e) {
      const id = e.currentTarget.dataset.copy;
      if (!id) return;
      wx.setClipboardData({
        data: id,
        success: () => wx.showToast({ title: "已复制 " + id, icon: "none", duration: 1200 }),
      });
    },

    onToTop() {
      wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    },

    // -------------------------------------------------------- 渲染
    /** 按当前模式/输入决定渲染哪个视图 */
    update() {
      if (state.mode === "size") this.refreshSize();
      else if (state.searching) this.refresh();
      else this.refreshBrowse();
    },

    refresh() {
      const res = BoxSearch.search(getIndex().index, state.query);
      const view = buildSearchView(res, state.expanded, state.query);
      this.setData({
        summary: view.summary,
        notice: "",
        groups: view.groups,
        notes: view.notes || [],
        sizeExamples: [],
        empty: view.empty || null,
      });
    },

    refreshBrowse() {
      const view = buildBrowseView(state.expanded, state.prefix);
      this.setData({
        summary: view.summary,
        notice: "",
        groups: view.groups,
        notes: view.notes || [],
        sizeExamples: [],
        empty: null,
      });
    },

    refreshSize() {
      const view = buildSizeView(state.query, state.expanded, state.prefix);
      this.setData({
        summary: view.summary,
        notice: view.notice || "",
        groups: view.groups,
        notes: view.notes || [],
        sizeExamples: view.sizeExamples || [],
        empty: view.empty || null,
      });
    },
  });
}
