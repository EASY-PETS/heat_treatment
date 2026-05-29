// ==================== 常量定义 ====================

// 默认安全间距（毫米）
export const DEFAULT_SPACING = 5;

// 预设基础固定尺寸炉膛 (规则7: 小炉500kg，大炉1000kg承重上限)
export const PRESET_FURNACES = [
    {
        name: "标准台车炉 (小型)",
        depth: 900,
        width: 600,
        height: 600,
        maxWeight: 500,
        count: 1
    },
    {
        name: "标准台车炉 (大型)",
        depth: 1200,
        width: 900,
        height: 900,
        maxWeight: 1000,
        count: 1
    }
];

// 默认炉膛配置（预设600x600x900 和 900x900x1200）
export const DEFAULT_FURNACES = PRESET_FURNACES;

// 默认工件配置（规则7: 单件重适配500kg/1000kg炉膛承重上限）
export const DEFAULT_ITEMS = [
    {
        name: "齿轮轴批次",
        shape: "cylinder",
        count: 18,
        dim1: 60,
        dim2: 0,
        dim3: 140,
        weight: 180,  // 18件总重180kg，单件10kg
        color: "#2ecc71"
    },
    {
        name: "精密箱体批次",
        shape: "cuboid",
        count: 15,
        dim1: 70,
        dim2: 60,
        dim3: 50,
        weight: 300,  // 15件总重300kg，单件20kg
        color: "#ff4d4d"
    },
    {
        name: "重型工模具夹具",
        shape: "cuboid",
        count: 5,
        dim1: 120,
        dim2: 110,
        dim3: 100,
        weight: 400,  // 5件总重400kg，单件80kg
        color: "#4da6ff"
    }
];

// 3D场景配置
export const SCENE_CONFIG = {
    backgroundColor: 0x0e0e12,
    gridColor: 0x444466,
    gridCenterColor: 0x333355,
    gridSize: 4000,
    gridDivisions: 80,
    groundOffset: -120
};

// 相机配置
export const CAMERA_CONFIG = {
    fov: 45,
    near: 1,
    far: 10000
};

// 灯光配置
export const LIGHT_CONFIG = {
    ambient: {
        color: 0xffffff,
        intensity: 0.5
    },
    main: {
        color: 0xffffff,
        intensity: 0.7,
        position: { x: 400, y: 800, z: 500 }
    },
    fill: {
        color: 0xffffff,
        intensity: 0.3,
        position: { x: -400, y: -200, z: -300 }
    }
};

// 炉膛边框颜色
export const FURNACE_BORDER_COLOR = 0xffffff;

// 工件材质配置
export const MATERIAL_CONFIG = {
    transparent: true,
    opacity: 0.85,
    roughness: 0.3,
    metalness: 0.2
};

// 边缘颜色
export const EDGE_COLOR = 0x000000;

// 动画配置
export const ANIMATION_CONFIG = {
    stepDelay: 500,  // 毫秒
    spaceGap: 120    // 炉膛间距
};

// 批次颜色调色板（确保不同批次有区分度）
export const BATCH_COLORS = [
    '#2ecc71', // 绿色
    '#ff4d4d', // 红色
    '#4da6ff', // 蓝色
    '#f39c12', // 橙色
    '#9b59b6', // 紫色
    '#1abc9c', // 青色
    '#e74c3c', // 深红
    '#3498db', // 深蓝
    '#f1c40f', // 黄色
    '#e67e22', // 橙棕
    '#2c3e50', // 深灰蓝
    '#16a085', // 翠绿
    '#c0392b', // 暗红
    '#2980b9', // 宝蓝
    '#8e44ad', // 深紫
    '#d35400'  // 深橙
];

// PDF配置
export const PDF_CONFIG = {
    pageWidth: 1122,
    pageHeight: 793,
    orientation: 'landscape',
    margin: 0,
    imageQuality: 1,
    scale: 4
};

// 视图配置
export const VIEW_CONFIGS = {
    top: { title: 'X-Z 顶视图', axisX: 'X', axisY: 'Z' },
    front: { title: 'X-Y 正视图', axisX: 'X', axisY: 'Y' },
    side: { title: 'Z-Y 侧视图', axisX: 'Z', axisY: 'Y' }
};

// LocalStorage 键名
export const STORAGE_KEYS = {
    furnaces: 'heatTreatment_furnaces',
    items: 'heatTreatment_items',
    settings: 'heatTreatment_settings',
    results: 'heatTreatment_results'
};

// 形状类型
export const SHAPE_TYPES = {
    CUBOID: 'cuboid',
    CYLINDER: 'cylinder'
};

// 存储键名
export const DATA_TYPES = {
    FURNACE: 'furnace',
    PART: 'part',
    ORDER: 'order',
    RESULT: 'result'
};

// ==================== 规则1: 材质/工艺属性与防混装互斥矩阵 ====================
// 材质类型定义
export const MATERIAL_TYPES = {
    STRUCTURAL_STEEL: '普通结构钢',
    HIGH_ALLOY_TOOL_STEEL: '高合金模具钢',
    SPECIAL_STAINLESS: '特种不锈钢',
    CARBON_STEEL: '碳素钢',
    ALUMINUM_ALLOY: '铝合金'
};

// 材质选项列表（用于下拉框）
export const MATERIAL_TYPE_OPTIONS = [
    { value: '', label: '-- 选择材质/工艺属性 --' },
    { value: MATERIAL_TYPES.STRUCTURAL_STEEL, label: MATERIAL_TYPES.STRUCTURAL_STEEL },
    { value: MATERIAL_TYPES.CARBON_STEEL, label: MATERIAL_TYPES.CARBON_STEEL },
    { value: MATERIAL_TYPES.HIGH_ALLOY_TOOL_STEEL, label: MATERIAL_TYPES.HIGH_ALLOY_TOOL_STEEL },
    { value: MATERIAL_TYPES.SPECIAL_STAINLESS, label: MATERIAL_TYPES.SPECIAL_STAINLESS },
    { value: MATERIAL_TYPES.ALUMINUM_ALLOY, label: MATERIAL_TYPES.ALUMINUM_ALLOY }
];

// 防混装互斥矩阵 (真空环境蒸气压污染互串约束)
// true 表示可以共炉, false 表示禁止混装
export const CONFLICT_MATRIX = {
    [MATERIAL_TYPES.STRUCTURAL_STEEL]: {
        [MATERIAL_TYPES.CARBON_STEEL]: true,
        [MATERIAL_TYPES.HIGH_ALLOY_TOOL_STEEL]: true,
        [MATERIAL_TYPES.SPECIAL_STAINLESS]: true,
        [MATERIAL_TYPES.ALUMINUM_ALLOY]: true
    },
    [MATERIAL_TYPES.CARBON_STEEL]: {
        [MATERIAL_TYPES.STRUCTURAL_STEEL]: true,
        [MATERIAL_TYPES.HIGH_ALLOY_TOOL_STEEL]: true,
        [MATERIAL_TYPES.SPECIAL_STAINLESS]: true,
        [MATERIAL_TYPES.ALUMINUM_ALLOY]: true
    },
    [MATERIAL_TYPES.HIGH_ALLOY_TOOL_STEEL]: {
        [MATERIAL_TYPES.STRUCTURAL_STEEL]: true,
        [MATERIAL_TYPES.CARBON_STEEL]: true,
        [MATERIAL_TYPES.SPECIAL_STAINLESS]: false,  // 禁止！高合金模具钢 + 特种不锈钢 不可混装
        [MATERIAL_TYPES.ALUMINUM_ALLOY]: false       // 禁止混装
    },
    [MATERIAL_TYPES.SPECIAL_STAINLESS]: {
        [MATERIAL_TYPES.STRUCTURAL_STEEL]: true,
        [MATERIAL_TYPES.CARBON_STEEL]: true,
        [MATERIAL_TYPES.HIGH_ALLOY_TOOL_STEEL]: false, // 禁止混装
        [MATERIAL_TYPES.ALUMINUM_ALLOY]: false          // 禁止混装
    },
    [MATERIAL_TYPES.ALUMINUM_ALLOY]: {
        [MATERIAL_TYPES.STRUCTURAL_STEEL]: true,
        [MATERIAL_TYPES.CARBON_STEEL]: true,
        [MATERIAL_TYPES.HIGH_ALLOY_TOOL_STEEL]: false,
        [MATERIAL_TYPES.SPECIAL_STAINLESS]: false
    }
};

// ==================== 规则3: 多炉混合排布策略 ====================
export const ROUTING_STRATEGIES = {
    STRATEGY_A: '高精空间利用（最大化容积率）',
    STRATEGY_B: '常规普通平铺（追求气流最优化）'
};

export const ROUTING_STRATEGY_OPTIONS = [
    { value: 'STRATEGY_A', label: ROUTING_STRATEGIES.STRATEGY_A },
    { value: 'STRATEGY_B', label: ROUTING_STRATEGIES.STRATEGY_B }
];

// ==================== 规则4: 截面差异度温控均匀性约束 ====================
// 同一炉次内，最大截面积与最小截面积的比例阈值
export const CROSS_SECTION_RATIO_THRESHOLD = 5;

// ==================== 规则5: 工艺校准单确认 ====================
export const VACUUM_LEVEL_OPTIONS = [
    { value: '1e-2', label: '10⁻² Pa (粗真空)' },
    { value: '1e-3', label: '10⁻³ Pa (高真空)' },
    { value: '1e-4', label: '10⁻⁴ Pa (超高真空)' }
];

export const HEATING_PROGRAM_OPTIONS = [
    { value: 'HT-Prog-001', label: 'HT-Prog-001 (普通退火)' },
    { value: 'HT-Prog-002', label: 'HT-Prog-002 (淬火)' },
    { value: 'HT-Prog-003', label: 'HT-Prog-003 (回火)' },
    { value: 'HT-Prog-004', label: 'HT-Prog-004 (渗碳淬火)' },
    { value: 'HT-Prog-005', label: 'HT-Prog-005 (固溶时效)' },
    { value: 'HT-Prog-006', label: 'HT-Prog-006 (氮化处理)' }
];

// ==================== 规则6: 重心标识球体颜色 ====================
export const COG_SPHERE_COLOR = 0xff4444;
export const COG_SPHERE_RADIUS = 15;
