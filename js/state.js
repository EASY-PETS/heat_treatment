/**
 * state.js - Central Application State (V2.7)
 *
 * V2.7 Updates:
 *   - Task 1: 多炉膛原点居中 — 新增 furnaceGroups Map 管理所有炉膛 Group
 *   - Task 2: 爆炸图模式 + 施工清单状态
 *   - Task 3: 性能优化状态标记
 *
 * V2.3 Updates:
 *   - 每个炉膛独立 basketType 参数
 *   - 标尺系统修复
 *
 * V2.2: Added basket type state, 3D visibility settings
 */

// ==================== THREE.JS OBJECTS ====================
/** @type {THREE.Scene} */
export let scene = null;
/** @type {THREE.PerspectiveCamera} */
export let camera = null;
/** @type {THREE.WebGLRenderer} */
export let renderer = null;
/** @type {OrbitControls} */
export let controls = null;

/** @type {THREE.Scene} */
export let masterScene = null;
/** @type {THREE.PerspectiveCamera} */
export let masterCamera = null;
/** @type {THREE.WebGLRenderer} */
export let masterRenderer = null;
/** @type {OrbitControls} */
export let masterControls = null;

/** Group containing all rendered furnace items */
export let itemsGroup = null;

// ==================== TASK 1: 多炉膛原点居中 — Furnace Group 管理 ====================
/**
 * Map<number, THREE.Group> — 炉膛索引 → 炉膛根Group
 * 所有炉膛 Group 均在原点 (0,0,0) 创建，通过 visible 切换显示
 */
export let furnaceGroups = new Map();

/** 主场景方向光引用 — 用于动画期间临时关闭阴影 */
export let mainDirectionalLight = null;

// ==================== TASK 2: 爆炸图 + 施工清单状态 ====================
/** 🔧 PDF截图进行中标志 — 截图期间暂停动画循环渲染，防止覆盖截图 framebuffer */
export let screenshotInProgress = false;

/** 爆炸图模式开关 */
export let explodedView = false;
/** 爆炸图模式：null=关闭 | 'vertical'=纵向展开 | 'horizontal'=横向展开 */
export let explodeMode = null;
/** 当前聚焦层：null=显示全部，数字=仅显示该编号的 layerGroup */
export let focusedLayer = null;
/** 爆炸间距常数 (mm) */
export const EXPLODE_GAP = 300;
/** 爆炸图动画过渡时长 (ms) */
export const EXPLODE_ANIM_DURATION = 600;

// ==================== FURNACE/MATERIAL RESULT STATE ====================
/** Array of completed furnace instances with packedItems */
export let globalFurnacesResult = null;

/**
 * Shelf mesh management - stores all dynamically generated shelf Mesh objects.
 * Used for unified disposal when clearing scenes / switching furnaces.
 * @type {Array<THREE.Mesh>}
 */
export let shelfMeshes = [];

/** Items that could not be packed into any furnace */
export let globalUnpackedItems = [];

/** Global spacing value in mm */
export let globalSpacingValue = 5;

// ==================== ANIMATION STATE ====================
export let isAnimating = false;
export let animPaused = false;
export let animStopped = false;

// ==================== SELECTION / NAVIGATION STATE ====================
export let currentFurnaceIndex = 0;
/**
 * @deprecated 递增计数器仅用于DOM元素ID生成。后续Phase将替换为 equipmentCode/crmOrderId 等业务主键。
 */
export let furnaceCounter = 0;
/** @deprecated 递增计数器仅用于DOM元素ID生成。 */
export let materialCounter = 0;
export let selectedFurnaceCardId = null;
export let selectedMaterialCardId = null;
export let fdpCollapsed = false;
export let mdpCollapsed = false;

// 多选筛选状态
// 材质内部是 OR：Cr12 或 H13
// 工艺内部是 OR：真空淬火 或 氮化
// 材质和工艺之间是 AND
export let currentMaterialFilters = new Set();
export let currentProcessFilters = new Set();

export function toggleMaterialFilter(value) {
    if (currentMaterialFilters.has(value)) {
        currentMaterialFilters.delete(value);
    } else {
        currentMaterialFilters.add(value);
    }
}

export function toggleProcessFilter(value) {
    if (currentProcessFilters.has(value)) {
        currentProcessFilters.delete(value);
    } else {
        currentProcessFilters.add(value);
    }
}

export function clearMaterialFilters() {
    currentMaterialFilters.clear();
}

export function clearProcessFilters() {
    currentProcessFilters.clear();
}

/** Furnace card sort state */
export let sortState = { field: null, dir: 'asc' };

// ==================== IMPORT STATE ====================
export let importPreviewData = [];
export let jiParsedData = null;

// ==================== PLACEMENT RULES ====================
/**
 * Active placement rule configuration.
 * Controls which packing algorithm is used and with what parameters.
 */
export let placementRules = {
    /** 🔧 V2.6: 以下字段固化为 true，仅保留用于兼容旧代码引用 */
    gravity: true,
    dense: true,
    balance: true,
    centerOfGravity: true,
    sortStrategy: 'weight-desc',
    sameMaterial: false,
    sameProcess: false,
    strategy: 'balanced',   // 新增
    /** --- 以下为面板中的有效参数 --- */
    minSpacing: 5,
    wallSpacing: 30,
    rotate: true,
    weightMargin: 10,
    /** 搁板分层平铺算法主开关 */
    useShelfLayered: false,
    /** 搁板实体厚度 (mm) - 真实占用炉膛高度空间 */
    shelfThickness: 20,
    /** 允许旋转90°寻找最佳摆放姿态（最小面积面朝下） */
    allowPostureOptimization: true,
    /** V4.5: 圆盘侧放阈值 — height/diameter < discFlipRatio 时翻转平放（值越大越容易翻，默认1.0保持当前行为） */
    discFlipRatio: 1.0
};

/** 装炉计算结果中的聚集率统计 */
export let aggregationStats = {
    materialRate: null,   // 材质聚集率 (0-100)
    processRate: null     // 工艺聚集率 (0-100)
};

// ==================== TOOLING TYPE EXTENSION (V4.8 → V5.0 P0) ====================
/**
 * 工装类型注册表 — 每种工装类型的完整元数据
 *
 * 字段说明:
 *   - toolingType:      唯一标识符
 *   - label:            中文显示名
 *   - maxLayers:        最大堆叠层数
 *   - allowedProcesses: 允许的工艺列表（空数组 = 全部允许）
 *   - placementMode:    摆放模式 — 'free' | 'fixed' | 'vertical' | 'radial' | 'discrete_nodes'
 *   - basketType:       映射到 3D 建模类型（grid|honeycomb|tray|ringnode|hanger|radial）
 *   - params:           工装专属参数
 *
 *   --- V5.0 P0: PRD §3.1 五大工装物理约束字段 ---
 *   - hasShelf:           是否支持搁板（高围边 + 定距导轨）
 *   - canStackInside:     是否允许工件直接肉身相叠
 *   - exposurePriority:   暴露面积优先级 — 'high' | 'medium' | 'low'
 *   - orientation:        工件朝向约束 — 'free' | 'vertical_only'
 *   - isNestable:         是否可作为虚拟工件嵌套入标准料框搁板
 *   - coordinateSystem:   坐标系类型 — 'cartesian' | 'polar'
 *   - centerVoidRadius:   中心主轴避障禁区半径（仅 polar 坐标系有效），null 表示无限制
 */
export const furnaceTooling = {
    'standard-basket': {
        toolingType: 'standard-basket',
        label: '标准料框',
        maxLayers: 5,
        allowedProcesses: [],
        placementMode: 'free',
        basketType: 'grid',
        // V5.0 P0: PRD 物理约束字段
        hasShelf: true,
        canStackInside: false,
        exposurePriority: 'medium',
        orientation: 'free',
        isNestable: false,
        coordinateSystem: 'cartesian',
        centerVoidRadius: null,
        params: { gridSize: 100, shelfThickness: 20 }
    },
    'mesh-basket': {
        toolingType: 'mesh-basket',
        label: '网篮',
        maxLayers: 3,
        allowedProcesses: ['渗碳', '碳氮共渗'],
        placementMode: 'free',
        basketType: 'honeycomb',
        // V5.0 P0: 集装网篮 — 密集网格，无搁板槽，轴类强制竖置，允许作为虚拟工件嵌套
        hasShelf: false,
        canStackInside: false,
        exposurePriority: 'high',
        orientation: 'vertical_only',
        isNestable: true,
        coordinateSystem: 'cartesian',
        centerVoidRadius: null,
        params: { gridSize: 80 }
    },
    'special-jig': {
        toolingType: 'special-jig',
        label: '专用夹具',
        maxLayers: 2,
        allowedProcesses: [],
        placementMode: 'discrete_nodes',
        basketType: 'tray',
        // V5.0 P0: 专用夹具/挂具 — 内部带定制挂钩或垂直销轴，工件放置点为离散三维定点捕捉
        hasShelf: false,
        canStackInside: false,
        exposurePriority: 'medium',
        orientation: 'free',
        isNestable: false,
        coordinateSystem: 'cartesian',
        centerVoidRadius: null,
        params: { slotWidth: 60, slotSpacing: 20 }
    },
    'material-tray': {
        toolingType: 'material-tray',
        label: '料盘',
        maxLayers: 10,
        allowedProcesses: ['氮化'],
        placementMode: 'free',
        basketType: 'tray',
        // V5.0 P0: 料盘 — 无围边，带叉车脚，严禁叠放压伤，最大化暴露面积，严格重心居中
        hasShelf: false,
        canStackInside: false,
        exposurePriority: 'high',
        orientation: 'free',
        isNestable: false,
        coordinateSystem: 'cartesian',
        centerVoidRadius: null,
        params: { shelfThickness: 15 }
    },
    'hanger': {
        toolingType: 'hanger',
        label: '挂具',
        maxLayers: 1,
        allowedProcesses: ['淬火', '回火'],
        placementMode: 'discrete_nodes',
        basketType: 'hanger',
        // V5.0 P0: 挂具 — 顶部横梁 + 垂直挂钩，用于防变形细长轴，离散定点捕捉
        hasShelf: false,
        canStackInside: false,
        exposurePriority: 'high',
        orientation: 'vertical_only',
        isNestable: false,
        coordinateSystem: 'cartesian',
        centerVoidRadius: null,
        params: { hookSpacing: 80, maxHangWeight: 200 }
    },
    'ring-tooling': {
        toolingType: 'ring-tooling',
        label: '环形工装',
        maxLayers: 3,
        allowedProcesses: ['渗碳'],
        placementMode: 'radial',
        basketType: 'ringnode',
        // V5.0 P0: 环形工装 — 井式/回转炉专用，极坐标排布，中心主轴为绝对避障禁区
        hasShelf: true,
        canStackInside: false,
        exposurePriority: 'medium',
        orientation: 'free',
        isNestable: false,
        coordinateSystem: 'polar',
        centerVoidRadius: 200,
        params: { innerRadius: 200, outerRadius: 400, angleStep: 30 }
    }
};

/**
 * 用户自定义工装模板列表
 * @type {Array<Object>}
 */
export let toolingTemplates = [];

/** 默认工装类型（新建炉膛时使用） */
export let defaultToolingType = 'standard-basket';

// ==================== V5.0 P0: 综合效益预测结果 ====================
/**
 * 装炉方案的预测数据 — 每个已完成炉膛对应一项
 * @type {Array<{ furnaceId: string, powerConsumption: { estimatedKwh, efficiencyTier }, gasConsumption: { nitrogenNm3 }, qualityRisk: { score, deformationRisk } }> | null}
 */
export let globalPredictions = null;
export function setGlobalPredictions(v) { globalPredictions = v; }

/** V3.0: 分组规则信息 — 用于方案统计面板展示 */
export let groupingInfo = {
    rulesText: [],        // 启用的规则文本列表 ['✓ 同工艺优先', '✓ 同材质优先']
    summaryText: [],      // 分组结果文本列表 ['渗碳（3种物料）', '氮化（2种物料）']
    totalGroups: 0        // 分组总数
};

// ==================== COLOR GENERATOR STATE ====================
/** Set of colors already assigned to materials, to avoid duplicates */
export const usedColors = new Set();

/**
 * 清空已使用颜色集合 — 用于重置所有物料数据时调用
 */
export function clearUsedColors() { usedColors.clear(); }

// ==================== BASKET TYPE STATE (V2.2) ====================
/**
 * 料框类型配置 — 支持普通网格、蜂窝料框、托盘式搁板、节点料框四种
 *
 * V2.3: 新增 'tray'（托盘式搁板）— 无四周围栏，底部搁板 + 10个支撑梁
 *       适用于齿轮、模具、法兰、圆环件、大尺寸工件
 *
 * 扩展点：未来可添加更多料框类型
 */
export const BASKET_TYPES = ['grid', 'honeycomb', 'tray', 'ringnode'];

/**
 * 默认料框类型（新建炉膛时使用）
 * V2.3: 改为仅作为新建炉膛的默认值，每个炉膛独立存储自己的 basketType
 */
export let currentBasketType = 'grid';   // 'grid' | 'honeycomb' | 'tray' | 'ringnode'

// ==================== 3D DISPLAY SETTINGS (V2.2) ====================
/**
 * 3D场景显示选项 — 控制标尺、网格、坐标轴的独立显示
 * 在主场景和装料大师场景中共享此设置
 */
export let displaySettings = {
    showGrid: true,       // 显示地面网格
    showAxes: true,       // 显示坐标轴
    showRulers: true      // 显示尺寸刻度
};

// ==================== MASTER PLANS ====================
/**
 * @deprecated Demo 演示数据。PRD 中无此功能定义，后续 Phase 4 由 MES/ERP 真实历史数据替换。
 * Historical furnace loading plans for "装料大师" view
 */
export const masterPlans = [
    {
        id: 1, title: '台车炉标准装载方案', tag: 'best', tagLabel: '最优方案',
        furnaceType: '台车炉 1200×800×600mm', date: '2024-03-15',
        operator: '张工', approver: '李总', utilization: '87.3%', totalWeight: '18500kg', itemCount: 42,
        description: '适用于大型箱体类工件的标准装载方案。采用重件置底、轻件叠放的原则，最大化空间利用率。经过多次实践验证，装炉效率提升35%。',
        furnaceW: 1200, furnaceH: 800, furnaceD: 600,
        items: [
            { name: '大型箱体A', shape: 'cuboid', w: 300, h: 200, d: 250, color: '#e74c3c', x: 0, y: 0, z: 0 },
            { name: '大型箱体B', shape: 'cuboid', w: 280, h: 180, d: 230, color: '#3498db', x: 310, y: 0, z: 0 },
            { name: '中型板件C', shape: 'cuboid', w: 200, h: 50, d: 300, color: '#2ecc71', x: 0, y: 210, z: 0 },
            { name: '圆柱轴D', shape: 'cylinder', w: 80, h: 200, d: 80, color: '#f39c12', x: 600, y: 0, z: 0 },
            { name: '圆柱轴E', shape: 'cylinder', w: 80, h: 200, d: 80, color: '#9b59b6', x: 700, y: 0, z: 0 },
        ]
    },
    {
        id: 2, title: '井式炉齿轮轴批量方案', tag: 'classic', tagLabel: '经典方案',
        furnaceType: '井式炉 ⌀800×1200mm', date: '2024-01-20',
        operator: '李工', approver: '王总', utilization: '91.2%', totalWeight: '8200kg', itemCount: 28,
        description: '专为齿轮轴类圆柱工件设计的竖向排列方案。利用井式炉的纵向空间，将轴类工件竖直悬挂，确保均匀加热，淬火变形量减少60%。',
        furnaceW: 800, furnaceH: 1200, furnaceD: 800,
        items: [
            { name: '齿轮轴1', shape: 'cylinder', w: 60, h: 300, d: 60, color: '#1abc9c', x: 0, y: 0, z: 0 },
            { name: '齿轮轴2', shape: 'cylinder', w: 60, h: 300, d: 60, color: '#e67e22', x: 80, y: 0, z: 0 },
            { name: '齿轮轴3', shape: 'cylinder', w: 60, h: 300, d: 60, color: '#e91e63', x: 160, y: 0, z: 0 },
            { name: '齿轮轴4', shape: 'cylinder', w: 60, h: 300, d: 60, color: '#00bcd4', x: 240, y: 0, z: 0 },
            { name: '齿轮轴5', shape: 'cylinder', w: 60, h: 300, d: 60, color: '#8bc34a', x: 320, y: 0, z: 0 },
        ]
    },
    {
        id: 3, title: '混合工件高效装炉方案', tag: 'special', tagLabel: '特殊工艺',
        furnaceType: '台车炉 1500×1000×800mm', date: '2024-05-08',
        operator: '王工', approver: '陈总', utilization: '79.6%', totalWeight: '22000kg', itemCount: 65,
        description: '针对多种形态工件混合装炉的优化方案。通过精确计算各工件的空间占用，实现不同形态工件的高效组合，适用于小批量多品种的生产模式。',
        furnaceW: 1500, furnaceH: 1000, furnaceD: 800,
        items: [
            { name: '重型模具A', shape: 'cuboid', w: 400, h: 300, d: 350, color: '#ff5722', x: 0, y: 0, z: 0 },
            { name: '中型板件B', shape: 'cuboid', w: 250, h: 80, d: 300, color: '#607d8b', x: 0, y: 310, z: 0 },
            { name: '轴承套C', shape: 'cylinder', w: 120, h: 80, d: 120, color: '#673ab7', x: 420, y: 0, z: 0 },
            { name: '轴承套D', shape: 'cylinder', w: 120, h: 80, d: 120, color: '#009688', x: 420, y: 100, z: 0 },
            { name: '精密箱体E', shape: 'cuboid', w: 150, h: 120, d: 180, color: '#ff9800', x: 560, y: 0, z: 0 },
        ]
    },
    {
        id: 4, title: '薄板类工件叠放方案', tag: 'classic', tagLabel: '经典方案',
        furnaceType: '台车炉 1200×800×600mm', date: '2023-11-12',
        operator: '陈工', approver: '张总', utilization: '93.5%', totalWeight: '15600kg', itemCount: 120,
        description: '专为薄板类工件设计的多层叠放方案。使用专用隔热垫片分层，确保每层工件均匀受热。该方案已在多个项目中验证，变形量控制在0.1mm以内。',
        furnaceW: 1200, furnaceH: 800, furnaceD: 600,
        items: [
            { name: '薄板层1', shape: 'cuboid', w: 500, h: 20, d: 400, color: '#795548', x: 0, y: 0, z: 0 },
            { name: '薄板层2', shape: 'cuboid', w: 500, h: 20, d: 400, color: '#f44336', x: 0, y: 30, z: 0 },
            { name: '薄板层3', shape: 'cuboid', w: 500, h: 20, d: 400, color: '#2196f3', x: 0, y: 60, z: 0 },
            { name: '薄板层4', shape: 'cuboid', w: 500, h: 20, d: 400, color: '#4caf50', x: 0, y: 90, z: 0 },
            { name: '薄板层5', shape: 'cuboid', w: 500, h: 20, d: 400, color: '#ffeb3b', x: 0, y: 120, z: 0 },
        ]
    }
];

// ==================== STATE SETTER FUNCTIONS ====================
// These allow other modules to update state without directly assigning

export function setScene(v) { scene = v; }
export function setCamera(v) { camera = v; }
export function setRenderer(v) { renderer = v; }
export function setControls(v) { controls = v; }
export function setMasterScene(v) { masterScene = v; }
export function setMasterCamera(v) { masterCamera = v; }
export function setMasterRenderer(v) { masterRenderer = v; }
export function setMasterControls(v) { masterControls = v; }
export function setItemsGroup(v) { itemsGroup = v; }
export function setGlobalFurnacesResult(v) { globalFurnacesResult = v; }
export function setShelfMeshes(v) { shelfMeshes = v; }
export function setGlobalUnpackedItems(v) { globalUnpackedItems = v; }
export function setGlobalSpacingValue(v) { globalSpacingValue = v; }
export function setIsAnimating(v) { isAnimating = v; }
export function setAnimPaused(v) { animPaused = v; }
export function setAnimStopped(v) { animStopped = v; }
export function setCurrentFurnaceIndex(v) { currentFurnaceIndex = v; }
export function setFurnaceCounter(v) { furnaceCounter = v; }
export function setMaterialCounter(v) { materialCounter = v; }
export function setSelectedFurnaceCardId(v) { selectedFurnaceCardId = v; }
export function setSelectedMaterialCardId(v) { selectedMaterialCardId = v; }
export function setFdpCollapsed(v) { fdpCollapsed = v; }
export function setMdpCollapsed(v) { mdpCollapsed = v; }
export function setSortState(v) { sortState = v; }
export function setImportPreviewData(v) { importPreviewData = v; }
export function setJiParsedData(v) { jiParsedData = v; }
export function setPlacementRules(v) {
    placementRules = { ...placementRules, ...v };
}
export function setAggregationStats(v) { aggregationStats = v; }
export function setGroupingInfo(v) { groupingInfo = v; }
export function setCurrentBasketType(v) { currentBasketType = v; }
export function setToolingTemplates(v) { toolingTemplates = v; }
export function setDefaultToolingType(v) { defaultToolingType = v; }
export function setDisplaySettings(v) { displaySettings = v; }
export function setExplodedView(v) { explodedView = v; }
export function setExplodeMode(v) { explodeMode = v; }
export function setFocusedLayer(v) { focusedLayer = v; }
export function setScreenshotInProgress(v) { screenshotInProgress = v; }
export function setMainDirectionalLight(v) { mainDirectionalLight = v; }
export function clearFurnaceGroups() { furnaceGroups.clear(); }
export function setFurnaceGroup(index, group) { furnaceGroups.set(index, group); }