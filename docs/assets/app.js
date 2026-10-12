/* 页面交互：加载数据、搜索、渲染结果 */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const tabsEl = $("#tabs");
  const resultsEl = $("#results");
  const summaryEl = $("#summary");
  const formEl = $("#search-form");
  const inputEl = $("#q");
  const toastEl = $("#toast");
  const headerEl = $("#header");
  const toTopEl = $("#to-top");

  const PREFIX_LABEL = { S: "S 开头", L: "L 开头", Y: "Y 开头" };
  const EXAMPLES = ["Mate30Pro", "X60Pro", "苹果13", "红米K80", "S01"];

  const state = {
    index: null,
    prefix: "ALL",
    result: null,
    showFuzzy: false,
    expanded: new Set(),
  };

  // ------------------------------------------------------------ 工具函数
  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  /** 在原始文本里高亮查询词（忽略空格大小写差异） */
  function highlight(raw, tokens) {
    const compact = [];
    let plain = "";
    for (let i = 0; i < raw.length; i += 1) {
      if (/\s/.test(raw[i])) continue;
      plain += raw[i].toLowerCase();
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
      return esc(raw.slice(0, start)) + "<mark>" + esc(raw.slice(start, end)) + "</mark>" + esc(raw.slice(end));
    }
    return esc(raw);
  }

  let toastTimer = 0;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
  }

  function copy(text) {
    const done = () => toast("已复制箱号 " + text);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else {
      fallback();
    }
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，箱号：" + text); }
      document.body.removeChild(ta);
    }
  }

  // ------------------------------------------------------------ 渲染
  function containsToken(text, tokens) {
    const compact = String(text).toLowerCase().replace(/\s+/g, "");
    return (tokens || []).some((t) => {
      const tk = t.toLowerCase().replace(/\s+/g, "");
      return tk.length >= 2 && compact.includes(tk);
    });
  }

  /** 型号可能有多种写法，优先显示与用户输入一致的那种 */
  function pickVariant(model, tokens) {
    const all = [model.t].concat(model.alt || []);
    const hit = all.find((t) => containsToken(t, tokens));
    const text = hit || model.t;
    return { text, others: all.filter((t) => t !== text) };
  }

  function badge(box, small) {
    const size = small ? " badge-sm" : "";
    return `<div class="badge badge-${box.prefix.toLowerCase()}${size}">${esc(box.id)}</div>`;
  }

  function sourceTag(hits) {
    if (!hits.length) return "";
    const verified = hits.every((h) => h.m.v === "both");
    return verified
      ? '<span class="tag verified">两人已核对</span>'
      : '<span class="tag pending">待核对</span>';
  }

  function resultCard(result, tokens) {
    const box = result.box;
    const limited = Math.min(result.hits.length, state.expanded.has(box.id) ? 99 : 8);
    const lines = result.hits.slice(0, limited).map((h) => {
      const cls = h.s >= 96 ? "exact" : "";
      const picked = pickVariant(h.m, tokens);
      const alt = picked.others.length
        ? ` <span class="alt">（另一写法：${esc(picked.others.join("、"))}）</span>`
        : "";
      return `<li class="${cls}">${highlight(picked.text, tokens)}${alt}</li>`;
    }).join("");
    const more = result.hits.length > limited
      ? `<button class="more" data-more="${esc(box.id)}" type="button">展开其余 ${result.hits.length - limited} 个型号</button>`
      : "";
    const name = box.name ? esc(box.name) : "未命名箱";
    return `
      <article class="card" data-id="${esc(box.id)}">
        ${badge(box, false)}
        <div class="card-body">
          <div class="card-head">
            <span class="card-name">${name}</span>
            ${sourceTag(result.hits)}
          </div>
          <ul class="hits">${lines}</ul>
          ${more}
          <div class="card-meta">箱号 ${esc(box.id)} · 箱内共 ${box.total} 个型号</div>
        </div>
      </article>`;
  }

  function browseCard(box) {
    const preview = box.models.slice(0, 6).map((m) => m.t).join("、");
    const rest = box.models.length > 6 ? " 等" : "";
    const name = box.name ? esc(box.name) : "未命名箱";
    const body = box.models.length
      ? `<div class="card-meta">${esc(preview)}${rest}（共 ${box.total} 个）</div>`
      : '<div class="card-meta">暂无型号数据</div>';
    return `
      <article class="card" data-id="${esc(box.id)}">
        ${badge(box, true)}
        <div class="card-body">
          <div class="card-head"><span class="card-name">${name}</span></div>
          ${body}
        </div>
      </article>`;
  }

  function visibleBoxes(list) {
    return state.prefix === "ALL" ? list : list.filter((b) => b.box.prefix === state.prefix);
  }

  function renderBrowse() {
    const boxes = state.index.boxes;
    const list = boxes.filter((b) => state.prefix === "ALL" || b.prefix === state.prefix);
    summaryEl.innerHTML = `共 <b>${boxes.length}</b> 个箱号 · ` +
      `S ${boxes.filter((b) => b.prefix === "S").length} / ` +
      `L ${boxes.filter((b) => b.prefix === "L").length} / ` +
      `Y ${boxes.filter((b) => b.prefix === "Y").length}`;
    let html = "";
    const groups = state.prefix === "ALL" ? ["S", "L", "Y"] : [state.prefix];
    for (const p of groups) {
      const items = list.filter((b) => b.prefix === p);
      if (!items.length) continue;
      html += `<h2 class="group-title">${PREFIX_LABEL[p]}（${items.length} 个箱号）</h2>`;
      html += items.map(browseCard).join("");
    }
    resultsEl.innerHTML = html;
  }

  function renderSearch() {
    const res = state.result;
    const tokens = String(inputEl.value).trim().split(/\s+/).filter(Boolean);
    if (res.q.length < 2) {
      summaryEl.textContent = "继续输入型号或箱号…";
      resultsEl.innerHTML = emptyHTML("再多输入一点", "至少输入 2 个字符，例如 X60Pro、红米K80、S01");
      return;
    }
    let exact = visibleBoxes(res.exact);
    let fuzzy = visibleBoxes(res.fuzzy);

    if (!exact.length && !fuzzy.length) {
      summaryEl.innerHTML = `查询「${esc(inputEl.value.trim())}」没有结果`;
      resultsEl.innerHTML = emptyHTML("没找到这个型号", "换个写法试试，比如只输入型号主体（X60Pro、Mate30Pro）");
      return;
    }

    const primary = exact.length ? exact : [];
    const secondary = state.showFuzzy ? fuzzy : [];
    summaryEl.innerHTML = primary.length
      ? `找到 <b>${primary.length}</b> 个箱号包含「${esc(res.query.trim())}」`
      : `没有完全匹配，以下是 <b>${fuzzy.length}</b> 个相近结果`;

    let html = "";
    if (primary.length) {
      html += `<h2 class="group-title">精确匹配（${primary.length}）</h2>`;
      html += primary.map((r) => resultCard(r, tokens)).join("");
      if (!state.showFuzzy && fuzzy.length) {
        html += `<button class="fuzzy-toggle" id="fuzzy-toggle" type="button">还有 ${fuzzy.length} 个相近结果（点击查看）</button>`;
      }
    }
    if (secondary.length) {
      html += `<h2 class="group-title">相近结果（${secondary.length}）</h2>`;
      html += secondary.map((r) => resultCard(r, tokens)).join("");
    }
    resultsEl.innerHTML = html;
  }

  function emptyHTML(title, hint) {
    return `
      <div class="empty">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14"/></svg>
        <p>${esc(title)}</p>
        <p class="hint">${esc(hint)}</p>
        <div class="examples">
          ${EXAMPLES.map((e) => `<button class="example" type="button" data-example="${esc(e)}">${esc(e)}</button>`).join("")}
        </div>
      </div>`;
  }

  function render() {
    if (!state.index) return;
    if (state.result) renderSearch();
    else renderBrowse();
  }

  // ------------------------------------------------------------ 交互
  let timer = 0;
  function runSearch(updateUrl) {
    const query = inputEl.value.trim();
    state.showFuzzy = false;
    state.expanded.clear();
    state.result = query ? window.BoxSearch.search(state.index, query) : null;
    render();
    if (updateUrl !== false) {
      const url = new URL(window.location.href);
      if (query) url.searchParams.set("q", query);
      else url.searchParams.delete("q");
      history.replaceState(null, "", url);
    }
  }

  inputEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(), 120);
  });

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    inputEl.blur();
    clearTimeout(timer);
    runSearch();
  });

  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    state.prefix = btn.dataset.prefix;
    for (const t of tabsEl.querySelectorAll(".tab")) {
      t.setAttribute("aria-pressed", String(t === btn));
    }
    render();
  });

  resultsEl.addEventListener("click", (e) => {
    const more = e.target.closest("[data-more]");
    if (more) {
      state.expanded.add(more.dataset.more);
      render();
      return;
    }
    if (e.target.closest("#fuzzy-toggle")) {
      state.showFuzzy = true;
      render();
      const head = resultsEl.querySelector(".group-title");
      if (head) head.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const example = e.target.closest("[data-example]");
    if (example) {
      inputEl.value = example.dataset.example;
      runSearch();
      return;
    }
    const card = e.target.closest(".card");
    if (card) copy(card.dataset.id);
  });

  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    headerEl.classList.toggle("compact", y > 30);
    toTopEl.classList.toggle("show", y > 700);
  }, { passive: true });

  toTopEl.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  // ------------------------------------------------------------ 启动
  function buildTabs() {
    const counts = { ALL: state.index.boxes.length };
    for (const b of state.index.boxes) counts[b.prefix] = (counts[b.prefix] || 0) + 1;
    const defs = [
      ["ALL", "全部"],
      ["S", "S 开头"],
      ["L", "L 开头"],
      ["Y", "Y 开头"],
    ];
    tabsEl.innerHTML = defs.map(([key, label]) =>
      `<button class="tab" type="button" data-prefix="${key}" aria-pressed="${key === state.prefix}">` +
      `${label}<span style="opacity:.65"> ${counts[key] || 0}</span></button>`
    ).join("");
  }

  async function boot() {
    resultsEl.innerHTML = '<div class="loading">正在加载型号数据…</div>';
    let data;
    try {
      const resp = await fetch("data/boxes.json", { cache: "no-cache" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      data = await resp.json();
    } catch (err) {
      resultsEl.innerHTML = emptyHTML(
        "数据加载失败",
        "请通过 http(s) 地址打开本页面（本地预览可运行 python -m http.server）"
      );
      if (location.protocol !== "https:" && location.protocol !== "http:") {
        resultsEl.innerHTML = emptyHTML(
          "请用网页地址打开",
          "直接双击文件（file://）无法读取数据，请在文件夹里运行 python -m http.server 后访问"
        );
      }
      return;
    }
    state.index = window.BoxSearch.makeIndex(data);
    buildTabs();
    const initial = new URLSearchParams(location.search).get("q");
    if (initial) inputEl.value = initial;
    runSearch(false);
    const c = state.index.counts;
    if (c && c.boxes) {
      $("#gen").textContent = `数据更新于 ${state.index.generatedAt}，共 ${c.boxes} 个箱号 / ${c.models} 条型号记录`;
    }
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  boot();
})();
