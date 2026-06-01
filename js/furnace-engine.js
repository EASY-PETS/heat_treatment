/**
 * furnace-engine.js - Furnace Loading / Packing Algorithms
 *
 * Purpose:
 *   Contains all furnace loading logic - packing algorithms, utilization calculations,
 *   weight calculations, furnace validation, and optimization logic.
 *   This is the core business module. Future AI optimization work will mainly happen here.
 *
 * Dependencies:
 *   - state.js (placementRules)
 *
 * Future Extension:
 *   - AI optimization (reinforcement learning, genetic algorithms)
 *   - Rule engine integration
 *   - Multi-constraint optimization (cost, time, energy)
 */

import { placementRules } from './state.js';

// ==================== 工件摆放姿态优化 ====================

/**
 * 计算长方体工件的最佳摆放姿态
 * 原则：最小面积面朝下，提高单层利用率
 * 
 * @param {Object} item - 工件对象 {w, h, d, shape}
 * @returns {Object} {w, h, d, orientation} - 调整后的尺寸和姿态描述
 */
function calculateOptimalOrientation(item) {
    // 仅对长方体工件生效，圆柱体保持原逻辑
    if (item.shape === 'cylinder') {
        return {
            w: item.w,
            h: item.h,
            d: item.d,
            orientation: '默认姿态（圆柱体）'
        };
    }

    // 如果未启用旋转规则，保持原始姿态
    if (!placementRules.rotate) {
        return {
            w: item.w,
            h: item.h,
            d: item.d,
            orientation: '默认姿态（未启用旋转）'
        };
    }

    // 计算三个可能的底面面积
    const dims = [
        { w: item.w, h: item.h, d: item.d, area: item.w * item.d, name: 'W×D朝下' },
        { w: item.h, h: item.w, d: item.d, area: item.h * item.d, name: 'H×D朝下（X轴旋转90°）' },
        { w: item.w, h: item.d, d: item.h, area: item.w * item.h, name: 'W×H朝下（Z轴旋转90°）' }
    ];

    // 选择最小面积的姿态
    dims.sort((a, b) => a.area - b.area);
    const optimal = dims[0];

    return {
        w: optimal.w,
        h: optimal.h,
        d: optimal.d,
        orientation: optimal.name,
        bottomArea: optimal.area
    };
}

// ==================== 材质/工艺聚集规则 ====================

/**
 * 根据材质和工艺对工件进行分组排序
 * 优先级：专炉限制 > 工艺一致 > 材质一致 > 空间利用率 > 重量利用率
 * 
 * @param {Array} items - 工件列表
 * @returns {Array} 排序后的工件列表
 */
function sortItemsByClusteringRules(items) {
    // 如果未启用聚集规则，使用默认排序
    if (!placementRules.sameMaterial && !placementRules.sameProcess) {
        return items.sort((a, b) => (b.w_algo * b.d_algo) - (a.w_algo * a.d_algo) || (b.h_algo - a.h_algo));
    }

    // 创建分组键
    const getGroupKey = (item) => {
        const parts = [];
        if (placementRules.sameProcess && item.process) {
            parts.push(`P:${item.process}`);
        }
        if (placementRules.sameMaterial && item.material) {
            parts.push(`M:${item.material}`);
        }
        return parts.length > 0 ? parts.join('|') : 'DEFAULT';
    };

    // 按分组键分组
    const groups = {};
    items.forEach(item => {
        const key = getGroupKey(item);
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    });

    // 对每组内部按体积排序
    Object.values(groups).forEach(group => {
        group.sort((a, b) => (b.w_algo * b.d_algo) - (a.w_algo * a.d_algo) || (b.h_algo - a.h_algo));
    });

    // 按组大小排序（大组优先），然后合并
    const sortedGroups = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    return sortedGroups.flatMap(([key, group]) => group);
}

/**
 * 计算聚集率统计
 * 
 * @param {Array} furnaces - 完成的炉膛列表
 * @returns {Object} {materialClusterRate, processClusterRate}
 */
export function calculateClusteringStats(furnaces) {
    if (!furnaces || furnaces.length === 0) {
        return { materialClusterRate: 0, processClusterRate: 0 };
    }

    let totalMaterialScore = 0;
    let totalProcessScore = 0;
    let totalFurnaces = 0;

    furnaces.forEach(furnace => {
        if (furnace.packedItems.length === 0) return;
        totalFurnaces++;

        // 材质聚集率：同一炉中相同材质的比例
        const materialGroups = {};
        furnace.packedItems.forEach(item => {
            const mat = item.material || 'UNKNOWN';
            materialGroups[mat] = (materialGroups[mat] || 0) + 1;
        });
        const maxMaterialCount = Math.max(...Object.values(materialGroups));
        const materialRate = maxMaterialCount / furnace.packedItems.length;
        totalMaterialScore += materialRate;

        // 工艺聚集率：同一炉中相同工艺的比例
        const processGroups = {};
        furnace.packedItems.forEach(item => {
            const proc = item.process || 'UNKNOWN';
            processGroups[proc] = (processGroups[proc] || 0) + 1;
        });
        const maxProcessCount = Math.max(...Object.values(processGroups));
        const processRate = maxProcessCount / furnace.packedItems.length;
        totalProcessScore += processRate;
    });

    return {
        materialClusterRate: totalFurnaces > 0 ? (totalMaterialScore / totalFurnaces * 100).toFixed(1) : 0,
        processClusterRate: totalFurnaces > 0 ? (totalProcessScore / totalFurnaces * 100).toFixed(1) : 0
    };
}

// ==================== HETEROGENEOUS SPACE-FILLING PACKING ====================

/**
 * Default heterogeneous 3D bin packing algorithm.
 * Uses a simple space-filling approach: sorts items by volume, iterates through
 * furnaces, places items into free spaces using 3-way space subdivision.
 *
 * Inputs:
 *   - furnacePoolInput: array of furnace configs [{name, count, width, height, depth, maxWeight, actualSpacing}]
 *   - itemsInput: array of material configs [{name, shape, count, dim1, dim2, dim3, weight, color}]
 *   - spacing: global spacing in mm
 *
 * Outputs:
 *   - { completedFurnaces: [], unpackedItems: [] }
 */
export function solveHeterogeneousPacking(furnacePoolInput, itemsInput, spacing) {
    let availableFurnaceInstances = [];
    furnacePoolInput.forEach(f => {
        for (let i = 0; i < f.count; i++) {
            availableFurnaceInstances.push({
                typeName: f.name,
                instanceId: `${f.name} (炉次 #${i + 1})`,
                w: f.width, h: f.height, d: f.depth, max_weight: f.maxWeight,
                spacing: f.actualSpacing !== null && f.actualSpacing !== undefined ? f.actualSpacing : spacing,
                packedItems: [], totalWeight: 0,
                emptySpaces: [{ x: 0, y: 0, z: 0, w: f.width, h: f.height, d: f.depth }]
            });
        }
    });

    availableFurnaceInstances.sort((a, b) => (b.w * b.h * b.d) - (a.w * a.h * a.d));

    let flattenedItems = [];
    itemsInput.forEach(item => {
        let w, h, d;
        if (item.shape === 'cylinder') { w = item.dim1; d = item.dim1; h = item.dim3; }
        else { w = item.dim1; d = item.dim2; h = item.dim3; }
        let singleWeight = item.count > 0 ? (item.weight / item.count) : 0;
        for (let i = 0; i < item.count; i++) {
            // 计算最佳摆放姿态
            const oriented = calculateOptimalOrientation({ w, h, d, shape: item.shape });
            
            flattenedItems.push({
                id: `${item.name}_${i}`, name: item.name, shape: item.shape,
                w_algo: oriented.w + spacing, h_algo: oriented.h + spacing, d_algo: oriented.d + spacing,
                w: oriented.w, h: oriented.h, d: oriented.d, 
                weight: singleWeight, color: item.color,
                material: item.material || '',
                process: item.process || '',
                orientation: oriented.orientation,
                bottomArea: oriented.bottomArea
            });
        }
    });

    // 应用聚集规则排序
    flattenedItems = sortItemsByClusteringRules(flattenedItems);

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
    return { completedFurnaces, unpackedItems: flattenedItems };
}

// ==================== SHELF-LAYERED PACKING ====================

/**
 * Shelf-Layered 3D Bin Packing algorithm.
 *
 * Strategy:
 *   1. Sort items by weight (desc) → volume (desc)  (heavy + large prioritized)
 *   2. Bottom layer: 2D tile placement at Z=0
 *   3. Dynamic first shelf height = max(item heights in layer 1)
 *   4. Subsequent shelves use configured fixed shelfHeight
 *   5. Loop until all items placed or furnace limits reached
 *
 * @param {Array} items - flattened item list [{w, h, d, weight, color, name, shape, id, ...}]
 * @param {Object} furnaceConfig - {w, h, d, max_weight, spacing}
 * @param {number} customShelfHeight - fixed shelf height for layers 2+ (mm)
 * @returns {{ packedItems, totalWeight, shelfCount, unpackedItems }}
 */
export function solveShelfLayeredPacking(items, furnaceConfig, customShelfHeight) {
    const { w: fw, h: fh, d: fd, max_weight, spacing: sp } = furnaceConfig;

    const packedItems = [];
    let totalWeight = 0;
    let currentY = 0;
    const unpacked = [];
    let shelfCount = 0;

    // Sort: weight desc → volume desc
    const sortedItems = [...items].sort((a, b) => {
        if (a.weight !== b.weight) return b.weight - a.weight;
        const volA = a.w * a.h * a.d;
        const volB = b.w * b.h * b.d;
        return volB - volA;
    });

    /**
     * 2D placement finder on a shelf plane (X-Z).
     * Uses greedy row-scanning with collision detection.
     * @returns {{ x: number, z: number } | null}
     */
    function find2DPlacement(itemW, itemD, shelfY, shelfItems) {
        if (shelfItems.length === 0) {
            if (itemW <= fw && itemD <= fd) return { x: 0, z: 0 };
            return null;
        }

        const xCandidates = [0];
        shelfItems.forEach(si => {
            const rightX = si.x + si.w_algo;
            if (rightX <= fw) xCandidates.push(rightX);
        });
        const uniqueX = [...new Set(xCandidates)].sort((a, b) => a - b);

        for (const tryX of uniqueX) {
            if (tryX + itemW > fw) continue;

            let minZ = 0;
            let changed = true;
            while (changed) {
                changed = false;
                for (const si of shelfItems) {
                    if (tryX + itemW > si.x && si.x + si.w_algo > tryX) {
                        if (minZ + itemD > si.z && si.z + si.d_algo > minZ) {
                            const newZ = si.z + si.d_algo;
                            if (newZ > minZ) { minZ = newZ; changed = true; }
                        }
                    }
                }
            }

            if (minZ + itemD <= fd) return { x: tryX, z: minZ };
        }
        return null;
    }

    /**
     * Pack a single shelf layer.
     * @returns {{ maxItemHeight, shelfItems, skippedItems }}
     */
    function packShelfLayer(shelfY, remainingItems) {
        const shelfItems = [];
        let maxItemHeight = 0;
        let placedSomething = true;
        const skippedItems = [];

        while (placedSomething && remainingItems.length > 0) {
            placedSomething = false;
            for (let i = 0; i < remainingItems.length; i++) {
                const item = remainingItems[i];

                if (totalWeight + item.weight > max_weight) {
                    skippedItems.push(...remainingItems.splice(i, 1));
                    i--;
                    continue;
                }

                const itemTopY = shelfY + (item.h + sp);
                if (itemTopY > fh) {
                    skippedItems.push(...remainingItems.splice(i, 1));
                    i--;
                    continue;
                }

                const itemW = item.w + sp;
                const itemH = item.h + sp;
                const itemD = item.d + sp;

                if (item.w > fw || item.h > fh || item.d > fd) {
                    console.warn(`[搁板分层算法] 物料 "${item.name}" 尺寸超出炉膛，已跳过`);
                    skippedItems.push(...remainingItems.splice(i, 1));
                    i--;
                    continue;
                }

                if (shelfCount >= 2 && customShelfHeight > 0 && itemH > customShelfHeight) {
                    console.warn(`[搁板分层算法] 物料 "${item.name}" 高度超过搁板层高(${customShelfHeight}mm)，已跳过`);
                    skippedItems.push(...remainingItems.splice(i, 1));
                    i--;
                    continue;
                }

                const placement = find2DPlacement(itemW, itemD, shelfY, shelfItems);
                if (placement !== null) {
                    item.x = placement.x;
                    item.y = shelfY;
                    item.z = placement.z;
                    item.w_algo = itemW;
                    item.h_algo = itemH;
                    item.d_algo = itemD;

                    shelfItems.push({ ...item });
                    if (itemH > maxItemHeight) maxItemHeight = itemH;
                    packedItems.push({ ...item });
                    totalWeight += item.weight;
                    remainingItems.splice(i, 1);
                    i--;
                    placedSomething = true;
                }
            }
        }

        return { maxItemHeight, shelfItems, skippedItems };
    }

    // Main loop: layer-by-layer packing
    const remainingItems = [...sortedItems];

    while (remainingItems.length > 0) {
        shelfCount++;
        if (currentY >= fh) {
            console.warn(`[搁板分层算法] 已达到炉膛最大高度(${fh}mm)`);
            unpacked.push(...remainingItems);
            break;
        }

        const layerResult = packShelfLayer(currentY, remainingItems);

        if (layerResult.skippedItems && layerResult.skippedItems.length > 0) {
            unpacked.push(...layerResult.skippedItems);
        }

        if (layerResult.shelfItems.length === 0 && remainingItems.length > 0) {
            const maxRemainingH = Math.max(...remainingItems.map(it => it.h + sp));
            if (currentY + maxRemainingH > fh) {
                unpacked.push(...remainingItems);
                remainingItems.length = 0;
                break;
            }
            currentY += maxRemainingH;
            continue;
        }

        if (shelfCount === 1) {
            currentY += layerResult.maxItemHeight > 0 ? layerResult.maxItemHeight : 1;
        } else {
            const shelfH = (customShelfHeight > 0) ? customShelfHeight : layerResult.maxItemHeight;
            if (shelfH <= 0) {
                unpacked.push(...remainingItems);
                remainingItems.length = 0;
                break;
            }
            currentY += shelfH;
        }

        if (totalWeight >= max_weight) {
            console.warn(`[搁板分层算法] 达到最大承重(${max_weight}kg)`);
            unpacked.push(...remainingItems);
            remainingItems.length = 0;
            break;
        }
    }

    return { packedItems, totalWeight, shelfCount, unpackedItems: unpacked };
}

/**
 * Multi-furnace wrapper for shelf-layered packing.
 */
export function solveShelfLayeredMultiFurnace(furnacePoolInput, itemsInput, spacing, shelfHeight) {
    let availableFurnaceInstances = [];
    furnacePoolInput.forEach(f => {
        for (let i = 0; i < f.count; i++) {
            availableFurnaceInstances.push({
                typeName: f.name,
                instanceId: `${f.name} (炉次 #${i + 1})`,
                w: f.width, h: f.height, d: f.depth, max_weight: f.maxWeight,
                spacing: f.actualSpacing !== null && f.actualSpacing !== undefined ? f.actualSpacing : spacing,
                packedItems: [], totalWeight: 0
            });
        }
    });
    availableFurnaceInstances.sort((a, b) => (b.w * b.h * b.d) - (a.w * a.h * a.d));

    let flattenedItems = [];
    itemsInput.forEach(item => {
        let w, h, d;
        if (item.shape === 'cylinder') { w = item.dim1; d = item.dim1; h = item.dim3; }
        else { w = item.dim1; d = item.dim2; h = item.dim3; }
        let singleWeight = item.count > 0 ? (item.weight / item.count) : 0;
        for (let i = 0; i < item.count; i++) {
            // 计算最佳摆放姿态
            const oriented = calculateOptimalOrientation({ w, h, d, shape: item.shape });
            
            flattenedItems.push({
                id: `${item.name}_${i}`, name: item.name, shape: item.shape,
                w: oriented.w, h: oriented.h, d: oriented.d, 
                weight: singleWeight, color: item.color,
                material: item.material || '',
                process: item.process || '',
                orientation: oriented.orientation,
                bottomArea: oriented.bottomArea
            });
        }
    });

    let completedFurnaces = [];
    for (let furnace of availableFurnaceInstances) {
        if (flattenedItems.length === 0) break;
        const result = solveShelfLayeredPacking(flattenedItems, furnace, shelfHeight);
        furnace.packedItems = result.packedItems;
        furnace.totalWeight = result.totalWeight;
        if (furnace.packedItems.length > 0) completedFurnaces.push(furnace);
        flattenedItems = result.unpackedItems;
    }

    return { completedFurnaces, unpackedItems: flattenedItems };
}

// ==================== CENTER-OF-GRAVITY PACKING ====================

/**
 * Center-of-Gravity Packing Algorithm.
 *
 * Strategy:
 *   1. Sort items by weight (desc) — heaviest first
 *   2. First (heaviest) item placed at furnace bottom center
 *   3. Each subsequent item: evaluate all emptySpaces, for each space evaluate:
 *      a) Corner position (original behavior)
 *      b) Ideal center-of-gravity position (clamped to space bounds)
 *   4. Choose position minimizing weighted Euclidean distance from furnace center
 *   5. AABB collision avoidance using emptySpaces subdivision
 *
 * Score = dx² + 0.25*dy² + dz²   (Y direction weighted less — vertical tolerance)
 */
export function solveCenterOfGravityPacking(items, furnaceConfig) {
    const { w: fw, h: fh, d: fd, max_weight, spacing: sp } = furnaceConfig;
    const centerX = fw / 2;
    const centerY = fh / 2;
    const centerZ = fd / 2;

    const packedItems = [];
    let totalWeight = 0;
    let emptySpaces = [{ x: 0, y: 0, z: 0, w: fw, h: fh, d: fd }];
    const unpacked = [];

    const sortedItems = [...items].sort((a, b) => b.weight - a.weight);

    function computeCenterOfGravity(existingItems, newItem) {
        let sumMx = 0, sumMy = 0, sumMz = 0, sumM = 0;
        existingItems.forEach(item => {
            const wgt = item.weight;
            const cx = item.x + item.w / 2;
            const cy = item.y + item.h / 2;
            const cz = item.z + item.d / 2;
            sumMx += wgt * cx;
            sumMy += wgt * cy;
            sumMz += wgt * cz;
            sumM += wgt;
        });
        if (newItem) {
            const wgt = newItem.weight;
            const cx = newItem.x + newItem.w / 2;
            const cy = newItem.y + newItem.h / 2;
            const cz = newItem.z + newItem.d / 2;
            sumMx += wgt * cx;
            sumMy += wgt * cy;
            sumMz += wgt * cz;
            sumM += wgt;
        }
        if (sumM === 0) return { cgx: centerX, cgy: centerY, cgz: centerZ };
        return { cgx: sumMx / sumM, cgy: sumMy / sumM, cgz: sumMz / sumM };
    }

    function calcCGScore(cgx, cgy, cgz) {
        const dx = cgx - centerX;
        const dy = cgy - centerY;
        const dz = cgz - centerZ;
        return dx * dx + 0.25 * dy * dy + dz * dz;
    }

    for (let i = 0; i < sortedItems.length; i++) {
        const item = sortedItems[i];

        if (totalWeight + item.weight > max_weight) { unpacked.push(item); continue; }

        const iw = item.w + sp;
        const ih = item.h + sp;
        const id_ = item.d + sp;

        if (item.w > fw || item.h > fh || item.d > fd) {
            console.warn(`[重心居中算法] 物料 "${item.name}" 尺寸超出炉膛，已跳过`);
            unpacked.push(item);
            continue;
        }

        let bestScore = Infinity;
        let bestSpaceIdx = -1;
        const candidates = [];

        for (let j = 0; j < emptySpaces.length; j++) {
            const s = emptySpaces[j];
            if (iw <= s.w && ih <= s.h && id_ <= s.d) {
                // Candidate A: corner position
                const candidateItemA = { ...item, x: s.x, y: s.y, z: s.z };
                const cgA = computeCenterOfGravity(packedItems, candidateItemA);
                const scoreA = calcCGScore(cgA.cgx, cgA.cgy, cgA.cgz);

                let bestLocalScore = scoreA;
                let bestLocalX = s.x;
                let bestLocalY = s.y;
                let bestLocalZ = s.z;

                // Candidate B: ideal center-of-gravity position
                if (packedItems.length > 0 && item.weight > 0) {
                    const existingCG = computeCenterOfGravity(packedItems, null);
                    const M = totalWeight;
                    const m = item.weight;
                    const totalMass = M + m;

                    const cx_target = totalMass > 0
                        ? (centerX * totalMass - existingCG.cgx * M) / m
                        : centerX;
                    const cz_target = totalMass > 0
                        ? (centerZ * totalMass - existingCG.cgz * M) / m
                        : centerZ;

                    const idealX = cx_target - iw / 2;
                    const idealZ = cz_target - id_ / 2;
                    const clampedX = Math.max(s.x, Math.min(s.x + s.w - iw, idealX));
                    const clampedZ = Math.max(s.z, Math.min(s.z + s.d - id_, idealZ));
                    const clampedY = s.y;

                    const candidateItemB = { ...item, x: clampedX, y: clampedY, z: clampedZ };
                    const cgB = computeCenterOfGravity(packedItems, candidateItemB);
                    const scoreB = calcCGScore(cgB.cgx, cgB.cgy, cgB.cgz);

                    if (scoreB < bestLocalScore) {
                        bestLocalScore = scoreB;
                        bestLocalX = clampedX;
                        bestLocalY = clampedY;
                        bestLocalZ = clampedZ;
                    }
                }

                candidates.push({ spaceIdx: j, x: bestLocalX, y: bestLocalY, z: bestLocalZ, score: bestLocalScore });

                if (bestLocalScore < bestScore) { bestScore = bestLocalScore; bestSpaceIdx = j; }
            }
        }

        if (bestSpaceIdx < 0) { unpacked.push(item); continue; }

        const chosenSpace = emptySpaces[bestSpaceIdx];
        const bestCandidate = candidates.find(c => c.spaceIdx === bestSpaceIdx);
        if (bestCandidate) {
            item.x = bestCandidate.x;
            item.y = bestCandidate.y;
            item.z = bestCandidate.z;
        } else {
            item.x = chosenSpace.x;
            item.y = chosenSpace.y;
            item.z = chosenSpace.z;
        }
        item.w_algo = iw;
        item.h_algo = ih;
        item.d_algo = id_;

        packedItems.push({ ...item });
        totalWeight += item.weight;

        let currentSpaces = [...emptySpaces];
        currentSpaces.splice(bestSpaceIdx, 1);
        const s = chosenSpace;
        const remainW = s.w - iw, remainH = s.h - ih, remainD = s.d - id_;
        if (remainW > 0) currentSpaces.push({ x: s.x + iw, y: s.y, z: s.z, w: remainW, h: s.h, d: s.d });
        if (remainD > 0) currentSpaces.push({ x: s.x, y: s.y, z: s.z + id_, w: iw, h: s.h, d: remainD });
        if (remainH > 0) currentSpaces.push({ x: s.x, y: s.y + ih, z: s.z, w: iw, h: remainH, d: id_ });
        currentSpaces.sort((a, b) => (a.y - b.y) || (a.z - b.z) || (a.x - b.x));
        emptySpaces = currentSpaces;
    }

    return { packedItems, totalWeight, unpackedItems: unpacked };
}

/**
 * Multi-furnace wrapper for center-of-gravity packing.
 */
export function solveCenterOfGravityMultiFurnace(furnacePoolInput, itemsInput, spacing) {
    let availableFurnaceInstances = [];
    furnacePoolInput.forEach(f => {
        for (let i = 0; i < f.count; i++) {
            availableFurnaceInstances.push({
                typeName: f.name,
                instanceId: `${f.name} (炉次 #${i + 1})`,
                w: f.width, h: f.height, d: f.depth, max_weight: f.maxWeight,
                spacing: f.actualSpacing !== null && f.actualSpacing !== undefined ? f.actualSpacing : spacing,
                packedItems: [], totalWeight: 0
            });
        }
    });
    availableFurnaceInstances.sort((a, b) => (b.w * b.h * b.d) - (a.w * a.h * a.d));

    let flattenedItems = [];
    itemsInput.forEach(item => {
        let w, h, d;
        if (item.shape === 'cylinder') { w = item.dim1; d = item.dim1; h = item.dim3; }
        else { w = item.dim1; d = item.dim2; h = item.dim3; }
        let singleWeight = item.count > 0 ? (item.weight / item.count) : 0;
        for (let i = 0; i < item.count; i++) {
            // 计算最佳摆放姿态
            const oriented = calculateOptimalOrientation({ w, h, d, shape: item.shape });
            
            flattenedItems.push({
                id: `${item.name}_${i}`, name: item.name, shape: item.shape,
                w: oriented.w, h: oriented.h, d: oriented.d, 
                weight: singleWeight, color: item.color,
                material: item.material || '',
                process: item.process || '',
                orientation: oriented.orientation,
                bottomArea: oriented.bottomArea
            });
        }
    });

    let completedFurnaces = [];
    let allUnpacked = [];
    for (let furnace of availableFurnaceInstances) {
        if (flattenedItems.length === 0) break;
        const result = solveCenterOfGravityPacking(flattenedItems, furnace);
        furnace.packedItems = result.packedItems;
        furnace.totalWeight = result.totalWeight;
        if (furnace.packedItems.length > 0) completedFurnaces.push(furnace);
        flattenedItems = result.unpackedItems;
    }
    allUnpacked = flattenedItems;
    return { completedFurnaces, unpackedItems: allUnpacked };
}

// ==================== MAIN EXECUTE ENTRY POINT ====================

/**
 * Main packing execute function.
 * Routes to the appropriate algorithm based on placementRules.
 *
 * @param {Array} furnacePoolInput
 * @param {Array} itemsInput
 * @param {number} spacing
 * @returns {{ completedFurnaces, unpackedItems }}
 */
export function executePacking(furnacePoolInput, itemsInput, spacing) {
    let result;
    if (placementRules.useShelfLayered) {
        const shelfHeight = placementRules.shelfHeight || 100;
        result = solveShelfLayeredMultiFurnace(furnacePoolInput, itemsInput, spacing, shelfHeight);
    } else if (placementRules.centerOfGravity) {
        result = solveCenterOfGravityMultiFurnace(furnacePoolInput, itemsInput, spacing);
    } else {
        result = solveHeterogeneousPacking(furnacePoolInput, itemsInput, spacing);
    }
    return result;
}