
---

# 工业热处理预装炉智能体产品需求文档 (PRD v2.0)

> Industrial Furnace Loading Agent - Product Requirements Document (Digital Twin Edition)

## 引言

本文档旨在详细阐述工业热处理预装炉智能体的产品需求、核心功能、工业规则、技术架构以及未来发展规划。本项目旨在超越传统的“3D几何拼接工具”，打造一个面向热处理车间的**工业排产大脑（APS）与数字孪生（Digital Twin）中枢**。系统通过智能化、3D 可视化的方式，解决传统装炉效率低下、经验依赖性强的问题，最终实现空间利用率最高、热处理质量最稳、能耗成本最低的绿色制造闭环。

---

## 一、 核心域模型与实体关系 (Domain Entities)

为确保系统不仅能独立运行，未来更能与工厂底层工业互联网（MES/SCADA/CRM）无缝对接，系统基础数据结构严格遵循以下实体层级（Domain Hierarchy）：

### 1. CRM (客户订单与工艺层)

* `crmOrderId`: 合同单号。
* `customerName`: 客户名称，用于同客户物料的优先归堆排产。
* `workOrderId`: 生产批次号 (MES 驱动)。
* `processCode`: 工艺路线代码（如：渗碳、真空高淬高回）。**绝对约束：不同 `processCode` 的工件严禁混装入同一炉。**

### 2. Workshop & Equipment (车间与物理设备层)

* `equipmentCode`: 对接 SCADA 的物理资产主键（如：1号真空油淬炉）。
* `currentStatus`: 设备实时状态（`IDLE`, `HEATING`, `COOLING`, `MAINTENANCE`）。
* `maxTemperature`: 设备极限温度（℃），用于过滤超高温工艺订单。
* `maxLoadCapacity`: 额定最大安全载重（kg）。**绝对约束：$\sum M_{parts} + \sum M_{tooling} \le maxLoadCapacity$**。

### 3. Chamber (炉膛 / 有效加热区)

* 定义：特指设备内部经过 SAT/TUS 测温认证的**有效加热区 (Effective Heating Zone, EHZ)**。
* **绝对约束：所有装载实体（含安全热运动间隙）在 $X, Y, Z$ 三个维度上绝对不可突破 EHZ 几何边界。**

### 4. Tooling (工装载具层)

* 统称所有承载物料进炉的金属结构件。详见「工业规则」分类。

---

## 二、 核心功能模块

### 1. 装炉管理与 3D 异构空间排布引擎

* **多源数据导入：** 支持手动创建、Excel/CSV 批量导入、JSON 方案导入。
* **智能化装炉算法矩阵：**
* **异构空间填充 (Heterogeneous):** 贪心空位分割放置，适用于简单场景。
* **搁板分层平铺 (Shelf-Layered):** 自底向上分层平铺，支持搁板动态高度分配。
* **重心居中嵌套 (Center-of-Gravity):** 针对高精密热处理，控制 $X, Z$ 轴的质心偏移率。


* **装炉策略开关：** * 重心稳定 + 贴边对称 (`balanced`)
* 空间利用率优先 (`spaceUtil`)
* 热场均衡装载 (`thermalBalance`)
* 表面均匀性优先 (`surfaceUniform`)



### 2. 综合效益预测引擎 (Analytical Prediction Engine)

在生成装炉方案的瞬间（无需耗时的物理仿真），基于统计学与物理公式输出预估效益：

* **⚡ 电力消耗预估：** 基于设备基础热损耗 + 升温有效热吸收（核心因子：$T_{target}$, $\sum M_{total}$, $t_{hold}$）。
* **💨 气体能耗预估：** 基于炉膛空置率。**物理逻辑：炉膛净空体积 $V_{void} = V_{chamber} - V_{packed}$ 越小，所需回填的冷却/保护气体越少**。
* **🛡️ 质量安全评分：** 基于算法检测热辐射遮挡率、垂直叠放压伤风险、循环气流阻力等给出 0-100 评分。

### 3. SpaceX 航天级 3D 视觉与交互 (UI/UX)

* **悬浮座舱布局：** 3D 渲染画布 (`#canvas-area`) 绝对定位铺满底层，HUD 面板（左侧配置/右侧清单）采用半透明暗色磨砂玻璃质感悬浮于场景之上。
* **视觉资产规范：** 采用纯白底色配合钛灰（#64748B）线框，能量流光采用猛禽发动机点火色（真空紫 #7000FF 至 电光青蓝 #00F0FF 渐变）。所有 UI 图标统一为 1.5px 极简工程图纸风。
* **高级视图：** 俯视/正视/侧视正交切换、爆炸图模式（横纵展开）、热场与重心标记。

### 4. PDF 工业工艺卡导出

* **六页式标准化输出：** 包含方案总览、多视图图纸、分层步骤图、AI 综合效益预测报告。
* **工程化元素：** 自动生成工件图例 (Legend)、尺寸标尺、签字区、工程图框。

---

## 三、 工业规则与算法刚性约束

### 1. 5 大基础工装定义与物理规则 (Tooling Constraints)

系统摒弃互联网名词，严格遵守工业界工装物理特征建立算法约束边界：

| 工装分类 | 工业特征 | 算法刚性约束 (Meta Rules) |
| --- | --- | --- |
| **料盘 / 托盘 (Tray)** | 无围边，带叉车脚，用于大型重型件（模具/大轴） | `hasShelf: false`, `canStackInside: false` (严禁叠放压伤), `exposurePriority: high` (最大化暴露面积), 必须严格重心居中。 |
| **集装网篮 (Grid Basket)** | 密集网格，无搁板槽，用于批量小件（齿轮/紧固件） | `hasShelf: false`, `orientation: vertical_only` (轴类强制竖置), `isNestables: true` (允许作为虚拟工件嵌套入标准料框的搁板上)。 |
| **标准料框 (Standard Basket)** | 高围边，带定距导轨，中型件模块化多层装载 | `hasShelf: true` (最大5层)。**动态层高分配：** 算法根据本层最高工件 $h_{max}$ 自动寻找最近导轨插入搁板。禁止工件直接肉身相叠。 |
| **环形工装 (Ring Tooling)** | 井式/回转炉专用，中心吊轴+多层圆网盘 | `coordinateSystem: 'polar'` (极坐标排布), `centerVoidRadius: R` (中心主轴为绝对避障禁区), `hasLayers: true`。 |
| **专用夹具/挂具 (Fixture)** | 内部带定制挂钩或垂直销轴，用于防变形细长轴 | `placementMode: discrete_nodes` (工件放置点从连续三维空间变为离散的三维定点捕捉)。 |

### 2. 安全与放置规则

* **安全间距：** 工件间 $\ge 5\text{mm}$，距炉壁 $\ge 30\text{mm}$（支持按炉膛独立覆盖配置）。
* **承重报警：** 实时监控 $\sum M \le maxLoadCapacity$，超载时强制阻断动画并警示。
* **姿态翻转：** 支持系统在排布时尝试 X/Z 轴的 $90^\circ$ 旋转，圆柱体根据 `discFlipRatio` 判定是否作为圆盘侧放。

---

## 四、 核心数据模型 (JSON 结构化约定)

### 1. Furnace / Tooling 配置结构

```javascript
{
    id: "furnace-001",
    equipmentCode: "EQ-VAC-01",  // 预留对接 SCADA 资产主键
    name: "1号真空油淬炉",
    width: 900, height: 1200, depth: 900, // 仅限有效加热区 EHZ 尺寸
    maxWeight: 1500,
    toolingType: "standard-basket",       // 强关联五大工装逻辑
    maxLayers: 5,
    placementMode: "free",
    allowedProcesses: ["渗碳", "调质"],     // 准入规则
    params: {
        // 针对特殊工装的结构参数（如环形内径、夹具挂钩间距）
        innerDia: 200,
        slotCount: 8
    }
}

```

### 2. PackingResult (装炉计算结果)附带预测数据

```javascript
{
    furnaceId: "furnace-001",
    utilization: 0.82,
    totalWeight: 1420,
    packedItems: [ ... ],
    // 效益预测引擎节点
    predictions: {
        powerConsumption: { estimatedKwh: 1250, efficiencyTier: "A" },
        gasConsumption: { nitrogenNm3: 38 },
        qualityRisk: { score: 94, deformationRisk: "LOW" }
    }
}

```

---

## 五、 项目结构与技术栈

* **3D 渲染与视角：** `Three.js` + `OrbitControls`
* **PDF 与工程图导出：** `jsPDF` + `svg2pdf` (搭配智能排版算法)
* **数据流转与算法：** ES Modules (`furnace-engine.js`, `PackingRuleEngine.js`, `strategies.js`)
* **模块解耦：** `state.js` 统一接管全局状态，UI 与 3D 渲染彻底分离。

---

## 六、 开发阶段规划

### Phase 1 ✅ 基础物理重构与可视化

* 完成 3D 渲染解耦、多视口切换。
* 基础 PDF 导出框架。
* 完成装炉动画。

### Phase 2 ✅ 算法升级与工业标准注入

* 引入搁板动态分配算法。
* 完成重心居中算法、同工艺/同材质自动分组隔离。
* 完成工程制图 PDF 生成。
* 爆炸图模式与分层 BOM 清单。

### Phase 3 🔄 智能化与架构升级（当前阶段）

* **UI/UX 彻底重构：** 落地 SpaceX 航天级悬浮座舱设计与纯粹线框图标系统。
* **工装模型库扩展：** `basket-model.js` 引入 5 大工装动态参数化工厂渲染。
* **综合效益预测引擎：** 实现能耗、气耗与质量风险的自动评估。

### Phase 4 📋 工业互联网深度融合

* 提供 RESTful API，对接工厂 MES/ERP 系统。
* 导入 DXF/DWG，根据真实工件轮廓进行像素级精确碰撞检测。
* 实装 AI Agent，根据车间设备的实时运行状态 (`currentStatus`) 自动完成排产调度。

---
