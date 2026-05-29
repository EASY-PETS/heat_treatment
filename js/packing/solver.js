// ==================== 装炉排布算法模块 ====================

import { getSingleItemWeight, getItemDimensions } from '../utils/helpers.js';

/**
 * 异构多规格炉膛空间智能排载算法
 * @param {Array} furnacePoolInput - 炉膛池输入
 * @param {Array} itemsInput - 工件输入
 * @param {number} spacing - 安全间距
 * @returns {Object} 排布结果
 */
export function solveHeterogeneousPacking(furnacePoolInput, itemsInput, spacing) {
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
                emptySpaces: [{ x: 0, y: 0, z: 0, w: f.width, h: f.height, d: f.depth }]
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
                color: item.color
            });
        }
    });

    // 按重量从大到小排序工件（先放重的），重量相同则按体积从大到小（先放大的）
    flattenedItems.sort((a, b) => 
        (b.weight - a.weight) ||
        ((b.w_algo * b.h_algo * b.d_algo) - (a.w_algo * a.h_algo * a.d_algo))
    );

    let completedFurnaces = [];

    // 遍历每个炉膛
    for (let furnace of availableFurnaceInstances) {
        if (flattenedItems.length === 0) break;

        // 尝试放置每个工件
        for (let i = 0; i < flattenedItems.length; i++) {
            let item = flattenedItems[i];
            
            // 检查重量限制
            if (furnace.totalWeight + item.weight > furnace.maxWeight) continue;

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

                // 更新剩余空间
                let currentSpaces = [...furnace.emptySpaces];
                currentSpaces.splice(spaceIdx, 1);

                const remainW = s.w - item.w_algo;
                const remainH = s.h - item.h_algo;
                const remainD = s.d - item.d_algo;

                if (remainW > 0) {
                    currentSpaces.push({ 
                        x: s.x + item.w_algo, 
                        y: s.y, 
                        z: s.z, 
                        w: remainW, 
                        h: s.h, 
                        d: s.d 
                    });
                }
                if (remainD > 0) {
                    currentSpaces.push({ 
                        x: s.x, 
                        y: s.y, 
                        z: s.z + item.d_algo, 
                        w: item.w_algo, 
                        h: s.h, 
                        d: remainD 
                    });
                }
                if (remainH > 0) {
                    currentSpaces.push({ 
                        x: s.x, 
                        y: s.y + item.h_algo, 
                        z: s.z, 
                        w: item.w_algo, 
                        h: remainH, 
                        d: item.d_algo 
                    });
                }

                // 按位置排序剩余空间
                currentSpaces.sort((a, b) => (a.y - b.y) || (a.z - b.z) || (a.x - b.x));
                furnace.emptySpaces = currentSpaces;

                // 从列表中移除已放置的工件
                flattenedItems.splice(i, 1);
                i--;
            }
        }

        // 如果炉膛中有工件，记录完成
        if (furnace.packedItems.length > 0) {
            completedFurnaces.push(furnace);
        }
    }

    return {
        completedFurnaces: completedFurnaces,
        unpackedItems: flattenedItems
    };
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
 * 获取统计信息
 */
export function getPackingStats(furnacesResult, unpackedItems) {
    const stats = {
        totalFurnaces: furnacesResult.length,
        totalItems: 0,
        totalWeight: 0,
        unpackedCount: unpackedItems.length,
        unpackedSummary: {}
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