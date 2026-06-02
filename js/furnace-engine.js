/**
 * furnace-engine.js - Furnace Loading / Packing Algorithms
 *
 * Purpose:
 *   Contains all furnace loading logic - packing algorithms, utilization calculations,
 *   weight calculations, furnace validation, and optimization logic.
 *   This is the core business module.
 *
 * V2.0 Updates:
 *   - Task 2: 同材质/同工艺聚集规则（按材质、工艺分组排序 + 聚集率统计）
 *   - Task 3: 最小面积面朝下姿态优化（长方体自动旋转）
 *   - Task 4: 搁板实体厚度计算（shelfThickness 真实占用高度）
 *
 * V2.4 Update:
 *   - 重心居中算法重构：从中心螺旋扩散 + 四象限均衡 + 动态重心修正
 *   - 替换旧的贪心空位遍历为 center-out radial packing
 *
 * V2.5 Update (Bug Fix):
 *   - Bug 1: Y轴隔离 — 重心居中打分绝对禁止包含Y轴，Y轴仅由重力支配
 *   - Bug 2: 搁板+重心嵌套融合 — 搁板控制外层Y分层，重心控制内层XZ落子
 *   - 新增 solveUnifiedPacking：统一搁板分层 + 重心居中嵌套算法
 *
 * Dependencies:
 *   - state.js (placementRules, aggregationStats)
 */

import { placementRules, setAggregationStats } from './state.js';

// ==================== 摆放姿态优化（Task 3） ====================

/**
 * 为长方体工件计算最佳摆放姿态。
 * 原则：最小面积面朝下 → 单层可放更多工件，提高利用率，减少空隙。
 * 仅对长方体(cuboid)生效；圆柱体保持原逻辑。
 *
 * @param {Object} item - { shape, w, d, h }
 * @param {boolean} allowOptimization - 是否启用姿态优化
 * @returns {{ w: number, d: number, h: number, rotationInfo: string }}
 */
function optimizePosture(item, allowOptimization) {
    if (item.shape === 'cylinder' || !allowOptimization) {
        return { w: item.w, d: item.d, h: item.h, rotationInfo: '保持原姿态' };
    }
    const dims = [
        { label: 'L', value: item.w },
        { label: 'W', value: item.d },
        { label: 'H', value: item.h }
    ];
    dims.sort((a, b) => a.value - b.value);
    // dims[0]=最小维度, dims[1]=中间维度, dims[2]=最大维度
    // 最小面积面 = dims[0] × dims[1]（两个较小维度构成底面），dims[2] 为高度
    const newW = dims[0].value;
    const newD = dims[1].value;
    const newH = dims[2].value;
    const rotationInfo = `底面: ${newW}×${newD}mm, 高度: ${newH}mm（最小面积面朝下）`;
    return { w: newW, d: newD, h: newH, rotationInfo };
}

// ==================== 聚集规则辅助函数（Task 2） ====================

/**
 * 计算装炉结果中的材质聚集率和工艺聚集率。
 *
 * 材质聚集率：对每种材质，max(单炉该材质工件数) / 总该材质工件数，加权平均。
 * 工艺聚集率：对每种工艺，max(单炉该工艺工件数) / 总该工艺工件数，加权平均。
 */
function computeAggregationRates(completedFurnaces, itemMaterialMap, itemProcessMap) {
    // 材质聚集率
    const materialTotalCount = new Map();
    const materialPerFurnace = [];
    completedFurnaces.forEach(furnace => {
        const matCount = new Map();
        furnace.packedItems.forEach(item => {
            const mat = itemMaterialMap.get(item.id) || (item.material || '未知材质');
            matCount.set(mat, (matCount.get(mat) || 0) + 1);
            materialTotalCount.set(mat, (materialTotalCount.get(mat) || 0) + 1);
        });
        materialPerFurnace.push(matCount);
    });

    let materialRate = null;
    if (materialTotalCount.size > 0 && completedFurnaces.length > 0) {
        let totalWeighted = 0, totalN = 0;
        materialTotalCount.forEach((cnt, mat) => {
            if (cnt === 0) return;
            let maxInOne = 0;
            materialPerFurnace.forEach(mc => { maxInOne = Math.max(maxInOne, mc.get(mat) || 0); });
            totalWeighted += (maxInOne / cnt) * cnt;
            totalN += cnt;
        });
        if (totalN > 0) materialRate = Math.round((totalWeighted / totalN) * 100);
    }

    // 工艺聚集率
    const processTotalCount = new Map();
    const processPerFurnace = [];
    completedFurnaces.forEach(furnace => {
        const procCount = new Map();
        furnace.packedItems.forEach(item => {
            const proc = itemProcessMap.get(item.id) || (item.process || '未知工艺');
            procCount.set(proc, (procCount.get(proc) || 0) + 1);
            processTotalCount.set(proc, (processTotalCount.get(proc) || 0) + 1);
        });
        processPerFurnace.push(procCount);
    });

    let processRate = null;
    if (processTotalCount.size > 0 && completedFurnaces.length > 0) {
        let totalWeighted = 0, totalN = 0;
        processTotalCount.forEach((cnt, proc) => {
            if (cnt === 0) return;
            let maxInOne = 0;
            processPerFurnace.forEach(pc => { maxInOne = Math.max(maxInOne, pc.get(proc) || 0); });
            totalWeighted += (maxInOne / cnt) * cnt;
            totalN += cnt;
        });
        if (totalN > 0) processRate = Math.round((totalWeighted / totalN) * 100);
    }

    return { materialRate, processRate };
}

/**
 * 按聚集规则对工件列表排序。
 * 优先级：工艺一致 > 材质一致 > 体积降序 > 重量降序
 */
function sortByAggregationRules(items, itemMaterialMap, itemProcessMap, sameMaterial, sameProcess) {
    if (!sameMaterial && !sameProcess) {
        return [...items].sort((a, b) => {
            const volA = a.w * a.h * a.d, volB = b.w * b.h * b.d;
            if (volA !== volB) return volB - volA;
            return b.weight - a.weight;
        });
    }
    return [...items].sort((a, b) => {
        const procA = itemProcessMap.get(a.id) || (a.process || '');
        const procB = itemProcessMap.get(b.id) || (b.process || '');
        const matA = itemMaterialMap.get(a.id) || (a.material || '');
        const matB = itemMaterialMap.get(b.id) || (b.material || '');
        if (sameProcess && procA !== procB) return procA.localeCompare(procB, 'zh-CN');
        if (sameMaterial && matA !== matB) return matA.localeCompare(matB, 'zh-CN');
        const volA = a.w * a.h * a.d, volB = b.w * b.h * b.d;
        if (volA !== volB) return volB - volA;
        return b.weight - a.weight;
    });
}

// ==================== HETEROGENEOUS SPACE-FILLING PACKING（V2.0）====================

export function solveHeterogeneousPacking(furnacePoolInput, itemsInput, spacing) {
    let availableFurnaceInstances = [];
    furnacePoolInput.forEach(f => {
        for (let i = 0; i < f.count; i++) {
            availableFurnaceInstances.push({
                typeName: f.name,
                instanceId: `${f.name} (炉次 #${i + 1})`,
                w: f.width, h: f.height, d: f.depth, max_weight: f.maxWeight,
                spacing: f.actualSpacing != null ? f.actualSpacing : spacing,
                packedItems: [], totalWeight: 0,
                emptySpaces: [{ x: 0, y: 0, z: 0, w: f.width, h: f.height, d: f.depth }],
                /** V2.3: 每个炉膛独立存储 basketType */
                basketType: f.basketType || 'grid'
            });
        }
    });
    /* Fix: 不再按体积排序，保持用户在左侧面板中选择的顺序（炉膛卡片顺序 = 装炉优先级） */
    // availableFurnaceInstances.sort((a, b) => (b.w * b.h * b.d) - (a.w * a.h * a.d));
    /* V2.3: 禁止自动生成/复制/扩容炉膛 — 只能使用用户已配置的炉膛 */

    const itemMaterialMap = new Map();
    const itemProcessMap = new Map();
    let flattenedItems = [];

    itemsInput.forEach(item => {
        let w, h, d;
        if (item.shape === 'cylinder') { w = item.dim1; d = item.dim1; h = item.dim3; }
        else { w = item.dim1; d = item.dim2; h = item.dim3; }

        const allowOpt = placementRules.allowPostureOptimization !== false;
        const optimized = optimizePosture({ shape: item.shape, w, d, h }, allowOpt && item.shape !== 'cylinder');

        let singleWeight = item.count > 0 ? (item.weight / item.count) : 0;
        for (let i = 0; i < item.count; i++) {
            const itemId = `${item.name}_${i}`;
            flattenedItems.push({
                id: itemId, name: item.name, shape: item.shape,
                w_algo: optimized.w + spacing, h_algo: optimized.h + spacing, d_algo: optimized.d + spacing,
                w: optimized.w, h: optimized.h, d: optimized.d,
                weight: singleWeight, color: item.color,
                material: item.material || '', process: item.process || '',
                rotationInfo: optimized.rotationInfo,
                originalDims: { l: item.dim1, w: item.dim2, h: item.dim3 }
            });
            itemMaterialMap.set(itemId, item.material || '未知材质');
            itemProcessMap.set(itemId, item.process || '未知工艺');
        }
    });

    flattenedItems = sortByAggregationRules(flattenedItems, itemMaterialMap, itemProcessMap,
        placementRules.sameMaterial, placementRules.sameProcess);
    if (!placementRules.sameMaterial && !placementRules.sameProcess) {
        flattenedItems.sort((a, b) => (b.w_algo * b.d_algo) - (a.w_algo * a.d_algo) || (b.h_algo - a.h_algo));
    }

    let completedFurnaces = [];
    for (let furnace of availableFurnaceInstances) {
        if (flattenedItems.length === 0) break;
        const sp = furnace.spacing;
        for (let i = 0; i < flattenedItems.length; i++) {
            let item = flattenedItems[i];
            if (furnace.totalWeight + item.weight > furnace.max_weight) continue;
            let spaceIdx = -1;
            for (let j = 0; j < furnace.emptySpaces.length; j++) {
                let s = furnace.emptySpaces[j];
                const iw = item.w + sp, ih = item.h + sp, id_ = item.d + sp;
                if (iw <= s.w && ih <= s.h && id_ <= s.d) { spaceIdx = j; break; }
            }
            if (spaceIdx !== -1) {
                let s = furnace.emptySpaces[spaceIdx];
                const iw = item.w + sp, ih = item.h + sp, id_ = item.d + sp;
                item.x = s.x; item.y = s.y; item.z = s.z;
                furnace.packedItems.push({ ...item });
                furnace.totalWeight += item.weight;
                let currentSpaces = [...furnace.emptySpaces];
                currentSpaces.splice(spaceIdx, 1);
                const remainW = s.w - iw, remainH = s.h - ih, remainD = s.d - id_;
                if (remainW > 0) currentSpaces.push({ x: s.x + iw, y: s.y, z: s.z, w: remainW, h: s.h, d: s.d });
                if (remainD > 0) currentSpaces.push({ x: s.x, y: s.y, z: s.z + id_, w: iw, h: s.h, d: remainD });
                if (remainH > 0) currentSpaces.push({ x: s.x, y: s.y + ih, z: s.z, w: iw, h: remainH, d: id_ });
                currentSpaces.sort((a, b) => (a.y - b.y) || (a.z - b.z) || (a.x - b.x));
                furnace.emptySpaces = currentSpaces;
                flattenedItems.splice(i, 1); i--;
            }
        }
        if (furnace.packedItems.length > 0) completedFurnaces.push(furnace);
    }

    const aggStats = computeAggregationRates(completedFurnaces, itemMaterialMap, itemProcessMap);
    return { completedFurnaces, unpackedItems: flattenedItems, aggregationStats: aggStats };
}

// ==================== SHELF-LAYERED PACKING（V3.0：纯重量降序分层搁板摆放）====================

/**
 * 核心算法逻辑流：
 *   1. 全局重量降序排序 — 所有待装炉物料严格按重量从大到小排序
 *   2. 自底向上层层累积 — 每层在固定 Y 平面上水平平铺至满
 *   3. 铺满后加搁板 — 找出本层最高工件高度，在其上方添加搁板
 *   4. 次重物继续铺放 — 下一层从搁板上方开始，继续铺放剩余工件
 */
export function solveShelfLayeredPacking(items, furnaceConfig, customShelfHeight, itemMaterialMap, itemProcessMap) {
    const { w: fw, h: fh, d: fd, max_weight, spacing: sp } = furnaceConfig;
    const shelfThickness = placementRules.shelfThickness || 20;

    const packedItems = [];
    let totalWeight = 0, currentY = 0;
    const unpacked = [], shelvesUsed = [];

    // Step 1: 全局重量降序排序 — 重物优先出队
    const remainingItems = [...items].sort((a, b) => b.weight - a.weight);

    const furnaceCenterX = fw / 2;
    const furnaceCenterZ = fd / 2;

    /**
     * 在给定 X 坐标上，找到 Z 方向第一个可放置位置（碰撞检测）
     * @param {number} itemW — 工件宽度（含间距）
     * @param {number} itemD — 工件深度（含间距）
     * @param {Array} shelfItems — 当前层已放置工件列表
     * @returns {{ x: number, z: number } | null}
     */
    function find2DPlacement(itemW, itemD, shelfItems) {
        if (shelfItems.length === 0) {
            return (itemW <= fw && itemD <= fd) ? { x: 0, z: 0 } : null;
        }
        const xCandidates = [0];
        shelfItems.forEach(si => {
            const rx = si.x + si.w_algo;
            if (rx <= fw) xCandidates.push(rx);
        });
        const uniqueX = [...new Set(xCandidates)].sort((a, b) => a - b);

        /** @type {Array<{ x: number, z: number }>} 所有合法候选位置 */
        const validPlacements = [];

        for (const tryX of uniqueX) {
            if (tryX + itemW > fw) continue;
            let minZ = 0, changed = true;
            while (changed) {
                changed = false;
                for (const si of shelfItems) {
                    if (tryX + itemW > si.x && si.x + si.w_algo > tryX) {
                        if (minZ + itemD > si.z && si.z + si.d_algo > minZ) {
                            const nz = si.z + si.d_algo;
                            if (nz > minZ) { minZ = nz; changed = true; }
                        }
                    }
                }
            }
            if (minZ + itemD <= fd) {
                validPlacements.push({ x: tryX, z: minZ });
            }
        }

        if (validPlacements.length === 0) return null;

        // 重心居中评分 — 选择距炉膛 XZ 平面中心最近的候选位置
        validPlacements.sort((a, b) => {
            const da = (a.x + itemW / 2 - furnaceCenterX) ** 2
                    + (a.z + itemD / 2 - furnaceCenterZ) ** 2;
            const db = (b.x + itemW / 2 - furnaceCenterX) ** 2
                    + (b.z + itemD / 2 - furnaceCenterZ) ** 2;
            if (Math.abs(da - db) > 0.001) return da - db;
            // 距离相同时，优先低 X、低 Z（紧凑排列）
            if (a.x !== b.x) return a.x - b.x;
            return a.z - b.z;
        });

        return validPlacements[0];
    }

    // Step 2-4: 自底向上层层累积（双层循环嵌套）
    while (remainingItems.length > 0 && currentY < fh) {
        const layerItems = [];
        let maxItemHeight = 0;
        let placed = true;

        // 内层循环：在当前 Y 平面平铺至满
        while (placed && remainingItems.length > 0) {
            placed = false;

            // 从队列头部（当前最重）依次取料尝试放置
            for (let i = 0; i < remainingItems.length; i++) {
                const item = remainingItems[i];

                // 重量上限检查
                if (totalWeight + item.weight > max_weight) continue;

                // 垂直高度检查
                if (currentY + item.h + sp > fh) continue;

                const iw = item.w + sp;
                const ih = item.h + sp;
                const id_ = item.d + sp;

                // 尺寸检查
                if (item.w > fw || item.h > fh || item.d > fd) continue;

                // 2D 水平平铺 — 结合重心居中找最佳位置
                const placement = find2DPlacement(iw, id_, layerItems);
                if (placement !== null) {
                    item.x = placement.x;
                    item.y = currentY;
                    item.z = placement.z;
                    item.w_algo = iw;
                    item.h_algo = ih;
                    item.d_algo = id_;

                    layerItems.push({ ...item });
                    if (ih > maxItemHeight) maxItemHeight = ih;

                    packedItems.push({ ...item });
                    totalWeight += item.weight;

                    remainingItems.splice(i, 1);
                    i--;
                    placed = true;
                }
            }

            // 如果遍历完所有剩余工件都无法再放入当前层 → 当前层已满
            if (!placed) break;
        }

        // 当前层为空（没有工件能放在这个高度）→ 退出
        if (layerItems.length === 0) {
            unpacked.push(...remainingItems);
            remainingItems.length = 0;
            break;
        }

        // 根据本层最高高度添加搁板
        const effectiveHeight = maxItemHeight > 0 ? maxItemHeight : 1;
        const shelfY = currentY + effectiveHeight;

        // 搁板添加在当前层最高工件上方 — 只要垂直空间还够放下一层搁板 + 工件就加
        if (shelfY + shelfThickness < fh) {
            shelvesUsed.push({ y: shelfY, thickness: shelfThickness });
            currentY = shelfY + shelfThickness;
        } else {
            // 垂直空间不足，不再加搁板，循环将在下一轮因 currentY >= fh 而退出
            currentY = shelfY;
        }

        // 重量上限检查
        if (totalWeight >= max_weight) {
            unpacked.push(...remainingItems);
            remainingItems.length = 0;
            break;
        }
    }

    const shelfCount = shelvesUsed.length + 1; // 层数 = 搁板数 + 1（底层无搁板）

    return { packedItems, totalWeight, shelfCount, unpackedItems: unpacked, shelvesUsed };
}

export function solveShelfLayeredMultiFurnace(furnacePoolInput, itemsInput, spacing, shelfHeight) {
    let availableFurnaceInstances = [];
    furnacePoolInput.forEach(f => {
        for (let i = 0; i < f.count; i++) {
            availableFurnaceInstances.push({
                typeName: f.name, instanceId: `${f.name} (炉次 #${i + 1})`,
                w: f.width, h: f.height, d: f.depth, max_weight: f.maxWeight,
                spacing: f.actualSpacing != null ? f.actualSpacing : spacing,
                packedItems: [], totalWeight: 0,
                /** V2.3: 每个炉膛独立存储 basketType */
                basketType: f.basketType || 'grid'
            });
        }
    });
    /* Fix: 不再按体积排序，保持用户在左侧面板中选择的顺序（炉膛卡片顺序 = 装炉优先级） */
    // availableFurnaceInstances.sort((a, b) => (b.w * b.h * b.d) - (a.w * a.h * a.d));
    /* V2.3: 禁止自动生成/复制/扩容炉膛 */

    const itemMaterialMap = new Map(), itemProcessMap = new Map();
    let flattenedItems = [];
    itemsInput.forEach(item => {
        let w, h, d;
        if (item.shape === 'cylinder') { w = item.dim1; d = item.dim1; h = item.dim3; }
        else { w = item.dim1; d = item.dim2; h = item.dim3; }
        const allowOpt = placementRules.allowPostureOptimization !== false;
        const optimized = optimizePosture({ shape: item.shape, w, d, h }, allowOpt && item.shape !== 'cylinder');
        let singleWeight = item.count > 0 ? (item.weight / item.count) : 0;
        for (let i = 0; i < item.count; i++) {
            const itemId = `${item.name}_${i}`;
            flattenedItems.push({
                id: itemId, name: item.name, shape: item.shape,
                w: optimized.w, h: optimized.h, d: optimized.d,
                weight: singleWeight, color: item.color,
                material: item.material || '', process: item.process || '',
                rotationInfo: optimized.rotationInfo,
                originalDims: { l: item.dim1, w: item.dim2, h: item.dim3 }
            });
            itemMaterialMap.set(itemId, item.material || '未知材质');
            itemProcessMap.set(itemId, item.process || '未知工艺');
        }
    });

    let completedFurnaces = [];
    for (let furnace of availableFurnaceInstances) {
        if (flattenedItems.length === 0) break;
        const result = solveShelfLayeredPacking(flattenedItems, furnace, shelfHeight, itemMaterialMap, itemProcessMap);
        furnace.packedItems = result.packedItems;
        furnace.totalWeight = result.totalWeight;
        furnace.shelvesUsed = result.shelvesUsed || [];
        if (furnace.packedItems.length > 0) completedFurnaces.push(furnace);
        flattenedItems = result.unpackedItems;
    }

    const aggStats = computeAggregationRates(completedFurnaces, itemMaterialMap, itemProcessMap);
    return { completedFurnaces, unpackedItems: flattenedItems, aggregationStats: aggStats };
}

// ==================== CENTER-OF-GRAVITY PACKING（V4.0：全局候选评分搜索）====================

/**
 * 重心居中装炉算法（V4.0 重构 — 全局候选评分搜索）
 *
 * V4.1 Bug Fix:
 *   - Y 轴绝对禁止参与重心打分！重心偏移仅计算 XZ 平面。
 *   - Y 轴由重力支配：候选位置强制从已放置工件顶面/炉底生成。
 *
 * 核心设计原则：
 *   1. **全局 3D 候选网格**：在整个炉膛容积内均匀采样候选放置位置，
 *      彻底消除 empty-space 分裂导致的"柱状堆叠"问题。
 *   2. **碰撞检测代替空位管理**：不再维护空位列表，直接对每个候选位置
 *      与已放置工件进行 AABB 碰撞检测。
 *   3. **多维度评分函数**（分数越低越优）：
 *      a) 整体重心偏移 — **仅 XZ 平面**加权重心距炉膛几何中心的平方距离
 *      b) 个体中心距离 — 鼓励工件靠近炉膛中心（center-out 扩散）
 *      c) 四象限均衡 — 各象限重量差异惩罚，鼓励填充轻象限
 *      d) 紧密度 — 奖励贴合已放置工件面或炉壁面
 *      e) 底部优先 — 优先使用低 Y 位置以增强物理稳定性
 *      f) 孤立惩罚 — 惩罚远离已有工件的孤立放置
 *   4. **每一步重新计算 global center of mass**，实时优化重心
 *   5. **物料在 X/Z 方向均匀扩展**，不允许单方向线性/柱状堆叠
 *   6. **候选网格自适应密度**：全局粗网格 + 中心密集采样 + 已放置工件邻接采样
 *
 * @param {Array} items - 待装炉工件列表
 * @param {Object} furnaceConfig - { w, h, d, max_weight, spacing }
 * @param {Map} itemMaterialMap - 工件 ID → 材质映射
 * @param {Map} itemProcessMap - 工件 ID → 工艺映射
 * @returns {{ packedItems: Array, totalWeight: number, unpackedItems: Array }}
 */
export function solveCenterOfGravityPacking(items, furnaceConfig, itemMaterialMap, itemProcessMap) {
    const { w: fw, h: fh, d: fd, max_weight, spacing: sp } = furnaceConfig;
    const centerX = fw / 2;
    const centerZ = fd / 2;

    /** @type {Array} 已放置工件列表（含 x, y, z, w_algo, h_algo, d_algo, weight）*/
    const placedItems = [];
    let totalWeight = 0;
    const unpacked = [];

    // 四象限重量追踪（X-Z 平面，以 centerX, centerZ 为原点）
    // Q0: X >= centerX, Z >= centerZ (右前)
    // Q1: X <  centerX, Z >= centerZ (左前)
    // Q2: X <  centerX, Z <  centerZ (左后)
    // Q3: X >= centerX, Z <  centerZ (右后)
    const quadrantWeights = [0, 0, 0, 0];

    /**
     * 判断工件中心所属象限
     * @param {number} itemCX - 工件中心 X
     * @param {number} itemCZ - 工件中心 Z
     * @returns {number} 0-3 象限索引
     */
    function getQuadrant(itemCX, itemCZ) {
        return (itemCX >= centerX ? 0 : 1) + (itemCZ < centerZ ? 2 : 0);
    }

    /**
     * 获取当前最轻象限索引
     * @returns {number} 0-3 或 -1（无工件时）
     */
    function getLightestQuadrant() {
        if (placedItems.length === 0) return -1;
        let minIdx = 0;
        for (let i = 1; i < 4; i++) {
            if (quadrantWeights[i] < quadrantWeights[minIdx]) {
                minIdx = i;
            }
        }
        return minIdx;
    }

    /**
     * 计算已放置工件的 **XZ 平面**加权重心（V4.1：Y轴不参与重心计算）
     * @returns {{ cgx: number, cgz: number, totalMass: number }}
     */
    function computeCurrentCG() {
        let sx = 0, sz = 0, sm = 0;
        for (const it of placedItems) {
            const wgt = it.weight || 1;
            const cx = it.x + it.w / 2;
            const cz = it.z + it.d / 2;
            sx += wgt * cx;
            sz += wgt * cz;
            sm += wgt;
        }
        if (sm === 0) return { cgx: centerX, cgz: centerZ, totalMass: 0 };
        return { cgx: sx / sm, cgz: sz / sm, totalMass: sm };
    }

    /**
     * AABB 碰撞检测：检查候选包围盒是否与任意已放置工件重叠
     * @param {number} x, y, z - 候选位置左下后角
     * @param {number} iw, ih, id_ - 工件尺寸（含间距）
     * @returns {boolean} true = 碰撞
     */
    function hasCollision(x, y, z, iw, ih, id_) {
        for (const p of placedItems) {
            if (x + iw > p.x && p.x + p.w_algo > x &&
                y + ih > p.y && p.y + p.h_algo > y &&
                z + id_ > p.z && p.z + p.d_algo > z) {
                return true;
            }
        }
        return false;
    }

    /**
     * 检查候选位置是否与某已放置工件在指定轴上重叠
     * （用于邻接面检测）
     */
    function overlapsY(y, ih, p) {
        return y + ih > p.y && p.y + p.h_algo > y;
    }
    function overlapsZ(z, id_, p) {
        return z + id_ > p.z && p.z + p.d_algo > z;
    }
    function overlapsX(x, iw, p) {
        return x + iw > p.x && p.x + p.w_algo > x;
    }

    /**
     * V4.1: 全局 3D 候选位置生成
     *
     * 关键修改：Y 轴候选位置从重力堆叠面生成，不再均匀采样全高。
     * Y候选 = 炉底(0) + 每个已放置工件顶面
     *
     * 混合策略：
     *   1. 全局均匀网格（XZ）+ 重力Y — 覆盖整个炉膛底面
     *   2. 中心密集采样 — 炉膛几何中心附近更高密度，优先 center-out
     *   3. 已放置工件邻接采样 — 紧贴每个已放置工件的面
     *   4. 炉壁贴合采样 — 鼓励工件靠壁放置
     *
     * @param {number} iw, ih, id_ - 工件尺寸（含间距）
     * @returns {Array<{x: number, y: number, z: number}>} 候选位置列表（按距中心距离排序）
     */
    function generateGlobalCandidates(iw, ih, id_) {
        const candidates = [];
        const seen = new Set();
        const xRange = fw - iw;
        const yRange = fh - ih;
        const zRange = fd - id_;

        /**
         * V4.1: 收集所有重力支撑面 Y 坐标
         * 包括炉底(0) + 每个已放置工件顶面
         */
        const supportYs = new Set();
        supportYs.add(0); // 炉底
        for (const p of placedItems) {
            supportYs.add(p.y + p.h_algo);
        }
        // 去重排序，低Y优先
        const sortedSupportYs = [...supportYs].sort((a, b) => a - b);
        // 过滤掉超出范围的Y
        const validYs = sortedSupportYs.filter(y => y <= yRange);

        function addCandidate(x, y, z) {
            // 边界裁剪与取整
            x = Math.round(Math.max(0, Math.min(x, xRange)));
            y = Math.round(Math.max(0, Math.min(y, yRange)));
            z = Math.round(Math.max(0, Math.min(z, zRange)));
            if (x < 0 || x > xRange || y < 0 || y > yRange || z < 0 || z > zRange) return;
            const key = `${x},${y},${z}`;
            if (!seen.has(key)) {
                seen.add(key);
                candidates.push({ x, y, z });
            }
        }

        // ===== 1. 全局均匀网格（XZ）+ 重力Y =====
        const gridNX = 15, gridNZ = 12;
        const stepX = Math.max(20, Math.floor(xRange / gridNX));
        const stepZ = Math.max(20, Math.floor(zRange / gridNZ));

        for (let x = 0; x <= xRange; x += stepX) {
            for (let z = 0; z <= zRange; z += stepZ) {
                // Y只使用重力支撑面
                for (const y of validYs) {
                    addCandidate(x, y, z);
                }
            }
        }

        // ===== 2. 炉膛几何中心附近密集采样 =====
        const denseHalf = Math.min(fw, fd) / 5;
        const denseStep = Math.max(10, Math.floor(Math.min(xRange, zRange) / 25));
        const cxMin = Math.max(0, Math.floor(centerX - iw / 2 - denseHalf));
        const cxMax = Math.min(xRange, Math.ceil(centerX - iw / 2 + denseHalf));
        const czMin = Math.max(0, Math.floor(centerZ - id_ / 2 - denseHalf));
        const czMax = Math.min(zRange, Math.ceil(centerZ - id_ / 2 + denseHalf));

        for (let x = cxMin; x <= cxMax; x += denseStep) {
            for (let z = czMin; z <= czMax; z += denseStep) {
                for (const y of validYs) {
                    addCandidate(x, y, z);
                }
            }
        }

        // ===== 3. 已放置工件邻接采样（紧贴六个面）=====
        for (const p of placedItems) {
            // 右侧邻接
            addCandidate(p.x + p.w_algo, p.y, p.z);
            // 左侧邻接
            addCandidate(p.x - iw, p.y, p.z);
            // 上方邻接
            addCandidate(p.x, p.y + p.h_algo, p.z);
            // 前方邻接
            addCandidate(p.x, p.y, p.z + p.d_algo);
            // 后方邻接
            addCandidate(p.x, p.y, p.z - id_);
            // 边角邻接（对角线方向）
            addCandidate(p.x + p.w_algo, p.y, p.z + p.d_algo);
            addCandidate(p.x + p.w_algo, p.y, p.z - id_);
            addCandidate(p.x - iw, p.y, p.z + p.d_algo);
            addCandidate(p.x - iw, p.y, p.z - id_);
            // 顶部邻接（同一 XZ 位置的不同 Y 层）
            addCandidate(p.x, p.y + p.h_algo, p.z + p.d_algo);
            addCandidate(p.x, p.y + p.h_algo, p.z - id_);
            addCandidate(p.x + p.w_algo, p.y + p.h_algo, p.z);
            addCandidate(p.x - iw, p.y + p.h_algo, p.z);
        }

        // ===== 4. 炉壁贴合采样 =====
        // 底面
        for (let x = 0; x <= xRange; x += stepX * 2) {
            for (let z = 0; z <= zRange; z += stepZ * 2) {
                addCandidate(x, 0, z);
            }
        }
        // 左壁
        for (const y of validYs) {
            for (let z = 0; z <= zRange; z += stepZ * 2) {
                addCandidate(0, y, z);
            }
        }
        // 后壁
        for (const y of validYs) {
            for (let x = 0; x <= xRange; x += stepX * 2) {
                addCandidate(x, y, 0);
            }
        }
        // 边界收尾
        for (const y of validYs) {
            addCandidate(0, y, 0);
            addCandidate(xRange, y, 0);
            addCandidate(0, y, zRange);
            addCandidate(xRange, y, zRange);
        }

        // ===== 排序：距炉膛 XZ 中心越近越优先，同距离时 Y 低优先 =====
        candidates.sort((a, b) => {
            const da = (a.x + iw / 2 - centerX) ** 2 + (a.z + id_ / 2 - centerZ) ** 2;
            const db = (b.x + iw / 2 - centerX) ** 2 + (b.z + id_ / 2 - centerZ) ** 2;
            // 组合排序 key：XZ中心优先，低 Y 优先
            const scoreA = da * 100 + a.y;
            const scoreB = db * 100 + b.y;
            return scoreA - scoreB;
        });

        return candidates;
    }

    /**
     * V4.1: 全维度评分函数（**Y 轴隔离**）
     *
     * 综合评估候选放置位置的优劣，分数越低越好。
     *
     * 关键修改：重心偏差仅计算 XZ 平面，Y 轴不参与。
     * Y 轴由重力支配（候选生成时已限定为炉底或工件顶面）。
     *
     * 评分维度（按权重）：
     *   1. 整体重心偏差 — 放置后 **XZ 平面**加权重心偏离炉膛中心的平方距离
     *   2. 个体中心距离 — 工件自身距炉膛 XZ 中心距离（推动 center-out 分布）
     *   3. 底部优先 — 低 Y 位置奖励（物理稳定性）
     *   4. 紧密度 — 贴合已放置工件面/炉壁面奖励
     *   5. 四象限均衡 — 超载象限惩罚 + 轻象限鼓励
     *   6. 孤立惩罚 — 远离已有工件的孤立放置惩罚
     *
     * @param {number} testX, testY, testZ - 候选位置
     * @param {number} iw, ih, id_ - 工件尺寸（含间距）
     * @param {number} itemWeight - 工件重量
     * @returns {number} 综合评分（越小越好）
     */
    function evaluatePlacement(testX, testY, testZ, iw, ih, id_, itemWeight) {
        const itemCX = testX + iw / 2;
        const itemCZ = testZ + id_ / 2;
        const effWeight = Math.max(itemWeight, 1);

        // ---- 1. 整体重心偏差 **仅 XZ 平面**（V4.1：Y 轴不参与）----
        const currentCG = computeCurrentCG();
        const newTotalMass = currentCG.totalMass + effWeight;
        const newCGX = (currentCG.cgx * currentCG.totalMass + effWeight * itemCX) / newTotalMass;
        const newCGZ = (currentCG.cgz * currentCG.totalMass + effWeight * itemCZ) / newTotalMass;
        // Y 轴绝对不参与重心计算
        const cgDeviation = (newCGX - centerX) ** 2 + (newCGZ - centerZ) ** 2;
        const furnaceXZDiag = fw * fw + fd * fd;
        const cgScore = (cgDeviation / Math.max(furnaceXZDiag, 1)) * 10000;

        // ---- 2. 个体中心距离（仅 XZ 平面）----
        const distToCenter = Math.sqrt(
            (itemCX - centerX) ** 2 + (itemCZ - centerZ) ** 2
        );
        const maxDist = Math.sqrt((fw / 2) ** 2 + (fd / 2) ** 2);
        const centerDistScore = (distToCenter / Math.max(maxDist, 1)) * 4000;

        // ---- 3. 底部优先 ----
        const yBottomScore = (testY / Math.max(fh, 1)) * 2500;

        // ---- 4. 紧密度 — 贴合已放置工件面或炉壁面奖励 ----
        let touchBonus = 0;

        // 炉壁贴合
        if (testX < 1) touchBonus++;
        if (testY < 1) touchBonus++;
        if (testZ < 1) touchBonus++;
        if (testX + iw >= fw - 1) touchBonus++;
        if (testZ + id_ >= fd - 1) touchBonus++;

        // 已放置工件面贴合检测
        for (const p of placedItems) {
            // X 方向邻接（右邻接：cand 左面贴 p 右面）
            if (Math.abs(testX - (p.x + p.w_algo)) < 2 && overlapsY(testY, ih, p) && overlapsZ(testZ, id_, p)) {
                touchBonus++;
            }
            // X 方向邻接（左邻接：cand 右面贴 p 左面）
            if (Math.abs((testX + iw) - p.x) < 2 && overlapsY(testY, ih, p) && overlapsZ(testZ, id_, p)) {
                touchBonus++;
            }
            // Z 方向邻接（前邻接）
            if (Math.abs(testZ - (p.z + p.d_algo)) < 2 && overlapsX(testX, iw, p) && overlapsY(testY, ih, p)) {
                touchBonus++;
            }
            // Z 方向邻接（后邻接）
            if (Math.abs((testZ + id_) - p.z) < 2 && overlapsX(testX, iw, p) && overlapsY(testY, ih, p)) {
                touchBonus++;
            }
            // Y 方向邻接（顶邻接）
            if (Math.abs(testY - (p.y + p.h_algo)) < 2 && overlapsX(testX, iw, p) && overlapsZ(testZ, id_, p)) {
                touchBonus++;
            }
        }
        const compactnessScore = touchBonus * (-600);

        // ---- 5. 四象限均衡 ----
        let quadrantScore = 0;
        if (placedItems.length > 0 && itemWeight > 0) {
            const q = getQuadrant(itemCX, itemCZ);
            const totalQW = quadrantWeights.reduce((a, b) => a + b, 0);
            if (totalQW > 0) {
                const avgW = totalQW / 4;
                const overload = quadrantWeights[q] + itemWeight - avgW;
                if (overload > 0) {
                    quadrantScore += (overload / Math.max(avgW, 1)) * 3000;
                }
            }
            const prefQ = getLightestQuadrant();
            if (prefQ >= 0 && q !== prefQ) {
                quadrantScore += 2000;
            }
        }

        // ---- 6. 孤立惩罚 — 远离已有工件则惩罚 ----
        let isolationPenalty = 0;
        if (placedItems.length > 0) {
            let minDistSq = Infinity;
            for (const p of placedItems) {
                // 包围盒间最小欧氏距离平方（简化：使用轴对齐间隙）
                const dx = Math.max(0, Math.max(p.x - (testX + iw), testX - (p.x + p.w_algo)));
                const dy = Math.max(0, Math.max(p.y - (testY + ih), testY - (p.y + p.h_algo)));
                const dz = Math.max(0, Math.max(p.z - (testZ + id_), testZ - (p.z + p.d_algo)));
                const dSq = dx * dx + dy * dy + dz * dz;
                if (dSq < minDistSq) minDistSq = dSq;
            }
            isolationPenalty = Math.min(Math.sqrt(minDistSq) / 2, 3000);
        }

        return cgScore + centerDistScore + yBottomScore + compactnessScore + quadrantScore + isolationPenalty;
    }

    // ==================== 工件排序 ====================
    // 按重量降序排列：最重工件优先（放在底部中心），保持同材质/同工艺聚集
    const sameMaterial = placementRules.sameMaterial;
    const sameProcess = placementRules.sameProcess;
    let sortedItems = [...items].sort((a, b) => {
        if (sameProcess) {
            const pa = itemProcessMap.get(a.id) || (a.process || '');
            const pb = itemProcessMap.get(b.id) || (b.process || '');
            if (pa !== pb) return pa.localeCompare(pb, 'zh-CN');
        }
        if (sameMaterial) {
            const ma = itemMaterialMap.get(a.id) || (a.material || '');
            const mb = itemMaterialMap.get(b.id) || (b.material || '');
            if (ma !== mb) return ma.localeCompare(mb, 'zh-CN');
        }
        return b.weight - a.weight;
    });

    // ==================== 主循环：全局优化放置 ====================
    for (let i = 0; i < sortedItems.length; i++) {
        const item = sortedItems[i];

        // 重量检查
        if (totalWeight + item.weight > max_weight) {
            unpacked.push(item);
            continue;
        }

        const iw = item.w + sp;
        const ih = item.h + sp;
        const id_ = item.d + sp;

        // 尺寸检查（是否超过炉膛整体尺寸）
        if (item.w > fw || item.h > fh || item.d > fd) {
            unpacked.push(item);
            continue;
        }

        // ===== 生成全局 3D 候选位置网格 =====
        const candidates = generateGlobalCandidates(iw, ih, id_);

        // ===== 遍历候选位置，评分选优 =====
        let best = { x: 0, y: 0, z: 0, score: Infinity };
        let found = false;

        for (const cand of candidates) {
            // 碰撞检测
            if (hasCollision(cand.x, cand.y, cand.z, iw, ih, id_)) continue;

            const score = evaluatePlacement(cand.x, cand.y, cand.z, iw, ih, id_, item.weight);
            if (score < best.score) {
                best = { x: cand.x, y: cand.y, z: cand.z, score };
                found = true;
            }
        }

        if (!found) {
            unpacked.push(item);
            continue;
        }

        // ===== 放置工件 =====
        item.x = best.x;
        item.y = best.y;
        item.z = best.z;
        item.w_algo = iw;
        item.h_algo = ih;
        item.d_algo = id_;

        placedItems.push({
            id: item.id, name: item.name, shape: item.shape,
            x: item.x, y: item.y, z: item.z,
            w: item.w, h: item.h, d: item.d,
            w_algo: iw, h_algo: ih, d_algo: id_,
            weight: item.weight, color: item.color,
            material: item.material || '', process: item.process || '',
            rotationInfo: item.rotationInfo || '',
            originalDims: item.originalDims || { l: item.w, w: item.d, h: item.h }
        });
        totalWeight += item.weight;

        // 更新四象限重量
        const qIdx = getQuadrant(item.x + item.w / 2, item.z + item.d / 2);
        quadrantWeights[qIdx] += item.weight;
    }

    return {
        packedItems: placedItems,
        totalWeight,
        unpackedItems: unpacked
    };
}

export function solveCenterOfGravityMultiFurnace(furnacePoolInput, itemsInput, spacing) {
    let availableFurnaceInstances = [];
    furnacePoolInput.forEach(f => {
        for (let i = 0; i < f.count; i++) {
            availableFurnaceInstances.push({
                typeName: f.name, instanceId: `${f.name} (炉次 #${i + 1})`,
                w: f.width, h: f.height, d: f.depth, max_weight: f.maxWeight,
                spacing: f.actualSpacing != null ? f.actualSpacing : spacing,
                packedItems: [], totalWeight: 0,
                /** V2.3: 每个炉膛独立存储 basketType */
                basketType: f.basketType || 'grid'
            });
        }
    });
    /* Fix: 不再按体积排序，保持用户在左侧面板中选择的顺序（炉膛卡片顺序 = 装炉优先级） */
    // availableFurnaceInstances.sort((a, b) => (b.w * b.h * b.d) - (a.w * a.h * a.d));
    /* V2.3: 禁止自动生成/复制/扩容炉膛 */

    const itemMaterialMap = new Map(), itemProcessMap = new Map();
    let flattenedItems = [];
    itemsInput.forEach(item => {
        let w, h, d;
        if (item.shape === 'cylinder') { w = item.dim1; d = item.dim1; h = item.dim3; }
        else { w = item.dim1; d = item.dim2; h = item.dim3; }
        const allowOpt = placementRules.allowPostureOptimization !== false;
        const optimized = optimizePosture({ shape: item.shape, w, d, h }, allowOpt && item.shape !== 'cylinder');
        let singleWeight = item.count > 0 ? (item.weight / item.count) : 0;
        for (let i = 0; i < item.count; i++) {
            const itemId = `${item.name}_${i}`;
            flattenedItems.push({
                id: itemId, name: item.name, shape: item.shape,
                w: optimized.w, h: optimized.h, d: optimized.d,
                weight: singleWeight, color: item.color,
                material: item.material || '', process: item.process || '',
                rotationInfo: optimized.rotationInfo,
                originalDims: { l: item.dim1, w: item.dim2, h: item.dim3 }
            });
            itemMaterialMap.set(itemId, item.material || '未知材质');
            itemProcessMap.set(itemId, item.process || '未知工艺');
        }
    });

    let completedFurnaces = [];
    for (let furnace of availableFurnaceInstances) {
        if (flattenedItems.length === 0) break;
        const result = solveCenterOfGravityPacking(flattenedItems, furnace, itemMaterialMap, itemProcessMap);
        furnace.packedItems = result.packedItems;
        furnace.totalWeight = result.totalWeight;
        if (furnace.packedItems.length > 0) completedFurnaces.push(furnace);
        flattenedItems = result.unpackedItems;
    }

    const aggStats = computeAggregationRates(completedFurnaces, itemMaterialMap, itemProcessMap);
    return { completedFurnaces, unpackedItems: flattenedItems, aggregationStats: aggStats };
}

// ==================== V2.5: 统一搁板分层 + 重心居中嵌套算法 ====================

/**
 * 统一装炉算法：搁板分层（外层Y控制）嵌套重心居中（内层XZ落子）
 *
 * 设计原则：
 *   1. 搁板分层与重心居中 **不是互斥关系，而是嵌套关系**
 *   2. 外层循环控制 Y 轴层高递增（搁板驱动）
 *   3. 内层在当前层使用重心居中算法挑选 (X, Z) 落子点
 *   4. Y 轴绝对禁止参与重心打分
 *   5. 所有工件 Y 坐标必须自底向上堆叠
 *
 * 场景：
 *   - 搁板ON + 重心ON: 外层搁板分层，内层重心居中找XZ位置
 *   - 搁板OFF + 重心ON: 单层无限高空间，重心居中找XZ位置，Y重力支撑
 *   - 搁板ON + 重心OFF: 外层搁板分层，内层贪心XZ平铺（从左到右）
 *
 * @param {Array} items - 待装炉工件列表
 * @param {Object} furnaceConfig - { w, h, d, max_weight, spacing }
 * @param {Map} itemMaterialMap
 * @param {Map} itemProcessMap
 * @returns {{ packedItems: Array, totalWeight: number, unpackedItems: Array, shelvesUsed: Array }}
 */
/**
 * 🔧 V2.6 重构：统一装炉算法 — 搁板分层（外层Y控制）嵌套重心居中（内层XZ落子）
 *
 * 逻辑主线已彻底固化：
 *   "重量降序预排 → 搁板分层 → 每一层内水平重心居中落子"
 *
 * - 勾选"启用搁板"时：外层搁板分层控制Y轴层高，内层重心居中找最佳XZ位置
 * - 不勾选搁板时：单层无限高空间，重心居中找XZ位置，Y由重力支撑面决定
 *
 * @param {Array} items - 待装炉工件列表
 * @param {Object} furnaceConfig - { w, h, d, max_weight, spacing }
 * @param {Map} itemMaterialMap
 * @param {Map} itemProcessMap
 * @returns {{ packedItems: Array, totalWeight: number, unpackedItems: Array, shelvesUsed: Array }}
 */
function solveUnifiedPacking(items, furnaceConfig, itemMaterialMap, itemProcessMap) {
    const { w: fw, h: fh, d: fd, max_weight, spacing: sp } = furnaceConfig;
    const shelfThickness = placementRules.shelfThickness || 20;
    const useShelf = placementRules.useShelfLayered;
    // 🔧 V2.6: 重心居中已固化，无条件执行
    const useCG = true;

    const packedItems = [];
    let totalWeight = 0;
    /** 当前层底面Y坐标 — 每加一层搁板后，currentY = 上一搁板顶面Y */
    let currentY = 0;
    const unpacked = [];
    const shelvesUsed = [];

    const centerX = fw / 2;
    const centerZ = fd / 2;

    // 🔧 V2.6: 全局重量降序排序 — 重物优先放在底层，确保物理稳定性
    const remainingItems = [...items].sort((a, b) => b.weight - a.weight);

    /**
     * 获取当前层底面以上所有已放置工件（用于重心计算和碰撞检测）
     * @param {number} layerBaseY - 当前层底面Y
     * @returns {Array} 当前层以上已放置工件
     */
    function getItemsForLayer(layerBaseY) {
        return packedItems.filter(p => p.y >= layerBaseY);
    }

    /**
     * 重心居中XZ打分（仅XZ平面）
     * @param {number} testX, testZ - 候选XZ位置（工件左下角）
     * @param {number} iw, id_ - 工件尺寸（含间距）
     * @param {number} itemWeight - 工件重量
     * @param {Array} layerItems - 当前层已放置工件
     * @returns {number} 综合评分（越小越好）
     */
    function scoreCGPlacement(testX, testZ, iw, id_, itemWeight, layerItems) {
        // 计算当前层工件 + 候选工件的XZ重心
        let sx = 0, sz = 0, sm = 0;
        for (const p of layerItems) {
            const wgt = p.weight || 1;
            sx += wgt * (p.x + p.w / 2);
            sz += wgt * (p.z + p.d / 2);
            sm += wgt;
        }
        const effW = Math.max(itemWeight, 1);
        const newMass = sm + effW;
        const newCX = (sx + effW * (testX + iw / 2)) / newMass;
        const newCZ = (sz + effW * (testZ + id_ / 2)) / newMass;

        // 重心偏离中心距离（仅XZ）
        const cgDist = Math.sqrt((newCX - centerX) ** 2 + (newCZ - centerZ) ** 2);
        // 个体距中心距离
        const itemDist = Math.sqrt(
            (testX + iw / 2 - centerX) ** 2 + (testZ + id_ / 2 - centerZ) ** 2
        );
        const maxDist = Math.sqrt((fw / 2) ** 2 + (fd / 2) ** 2);

        return (cgDist / maxDist) * 6000 + (itemDist / maxDist) * 3000;
    }

    /**
     * 在当前层内使用重心居中找最佳XZ位置
     * @param {number} iw, id_ - 工件尺寸
     * @param {number} itemWeight - 工件重量
     * @param {Array} layerItems - 当前层已放置工件
     * @param {number} layerBaseY - 当前层底面Y
     * @returns {{ x: number, z: number } | null}
     */
    function findCGXZPlacement(iw, id_, itemWeight, layerItems, layerBaseY) {
        const xRange = fw - iw;
        const zRange = fd - id_;
        if (xRange < 0 || zRange < 0) return null;

        const candidates = [];
        const seen = new Set();

        function addCandidate(x, z) {
            x = Math.round(Math.max(0, Math.min(x, xRange)));
            z = Math.round(Math.max(0, Math.min(z, zRange)));
            const key = `${x},${z}`;
            if (!seen.has(key)) {
                seen.add(key);
                candidates.push({ x, z });
            }
        }

        // 全局网格采样
        const stepX = Math.max(20, Math.floor(xRange / 15));
        const stepZ = Math.max(20, Math.floor(zRange / 12));
        for (let x = 0; x <= xRange; x += stepX) {
            for (let z = 0; z <= zRange; z += stepZ) {
                addCandidate(x, z);
            }
        }

        // 中心密集采样
        const denseHalf = Math.min(fw, fd) / 5;
        const denseStep = Math.max(10, Math.floor(Math.min(xRange, zRange) / 25));
        for (let x = Math.max(0, centerX - iw / 2 - denseHalf); x <= Math.min(xRange, centerX - iw / 2 + denseHalf); x += denseStep) {
            for (let z = Math.max(0, centerZ - id_ / 2 - denseHalf); z <= Math.min(zRange, centerZ - id_ / 2 + denseHalf); z += denseStep) {
                addCandidate(x, z);
            }
        }

        // 已放置工件邻接
        for (const p of layerItems) {
            addCandidate(p.x + p.w_algo, p.z);
            addCandidate(p.x - iw, p.z);
            addCandidate(p.x, p.z + p.d_algo);
            addCandidate(p.x, p.z - id_);
            addCandidate(p.x + p.w_algo, p.z + p.d_algo);
            addCandidate(p.x - iw, p.z - id_);
        }

        // 炉壁贴合
        addCandidate(0, 0);
        addCandidate(xRange, 0);
        addCandidate(0, zRange);
        addCandidate(xRange, zRange);

        // 碰撞检测 + 评分
        let bestScore = Infinity;
        let bestPos = null;

        for (const cand of candidates) {
            // 与当前层工件碰撞检测
            let collision = false;
            for (const p of layerItems) {
                if (cand.x + iw > p.x && p.x + p.w_algo > cand.x &&
                    cand.z + id_ > p.z && p.z + p.d_algo > cand.z) {
                    collision = true;
                    break;
                }
            }
            if (collision) continue;

            // 与下层工件碰撞检测（确保不穿透到下层工件体内）
            const belowItems = packedItems.filter(p => p.y < layerBaseY);
            let belowCollision = false;
            for (const p of belowItems) {
                if (p.y + p.h_algo > layerBaseY &&
                    cand.x + iw > p.x && p.x + p.w_algo > cand.x &&
                    cand.z + id_ > p.z && p.z + p.d_algo > cand.z) {
                    belowCollision = true;
                    break;
                }
            }
            if (belowCollision) continue;

            const score = useCG
                ? scoreCGPlacement(cand.x, cand.z, iw, id_, itemWeight, layerItems)
                : (cand.x + cand.z); // 无重心居中时用左上优先的贪心策略

            if (score < bestScore) {
                bestScore = score;
                bestPos = { x: cand.x, z: cand.z };
            }
        }

        return bestPos;
    }

    // ==================== 主循环：外层搁板分层，内层重心居中 ====================
    while (remainingItems.length > 0 && currentY < fh) {
        const layerItems = [];
        let maxItemHeight = 0;
        let layerPlacedAny = false;

        // 内层循环：在当前 Y 层内使用重心居中找最佳 XZ 位置
        for (let i = 0; i < remainingItems.length; i++) {
            const item = remainingItems[i];

            // 重量上限检查
            if (totalWeight + item.weight > max_weight) continue;

            // 垂直高度检查
            const ih = item.h + sp;
            if (currentY + ih > fh) continue;

            // 尺寸检查
            if (item.w > fw || item.h > fh || item.d > fd) continue;

            const iw = item.w + sp;
            const id_ = item.d + sp;

            // 找最佳 XZ 位置
            const placement = findCGXZPlacement(iw, id_, item.weight, layerItems, currentY);
            if (placement !== null) {
                item.x = placement.x;
                item.y = currentY;
                item.z = placement.z;
                item.w_algo = iw;
                item.h_algo = ih;
                item.d_algo = id_;

                layerItems.push({ ...item });
                if (ih > maxItemHeight) maxItemHeight = ih;

                packedItems.push({ ...item });
                totalWeight += item.weight;

                remainingItems.splice(i, 1);
                i--;
                layerPlacedAny = true;
            }
        }

        // 当前层为空 → 退出
        if (!layerPlacedAny) {
            unpacked.push(...remainingItems);
            remainingItems.length = 0;
            break;
        }

        // ===== 搁板逻辑（仅当开启搁板分层时）=====
        if (useShelf) {
            const effectiveHeight = maxItemHeight > 0 ? maxItemHeight : 1;
            const shelfY = currentY + effectiveHeight;

            if (shelfY + shelfThickness < fh) {
                shelvesUsed.push({ y: shelfY, thickness: shelfThickness });
                currentY = shelfY + shelfThickness;
            } else {
                currentY = shelfY;
            }
        } else {
            // 未开启搁板：当前层已满，但仍有垂直空间 → 继续在当前最高工件上方铺设（自然堆叠）
            // 找出 packedItems 中的最高顶面作为新的 currentY
            let maxTop = currentY;
            for (const pi of packedItems) {
                const top = pi.y + pi.h_algo;
                if (top > maxTop) maxTop = top;
            }
            currentY = maxTop;
            // 如果所有工件都放置在同一层底面上方，currentY 会更新为最高工件的顶面
            // 下一轮循环如果有新工件能放在这之上（不碰撞），自然会继续堆叠
        }

        // 重量上限检查
        if (totalWeight >= max_weight) {
            unpacked.push(...remainingItems);
            remainingItems.length = 0;
            break;
        }
    }

    const shelfCount = useShelf ? (shelvesUsed.length + 1) : 1;

    return { packedItems, totalWeight, shelfCount, unpackedItems: unpacked, shelvesUsed };
}

/**
 * 统一多炉膛入口
 */
function solveUnifiedMultiFurnace(furnacePoolInput, itemsInput, spacing) {
    let availableFurnaceInstances = [];
    furnacePoolInput.forEach(f => {
        for (let i = 0; i < f.count; i++) {
            availableFurnaceInstances.push({
                typeName: f.name, instanceId: `${f.name} (炉次 #${i + 1})`,
                w: f.width, h: f.height, d: f.depth, max_weight: f.maxWeight,
                spacing: f.actualSpacing != null ? f.actualSpacing : spacing,
                packedItems: [], totalWeight: 0,
                basketType: f.basketType || 'grid'
            });
        }
    });

    const itemMaterialMap = new Map(), itemProcessMap = new Map();
    let flattenedItems = [];
    itemsInput.forEach(item => {
        let w, h, d;
        if (item.shape === 'cylinder') { w = item.dim1; d = item.dim1; h = item.dim3; }
        else { w = item.dim1; d = item.dim2; h = item.dim3; }
        const allowOpt = placementRules.allowPostureOptimization !== false;
        const optimized = optimizePosture({ shape: item.shape, w, d, h }, allowOpt && item.shape !== 'cylinder');
        let singleWeight = item.count > 0 ? (item.weight / item.count) : 0;
        for (let i = 0; i < item.count; i++) {
            const itemId = `${item.name}_${i}`;
            flattenedItems.push({
                id: itemId, name: item.name, shape: item.shape,
                w: optimized.w, h: optimized.h, d: optimized.d,
                weight: singleWeight, color: item.color,
                material: item.material || '', process: item.process || '',
                rotationInfo: optimized.rotationInfo,
                originalDims: { l: item.dim1, w: item.dim2, h: item.dim3 }
            });
            itemMaterialMap.set(itemId, item.material || '未知材质');
            itemProcessMap.set(itemId, item.process || '未知工艺');
        }
    });

    let completedFurnaces = [];
    for (let furnace of availableFurnaceInstances) {
        if (flattenedItems.length === 0) break;
        const result = solveUnifiedPacking(flattenedItems, furnace, itemMaterialMap, itemProcessMap);
        furnace.packedItems = result.packedItems;
        furnace.totalWeight = result.totalWeight;
        furnace.shelvesUsed = result.shelvesUsed || [];
        if (furnace.packedItems.length > 0) completedFurnaces.push(furnace);
        flattenedItems = result.unpackedItems;
    }

    const aggStats = computeAggregationRates(completedFurnaces, itemMaterialMap, itemProcessMap);
    return { completedFurnaces, unpackedItems: flattenedItems, aggregationStats: aggStats };
}

// ==================== MAIN EXECUTE ENTRY POINT（V2.5：嵌套融合）====================

/**
 * V2.5 修复：搁板分层 + 重心居中 → 嵌套融合，不再是 if-else 互斥关系
 *
 * 决策逻辑：
 *   - 搁板ON 或 重心ON → 使用统一嵌套算法 solveUnifiedMultiFurnace
 *   - 两者都OFF → 使用旧版异构装炉 solveHeterogeneousPacking
 *
 * 旧版 shelf-layered 和 CG-only 入口保留作为回退/兼容，
 * 但主入口通过统一算法处理所有嵌套场景。
 */
export function executePacking(furnacePoolInput, itemsInput, spacing) {
    let result;
    const useShelf = placementRules.useShelfLayered;
    const useCG = placementRules.centerOfGravity;

    if (useShelf || useCG) {
        // V2.5: 统一嵌套算法 — 搁板控制Y分层，重心控制XZ落子
        result = solveUnifiedMultiFurnace(furnacePoolInput, itemsInput, spacing);
    } else {
        // 两者都OFF：使用旧版异构装炉
        result = solveHeterogeneousPacking(furnacePoolInput, itemsInput, spacing);
    }

    // Task 2: 更新全局聚集率统计
    if (result.aggregationStats) {
        setAggregationStats(result.aggregationStats);
    }
    return result;
}