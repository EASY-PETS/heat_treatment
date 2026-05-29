// ==================== 装炉排布算法模块（集成规则1-4、7） ====================

import { getSingleItemWeight, getItemDimensions } from '../utils/helpers.js';
import { CONFLICT_MATRIX, CROSS_SECTION_RATIO_THRESHOLD, ROUTING_STRATEGIES } from '../utils/constants.js';

/**
 * 规则4: 检查截面差异度温控均匀性约束
 * 同一炉次内，最大截面积与最小截面积的比例不得超过阈值
 * @param {Array} existingItems - 炉内已有工件
 * @param {Object} newItem - 待放入工件
 * @param {number} threshold - 比例阈值
 * @returns {boolean} 是否允许同炉
 */
function checkCrossSectionVariance(existingItems, newItem, threshold = CROSS_SECTION_RATIO_THRESHOLD) {
    if (existingItems.length === 0) return true;
    
    const newSectionArea = newItem.w_algo * newItem.d_algo;
    let minArea = Infinity;
    let maxArea = -Infinity;
    
    existingItems.forEach(item => {
        const area = item.w_algo * item.d_algo;
        if (area < minArea) minArea = area;
        if (area > maxArea) maxArea = area;
    });
    
    // 将新工件的截面积纳入比较
    if (newSectionArea < minArea) minArea = newSectionArea;
    if (newSectionArea > maxArea) maxArea = newSectionArea;
    
    // 防止除零
    if (minArea <= 0) return true;
    
    const ratio = maxArea / minArea;
    return ratio <= threshold;
}

/**
 * 规则1: 检查材质冲突约束
 * 根据互斥矩阵判断新工件是否可以与炉内已有工件共炉
 * @param {Array} existingItems - 炉内已有工件
 * @param {Object} newItem - 待放入工件
 * @returns {boolean} 是否允许共炉
 */
function checkMaterialConflict(existingItems, newItem) {
    if (!newItem.materialType || existingItems.length === 0) return true;
    
    for (const existing of existingItems) {
        if (!existing.materialType) continue;
        if (existing.materialType === newItem.materialType) continue;
        
        // 查互斥矩阵
        const row = CONFLICT_MATRIX[existing.materialType];
        if (row && row[newItem.materialType] === false) {
            return false; // 冲突，禁止混装
        }
        
        const reverseRow = CONFLICT_MATRIX[newItem.materialType];
        if (reverseRow && reverseRow[existing.materialType] === false) {
            return false;
        }
    }
    return true;
}

/**
 * 异构多规格炉膛空间智能排载算法
 * @param {Array} furnacePoolInput - 炉膛池输入
 * @param {Array} itemsInput - 工件输入
 * @param {number} spacing - 安全间距
 * @param {string} routingStrategy - 排布策略 'STRATEGY_A' 或 'STRATEGY_B'
 * @returns {Object} 排布结果
 */
export function solveHeterogeneousPacking(furnacePoolInput, itemsInput, spacing, routingStrategy = 'STRATEGY_A') {
    // 创建炉膛实例
    let availableFurnaceInstances = [];
    furnacePoolInput.forEach(f => {
        for (let i = 0; i < f.count; i++) {
            availableFurnaceInstances.push({
                typeName: f.name,
                instanceId: `${f.name} (炉次 #${i+1})`,
                w: f.width,
                h: f.height,
                d: f.depth,
                maxWeight: f.maxWeight,
                packedItems: [],
                totalWeight: 0,
                materialTypes: new Set(),  // 规则1: 记录炉内材质类型
                emptySpaces: [{ x: 0, y: 0, z: 0, w: f.width, h: f.height, d: f.depth }],
                isDedicated: false  // 规则2: 是否被某VIP订单独占
            });
        }
    });

    // 按体积从大到小排序炉膛
    availableFurnaceInstances.sort((a, b) => (b.w * b.h * b.d) - (a.w * a.h * a.d));

    // 展平工件为单个实例
    let flattenedItems = [];
    itemsInput.forEach(item => {
        const dims = getItemDimensions(item);
        const singleWeight = getSingleItemWeight(item);
        
        for (let i = 0; i < item.count; i++) {
            flattenedItems.push({
                id: `${item.name}_${i}`,
                name: item.name,
                shape: item.shape,
                w_algo: dims.width + spacing,
                h_algo: dims.height + spacing,
                d_algo: dims.depth + spacing,
                w: dims.width,
                h: dims.height,
                d: dims.depth,
                weight: singleWeight,
                color: item.color,
                materialType: item.materialType || '',  // 规则1
                isDedicated: !!item.isDedicated,         // 规则2
                batchName: item.name                      // 规则2: 用于包炉标识
            });
        }
    });

    // 规则2: 将包炉(VIP)工件优先分组，按重量排序
    const dedicatedItems = flattenedItems.filter(item => item.isDedicated);
    const normalItems = flattenedItems.filter(item => !item.isDedicated);

    // 按重量从大到小排序工件（先放重的），重量相同则按体积从大到小
    const sortFn = (a, b) => 
        (b.weight - a.weight) ||
        ((b.w_algo * b.h_algo * b.d_algo) - (a.w_algo * a.h_algo * a.d_algo));
    
    dedicatedItems.sort(sortFn);
    normalItems.sort(sortFn);

    // 规则2处理：包炉工件优先分配独立炉膛
    let completedFurnaces = [];
    
    // 先处理包炉工件
    for (const item of dedicatedItems) {
        let placed = false;
        for (const furnace of availableFurnaceInstances) {
            // 跳过已被占用的炉膛
            if (furnace.isDedicated && furnace.packedItems.length > 0) {
                // 检查是否属于同一批次包炉
                if (furnace.packedItems[0].batchName !== item.batchName) continue;
            }
            if (furnace.totalWeight + item.weight > furnace.maxWeight) continue;
            
            // 规则1: 材质冲突检查
            if (!checkMaterialConflict(furnace.packedItems, item)) continue;
            
            // 规则4: 截面差异度检查
            if (!checkCrossSectionVariance(furnace.packedItems, item)) continue;
            
            let spaceIdx = -1;
            for (let j = 0; j < furnace.emptySpaces.length; j++) {
                let s = furnace.emptySpaces[j];
                if (item.w_algo <= s.w && item.h_algo <= s.h && item.d_algo <= s.d) {
                    spaceIdx = j;
                    break;
                }
            }
            
            if (spaceIdx !== -1) {
                let s = furnace.emptySpaces[spaceIdx];
                item.x = s.x;
                item.y = s.y;
                item.z = s.z;
                
                furnace.isDedicated = true;  // 规则2: 标记为独占炉膛
                furnace.packedItems.push({...item});
                furnace.totalWeight += item.weight;
                if (item.materialType) furnace.materialTypes.add(item.materialType);
                
                // 更新剩余空间（规则3策略A：三维切割回填）
                updateEmptySpaces(furnace, s, item, routingStrategy);
                placed = true;
                break;
            }
        }
        
        if (!placed) {
            // 包炉工件无法装入，找空炉膛
            for (const furnace of availableFurnaceInstances) {
                if (furnace.packedItems.length > 0 || furnace.isDedicated) continue;
                if (furnace.totalWeight + item.weight > furnace.maxWeight) continue;
                
                let s = furnace.emptySpaces[0]; // 空炉膛首个空间
                if (item.w_algo <= s.w && item.h_algo <= s.h && item.d_algo <= s.d) {
                    item.x = s.x;
                    item.y = s.y;
                    item.z = s.z;
                    
                    furnace.isDedicated = true;
                    furnace.packedItems.push({...item});
                    furnace.totalWeight += item.weight;
                    if (item.materialType) furnace.materialTypes.add(item.materialType);
                    
                    updateEmptySpaces(furnace, s, item, routingStrategy);
                    placed = true;
                    break;
                }
            }
        }
    }

    // 再处理普通工件（规则3策略控制）
    for (let furnace of availableFurnaceInstances) {
        // 规则2: 跳过已被独占的炉膛
        if (furnace.isDedicated) {
            // 但独占炉膛也需要记录到completedFurnaces
            if (furnace.packedItems.length > 0) {
                completedFurnaces.push(furnace);
            }
            continue;
        }
        if (normalItems.length === 0) break;
        
        for (let i = 0; i < normalItems.length; i++) {
            let item = normalItems[i];
            
            // 检查重量限制
            if (furnace.totalWeight + item.weight > furnace.maxWeight) continue;
            
            // 规则1: 材质冲突检查
            if (!checkMaterialConflict(furnace.packedItems, item)) continue;
            
            // 规则4: 截面差异度检查
            if (!checkCrossSectionVariance(furnace.packedItems, item)) continue;

            // 查找可用空间
            let spaceIdx = -1;
            for (let j = 0; j < furnace.emptySpaces.length; j++) {
                let s = furnace.emptySpaces[j];
                if (item.w_algo <= s.w && item.h_algo <= s.h && item.d_algo <= s.d) {
                    spaceIdx = j;
                    break;
                }
            }

            if (spaceIdx !== -1) {
                let s = furnace.emptySpaces[spaceIdx];
                item.x = s.x;
                item.y = s.y;
                item.z = s.z;
                
                // 添加到炉膛
                furnace.packedItems.push({...item});
                furnace.totalWeight += item.weight;
                if (item.materialType) furnace.materialTypes.add(item.materialType);

                // 更新剩余空间（规则3策略控制）
                updateEmptySpaces(furnace, s, item, routingStrategy);

                // 从列表中移除已放置的工件
                normalItems.splice(i, 1);
                i--;
            }
        }

        // 如果炉膛中有工件，记录完成
        if (furnace.packedItems.length > 0) {
            completedFurnaces.push(furnace);
        }
    }

    // 确保所有有工件的炉膛都被记录（包括之前可能遗漏的独占炉膛）
    for (let furnace of availableFurnaceInstances) {
        if (furnace.packedItems.length > 0 && !completedFurnaces.includes(furnace)) {
            completedFurnaces.push(furnace);
        }
    }

    // 收集所有已放置的工件ID
    const packedIds = new Set();
    for (const f of completedFurnaces) {
        for (const pi of f.packedItems) {
            packedIds.add(pi.id);
        }
    }

    // 剩余未装炉工件
    const allUnpacked = [...dedicatedItems.filter(d => !packedIds.has(d.id)), ...normalItems];

    return {
        completedFurnaces: completedFurnaces,
        unpackedItems: allUnpacked
    };
}

/**
 * 更新炉膛剩余空间
 * @param {Object} furnace - 炉膛
 * @param {Object} space - 当前被占用的空间
 * @param {Object} item - 已放置的工件
 * @param {string} routingStrategy - 排布策略
 */
function updateEmptySpaces(furnace, space, item, routingStrategy) {
    let currentSpaces = [...furnace.emptySpaces];
    const spaceIdx = currentSpaces.indexOf(space);
    if (spaceIdx >= 0) {
        currentSpaces.splice(spaceIdx, 1);
    }

    const remainW = space.w - item.w_algo;
    const remainH = space.h - item.h_algo;
    const remainD = space.d - item.d_algo;

    // 规则3: 策略B关闭remainH（上方残差空间二次利用），仅2D单层平铺
    const allowHeightStacking = (routingStrategy !== 'STRATEGY_B');

    if (remainW > 0) {
        currentSpaces.push({ 
            x: space.x + item.w_algo, 
            y: space.y, 
            z: space.z, 
            w: remainW, 
            h: space.h, 
            d: space.d 
        });
    }
    if (remainD > 0) {
        currentSpaces.push({ 
            x: space.x, 
            y: space.y, 
            z: space.z + item.d_algo, 
            w: item.w_algo, 
            h: space.h, 
            d: remainD 
        });
    }
    if (allowHeightStacking && remainH > 0) {
        currentSpaces.push({ 
            x: space.x, 
            y: space.y + item.h_algo, 
            z: space.z, 
            w: item.w_algo, 
            h: remainH, 
            d: item.d_algo 
        });
    }

    // 按位置排序剩余空间（规则3策略A：y优先，小件找缝隙）
    currentSpaces.sort((a, b) => (a.y - b.y) || (a.z - b.z) || (a.x - b.x));
    furnace.emptySpaces = currentSpaces;
}

/**
 * 计算利用率
 */
export function calculateFurnaceUtilization(furnace) {
    const totalVol = furnace.w * furnace.h * furnace.d;
    let packedVol = furnace.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
    return (packedVol / totalVol) * 100;
}

/**
 * 获取统计信息（含规则冲突说明）
 */
export function getPackingStats(furnacesResult, unpackedItems) {
    const stats = {
        totalFurnaces: furnacesResult.length,
        totalItems: 0,
        totalWeight: 0,
        unpackedCount: unpackedItems.length,
        unpackedSummary: {},
        conflictWarnings: []  // 规则1/4冲突警告
    };

    furnacesResult.forEach(f => {
        stats.totalItems += f.packedItems.length;
        stats.totalWeight += f.totalWeight;
    });

    // 汇总未装炉工件
    unpackedItems.forEach(u => {
        stats.unpackedSummary[u.name] = (stats.unpackedSummary[u.name] || 0) + 1;
    });

    return stats;
}