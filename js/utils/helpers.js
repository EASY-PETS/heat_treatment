// ==================== 工具函数 ====================

/**
 * 格式化数字，保留指定小数位
 */
export function formatNumber(num, decimals = 2) {
    return Number(num).toFixed(decimals);
}

/**
 * 获取当前时间戳
 */
export function getTimestamp() {
    return Date.now();
}

/**
 * 生成唯一ID
 */
export function generateId(prefix = '') {
    return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 深拷贝对象
 */
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * 计算空间利用率
 */
export function calculateUtilization(packedVolume, totalVolume) {
    if (totalVolume === 0) return 0;
    return ((packedVolume / totalVolume) * 100).toFixed(2);
}

/**
 * 计算总体积
 */
export function calculateVolume(width, height, depth) {
    return width * height * depth;
}

/**
 * 获取工件尺寸（考虑形状）
 */
export function getItemDimensions(item) {
    if (item.shape === 'cylinder') {
        return {
            width: item.dim1,
            height: item.dim3,
            depth: item.dim1
        };
    }
    return {
        width: item.dim1,
        height: item.dim3,
        depth: item.dim2
    };
}

/**
 * 获取单个工件重量
 */
export function getSingleItemWeight(item) {
    if (item.count > 0) {
        return item.weight / item.count;
    }
    return 0;
}

/**
 * 延迟函数
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 生成PDF文件名
 */
export function generatePDFFilename(prefix = '工业热处理装炉工艺报告') {
    return `${prefix}_${getTimestamp()}.pdf`;
}

/**
 * 格式化日期时间
 */
export function formatDateTime(date = new Date()) {
    return date.toLocaleString('zh-CN');
}

/**
 * 数组去重（基于某个属性）
 */
export function uniqueBy(arr, key) {
    const seen = new Set();
    return arr.filter(item => {
        const val = item[key];
        if (seen.has(val)) return false;
        seen.add(val);
        return true;
    });
}

/**
 * 按属性分组
 */
export function groupBy(arr, key) {
    return arr.reduce((acc, item) => {
        const val = item[key];
        if (!acc[val]) acc[val] = [];
        acc[val].push(item);
        return acc;
    }, {});
}

/**
 * 计算重心位置
 */
export function calculateCenterOfGravity(items) {
    if (!items || items.length === 0) {
        return { x: 0, y: 0, z: 0 };
    }
    
    let totalWeight = 0;
    let x = 0, y = 0, z = 0;
    
    items.forEach(item => {
        const weight = item.weight || 0;
        totalWeight += weight;
        x += (item.x || 0) * weight;
        y += (item.y || 0) * weight;
        z += (item.z || 0) * weight;
    });
    
    if (totalWeight === 0) {
        return { x: 0, y: 0, z: 0 };
    }
    
    return {
        x: x / totalWeight,
        y: y / totalWeight,
        z: z / totalWeight
    };
}

/**
 * 检测偏载
 */
export function checkLoadImbalance(furnace, threshold = 0.3) {
    const items = furnace.packedItems;
    if (!items || items.length === 0) {
        return { isBalanced: true, issues: [] };
    }
    
    const cog = calculateCenterOfGravity(items);
    const centerX = furnace.w / 2;
    const centerZ = furnace.d / 2;
    
    const offsetX = Math.abs(cog.x - centerX) / centerX;
    const offsetZ = Math.abs(cog.z - centerZ) / centerZ;
    
    const issues = [];
    
    if (offsetX > threshold) {
        issues.push(`左右偏载: ${(offsetX * 100).toFixed(1)}%`);
    }
    if (offsetZ > threshold) {
        issues.push(`前后偏载: ${(offsetZ * 100).toFixed(1)}%`);
    }
    
    return {
        isBalanced: issues.length === 0,
        issues,
        centerOfGravity: cog
    };
}

/**
 * 验证工件是否在炉膛范围内
 */
export function isItemInFurnace(item, furnace) {
    return (
        item.x >= 0 &&
        item.y >= 0 &&
        item.z >= 0 &&
        item.x + item.w <= furnace.w &&
        item.y + item.h <= furnace.h &&
        item.z + item.d <= furnace.d
    );
}

/**
 * 检测工件碰撞
 */
export function checkCollision(item1, item2, spacing = 0) {
    const expanded1 = {
        x: item1.x - spacing / 2,
        y: item1.y - spacing / 2,
        z: item1.z - spacing / 2,
        w: item1.w + spacing,
        h: item1.h + spacing,
        d: item1.d + spacing
    };
    
    return !(
        expanded1.x + expanded1.w <= item2.x ||
        expanded1.x >= item2.x + item2.w ||
        expanded1.y + expanded1.h <= item2.y ||
        expanded1.y >= item2.y + item2.h ||
        expanded1.z + expanded1.d <= item2.z ||
        expanded1.z >= item2.z + item2.d
    );
}

/**
 * 导出数据为JSON文件
 */
export function exportToJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 从JSON文件导入数据
 */
export function importFromJSON(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                resolve(data);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
}