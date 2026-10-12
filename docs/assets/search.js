/* 搜索核心逻辑：规范化、型号匹配、打分排序。
   同时可在 Node 中 require 以便自动化测试。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BoxSearch = api;
})(typeof self !== "undefined" ? self : this, function () {
  // 与 tools/build_data.py 中的映射保持一致
  const ALIASES = [
    ["华为", "huawei"],
    ["荣耀", "honor"],
    ["小米", "xiaomi"],
    ["红米", "redmi"],
    ["苹果", "iphone"],
    ["真我", "realme"],
    ["一加", "oneplus"],
    ["三星", "samsung"],
    ["魅族", "meizu"],
    ["魔术", "magic"],
    ["魔法", "magic"],
    ["魔幻", "magic"],
    ["保时捷版", "rs"],
    ["保时捷设计", "rs"],
    ["至臻版", "ultimate"],
    ["至尊版", "ultimate"],
    ["至臻", "ultimate"],
    ["至尊", "ultimate"],
    ["尊享版", "ultimate"],
    ["青春版", "youth"],
    ["活力版", "youth"],
    ["国内版", "cn"],
    ["超声波解锁", ""],
    ["厚胶", ""],
  ];

  const SEP_RE = /[\s,，、;；/／|｜\\\-—_~～:：.。'’"“”()（）\[\]【】{}｛｝]+/g;

  const BRAND_PREFIXES = [
    "huawei", "honor", "xiaomi", "redmi", "vivo", "oppo", "oneplus", "realme",
    "iphone", "apple", "samsung", "galaxy", "iqoo", "meizu", "tdtech",
    "金利", "优畅享", "麦芒", "联想", "中兴", "努比亚", "摩托罗拉", "诺基亚",
    "海信", "飞利浦", "索尼", "夏普", "黑鲨", "红魔", "魅蓝", "锤子", "美图",
    "中国移动", "移动", "联通", "电信", "酷派", "天语", "小辣椒", "朵唯",
    "letv", "leeco", "htc", "zte", "nubia", "lenovo", "motorola", "nokia",
    "philips", "sharp", "sony", "blackshark", "smartisan", "gionee", "doov",
    "hisense", "tcl", "meitu", "vertu", "8848", "docomo", "softbank",
  ];

  const PREFIX_ORDER = { S: 0, L: 1, Y: 2 };

  function norm(text) {
    let s = String(text == null ? "" : text).normalize("NFKC").toLowerCase();
    s = s.replace(/＋|﹢/g, "+");
    for (const [a, b] of ALIASES) s = s.split(a).join(b);
    s = s.replace(SEP_RE, "");
    return s.split("+").join("plus");
  }

  function core(text) {
    let s = norm(text);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of BRAND_PREFIXES) {
        if (s.startsWith(p) && s.length > p.length + 1) {
          s = s.slice(p.length);
          changed = true;
          break;
        }
      }
    }
    return s;
  }

  /** 预计算索引：给每个箱号补上规范化字段 */
  function makeIndex(data) {
    const boxes = data.boxes.map((box) => ({
      id: box.id,
      prefix: box.prefix,
      name: box.name || "",
      nk: norm(box.name || ""),
      nc: core(box.name || ""),
      idKey: box.id.toLowerCase(),
      total: box.models.length,
      models: box.models.map((m) => ({
        t: m.t,
        alt: m.alt || [],
        k: m.k || norm(m.t),
        c: m.c || core(m.t),
        v: m.v || "d",
      })),
    }));
    boxes.sort(
      (a, b) =>
        (PREFIX_ORDER[a.prefix] ?? 9) - (PREFIX_ORDER[b.prefix] ?? 9) ||
        codeNum(a.id) - codeNum(b.id)
    );
    return { boxes, counts: data.counts || {}, generatedAt: data.generatedAt || "" };
  }

  function codeNum(id) {
    const n = parseInt(String(id).replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  /** 单条文本的匹配分：100 完全相同 / 96 型号核心相同 / 82 前缀 / 64 包含 / 58 被包含 */
  function score(key, coreKey, q, qc) {
    if (!q || !key) return 0;
    if (key === q) return 100;
    // 核心型号只在“够长且含字母”时才用于匹配，避免"13"这类纯数字误伤一大片
    const useCore = qc.length >= 3 && /[a-z]/.test(qc);
    if (useCore && coreKey === qc) return 96;
    if (key.startsWith(q) || (useCore && coreKey.startsWith(qc))) return 82;
    if (key.includes(q) || (useCore && coreKey.includes(qc))) return 64;
    if (key.length >= 3 && q.includes(key)) return 58;
    return 0;
  }

  /**
   * 查询。
   * 返回 { q, exact: [...], fuzzy: [...] }，每个结果 { box, score, hits, byId, byName }
   */
  function search(index, rawQuery) {
    const q = norm(rawQuery);
    const qc = core(rawQuery);
    if (!q) return { q, exact: [], fuzzy: [], query: rawQuery };
    const allowFuzzy = q.length >= 2;
    const exact = [];
    const fuzzy = [];

    for (const box of index.boxes) {
      const idScore = q === box.idKey ? 100 : 0;
      const nameScore = score(box.nk, box.nc, q, qc);
      const hits = [];
      let modelBest = 0;
      for (const m of box.models) {
        const s = score(m.k, m.c, q, qc);
        if (s >= 58) hits.push({ m, s });
        if (s > modelBest) modelBest = s;
      }
      hits.sort((a, b) => b.s - a.s || a.m.t.length - b.m.t.length);
      const best = Math.max(idScore, nameScore, modelBest);
      if (!best) continue;

      const byId = idScore === 100;
      const byName = nameScore >= 82;
      let list = hits;
      if (!list.length && box.total) {
        // 命中箱号或箱子名称时，展示箱内型号作为参考
        list = box.models.slice(0, 12).map((m) => ({ m, s: 0 }));
      }
      const result = { box, score: best, hits: list, byId, byName };
      if (best >= 96) exact.push(result);
      else if (allowFuzzy) fuzzy.push(result);
    }

    const sorter = (a, b) => b.score - a.score || b.hits.length - a.hits.length;
    exact.sort(sorter);
    fuzzy.sort(sorter);
    return { q, query: rawQuery, exact, fuzzy };
  }

  /**
   * 输入联想用的候选表：把所有型号（含箱名、别名写法）去重后汇总，
   * 每项记录它出现在哪些箱号里。
   */
  function buildSuggestions(boxes) {
    const map = new Map();
    const add = (isModel, key, coreKey, text, boxId) => {
      if (!key) return;
      let e = map.get(key);
      if (!e) {
        e = { id: key, ns: isModel ? "m" : "name", k: key, core: coreKey, texts: [], raws: [], boxes: [] };
        map.set(key, e);
      }
      if (isModel) e.ns = "m"; // 型号和箱名撞名时按型号处理
      const raw = String(text).toLowerCase().replace(/\s+/g, "");
      if (!e.texts.includes(text)) {
        e.texts.push(text);
        e.raws.push(raw);
      }
      if (boxId && !e.boxes.includes(boxId)) e.boxes.push(boxId);
    };
    for (const box of boxes) {
      for (const m of box.models) {
        add(true, m.k, m.c, m.t, box.id);
        for (const alt of m.alt || []) add(true, m.k, m.c, alt, box.id);
      }
      add(false, box.nk, box.nc, box.name, box.id);
    }
    return Array.from(map.values());
  }

  /**
   * 联想查询：输入 "i" 就能列出所有以 i 开头的机型（含别名写法）。
   * 返回 { items: [{ id, text, boxes, type, tier }], total }
   */
  function suggest(list, rawQuery, limit) {
    const q = norm(rawQuery);
    if (!q) return { items: [], total: 0 };
    const qc = core(rawQuery);
    const useCore = qc.length >= 3 && /[a-z]/.test(qc);
    const qraw = String(rawQuery).trim().toLowerCase().replace(/\s+/g, "");

    const scored = [];
    for (const e of list) {
      let tier = -1;
      if (e.k === q) tier = 0;
      else if (useCore && e.core === qc) tier = 1;
      else if (qraw && e.raws.some((r) => r.startsWith(qraw))) tier = 2;
      else if (e.k.startsWith(q)) tier = 3;
      else if (useCore && e.core.startsWith(qc)) tier = 4;
      else if (qraw.length >= 2 && e.raws.some((r) => r.includes(qraw))) tier = 5;
      else if (e.k.includes(q)) tier = 6;
      else if (useCore && e.core.includes(qc)) tier = 7;
      if (tier < 0) continue;
      scored.push({ e, tier });
    }

    scored.sort((a, b) =>
      a.tier - b.tier ||
      (a.e.ns === b.e.ns ? 0 : a.e.ns === "m" ? -1 : 1) ||
      a.e.texts[0].length - b.e.texts[0].length ||
      (a.e.texts[0] < b.e.texts[0] ? -1 : 1)
    );

    const max = limit || 30;
    return {
      total: scored.length,
      items: scored.slice(0, max).map(({ e, tier }) => {
        // 显示与用户输入最接近的那种写法（例如输入“苹果”就显示“苹果13”而不是“iPhone13”）
        let text = e.texts[0];
        if (qraw) {
          const starts = e.texts.find((t) => t.toLowerCase().replace(/\s+/g, "").startsWith(qraw));
          const has = e.texts.find((t) => t.toLowerCase().replace(/\s+/g, "").includes(qraw));
          text = starts || has || text;
        }
        return {
          id: e.id,
          text,
          alt: e.texts.filter((t) => t !== text).slice(0, 2),
          boxes: e.boxes,
          type: e.ns === "name" ? "name" : "model",
          tier,
        };
      }),
    };
  }

  return { norm, core, makeIndex, search, suggest, buildSuggestions, score, PREFIX_ORDER };
});
