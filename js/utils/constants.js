// ==================== 常量定义 ====================

// 默认安全间距（毫米）
export const DEFAULT_SPACING = 5;

// 预设基础固定尺寸炉膛
export const PRESET_FURNACES = [
    {
        name: "标准台车炉 (小型)",
        depth: 900,
        width: 600,
        height: 600,
        maxWeight: 30000,
        count: 1
    },
    {
        name: "标准台车炉 (大型)",
        depth: 1200,
        width: 900,
        height: 900,
        maxWeight: 50000,
        count: 1
    }
];

// 默认炉膛配置（预设600x600x900 和 900x900x1200）
export const DEFAULT_FURNACES = PRESET_FURNACES;

// 默认工件配置
export const DEFAULT_ITEMS = [
    {
        name: "齿轮轴批次",
        shape: "cylinder",
        count: 18,
        dim1: 60,
        dim2: 0,
        dim3: 140,
        weight: 4500,
        color: "#2ecc71"
    },
    {
        name: "精密箱体批次",
        shape: "cuboid",
        count: 15,
        dim1: 70,
        dim2: 60,
        dim3: 50,
        weight: 6000,
        color: "#ff4d4d"
    },
    {
        name: "重型工模具夹具",
        shape: "cuboid",
        count: 5,
        dim1: 120,
        dim2: 110,
        dim3: 100,
        weight: 8000,
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
export const FURNACE_BORDER_COLOR = 0xe67e22;

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