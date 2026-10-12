# -*- coding: utf-8 -*-
"""读取 资料/ 下的 6 个 xlsx，输出结构报告，便于确认数据模型。"""
import os
import re
import sys

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "资料")

FILES = [
    "d-s开头手机型号.xlsx",
    "q-s 箱号型号对照表.xlsx",
    "d-L开头手机型号.xlsx",
    "q-L箱号分类手机型号统计表-一箱号一行.xlsx",
    "d-Y开头手机型号.xlsx",
    "q-Y箱号适配型号汇总表(每箱一行).xlsx",
]


def rows_of(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    out = [r for r in ws.iter_rows(values_only=True)]
    wb.close()
    return ws.title, out


for name in FILES:
    path = os.path.join(DATA_DIR, name)
    title, rows = rows_of(path)
    print("=" * 100)
    print("FILE:", name, "| sheet:", title, "| rows:", len(rows))
    widths = {}
    for r in rows:
        widths[len(r)] = widths.get(len(r), 0) + 1
    print("  row-width histogram:", widths)
    print("  header:", rows[0])
    print("  first data row:", rows[1])
    print("  last data row:", rows[-1])
    # 只打印前 3 列的前 30 字符，便于看结构
    for r in rows[1:]:
        cells = [(str(c)[:40] if c is not None else None) for c in r[:3]]
        print("   ", cells)
