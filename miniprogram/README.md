# 手机型号查箱号 · 微信小程序版

功能和网页版一致：输入手机型号或箱号 → 查出所在箱子、可替代箱号、箱内机型，
带输入联想、S/L/Y 筛选、展开箱内机型、复制箱号。

## 为什么数据不在 GitHub Pages 上拉

小程序的网络请求域名必须是 **HTTPS + 已 ICP 备案**，还要在微信后台
「开发 → 开发管理 → 服务器域名」里配进白名单。GitHub Pages 的 `github.io`
不满足备案要求，**配不进去**，所以小程序不能像网页那样去 `fetch("data/boxes.json")`。

这份数据是纯静态的、只有约 165 KB，所以直接打进代码包：

- 不联网也能用（地铁里、仓库里没信号照样查）；
- 没有请求失败、没有域名/备案问题；
- 大小远低于主包 2MB 上限。

## 目录结构

```
miniprogram/
  app.js / app.json / app.wxss   小程序全局配置与样式
  project.config.json            开发者工具项目配置（appid 要改成你自己的）
  sitemap.json
  pages/index/index.*            唯一页面：搜索 + 联想 + 浏览
  utils/search.js                搜索逻辑，从 docs/assets/search.js 复制而来，勿手改
  data/boxes.js                  箱号数据，自动生成，勿手改
  data/substitutes.js            可替代箱号关系，自动生成，勿手改
```

## 第一次跑起来

1. 装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)；
2. 「导入项目」→ 目录选本仓库的 **`miniprogram`** 文件夹；
3. AppID 填你自己的小程序 AppID。还没有就先点「测试号」，
   或者直接用默认的 `touristappid` 以游客模式在模拟器里看效果（游客模式不能真机预览）；
4. 模拟器里就能搜索了。点「预览」用手机扫二维码可以真机试。

## 数据怎么更新

数据来源仍是仓库根目录的 `docs/data/*.json`（网页版用的那份），改完数据后回到仓库根目录跑：

```powershell
python tools/build_data.py     # 从 Excel 重新生成 docs/data/*.json（改过表格才需要）
node tools/build_mp_data.js    # 把 JSON 同步进小程序，并同步搜索逻辑
node tools/check_mp.js         # 跑一遍小程序版的自测
```

`build_mp_data.js` 会把 `docs/assets/search.js` 原样复制成 `utils/search.js`，
所以网页版和小程序版的搜索规则**永远只有一份实现**，不会各改各的改岔。

## 上传发布

1. 到 [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册小程序、拿到 AppID；
2. 开发者工具里点「上传」，填版本号和备注；
3. 后台「版本管理」里把刚上传的版本**提交审核**，填好服务类目；
4. 审核通过后点「发布」，用户就能搜到、也能扫码用了。

> 注意：服务类目要在后台按你实际主体选。个人主体可选类目有限，
> 如果「工具 / 信息查询」这类类目不可选，需要有对应资质的**企业主体**小程序。
> 这一步和代码无关，但会挡住发布，建议先在小程序后台确认类目再动手。
> 只想给自己、同事用的话，不发布也可以：把版本设为「体验版」，加体验成员即可。

## 自测覆盖了什么

`node tools/check_mp.js` 会验证：箱号数量、型号搜索（含空格/大小写/品牌别名）、
无结果空状态、命中高亮、展开显示箱内其余型号、可替代箱号分组与链接、
输入联想、浏览分组与前缀筛选。结果全绿才算通过。
