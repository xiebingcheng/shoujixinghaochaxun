# -*- coding: utf-8 -*-
"""把《核实后的修复报告》与 6 个原始表格逐条比对，输出可执行的修正清单。

用法：python tools/reconcile_fixes.py [报告路径]
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as bd  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_REPORT = r"C:\Users\admin\Desktop\核实后的修复报告.txt"
PREFIX_ORDER = bd.PREFIX_ORDER


def strip_md(line):
    s = line.strip()
    s = re.sub(r"^[-*\s]+", "", s)
    s = s.replace("**", "")
    return s.strip()


def split_items(text):
    text = text.strip().rstrip("。")
    parts = re.split(r"[、；;]", text)
    return [p.strip() for p in parts if p.strip()]


def parse_report(path):
    """返回 {箱号: {"add": [...], "del": [...], "asis": bool}}"""
    boxes = {}
    current = None
    for raw in open(path, encoding="utf-8"):
        line = strip_md(raw)
        if not line:
            continue
        if line.startswith(("核对后的", "L开头的", "S开头的", "Y开头的")) or \
                re.match(r"^[SLY]开头", line):
            current = None
            continue
        # 箱号后必须是非字母数字字符（避免把 "Y72INDIA、…" 这种型号当成箱号）
        m = re.match(r"^([SLY])(\d{1,3})(?![0-9A-Za-z])", line)
        if m:
            current = (m.group(1) + m.group(2)).upper()
            boxes.setdefault(current, {"add": [], "del": [], "asis": False, "raw": []})
            boxes[current]["raw"].append(line)
            # 同行可能直接跟内容，例如 "S33 有：..."，这里不再拆
            continue
        if current is None:
            continue
        boxes[current]["raw"].append(line)
        if "保持原样" in line:
            boxes[current]["asis"] = True
            continue
        if "箱号没有这个机型" in line:
            boxes[current]["del"] += split_items(line.split("：", 1)[-1])
            continue
        if line.startswith(("有：", "有:")):
            boxes[current]["add"] += split_items(line.split("：", 1)[-1])
            continue
        if line.startswith(("没有：", "没有:", "无：", "无:")):
            body = re.split(r"：|:", line, 1)[-1]
            body = re.split(r"这个机型是", body)[0]
            boxes[current]["del"] += split_items(body)
            continue
        # 没有任何前缀的裸清单（前四个箱号是这种写法）→ 视为“应有”
        boxes[current]["add"] += split_items(line)
    return boxes


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_REPORT
    report = parse_report(path)
    parsed = {(p, pre): bd.parse(p, pre) for (p, pre) in bd.FILES}

    def side_rows(box_id):
        prefix = box_id[0]
        out = {"d": {}, "q": {}}
        for person in ("d", "q"):
            box = parsed[(person, prefix)].get(box_id)
            if box:
                for m in box["models"]:
                    out[person][bd.norm(m)] = m
        return out

    def find(rows, item):
        """精确匹配规范键；找不到时返回近似候选（仅用于提示，不作为命中）"""
        key = bd.norm(item)
        if key in rows:
            return rows[key], None
        cands = [v for k, v in rows.items() if key and (key in k or k in key) and abs(len(k) - len(key)) <= 6]
        return None, cands[:3]

    print("报告共提到 %d 个箱号\n" % len(report))
    plan = {}
    problems = []
    unmentioned_all = []
    for box_id in sorted(report, key=lambda b: (PREFIX_ORDER[b[0]], int(b[1:]))):
        info = report[box_id]
        rows = side_rows(box_id)
        d_keys, q_keys = set(rows["d"]), set(rows["q"])
        common = d_keys & q_keys
        only_d = d_keys - q_keys
        only_q = q_keys - d_keys
        print("=" * 78)
        print(f"{box_id}  两份一致 {len(common)} 条 / 仅d {len(only_d)} 条 / 仅q {len(only_q)} 条")
        if info["asis"]:
            print("  报告：保持原样，不修改")
            plan[box_id] = {"add": [], "del": [], "asis": True}
            continue

        add_plan, del_plan = [], []
        for item in info["add"]:
            key = bd.norm(item)
            where = ["d"] if key in d_keys else []
            if key in q_keys:
                where.append("q")
            tag = "两条都有" if len(where) == 2 else ("仅 " + where[0] if where else "两边都没有")
            print(f"  应有  {item:<34} 现状: {tag}")
            add_plan.append(item)
            if not where:
                near = (find(rows["d"], item)[1] or []) + (find(rows["q"], item)[1] or [])
                problems.append(f"{box_id} 要保留的「{item}」两份表格里都没有完全相同的一条"
                                + ("，近似的写法：" + "、".join(near) if near else ""))
        for item in info["del"]:
            key = bd.norm(item)
            got = []
            if key in d_keys:
                got.append("d:" + rows["d"][key])
            if key in q_keys:
                got.append("q:" + rows["q"][key])
            print(f"  删除  {item:<34} 命中: {' | '.join(got) if got else '两边都没找到'}")
            del_plan.append(item)
            if not got:
                near = (find(rows["d"], item)[1] or []) + (find(rows["q"], item)[1] or [])
                problems.append(f"{box_id} 要删除的「{item}」没有一模一样的行"
                                + ("，近似的写法：" + "、".join(near) if near else ""))
        plan[box_id] = {"add": add_plan, "del": del_plan, "asis": False}

        # 报告没提到的争议条目
        mentioned = {bd.norm(x) for x in info["add"] + info["del"]}
        left = [rows["d"][k] for k in only_d if k not in mentioned] + \
               ["(q) " + rows["q"][k] for k in only_q if k not in mentioned]
        if left:
            print("  报告没提到的争议条目: " + "、".join(left))
            unmentioned_all.append((box_id, left))

    print("\n" + "=" * 78)
    print(f"需要你确认的地方共 {len(problems)} 条：")
    for p in problems:
        print("  - " + p)
    print(f"\n报告没提到的争议条目共 {sum(len(x[1]) for x in unmentioned_all)} 条：")
    for box_id, items in unmentioned_all:
        print(f"  {box_id}: " + "、".join(items))

    # 报告没覆盖、但两份表格仍有差异的箱号
    print("\n" + "=" * 78)
    print("报告里没有提到、但两份表格仍有型号差异的箱号：")
    missing = []
    for prefix in PREFIX_ORDER:
        for person_boxes in (parsed[("d", prefix)], parsed[("q", prefix)]):
            for box_id in person_boxes:
                if box_id in report:
                    continue
                if box_id in [m[0] for m in missing]:
                    continue
                dbox = parsed[("d", prefix)].get(box_id)
                qbox = parsed[("q", prefix)].get(box_id)
                if not dbox or not qbox:
                    missing.append((box_id, "只有一份表格有这个箱号"))
                    print(f"  {box_id}: 只有一份表格有这个箱号")
                    continue
                dset = {bd.norm(m) for m in dbox["models"]}
                qset = {bd.norm(m) for m in qbox["models"]}
                only_d = [m for m in dbox["models"] if bd.norm(m) not in qset]
                only_q = [m for m in qbox["models"] if bd.norm(m) not in dset]
                if only_d or only_q:
                    missing.append((box_id, "有差异"))
                    print(f"  {box_id}: 仅d {only_d} / 仅q {only_q}")
    if not missing:
        print("  （没有遗漏）")


if __name__ == "__main__":
    main()
