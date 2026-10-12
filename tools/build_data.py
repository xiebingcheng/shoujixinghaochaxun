# -*- coding: utf-8 -*-
"""把 资料/ 下 6 个 xlsx（d* 与 q* 两人各 3 份）合并成网站用的 JSON，
并输出两份数据的一致 / 冲突核对报告。

用法：python tools/build_data.py
"""
import csv
import io
import json
import os
import re
import sys
import unicodedata

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "资料")
OUT_DIR = os.path.join(ROOT, "docs", "data")
REPORT_DIR = os.path.join(ROOT, "reports")

FILES = {
    ("d", "S"): "d-s开头手机型号.xlsx",
    ("q", "S"): "q-s 箱号型号对照表.xlsx",
    ("d", "L"): "d-L开头手机型号.xlsx",
    ("q", "L"): "q-L箱号分类手机型号统计表-一箱号一行.xlsx",
    ("d", "Y"): "d-Y开头手机型号.xlsx",
    ("q", "Y"): "q-Y箱号适配型号汇总表(每箱一行).xlsx",
}

PREFIX_ORDER = {"S": 0, "L": 1, "Y": 2}
CORRECTIONS_PATH = os.path.join(DATA_DIR, "核实修正表.json")

# ---------------------------------------------------------------- 文本规范化
BRAND_ALIASES = [
    ("华为", "huawei"),
    ("荣耀", "honor"),
    ("小米", "xiaomi"),
    ("红米", "redmi"),
    ("苹果", "iphone"),
    ("真我", "realme"),
    ("一加", "oneplus"),
    ("三星", "samsung"),
    ("魅族", "meizu"),
    ("魔术", "magic"),
    ("魔法", "magic"),
    ("魔幻", "magic"),
    ("保时捷版", "rs"),
    ("保时捷设计", "rs"),
    ("至臻版", "ultimate"),
    ("至尊版", "ultimate"),
    ("至臻", "ultimate"),
    ("至尊", "ultimate"),
    ("尊享版", "ultimate"),
    ("青春版", "youth"),
    ("活力版", "youth"),
    ("国内版", "cn"),
    ("超声波解锁", ""),
    ("厚胶", ""),
]

SEP_RE = re.compile(r"[\s,，、;；/／|｜\\\-—_~～:：\.。'’\"“”\(\)（）\[\]【】\{｝\}]+")


def norm(text):
    """查询 / 匹配统一使用的规范形式。"""
    s = unicodedata.normalize("NFKC", str(text))
    s = s.lower().replace("＋", "+").replace("﹢", "+")
    for src, dst in BRAND_ALIASES:
        s = s.replace(src, dst)
    s = SEP_RE.sub("", s)
    s = s.replace("+", "plus")
    return s


# 去掉品牌前缀后的“核心型号”，让用户输入 X60Pro 也能命中 vivo X60Pro
BRAND_PREFIXES = [
    "huawei", "honor", "xiaomi", "redmi", "vivo", "oppo", "oneplus", "realme",
    "iphone", "apple", "samsung", "galaxy", "iqoo", "meizu", "tdtech",
    "金利", "优畅享", "麦芒", "联想", "中兴", "努比亚", "摩托罗拉", "诺基亚",
    "海信", "飞利浦", "索尼", "夏普", "黑鲨", "红魔", "魅蓝", "锤子", "美图",
    "中国移动", "移动", "联通", "电信", "酷派", "天语", "小辣椒", "朵唯",
    "letv", "leeco", "hTC", "zte", "nubia", "lenovo", "motorola", "nokia",
    "philips", "sharp", "sony", "blackshark", "smartisan", "gionee", "doov",
    "hisense", "tcl", "meitu", "vertu", "8848", "docomo", "softbank",
]


def core(text):
    """去掉品牌词，得到型号核心。"""
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


# ---------------------------------------------------------------- 读取 xlsx
def rows_of(fname):
    path = os.path.join(DATA_DIR, fname)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    return rows


def cell(v):
    return "" if v is None else str(v).strip()


SKIP = {"", "-", "—", "–", "/", "无", "暂无", "暂无(图片中未展示)"}

# 人工录入时的残留（截图里的界面文字、时间等），不参与匹配
JUNK_RE = re.compile(r"^(首页|教程|公告|保存海报|分享|搜索|返回|购物车|我的|首页 教程 公告 我)$|"
                     r"^\d{1,2}:\d{2}$|^[A-Za-z]?Hi$|^Hi$")
JUNK_WORDS = ("首页 教程 公告", "保存海报", "17:5", "18:0")


def is_junk(text):
    t = text.strip()
    if JUNK_RE.match(t):
        return True
    return any(w in t for w in JUNK_WORDS)


def split_models(text):
    if text is None:
        return []
    parts = re.split(r"[,，、;；]+", str(text))
    out = []
    for p in parts:
        p = p.strip().strip("。.")
        if p and p not in SKIP and not is_junk(p):
            out.append(p)
    return out


def parse(person, prefix):
    """返回 {箱号: {'name': str, 'models': [str]}}"""
    rows = rows_of(FILES[(person, prefix)])
    boxes = {}
    id_re = re.compile(r"^[SLY]\d{1,3}$", re.I)
    for row in rows[1:]:
        row = [cell(c) for c in row]
        if not any(row):
            continue
        if prefix == "Y" and person == "d":
            # 整行是 CSV 文本：箱号,商品名称,"型号、型号…"
            raw = next((c for c in row if c), "")
            parsed = next(csv.reader(io.StringIO(raw)))
            parsed = [c.strip() for c in parsed]
            if len(parsed) < 3 or not id_re.match(parsed[0]):
                continue
            bid, name, models = parsed[0], parsed[1], parsed[2]
        elif prefix == "L" and person == "d":
            bid, name, models = row[0], "", row[1] if len(row) > 1 else ""
        else:
            # 其余表列数不一：自动定位“箱号”所在列，其后一列是名称，最后一列是型号
            idx = next((i for i, c in enumerate(row) if id_re.match(c)), None)
            if idx is None:
                continue
            bid = row[idx]
            name = row[idx + 1] if idx + 1 < len(row) - 1 else ""
            models = row[-1] if len(row) > idx + 1 else ""
        bid = bid.upper()
        if not id_re.match(bid):
            continue
        boxes.setdefault(bid, {"name": "", "models": []})
        if name and not boxes[bid]["name"]:
            boxes[bid]["name"] = name
        boxes[bid]["models"].extend(split_models(models))
    # 去重（保留原始写法顺序）
    for bid, box in boxes.items():
        seen, uniq = set(), []
        for m in box["models"]:
            k = norm(m)
            if k and k not in seen:
                seen.add(k)
                uniq.append(m)
        box["models"] = uniq
    return boxes


def main():
    parsed = {(p, pre): parse(p, pre) for (p, pre) in FILES}

    boxes = {}
    for prefix in PREFIX_ORDER:
        for person in ("d", "q"):
            for bid, box in parsed[(person, prefix)].items():
                entry = boxes.setdefault(bid, {
                    "id": bid, "prefix": prefix, "name": "", "models": {},
                })
                if box["name"] and not entry["name"]:
                    entry["name"] = box["name"]
                for m in box["models"]:
                    key = norm(m)
                    item = entry["models"].setdefault(key, {
                        "key": key, "core": core(m), "raws": {"d": [], "q": []},
                    })
                    if m not in item["raws"][person]:
                        item["raws"][person].append(m)

    out_boxes = []
    for bid in sorted(boxes, key=lambda b: (PREFIX_ORDER[boxes[b]["prefix"]], int(re.sub(r"\D", "", b) or 0))):
        b = boxes[bid]
        models = []
        for m in sorted(b["models"].values(),
                        key=lambda x: (0 if (x["raws"]["d"] and x["raws"]["q"]) else 1, x["key"])):
            d_raw, q_raw = m["raws"]["d"], m["raws"]["q"]
            both = [t for t in d_raw if t in q_raw]
            primary = (both or d_raw or q_raw)[0]
            seen = {primary.lower()}
            alts = []
            for t in d_raw + q_raw:
                low = t.lower()
                if low in seen or t.lower() == primary.lower():
                    continue
                seen.add(low)
                alts.append(t)
            item = {"t": primary, "k": m["key"], "c": m["core"],
                    "v": "both" if (d_raw and q_raw) else ("d" if d_raw else "q")}
            if alts:
                item["alt"] = alts[:2]
            models.append(item)
        out_boxes.append({
            "id": bid, "prefix": b["prefix"], "name": b["name"], "models": models,
        })

    # ------------------------------------------------------- 应用人工核实结论
    corrections = {}
    if os.path.exists(CORRECTIONS_PATH):
        with open(CORRECTIONS_PATH, encoding="utf-8") as f:
            corrections = json.load(f)
    logs = []
    by_id = {b["id"]: b for b in out_boxes}
    for bid, rule in corrections.get("boxes", {}).items():
        box = by_id.get(bid)
        if box is None:
            logs.append(f"{bid}: 数据里没有这个箱号（已跳过）")
            continue
        if rule.get("asis"):
            continue
        models = box["models"]
        n_del = n_add = n_fix = 0
        for text in rule.get("remove", []):
            key = norm(text)
            hit = [m for m in models if m["k"] == key]
            if not hit:
                logs.append(f"{bid}: 要删除的「{text}」在数据里没找到")
                continue
            for m in hit:
                models.remove(m)
                n_del += 1
        for text in rule.get("keep", []):
            key = norm(text)
            hit = [m for m in models if m["k"] == key]
            if hit:
                for m in hit:
                    if m["t"] != text:
                        n_fix += 1
                    m["t"] = text
                    m["v"] = "fixed"
                    m.pop("alt", None)
            else:
                models.append({"t": text, "k": key, "c": core(text), "v": "fixed"})
                n_add += 1
        models.sort(key=lambda x: (0 if x["v"] in ("both", "fixed") else 1, x["k"]))
        if n_del or n_add or n_fix:
            logs.append(f"{bid}: 删除 {n_del} 条 / 新增 {n_add} 条 / 纠正写法 {n_fix} 条")

    # 没有任何型号记录的箱号（如 S83/S90，两份表格里都写着"暂无(图片中未展示)"）不上线
    empty = [b["id"] for b in out_boxes if not b["models"]]
    if empty:
        out_boxes = [b for b in out_boxes if b["models"]]
        logs.append("隐藏空箱号：" + "、".join(empty))

    os.makedirs(OUT_DIR, exist_ok=True)
    payload = {
        "generatedAt": __import__("datetime").date.today().isoformat(),
        "counts": {
            "boxes": len(out_boxes),
            "models": sum(len(b["models"]) for b in out_boxes),
            "confirmed": sum(1 for b in out_boxes for m in b["models"] if m["v"] == "both"),
            "fixed": sum(1 for b in out_boxes for m in b["models"] if m["v"] == "fixed"),
        },
        "boxes": out_boxes,
    }
    out_path = os.path.join(OUT_DIR, "boxes.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(out_path)
    print(f"[OK] {out_path}  ({size/1024:.1f} KB)")
    print(f"     箱号 {payload['counts']['boxes']} 个，型号条目 {payload['counts']['models']} 条，"
          f"两人确认 {payload['counts']['confirmed']} 条，按核实报告修正 {payload['counts']['fixed']} 条")
    if logs:
        print("[核实修正表] 应用结果：")
        for line in logs:
            print("   - " + line)

    # ------------------------------------------------------------ 核对报告
    lines = ["# 数据核对报告（d 版 vs q 版）", "",
             f"生成时间：{payload['generatedAt']}", "",
             "> 本报告只对比两份原始表格的差异，不含人工核实结论。",
             "> 已核实的修正在 资料/核实修正表.json，由 build_data.py 应用"
             f"（本次应用 {payload['counts']['fixed']} 条）。",
             "> 还没核实的条目见 reports/数据修正待确认.md。", ""]
    all_ids = []
    for prefix in PREFIX_ORDER:
        ids = sorted(set(parsed[("d", prefix)]) | set(parsed[("q", prefix)]),
                     key=lambda b: int(re.sub(r"\D", "", b) or 0))
        all_ids.extend(ids)
        lines.append(f"## {prefix} 开头（{len(ids)} 个箱号）")
        lines.append("")
        for bid in ids:
            dbox = parsed[("d", prefix)].get(bid)
            qbox = parsed[("q", prefix)].get(bid)
            if dbox is None or qbox is None:
                who = "d 版" if qbox is None else "q 版"
                lines.append(f"- **{bid}**：只有{who}有记录，另一方缺此箱号")
                continue
            dset = {norm(m): m for m in dbox["models"]}
            qset = {norm(m): m for m in qbox["models"]}
            only_d = [dset[k] for k in dset if k not in qset]
            only_q = [qset[k] for k in qset if k not in dset]
            both_names = bool(dbox["name"]) and bool(qbox["name"])
            if not only_d and not only_q and (not both_names or dbox["name"] == qbox["name"]):
                continue
            lines.append(f"- **{bid}**（{qbox['name'] or dbox['name']}）"
                         f"共 {len(dset)} / {len(qset)} 条")
            if both_names and dbox["name"] != qbox["name"]:
                lines.append(f"    - 名称不一致：d=「{dbox['name']}」 q=「{qbox['name']}」")
            if only_d:
                lines.append(f"    - 仅 d 版有（{len(only_d)}）：" + "、".join(only_d))
            if only_q:
                lines.append(f"    - 仅 q 版有（{len(only_q)}）：" + "、".join(only_q))
        lines.append("")
    os.makedirs(REPORT_DIR, exist_ok=True)
    rep = os.path.join(REPORT_DIR, "数据核对报告.md")
    with open(rep, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[OK] {rep}")


if __name__ == "__main__":
    main()
