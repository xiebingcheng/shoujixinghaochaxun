# -*- coding: utf-8 -*-
"""把「型号 -> 屏幕尺寸」表汇总成「每个箱号的代表尺寸」，供网站/小程序使用。

输入：
    docs/data/boxes.json        （已有：箱号 + 箱内型号）
    docs/data/model-sizes.json  （人工/生成：型号 -> 英寸）

输出：
    docs/data/sizes.json        型号尺寸表 + 每个箱号的代表尺寸
    reports/屏幕尺寸覆盖报告.md  覆盖情况 / 待补清单 / 尺寸不一致的箱号

箱号代表尺寸怎么算（按“抽 60~80% 的机型就能代表这一箱”的思路）：
  1. 只统计「有尺寸数据」的箱内型号；
  2. 覆盖率 = 有尺寸的型号数 / 箱内型号总数，低于 60% 就不给结论；
  3. 把尺寸按 0.1 英寸分桶，取占比最大的那一桶；
  4. 一致率 = 该桶型号数 / 有尺寸的型号数，低于 60% 说明这一箱尺寸不统一，
     也不给结论（会列进报告，多半是数据本身有问题）。

用法：python tools/build_sizes.py
"""
import datetime
import json
import os
import sys
sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "docs", "data")
BOXES_PATH = os.path.join(DATA_DIR, "boxes.json")
SIZES_PATH = os.path.join(DATA_DIR, "model-sizes.json")
OUT_PATH = os.path.join(DATA_DIR, "sizes.json")
REPORT_PATH = os.path.join(ROOT, "reports", "屏幕尺寸覆盖报告.md")

COVERAGE_MIN = 0.6   # 覆盖率达到 60% 才认这一箱
AGREEMENT_MIN = 0.6  # 落在同一尺寸档的型号占比达到 60% 才认
TOLERANCE = 0.1      # 相差 0.1 英寸以内算「同一档」屏幕

# 这些不是具体机型，是表格里的占位词（折叠屏箱子里都写着它），不参与尺寸统计
PLACEHOLDERS = {"折叠屏", "折叠屏前屏"}

# ---------------------------------------------------------------- 规范化（必须与 assets/search.js、tools/build_data.py 保持一致）
BRAND_ALIASES = [
    ("华为", "huawei"), ("荣耀", "honor"), ("小米", "xiaomi"), ("红米", "redmi"),
    ("苹果", "iphone"), ("真我", "realme"), ("一加", "oneplus"), ("三星", "samsung"),
    ("魅族", "meizu"), ("魔术", "magic"), ("魔法", "magic"), ("魔幻", "magic"),
    ("保时捷版", "rs"), ("保时捷设计", "rs"), ("至臻版", "ultimate"),
    ("至尊版", "ultimate"), ("至臻", "ultimate"), ("至尊", "ultimate"),
    ("尊享版", "ultimate"), ("青春版", "youth"), ("活力版", "youth"),
    ("国内版", "cn"), ("超声波解锁", ""), ("厚胶", ""),
]
SEP_CHARS = " \t\r\n,，、;；/／|｜\\-—_~～:：.。'’\"“”()（）[]【】{}｛｝"
SEP_TABLE = {ord(c): None for c in SEP_CHARS}


def norm(text):
    s = str(text or "").lower()
    s = s.replace("＋", "+").replace("﹢", "+")
    for a, b in BRAND_ALIASES:
        s = s.replace(a, b)
    s = s.translate(SEP_TABLE)
    return s.replace("+", "plus")


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def parse_size(val):
    """尺寸表里一条记录：单个数字，或 {"inner": 内屏, "outer": 外屏}。"""
    if isinstance(val, dict):
        out = {}
        for k in ("inner", "outer"):
            if val.get(k):
                out[k] = float(val[k])
        return out or None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def size_key(val):
    return tuple(sorted(val.items())) if isinstance(val, dict) else (val,)


def cluster_repr(vals):
    """找「最多数值挤在一起」的那个 0.1 英寸区间，返回 (代表值, 一致率, (最小, 最大))。"""
    vals = sorted(vals)
    best_i = best_n = 0
    j = 0
    for i, v in enumerate(vals):
        while vals[j] < v - TOLERANCE - 1e-9:
            j += 1
        if i - j + 1 > best_n:
            best_n, best_i = i - j + 1, j
    window = vals[best_i:best_i + best_n]
    return round(sum(window) / len(window), 2), best_n / len(vals), (min(window), max(window))
def main():
    boxes_data = load_json(BOXES_PATH)
    if not os.path.exists(SIZES_PATH):
        print(f"[!] 找不到 {SIZES_PATH}，先运行 python tools/gen_model_sizes.py")
        return 1
    sizes_data = load_json(SIZES_PATH)
    raw_models = sizes_data.get("models") or {}

    # 型号表 -> 按规范 key 索引
    model_size = {}
    conflicts = []
    for text, val in raw_models.items():
        parsed = parse_size(val)
        if parsed is None:
            continue
        key = norm(text)
        if key in model_size and size_key(model_size[key]) != size_key(parsed):
            conflicts.append((text, model_size[key], parsed))
            continue
        model_size[key] = parsed

    boxes_out = {}
    rows = []
    total_models = with_size = 0
    no_cover, no_agree = [], []

    for box in boxes_data["boxes"]:
        models = [m for m in box["models"] if m["t"] not in PLACEHOLDERS]
        total = len(models)
        singles, inners, outers = [], [], []
        for m in models:
            key = m.get("k") or norm(m["t"])
            val = model_size.get(key)
            if val is None:
                val = model_size.get(norm(m["t"]))
            if val is None:
                continue
            if isinstance(val, dict):
                if "inner" in val:
                    inners.append(val["inner"])
                if "outer" in val:
                    outers.append(val["outer"])
                # 只有外屏写法（如「xx 折叠屏前屏」）并入单屏组，用于判定这一箱是不是折叠屏
                if "inner" not in val:
                    singles.append(val["outer"])
            else:
                singles.append(val)
        total_models += total
        # 有尺寸的型号数：折叠屏一台上算一台
        have_size = 0
        for m in models:
            key = m.get("k") or norm(m["t"])
            if model_size.get(key) is not None or model_size.get(norm(m["t"])) is not None:
                have_size += 1
        with_size += have_size

        entry = {"total": total, "known": have_size}
        entry["fold"] = bool(inners and len(inners) >= len(singles))
        if total and have_size:
            coverage = have_size / total
            entry["coverage"] = round(coverage, 3)
            if entry["fold"]:
                inch, agreement, rng = cluster_repr(inners)
                entry.update({"inch": inch, "inner": inch, "range": list(rng),
                              "agreement": round(agreement, 3)})
                if outers:
                    o_inch, o_agree, o_rng = cluster_repr(outers)
                    entry.update({"outer": o_inch, "outerRange": list(o_rng),
                                  "outerAgreement": round(o_agree, 3)})
            else:
                inch, agreement, rng = cluster_repr(singles)
                entry.update({"inch": inch, "range": list(rng),
                              "agreement": round(agreement, 3)})
            agreement = min(entry["agreement"], entry.get("outerAgreement", 1))
            if coverage < COVERAGE_MIN:
                no_cover.append(box["id"])
                entry["ok"] = False
                entry["reason"] = "coverage"
            elif agreement < AGREEMENT_MIN:
                no_agree.append(box["id"])
                entry["ok"] = False
                entry["reason"] = "agreement"
            else:
                entry["ok"] = True
        else:
            entry["ok"] = False
            entry["reason"] = "no-data"
        boxes_out[box["id"]] = entry
        rows.append((box["id"], box.get("name", ""), entry))

    payload = {
        "generatedAt": datetime.date.today().isoformat(),
        "thresholds": {"coverage": COVERAGE_MIN, "agreement": AGREEMENT_MIN,
                       "tolerance": TOLERANCE},
        "stats": {
            "boxes": len(boxes_data["boxes"]),
            "boxesWithSize": sum(1 for e in boxes_out.values() if e.get("ok")),
            "modelCoverage": round(with_size / total_models, 3) if total_models else 0,
        },
        "models": {k: (round(v, 2) if isinstance(v, float) else v)
                   for k, v in sorted(model_size.items())},
        "boxes": boxes_out,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[OK] {OUT_PATH}  ({os.path.getsize(OUT_PATH) / 1024:.1f} KB)")
    st = payload["stats"]
    print(f"     箱号 {st['boxes']} 个，能算出尺寸 {st['boxesWithSize']} 个；"
          f"型号尺寸覆盖 {st['modelCoverage'] * 100:.1f}%")

    # ------------------------------------------------------------ 报告
    # 统计有多少条是 tools/lookup_sizes.py 搜索补进来的（草稿文件还在的话）
    searched = set()
    draft_path = os.path.join(os.path.dirname(REPORT_PATH), "尺寸查询草稿.json")
    if os.path.exists(draft_path):
        try:
            for it in load_json(draft_path).get("items", []):
                if it.get("inch"):
                    for n in it.get("names", []):
                        if n in raw_models:
                            searched.add(n)
        except Exception:
            pass

    lines = ["# 屏幕尺寸覆盖报告", "",
             f"生成时间：{payload['generatedAt']}",
             f"数据来源：`docs/data/model-sizes.json`（型号 → 英寸）", "",
             "## 总览", "",
             f"- 箱号总数：**{st['boxes']}**",
             f"- 能算出代表尺寸的箱号：**{st['boxesWithSize']}**"
             f"（覆盖率 ≥ {COVERAGE_MIN:.0%} 且尺寸一致率 ≥ {AGREEMENT_MIN:.0%}）",
             f"- 箱内型号的尺寸覆盖率：**{st['modelCoverage'] * 100:.1f}%**",
             f"- 尺寸表共 {len(raw_models)} 条：{len(searched)} 条由 `tools/lookup_sizes.py` "
             f"搜索得到，其余按机型系列规则生成",
             "- ⚠️ 两种来源都**没有逐条人工核对**，数值仅供参考，建议照下面的清单抽查", ""]

    if conflicts:
        lines += ["## 同一个型号被写成了不同尺寸（请核对）", ""]
        for text, a, b in conflicts:
            fmt = lambda v: ("内%s/外%s" % (v.get("inner", "—"), v.get("outer", "—"))
                             if isinstance(v, dict) else str(v))
            lines.append(f"- `{text}`：已有 {fmt(a)}，表里又写了 {fmt(b)}")
        lines.append("")

    if no_agree:
        lines += ["## 尺寸不一致、暂时不给结论的箱号", "",
                  "> 同一箱里有多个尺寸占比都不高，多半是箱内型号数据本身有问题，建议人工核对。", ""]
        for bid in no_agree:
            e = boxes_out[bid]
            lines.append(f"- **{bid}**：有尺寸 {e['known']}/{e['total']}，"
                         f"最大尺寸组只占 {e['agreement']:.0%}")
        lines.append("")

    folds = [(bid, e) for bid, e in boxes_out.items() if e.get("inner") and e.get("outer")]
    if folds:
        lines += ["## 折叠屏箱号（内屏 / 外屏）", "",
                  "> 折叠屏一块机器两块屏，箱号标签会同时标出内屏和外屏；"
                  "搜索时命中哪块屏，结果里会标「内屏匹配」或「外屏匹配」。", ""]
        for bid, e in folds:
            lines.append(f"- **{bid}**：内屏 {e['inner']}″ / 外屏 {e['outer']}″"
                         f"（{'可信' if e.get('ok') else '数据不足'}，"
                         f"型号 {e['known']}/{e['total']}）")
        lines.append("")

    if no_cover:
        lines += ["## 尺寸数据不足（覆盖率 < 60%）的箱号", "",
                  "> 这些箱子的型号大多还没有尺寸数据，补完 `model-sizes.json` 就会有结论。", ""]
        for bid in no_cover:
            e = boxes_out[bid]
            lines.append(f"- **{bid}**：有尺寸 {e['known']}/{e['total']}"
                         f"（{e['known'] / e['total']:.0%}）")
        lines.append("")

    # 待补型号清单（按箱号分组）
    missing_by_box = []
    for box in boxes_data["boxes"]:
        miss = []
        for m in box["models"]:
            if m["t"] in PLACEHOLDERS:
                continue
            key = m.get("k") or norm(m["t"])
            if model_size.get(key) is None and model_size.get(norm(m["t"])) is None:
                miss.append(m["t"])
        if miss:
            missing_by_box.append((box["id"], box.get("name", ""), miss))

    lines += ["## 还没有尺寸数据的型号（按箱号分组）", "",
              f"共 {sum(len(x[2]) for x in missing_by_box)} 条，补进 "
              "`docs/data/model-sizes.json` 的 `models` 里即可（键写型号原文，值写英寸，如 `\"红米15\": 6.9`）。", ""]
    for bid, name, miss in missing_by_box:
        lines.append(f"- **{bid}**（{name}）：" + "、".join(miss))
    lines.append("")

    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[OK] {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
