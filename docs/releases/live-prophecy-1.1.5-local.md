# 直播预言 1.1.5：修复底部细微拉伸

替换 Tampermonkey 中的本地 `bilibili-live-prophecy.user.js`，保存并刷新整个直播间。图标版本应为 `v1.1.5`。

定位代码原来用 `getBoundingClientRect()` 除以会取整的 `offsetWidth/offsetHeight` 来反算缩放。当工具栏高度或面板高度包含小数时，取整误差会反馈到下一次定位，导致每 250ms 交替写入不同高度。官方 iframe 的视口和底栏随之发生细微拉伸。

本版直接读取宿主及其祖先的 CSS zoom，并用工具栏的精确 CSS 边框盒尺寸计算锚点缩放。面板自身的取整尺寸不再参与后续尺寸计算。继续保留原生悬停生命周期、默认 420×600 面板、两张卡片的紧凑布局和全部手动确认逻辑。

## 验证

- 修复前，在真实官方 H5 加模拟数据、工具栏高度 `43.39px` 的场景中，面板底部每 250ms 往返移动约 0.3–0.5px；125% CSS 缩放时还触发 iframe 视口高度在两个整数间交替变化。
- 修复后，在 100%/110%/125%/133% CSS 缩放下各连续采样 4 秒，面板、iframe、外层底栏和官方余额栏的坐标及尺寸变化均为 0，外层 DOM 重写次数为 0。
- 新增离线 Chromium 回归覆盖两种 iframe 注入模式、小数宽高及四档 CSS 缩放。在线官方 H5 测试持续采样 3 秒，同时检查面板、iframe、余额栏和视口稳定性；仍能完整显示两张卡片。
- 原有取消确认、余额不足、模拟失败反馈、当前/历史/规则导航继续验证；不发送真实参与请求。

82 项预言回归、96 项离线 Chromium 检查、6 个原生悬停/缩放/全屏场景和在线官方 H5 检查通过。全仓为 176/177，失败仍是原有 BiliForge 画质用例 `tests/regression.test.cjs:882`。JavaScript 语法和补丁空白检查通过。

```powershell
npm run test:prophecy
npm run test:prophecy:browser
```

测试使用独立 Chrome 上下文。用户已登录的 Tampermonkey 环境仍需实机核对，未进行真实扣币。卡片布局见 [1.1.4 说明](live-prophecy-1.1.4-local.md)，许可证与复用范围见 [1.1.0 说明](live-prophecy-1.1.0-local.md)。
