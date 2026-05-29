// ==================== Excel 导入解析模块 ====================

/**
 * 从 Excel / CSV 文件中解析工件明细数据
 * 
 * 支持的Excel列（按列名或列序号识别）：
 *   名称, 长度(L)/mm, 宽度(W)/mm, 高度(H)/mm, 直径(D)/mm, 数量, 单件重量/kg, 材质, 硬度要求, 工艺, 日期, 备注
 * 
 * 几何形态自动推断规则：
 *   - 如果同时有 直径 和 高度 → 圆柱体 (cylinder)
 *   - 如果有 长、宽、高 三个尺寸 → 立方体 (cuboid)
 *   - 如果只有 长和宽(或直径) 两个尺寸 + 高度 → 也视为圆柱体
 *   - 如果只有 长+高 两个数字（无宽度，无直径标识）→ 圆柱体，使用长度字段为直径
 * 
 * 简化规则：任何一行数据，
 *   - 如果有明确的"直径"列 → 圆柱体
 *   - 如果只有2个几何尺寸数字 → 圆柱体（直径、高度）
 *   - 如果有3个几何尺寸数字 → 立方体（长、宽、高）
 */

/**
 * 规范化表头名称（去掉空格、转小写）
 */
function normalizeHeader(h) {
    if (!h) return '';
    return String(h).trim().toLowerCase()
        .replace(/[\s（）()（）【】\[\]]/g, '')
        .replace(/\/mm/g, '')
        .replace(/mm/g, '')
        .replace(/kg/g, '');
}

/**
 * 解析 Excel 文件并返回工件数据数组
 * @param {File} file - 上传的Excel文件
 * @returns {Promise<{items: Array, headers: Array<string>, rawRows: Array}>}
 */
export async function parseExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // 取第一个工作表
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                
                // 转为JSON数组（保留表头）
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
                
                if (!jsonData || jsonData.length === 0) {
                    reject(new Error('Excel 文件中没有数据行，请检查文件内容。'));
                    return;
                }
                
                // 获取表头
                const headers = Object.keys(jsonData[0]);
                
                // 解析每一行
                const items = [];
                const errors = [];
                
                jsonData.forEach((row, rowIdx) => {
                    try {
                        const item = parseRowToItem(row, headers);
                        if (item) {
                            items.push(item);
                        }
                    } catch (err) {
                        errors.push(`第 ${rowIdx + 2} 行: ${err.message}`);
                    }
                });
                
                resolve({
                    items,
                    headers,
                    rawRows: jsonData,
                    errors,
                    sheetName
                });
                
            } catch (err) {
                reject(new Error(`Excel 解析失败: ${err.message}`));
            }
        };
        
        reader.onerror = function() {
            reject(new Error('文件读取失败，请重试。'));
        };
        
        reader.readAsArrayBuffer(file);
    });
}

/**
 * 将一行Excel数据解析为工件对象
 * @param {Object} row - 一行数据
 * @param {Array<string>} headers - 表头列表
 * @returns {Object|null} 工件对象，如无法解析则返回null
 */
function parseRowToItem(row, headers) {
    // 规范化列名映射
    const colMap = {};
    headers.forEach(h => {
        const norm = normalizeHeader(h);
        colMap[norm] = h;
    });
    
    // 辅助函数：根据多个可能的列名获取值
    function getVal(...keys) {
        for (const k of keys) {
            const nk = normalizeHeader(k);
            if (colMap[nk] !== undefined) {
                const val = row[colMap[nk]];
                if (val !== '' && val !== null && val !== undefined) {
                    return val;
                }
            }
        }
        return null;
    }
    
    // 获取名称
    const name = getVal('名称', '工件名称', '零件名称', '产品名称', '批次名称', 'name', '品名');
    if (!name) {
        // 没有名称的行视为空行，跳过
        return null;
    }
    
    // 获取几何尺寸 - 智能检测
    let shape = 'cuboid';
    let dim1 = 0, dim2 = 0, dim3 = 0;
    
    const diameter = parseFloatOrNull(getVal('直径', '直径D', '外径', 'diameter', 'φ'));
    const length = parseFloatOrNull(getVal('长度', '长度L', '长', 'length', 'l'));
    const width = parseFloatOrNull(getVal('宽度', '宽度W', '宽', 'width', 'w'));
    const height = parseFloatOrNull(getVal('高度', '高度H', '高', 'height', 'h'));
    
    // 统计非零尺寸数量
    const dims = [];
    if (diameter !== null && diameter > 0) dims.push({ key: 'diameter', val: diameter });
    if (length !== null && length > 0) dims.push({ key: 'length', val: length });
    if (width !== null && width > 0) dims.push({ key: 'width', val: width });
    if (height !== null && height > 0) dims.push({ key: 'height', val: height });
    
    if (dims.length === 0) {
        throw new Error(`缺少几何尺寸数据（至少需要2个尺寸数值）`);
    }
    
    // 判断形状
    if (diameter !== null && diameter > 0) {
        // 有直径 → 圆柱体
        // 高度从 height 或 length 获取
        const h = (height !== null && height > 0) ? height : ((length !== null && length > 0) ? length : 0);
        if (h === 0) {
            throw new Error(`圆柱体必须指定高度（请检查"高度"或"长度"列）`);
        }
        shape = 'cylinder';
        dim1 = diameter;
        dim2 = 0;  // 圆柱体宽度不需要
        dim3 = h;
    } else {
        // 无直径，检查尺寸数量判断形状
        const numDims = dims.length;
        if (numDims === 3) {
            // 3个数字 → 立方体 (长、宽、高)
            shape = 'cuboid';
            dim1 = (length !== null && length > 0) ? length : dims[0].val;
            dim2 = (width !== null && width > 0) ? width : dims[1].val;
            dim3 = (height !== null && height > 0) ? height : dims[2].val;
        } else if (numDims === 2) {
            // 2个数字 → 圆柱体 (直径、高度)
            shape = 'cylinder';
            // 取较大的为直径，较小的为高度？不，按照约定：第一个非高度为直径，高度为高度
            // 更合理的：如果有明确的高度列，用高度；否则按数值大小判断
            const hasHeight = height !== null && height > 0;
            if (hasHeight) {
                dim1 = dims.find(d => d.key !== 'height').val; // 直径
                dim3 = height; // 高度
            } else {
                // 没有高度标识，按顺序：dim1=第一个尺寸(直径), dim3=第二个尺寸(高度)
                dim1 = dims[0].val;
                dim3 = dims[1].val;
            }
            dim2 = 0;
        } else {
            throw new Error(`几何尺寸不足（需要2-3个数值，当前检测到${numDims}个有效数值）`);
        }
    }
    
    // 获取数量（默认1）
    const count = parseFloatOrNull(getVal('数量', '件数', '批次总量', 'count', 'qty', 'quantity')) || 1;
    
    // 获取重量
    const weightRaw = parseFloatOrNull(getVal('整批总重', '总重', '单件重量', '重量', 'weight'));
    let totalWeight = 0;
    if (weightRaw !== null && weightRaw > 0) {
        // 如果列名包含"整批"或"总重"，直接使用；否则乘以数量
        const isTotalWeight = ['整批总重', '总重'].some(k => {
            const nk = normalizeHeader(k);
            return colMap[nk] !== undefined && getVal(k) === row[colMap[nk]];
        });
        // 保守处理：直接使用读取到的值作为总重
        totalWeight = weightRaw;
    } else {
        // 没有重量，默认为0
        totalWeight = 0;
    }
    
    // 获取材质
    const materialType = getVal('材质', '材料', '材质工艺属性', 'material', '材料类型') || '';
    
    // 获取颜色（使用哈希分配）
    const color = getBatchColorForName(name);
    
    // 获取额外信息（用于显示，暂存）
    const hardness = getVal('硬度要求', '硬度', 'hardness') || '';
    const process = getVal('工艺', '处理工艺', '热处理工艺', 'process') || '';
    const date = getVal('日期', '交货日期', 'date', '计划日期') || '';
    const remark = getVal('备注', 'remark', 'notes') || '';
    
    return {
        name: String(name).trim(),
        shape,
        count: Math.max(1, Math.round(count)),
        dim1: Math.round(dim1),
        dim2: shape === 'cylinder' ? 0 : Math.round(dim2),
        dim3: Math.round(dim3),
        weight: Math.round(totalWeight * 100) / 100,
        color,
        materialType: String(materialType).trim(),
        hardness: String(hardness).trim(),
        process: String(process).trim(),
        date: String(date).trim(),
        remark: String(remark).trim()
    };
}

/**
 * 安全解析浮点数
 */
function parseFloatOrNull(val) {
    if (val === null || val === undefined || val === '') return null;
    const num = parseFloat(String(val).replace(/[^\d.\-]/g, ''));
    return isNaN(num) ? null : num;
}

/**
 * 根据批次名称分配颜色
 */
const BATCH_COLORS = [
    '#2ecc71', '#ff4d4d', '#4da6ff', '#f39c12', '#9b59b6',
    '#1abc9c', '#e74c3c', '#3498db', '#f1c40f', '#e67e22',
    '#2c3e50', '#16a085', '#c0392b', '#2980b9', '#8e44ad', '#d35400'
];

function getBatchColorForName(name) {
    let hash = 0;
    const s = String(name);
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i);
        hash |= 0;
    }
    return BATCH_COLORS[Math.abs(hash) % BATCH_COLORS.length];
}

/**
 * 生成 Excel 导入模板 Blob（供下载参考）
 */
export function generateExcelTemplate() {
    // 使用 XLSX 库生成模板
    const wsData = [
        ['名称', '长度(L)/mm', '宽度(W)/mm', '高度(H)/mm', '数量', '整批总重/kg', '材质', '硬度要求', '工艺', '日期'],
        ['齿轮轴A', 60, '', 140, 10, 100, '高合金模具钢', 'HRC58-62', '淬火', '2025-06-01'],
        ['精密箱体B', 70, 60, 50, 15, 300, '普通结构钢', 'HB220-260', '退火', '2025-06-02'],
        ['圆柱销C', 30, '', 80, 20, 50, '碳素钢', 'HRC30-35', '回火', '2025-06-03'],
        ['方板D', 120, 110, 25, 8, 200, '特种不锈钢', '', '固溶时效', '2025-06-04'],
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    
    // 设置列宽
    ws['!cols'] = [
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }
    ];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '工件明细');
    
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}