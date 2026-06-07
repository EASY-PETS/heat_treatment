# 工业热处理装炉系统产品需求文档 (PRD)

Industrial Furnace Loading System - Product Requirements Document

---

## 引言

本文档旨在详细阐述工业热处理装炉系统的产品需求、核心功能、用户角色、工业规则、技术架构以及未来发展规划。本系统致力于通过智能化、3D 可视化的方式，解决传统热处理装炉过程中效率低下、经验依赖性强、工艺标准化不足等痛点，最终目标是打造一个全面的工业热处理工艺平台。

---

# 一、项目目标

开发一套工业热处理装炉系统，实现：

* 多炉型装炉规划
* 3D 可视化摆放
* 自动装炉优化
* 工业 PDF 工艺卡输出
* 工件碰撞与间距检测
* 炉次管理与审核
* 客户订单与 CAD 文件导入

系统目标：

* 提高装炉效率
* 提高炉膛利用率
* 降低人工经验依赖
* 标准化工艺流程
* 支持未来 AI 优化

---

# 二、核心功能

## 1. 装炉管理

支持：

* 多炉型管理（标准料框、网篮、专用夹具、料盘、挂具、环形工装）
* 工件导入（手动创建 + Excel/CSV 批量导入 + JSON 方案导入）
* 自动装炉（多种算法可选）
* 人工调整
* 炉次分配
* 工装类型选择与参数配置

### 1.1 装炉算法

系统提供三种装炉算法：

| 算法 | 说明 | 适用场景 |
|------|------|----------|
| 异构空间填充 (Heterogeneous) | 贪心空位分割放置 | 简单场景、无搁板无重心需求 |
| 搁板分层 (Shelf-Layered) | 自底向上分层平铺 | 需要分层管理的多层摆放 |
| 重心居中嵌套 (Center-of-Gravity) | 搁板分层 + 重心居中嵌套 | 需要重心平衡的精密装炉 |

### 1.2 装炉策略

| 策略 | 键名 | 说明 |
|------|------|------|
| 重心稳定 + 贴边对称 | `balanced` | 少物料贴边对称，多物料兼顾重心 |
| 空间利用率优先 | `spaceUtil` | 塞满炉子，忽略重心，强力贴边紧凑 |
| 热场均衡装载 | `thermalBalance` | 温度均匀，避免中心聚集，控制局部密度 |
| 表面均匀性优先 | `surfaceUniform` | 最大暴露面积，避免遮挡 |

### 1.3 分组规则

* 同工艺优先：按热处理工艺类型分组，同工艺工件聚集到同一炉膛
* 同材质优先：按材料类型分组，同材质工件聚集到同一炉膛
* 两者同时开启时：工艺优先 > 材质优先（二级分组）

---

## 2. 3D 可视化

系统提供：

* 3D 炉膛显示（含多种料框类型渲染：网格 grid / 蜂窝 honeycomb / 托盘 tray / 挂具 hanger / 环形 ringnode）
* 工件实时摆放
* 缩放/旋转查看
* 工件高亮
* 炉内空间预览
* 爆炸图模式（纵向/横向展开 + 分层显示）
* 施工清单（BOM 分层视图）
* 3D 显示设置（网格/坐标轴/标尺独立开关）

技术：

* Three.js + OrbitControls

---

## 3. PDF 工艺卡

系统自动生成工业 PDF：

* 炉次总览
* 多视图图纸（俯视图、前视图、侧视图）
* 工件图例 (Legend)
* 尺寸标尺
* 页码与 REV 版本号
* 签字区
* 工程图框
* 六页式 PDF 布局

输出：

* A4/A3 PDF（jsPDF 生成）
* SVG 工程图（svg2pdf 转换）
* 尺寸标注系统
* 智能排版引擎

---

## 4. 数据导入

支持：

* CSV 订单（PapaParse）
* Excel 订单（SheetJS / XLSX）
* 热处理工件导入模板（`.xlsx`）
* JSON 装炉方案导入/导出
* STEP/STL 模具（规划中）
* DWG/DXF 炉膛 CAD（规划中）

---

# 三、用户角色

## 1. 工艺工程师

负责：

* 创建装炉方案
* 调整工件摆放
* 导出工艺卡

---

## 2. 车间操作员

负责：

* 查看工艺卡
* 按图装炉
* 提交执行状态

---

## 3. 总工/审核人员

负责：

* 审核装炉方案
* 工艺签字确认
* 管理工业规则（间距、摆放策略、分组规则等）

---

# 四、工业规则

## 1. 摆放优先级

系统默认：

* 先放重工件（重量降序）
* 先放大工件（体积降序）
* 后放小工件

目的：

* 保证稳定性
* 提高利用率

---

## 2. 摆放方式

支持：

* 平摆（长方体最小面积面朝下姿态优化）
* 水平旋转（w×d 和 d×w 两种朝向候选）
* 串放
* 插放

不同工件支持不同摆放方式。

---

## 3. 安全间距

工件之间必须保留安全间隔：

默认：

* 工件间距 ≥ 5mm（可全局配置）
* 距离炉壁 ≥ 30mm
* 每个炉膛可独立设置间距

系统必须自动检测碰撞。

---

## 4. 重量平衡

系统需要检测：

* 左右偏载
* 前后偏载
* 重心位置（仅 XZ 平面，Y 轴由重力支配）
* 四象限重量均衡

超限时自动报警。

---

## 5. 搁板分层

系统支持：

* 搁板实体厚度配置（默认 20mm，真实占用炉膛高度）
* 自底向上层层累积放置
* 环形工装内置搁板自动跳转

---

# 五、核心数据模型

## Part（工件）

```js
{
    id,                    // 唯一标识
    name,                  // 工件名称
    shape,                 // 形状：'cuboid' | 'cylinder'
    width,                 // 宽度 (mm)，圆柱为直径
    height,                // 高度 (mm)，圆柱为长度
    depth,                 // 深度 (mm)，圆柱为直径
    weight,                // 单件重量 (kg)
    count,                 // 数量
    material,              // 材质（如 20CrMnTi、45#）
    process,               // 热处理工艺（如 渗碳、氮化、淬火）
    customer,              // 客户名称
    itemCode,              // 物料编码
    showName,              // PDF 显示名称（用于净化渲染）
    color                  // 3D 渲染颜色
}
```

---

## Furnace（炉型/工装）

```js
{
    id,                    // 唯一标识
    name,                  // 炉膛/工装名称
    width,                 // 炉膛内宽 (mm)
    height,                // 炉膛内高 (mm)
    depth,                 // 炉膛内深 (mm)
    maxWeight,             // 最大承重 (kg)
    count,                 // 可用台数
    plannedHeats,          // 计划炉次数
    actualSpacing,         // 每个炉膛独立间距 (mm)，null 则使用全局值
    basketType,            // 料框类型：'grid' | 'honeycomb' | 'tray' | 'ringnode' | 'hanger'
    toolingType,           // 工装类型：'standard-basket' | 'mesh-basket' | 'special-jig' |
                           //            'material-tray' | 'hanger' | 'ring-tooling'
    maxLayers,             // 最大堆叠层数
    placementMode,         // 摆放模式：'free' | 'fixed' | 'vertical' | 'radial'
    allowedProcesses,      // 允许的热处理工艺（逗号分隔）
    params                 // 工装专属参数（如 ringCount、rodDiameter、slotWidth 等）
}
```

---

## FurnaceTooling（工装类型注册表）

```js
// 六种内置工装类型，每种定义完整的元数据：
{
    toolingType,           // 唯一标识符
    label,                 // 中文显示名
    maxLayers,             // 最大堆叠层数
    allowedProcesses,      // 允许的工艺列表（空数组 = 全部允许）
    placementMode,         // 'free' | 'fixed' | 'vertical' | 'radial'
    basketType,            // 映射到 3D 建模类型
    params                 // 工装专属参数（网格大小、杆径、槽宽等）
}
```

---

## PackingResult（装炉结果）

```js
{
    furnaceId,             // 炉膛 ID
    packedItems,           // 已装入工件列表（含 x, y, z, w, h, d, rotationInfo）
    unpackedItems,         // 未装入工件列表
    totalWeight,           // 总重量
    utilization,           // 空间利用率
    shelvesUsed,           // 使用的搁板列表 [{ y, thickness }]
    aggregationStats,      // 聚集率统计 { materialRate, processRate }
    groupingInfo           // 分组统计 { rulesText, summaryText, totalGroups }
}
```

---

# 六、项目结构

```text
project/
├── css/
│   ├── main.css                    # 主样式
│   └── pdf-template.css            # PDF 模板样式
├── js/
│   ├── app.js                      # 应用启动与模块协调
│   ├── state.js                    # 全局状态管理（炉膛/物料/动画/显示设置）
│   ├── furnace-engine.js           # 装炉算法核心（异构/搁板/重心居中/统一嵌套）
│   ├── strategies.js               # 四种装炉策略配置（balanced/spaceUtil/thermalBalance/surfaceUniform）
│   ├── PackingRuleEngine.js        # 分组规则引擎（同工艺/同材质分组）
│   ├── basket-model.js             # 料框 3D 模型创建
│   ├── item-models.js              # 工件 3D 模型创建
│   ├── geometry-utils.js           # 姿态优化工具
│   ├── three-scene.js              # Three.js 场景管理（渲染、动画、爆炸图、BOM）
│   ├── ui.js                       # UI 交互（卡片、面板、弹窗、统计）
│   ├── pdf-export.js               # PDF 导出（单炉膛）
│   ├── pdf-six-page.js             # 六页式 PDF 生成器
│   ├── screenshot-capture.js       # 3D 截图工具
│   ├── server.js                   # 本地开发服务器
│   └── modules/
│       ├── furnaceManagement.js    # 炉膛管理模块
│       ├── layoutStrategy.js       # 布局策略模块
│       ├── loadingHistory.js       # 装炉历史模块
│       ├── pdfManagement.js        # PDF 管理模块
│       ├── preview3D.js            # 3D 预览模块
│       ├── productManagement.js    # 产品管理模块
│       └── workshopManagement.js   # 车间管理模块
├── furnace.html                    # 主页面入口
├── 热处理工件导入模板.xlsx         # Excel 导入模板
├── 测试用例一.xlsx                 # 测试用例数据
├── PRD.md                          # 产品需求文档（本文件）
├── docs/
│   └── ARCHITECTURE.md             # 系统架构文档
└── package.json                    # 项目配置
```

---

# 七、推荐技术栈

| 功能   | 技术                  |
| ---- | ------------------- |
| 3D   | Three.js            |
| PDF  | jsPDF               |
| SVG  | svg2pdf             |
| 数据导入 | PapaParse / SheetJS (XLSX) |
| CAD  | DXF Parser（规划中） |
| 模块化  | ES Modules          |
| 服务器 | Node.js (Express)   |

---

# 八、开发阶段

## Phase 1 ✅ 已完成

* 项目模块化
* PDF 工艺卡（单炉膛 + 六页式）
* 多视图图纸
* Legend 图例
* 装炉动画播放

---

## Phase 2 ✅ 已完成

* SVG 工程图尺寸标注
* SVG 工程图排版引擎
* 页码与 REV
* 工程图框
* 搁板分层算法
* 重心居中算法（XZ 平面、四象限均衡）
* 分组规则引擎（同工艺/同材质聚集）
* 策略化装炉（4 种策略 x 灵活的权重配置）
* 爆炸图 + 施工清单视图

---

## Phase 3 🔄 进行中

* AI 装炉优化
* 偏载分析
* 热场分析
* 自动排炉
* DXF/DWG 炉膛 CAD 导入

---

## Phase 4 📋 规划中

* MES/ERP 对接
* 审批流程
* 工厂生产管理
* 用户权限管理

---

# 九、项目愿景（最终）

本系统的最终目标是将"工业热处理装炉可视化工具"升级为一个全面的**工业热处理工艺平台**。该平台将不仅仅局限于装炉规划，更将支持：

*   **工艺标准化与数字化：** 通过系统固化最佳实践，减少人为误差，实现工艺流程的全面数字化管理。
*   **AI 智能优化：** 借助人工智能算法，实现更高效、更科学的装炉方案，进一步提升炉膛利用率和生产效率。
*   **工厂 MES/ERP 协同：** 与工厂制造执行系统 (MES) 及企业资源规划 (ERP) 无缝对接，实现生产数据的互联互通和智能化决策。
*   **工业级工程图输出：** 提供具备尺寸标注和智能排版能力的工业工程图，满足车间生产和质量管理的高标准要求。

通过持续迭代和技术创新，本系统将成为推动工业热处理行业向智能化、数字化转型的核心动力。