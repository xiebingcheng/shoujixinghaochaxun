# 手机型号查箱号

输入手机型号（或箱号），查出它所在的箱子。箱号分 **S / L / Y** 三种开头，
同一个型号如果在多个箱子里都有，会一次全部列出来。

纯静态网站，可直接部署到 GitHub Pages，数据存成 JSON 文件。

## 目录结构

```
docs/                      ← 网站本体（GitHub Pages 发布这个目录）
  index.html
  assets/style.css         ← 样式
  assets/app.js            ← 页面交互
  assets/search.js         ← 搜索逻辑（规范化 + 匹配打分）
  assets/favicon.svg
  data/boxes.json          ← 由脚本从 6 个表格生成的查询数据
  manifest.webmanifest     ← 可“添加到主屏幕”
  sw.js                    ← 离线缓存（首次打开后无网也能查）
资料/                       ← 原始表格（两人各 3 份，共 6 份）
tools/build_data.py        ← 把表格生成 JSON + 数据核对报告
tools/check_search.js      ← 搜索逻辑自测
tools/inspect_data.py      ← 查看表格结构
reports/数据核对报告.md      ← d 版 / q 版 两份数据的差异清单
```

## 本地预览

直接双击 `docs/index.html` 不行（浏览器不允许读取本地 JSON），要先起一个本地服务：

```powershell
python -m http.server 8123 --directory docs
```

然后浏览器打开 <http://127.0.0.1:8123/>。

## 修改数据

1. 直接编辑 `资料/` 里的 Excel（保持列结构不变）；
2. 运行：

```powershell
python tools/build_data.py
```

这一步会同时做两件事：

- 重新生成 `docs/data/boxes.json`（网站查询用）；
- 重新生成 `reports/数据核对报告.md`（两人数据的差异清单）。

## 两个人做的数据怎么对比

6 个表格是两个人各做 3 份（`d-*` 与 `q-*`），脚本会逐箱比对：

- 两边都有的型号 → 标记 **两人已核对**；
- 只有一边有的型号 → 标记 **待核对**，并写进 `reports/数据核对报告.md`。

报告里会列出每个箱号"仅 d 版有 / 仅 q 版有"的型号，照着它核对即可。
当前 131 个箱号、2554 条型号记录中，2395 条两人一致。

## 部署到 GitHub Pages

### 方式一：网页操作（不需要命令行）

1. 登录 <https://github.com>，点右上角 **+ → New repository**；
2. 仓库名随便取，比如 `phone-box-lookup`，选 **Public**，创建；
3. 进入新仓库，点 **Add file → Upload files**，把本项目的 `docs` 文件夹
   整个拖进去（拖文件夹，目录结构会自动保留）；
4. 上传后进入 **Settings → Pages**：
   - Source 选 `Deploy from a branch`
   - Branch 选 `main`，文件夹选 **`/docs`**，保存；
5. 等 1～2 分钟，访问 `https://你的用户名.github.io/phone-box-lookup/`。

> 网址里的路径要和仓库名一致。以后改数据，只要重新上传 `docs/data/boxes.json` 即可。

### 方式二：命令行

```powershell
git remote add origin https://github.com/你的用户名/phone-box-lookup.git
git push -u origin main
```

推送完成后，同样在 **Settings → Pages** 里选 `main` + `/docs`。

## 搜索是怎么匹配的

- 忽略空格、大小写、全角半角：`mate30 pro`、`Mate30Pro`、`mate30pro` 一样；
- 常用别名互通：苹果=iPhone、荣耀=honor、魔术/魔法=Magic、至臻版=至尊版 等；
- 品牌可省：输入 `X60Pro` 能查到 `vivo X60Pro`；
- 精确匹配优先，查不到精确结果时会另给"相近结果"；
- 支持直接搜箱号（`S01`、`y07`）。
