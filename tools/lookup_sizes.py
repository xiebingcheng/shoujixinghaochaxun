# -*- coding: utf-8 -*-
"""用 opencli 的 Google 搜索，给还没有屏幕尺寸的型号查一遍尺寸（半自动）。

为什么不是直接抓网页：
    百度/搜狗/360 对脚本访问都会反爬，Google 的 opencli 适配器走真实浏览器，
    结果里常常直接带品牌官网和 ZOL 的参数页，抽取更靠谱。

做什么：
    1. 从 docs/data/boxes.json + docs/data/model-sizes.json 找出缺尺寸的型号；
    2. 按「去掉品牌后的核心型号」去重，同一个机型只查一次；
    3. 逐个调 `opencli google search "<型号> 屏幕尺寸 英寸" -f json`；
    4. 按「出现位置 + 来源站点」给候选尺寸打分，取最高分；
    5. 写 reports/尺寸查询草稿.json 和 reports/尺寸查询草稿.md 供人工过目。

注意：
    结果是**草稿**，不会自动写进 model-sizes.json。请照草稿核对后再手工合并，
    或者用 --apply 只应用「高置信度且分数达标」的条目（低分的留空等人补）。

用法：
    python tools/lookup_sizes.py            # 查询并生成草稿
    python tools/lookup_sizes.py --refresh  # 忽略缓存，重新查一遍
    python tools/lookup_sizes.py --limit 10 # 只查前 10 个（调试用）

这里只产出**草稿**，不会自动写进 model-sizes.json：搜索结果里混着「外屏尺寸 / 上代机型 /
爆料预测」这类噪声，必须人工过一遍再合并。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs", "data")
BOXES_PATH = os.path.join(DOCS, "boxes.json")
SIZES_PATH = os.path.join(DOCS, "model-sizes.json")
REPORTS = os.path.join(ROOT, "reports")
CACHE_PATH = os.path.join(REPORTS, "_lookup_cache.json")
OUT_JSON = os.path.join(REPORTS, "尺寸查询草稿.json")
OUT_MD = os.path.join(REPORTS, "尺寸查询草稿.md")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_model_sizes import norm  # noqa: E402  （复用同一套规范化）

# 去品牌前缀得到「核心型号」，规则与 docs/assets/search.js 的 core() 一致
BRAND_PREFIXES = [
    "huawei", "honor", "xiaomi", "redmi", "vivo", "oppo", "oneplus", "realme",
    "iphone", "apple", "samsung", "galaxy", "iqoo", "meizu", "tdtech",
    "金利", "优畅享", "麦芒", "联想", "中兴", "努比亚", "摩托罗拉", "诺基亚",
    "海信", "飞利浦", "索尼", "夏普", "黑鲨", "红魔", "魅蓝", "锤子", "美图",
    "中国移动", "移动", "联通", "电信", "酷派", "天语", "小辣椒", "朵唯",
    "letv", "leeco", "htc", "zte", "nubia", "lenovo", "motorola", "nokia",
    "philips", "sharp", "sony", "blackshark", "smartisan", "gionee", "doov",
    "hisense", "tcl", "meitu", "vertu", "8848", "docomo", "softbank",
]


def core(text):
    s = norm(text)
    changed = True
    while changed:
        changed = False
        for p in BRAND_PREFIXES:
            if s.startswith(p) and len(s) > len(p) + 1:
                s = s[len(p):]
                changed = True
                break
    return s

# 品牌官网 / 权威参数站：命中这些来源的尺寸更可信
OFFICIAL = (
    "consumer.huawei.com", "huawei.com", "mi.com", "honor.com", "hihonor.com",
    "oppo.com", "vivo.com", "oneplus.com", "realme.com", "apple.com",
    "samsung.com", "iqoo.com", "meizu.com", "nubia.com", "zte.com.cn",
)
SPEC_SITES = (
    "zol.com.cn", "baike.baidu.com", "wikipedia.org", "gsmarena.com",
    "yesky.com", "pconline.com.cn", "ithome.com", "kalvo.com", "evolife.cn",
)

NUM_RE = re.compile(r"(\d\.\d{1,2})\s*(?:英寸|吋|″|\"|寸)")
SPEC_RE = re.compile(r"屏幕尺寸\s*[:：,，]?\s*(\d\.\d{1,2})")

# 品牌 -> 规范化前缀，用来判断一个型号属于哪个品牌
BRANDS = [
    ("华为", "huawei"), ("荣耀", "honor"), ("小米", "xiaomi"), ("红米", "redmi"),
    ("苹果", "iphone"), ("真我", "realme"), ("一加", "oneplus"), ("OPPO", "oppo"),
    ("vivo", "vivo"), ("iQOO", "iqoo"), ("三星", "samsung"), ("魅族", "meizu"),
    ("中兴", "zte"), ("努比亚", "nubia"), ("联想", "lenovo"), ("黑鲨", "blackshark"),
]


def brand_of(nk):
    for cn, en in BRANDS:
        if nk.startswith(en):
            return cn
    return None


def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def query_text(name):
    """把型号写法整理成适合搜索的样子。"""
    s = name.strip()
    s = s.replace("厚胶", "").replace(" 新", "").strip()
    if s.startswith("1+"):
        s = "一加" + s[2:]
    return s


def opencli_search(query, timeout=120):
    exe = shutil.which("opencli")
    if not exe:
        raise RuntimeError("找不到 opencli 命令")
    r = subprocess.run(
        [exe, "google", "search", query, "-f", "json"],
        capture_output=True, timeout=timeout,
    )
    if r.returncode != 0:
        raise RuntimeError("opencli 返回码 " + str(r.returncode))
    text = r.stdout.decode("utf-8", "replace").strip()
    if not text.startswith("["):
        raise RuntimeError("结果不是 JSON：" + text[:120])
    return json.loads(text)


def score_rows(rows, texts):
    """返回 Counter：尺寸 -> 得分，以及每个尺寸的一条证据。texts 是这台机子的各种写法。"""
    keys = set()
    for name in texts:
        keys.add(norm(name))
        keys.add(core(name))
    keys = {k for k in keys if k}
    votes = Counter()
    ev = {}
    for row in rows:
        title = str(row.get("title") or "")
        url = str(row.get("url") or "")
        snip = str(row.get("snippet") or "")
        text = title + " " + snip
        ntext = norm(text)
        ntitle = norm(title)
        # 很短的核心（如 a6）太容易蹭到别的型号，要求它出现在标题里
        if not any(k in ntext for k in keys):
            continue  # 结果里没提到这个机型，跳过（避免蹭到别的型号的尺寸）
        if all(len(k) <= 3 for k in keys) and not any(k in ntitle for k in keys):
            continue
        official = any(d in url for d in OFFICIAL)
        spec_site = any(d in url for d in SPEC_SITES)
        for m in SPEC_RE.finditer(snip):
            v = round(float(m.group(1)), 2)
            if 4 <= v <= 9.5:
                votes[v] += 8 + (6 if official else 0) + (3 if spec_site else 0)
                ev.setdefault(v, ("官网 " if official else "") + snip[:110])
        for m in NUM_RE.finditer(text):
            v = round(float(m.group(1)), 2)
            if not (4 <= v <= 9.5):
                continue
            before = text[max(0, m.start() - 16):m.start()]
            near = "屏幕" in text[max(0, m.start() - 24):m.end() + 6]
            s = 1
            if re.search(r"屏幕尺寸\s*[:：,，]?\s*$", before):
                s = 6
            elif near:
                s = 3
            if official:
                s += 5
            elif spec_site:
                s += 2
            votes[v] += s
            ev.setdefault(v, ("官网 " if official else "") + (snip or title)[:110])
    return votes, ev


def main():
    refresh = "--refresh" in sys.argv
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0

    boxes = load_json(BOXES_PATH)["boxes"]
    sizes = load_json(SIZES_PATH)["models"]

    # 每个箱子的主力品牌（箱名/箱内大多数型号的品牌），用来给不带品牌的短码加限定词
    box_brand = {}
    model_boxes = {}
    for box in boxes:
        cnt = Counter()
        for m in box["models"]:
            b = brand_of(norm(m["t"]))
            if b:
                cnt[b] += 1
            model_boxes.setdefault(m["t"], []).append(box["id"])
        if cnt and sum(cnt.values()) >= 3:
            b, n = cnt.most_common(1)[0]
            if n / sum(cnt.values()) >= 0.5:
                box_brand[box["id"]] = b

    # 以「规范化后的型号键」为准：尺寸表里只要有一个写法覆盖了这个键，就算已覆盖
    size_keys = {norm(k) for k in sizes}
    missing = {}
    for box in boxes:
        for m in box["models"]:
            k = m.get("k") or norm(m["t"])
            if k in size_keys:
                continue
            cur = missing.get(k)
            if cur is None or len(m["t"]) > len(cur):
                missing[k] = m["t"]

    # 按核心型号去重：同一台机子的不同写法只查一次
    groups = {}
    for _k, name in missing.items():
        c = core(name) or norm(name)
        groups.setdefault(c, []).append(name)

    rep_of, hint_of = {}, {}
    for c, names in groups.items():
        rep = max(names, key=len)
        rep_of[c] = rep
        if brand_of(norm(rep)) is None:      # 不带品牌前缀的短码，补一个品牌限定词
            hints = Counter()
            for nm in names:
                for bid in model_boxes.get(nm, []):
                    b = box_brand.get(bid)
                    if b:
                        hints[b] += 1
            if hints and hints.most_common(1)[0][1] >= max(1, len(names)) * 0.6:
                hint_of[c] = hints.most_common(1)[0][0]

    cache = {} if refresh else (load_json(CACHE_PATH, {}) or {})
    todo = [c for c in sorted(groups) if c not in cache]
    if limit:
        todo = todo[:limit]
    print(f"缺尺寸型号 {len(missing)} 条，去重成 {len(groups)} 个机型；本次要查 {len(todo)} 个")

    for i, c in enumerate(todo, 1):
        names = groups[c]
        rep = rep_of[c]
        hint = hint_of.get(c)
        q = ((hint + " ") if hint else "") + query_text(rep) + " 屏幕尺寸 英寸"
        try:
            rows = opencli_search(q)
            votes, ev = score_rows(rows, names + [query_text(rep)])
            top = votes.most_common(1)
            item = {
                "query": q,
                "names": names,
                "inch": top[0][0] if top else None,
                "score": top[0][1] if top else 0,
                "votes": dict(votes.most_common(4)),
                "evidence": ev.get(top[0][0], "") if top else "",
            }
            cache[c] = item
            mark = "✓" if item["inch"] else "×"
            print(f"  [{i}/{len(todo)}] {mark} {rep} -> {item['inch']} (分 {item['score']})")
        except Exception as e:
            print(f"  [{i}/{len(todo)}] ! {rep} 查询失败：{e}")
            cache[c] = {"query": q, "names": names, "inch": None, "score": 0,
                        "votes": {}, "evidence": "查询失败：" + str(e)}
        # 每查一个就落盘，中途断了也不用重头再来
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=1)
        time.sleep(0.6)

    items = [cache[c] for c in sorted(groups) if c in cache]
    got = [x for x in items if x["inch"]]
    payload = {
        "note": "由 tools/lookup_sizes.py 用 opencli google 搜索查到的草稿，未经人工核对。"
                "score 越高越可信（官网/参数页命中加分）。",
        "total": len(items), "found": len(got),
        "items": items,
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    lines = ["# 屏幕尺寸查询草稿", "",
             f"共 {len(items)} 个机型，查到 {len(got)} 个。**未经人工核对，仅供参考。**", "",
             "| 型号 | 尺寸 | 分数 | 依据（节选） |",
             "| --- | --- | --- | --- |"]
    for x in sorted(items, key=lambda v: (-(v["score"] or 0), v["names"][0])):
        lines.append("| {} | {} | {} | {} |".format(
            x["names"][0].replace("|", ""),
            x["inch"] if x["inch"] else "—",
            x["score"],
            (x["evidence"] or "").replace("|", "").replace("\n", " ")[:90],
        ))
    lines += ["", "## 没查到的", ""]
    none = [x["names"][0] for x in items if not x["inch"]]
    lines.append("、".join(none) if none else "（无）")
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[OK] {OUT_JSON}")
    print(f"[OK] {OUT_MD}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
