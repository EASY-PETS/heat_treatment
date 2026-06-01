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

// ==================== SHELF-LAYERED PACKING（V2.0: 搁板厚度 + 聚集 + 姿态优化）====================

export function solveShelfLayeredPacking(items, furnaceConfig, customShelfHeight, itemMaterialMap, itemProcessMap) {
    const { w: fw, h: fh, d: fd, max_weight, spacing: sp } = furnaceConfig;
    const shelfThickness = placementRules.shelfThickness || 20;  // Task 4: 搁板实体厚度

    const packedItems = [];
    let totalWeight = 0, currentY = 0, shelfCount = 0;
    const unpacked = [], shelvesUsed = [];

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
        if (a.weight !== b.weight) return b.weight - a.weight;
        return (b.w * b.h * b.d) - (a.w * a.h * a.d);
    });

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
            if (minZ + itemD <= fd) return { x: tryX, z: minZ };
        }
        return null;
    }

    function packShelfLayer(shelfY, remainingItems) {
        const shelfItems = [];
        let maxItemHeight = 0, placedSomething = true;
        const skippedItems = [];
        while (placedSomething && remainingItems.length > 0) {
            placedSomething = false;
            for (let i = 0; i < remainingItems.length; i++) {
                const item = remainingItems[i];
                if (totalWeight + item.weight > max_weight) {
                    skippedItems.push(...remainingItems.splice(i, 1)); i--; continue;
                }
                if (shelfY + item.h + sp > fh) {
                    skippedItems.push(...remainingItems.splice(i, 1)); i--; continue;
                }
                const iw = item.w + sp, ih = item.h + sp, id_ = item.d + sp;
                if (item.w > fw || item.h > fh || item.d > fd) {
                    skippedItems.push(...remainingItems.splice(i, 1)); i--; continue;
                }
                if (shelfCount >= 2 && customShelfHeight > 0 && ih > customShelfHeight) {
                    skippedItems.push(...remainingItems.splice(i, 1)); i--; continue;
                }
                const placement = find2DPlacement(iw, id_, shelfItems);
                if (placement !== null) {
                    item.x = placement.x; item.y = shelfY; item.z = placement.z;
                    item.w_algo = iw; item.h_algo = ih; item.d_algo = id_;
                    shelfItems.push({ ...item });
                    if (ih > maxItemHeight) maxItemHeight = ih;
                    packedItems.push({ ...item });
                    totalWeight += item.weight;
                    remainingItems.splice(i, 1); i--;
                    placedSomething = true;
                }
            }
        }
        return { maxItemHeight, shelfItems, skippedItems };
    }

    const remainingItems = [...sortedItems];
    while (remainingItems.length > 0) {
        shelfCount++;
        if (currentY >= fh) { unpacked.push(...remainingItems); break; }
        const layerResult = packShelfLayer(currentY, remainingItems);
        if (layerResult.skippedItems.length > 0) unpacked.push(...layerResult.skippedItems);
        if (layerResult.shelfItems.length === 0 && remainingItems.length > 0) {
            const maxRH = Math.max(...remainingItems.map(it => it.h + sp));
            if (currentY + maxRH + shelfThickness > fh) { unpacked.push(...remainingItems); remainingItems.length = 0; break; }
            currentY += maxRH + shelfThickness;
            shelvesUsed.push({ y: currentY - shelfThickness, thickness: shelfThickness });
            continue;
        }
        if (shelfCount === 1) {
            currentY += layerResult.maxItemHeight > 0 ? layerResult.maxItemHeight : 1;
        } else {
            currentY += shelfThickness;
            shelvesUsed.push({ y: currentY - shelfThickness, thickness: shelfThickness });
            const sh = (customShelfHeight > 0) ? customShelfHeight : layerResult.maxItemHeight;
            if (sh <= 0) { unpacked.push(...remainingItems); remainingItems.length = 0; break; }
            currentY += sh;
        }
        if (totalWeight >= max_weight) { unpacked.push(...remainingItems); remainingItems.length = 0; break; }
    }

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

// ==================== CENTER-OF-GRAVITY PACKING（V2.0）====================

export function solveCenterOfGravityPacking(items, furnaceConfig, itemMaterialMap, itemProcessMap) {
    const { w: fw, h: fh, d: fd, max_weight, spacing: sp } = furnaceConfig;
    const centerX = fw / 2, centerY = fh / 2, centerZ = fd / 2;
    const packedItems = [];
    let totalWeight = 0;
    let emptySpaces = [{ x: 0, y: 0, z: 0, w: fw, h: fh, d: fd }];
    const unpacked = [];

    const sameMaterial = placementRules.sameMaterial, sameProcess = placementRules.sameProcess;
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

    function computeCenterOfGravity(existing, newIt) {
        let smx = 0, smy = 0, smz = 0, sm = 0;
        existing.forEach(it => {
            const wgt = it.weight;
            smx += wgt * (it.x + it.w / 2);
            smy += wgt * (it.y + it.h / 2);
            smz += wgt * (it.z + it.d / 2);
            sm += wgt;
        });
        if (newIt) {
            const wgt = newIt.weight;
            smx += wgt * (newIt.x + newIt.w / 2);
            smy += wgt * (newIt.y + newIt.h / 2);
            smz += wgt * (newIt.z + newIt.d / 2);
            sm += wgt;
        }
        return sm === 0 ? { cgx: centerX, cgy: centerY, cgz: centerZ }
            : { cgx: smx / sm, cgy: smy / sm, cgz: smz / sm };
    }

    function calcCGScore(cgx, cgy, cgz) {
        return (cgx - centerX) ** 2 + 0.25 * (cgy - centerY) ** 2 + (cgz - centerZ) ** 2;
    }

    for (let i = 0; i < sortedItems.length; i++) {
        const item = sortedItems[i];
        if (totalWeight + item.weight > max_weight) { unpacked.push(item); continue; }
        const iw = item.w + sp, ih = item.h + sp, id_ = item.d + sp;
        if (item.w > fw || item.h > fh || item.d > fd) { unpacked.push(item); continue; }

        let bestScore = Infinity, bestSpaceIdx = -1;
        const candidates = [];

        for (let j = 0; j < emptySpaces.length; j++) {
            const s = emptySpaces[j];
            if (iw <= s.w && ih <= s.h && id_ <= s.d) {
                const cgA = computeCenterOfGravity(packedItems, { ...item, x: s.x, y: s.y, z: s.z });
                let bestLocalScore = calcCGScore(cgA.cgx, cgA.cgy, cgA.cgz);
                let bestLX = s.x, bestLY = s.y, bestLZ = s.z;

                if (packedItems.length > 0 && item.weight > 0) {
                    const existingCG = computeCenterOfGravity(packedItems, null);
                    const M = totalWeight, m = item.weight, totalMass = M + m;
                    const cx_target = totalMass > 0 ? (centerX * totalMass - existingCG.cgx * M) / m : centerX;
                    const cz_target = totalMass > 0 ? (centerZ * totalMass - existingCG.cgz * M) / m : centerZ;
                    const clampedX = Math.max(s.x, Math.min(s.x + s.w - iw, cx_target - iw / 2));
                    const clampedZ = Math.max(s.z, Math.min(s.z + s.d - id_, cz_target - id_ / 2));
                    const cgB = computeCenterOfGravity(packedItems, { ...item, x: clampedX, y: s.y, z: clampedZ });
                    const scoreB = calcCGScore(cgB.cgx, cgB.cgy, cgB.cgz);
                    if (scoreB < bestLocalScore) { bestLocalScore = scoreB; bestLX = clampedX; bestLZ = clampedZ; }
                }

                candidates.push({ spaceIdx: j, x: bestLX, y: bestLY, z: bestLZ, score: bestLocalScore });
                if (bestLocalScore < bestScore) { bestScore = bestLocalScore; bestSpaceIdx = j; }
            }
        }

        if (bestSpaceIdx < 0) { unpacked.push(item); continue; }

        const chosenSpace = emptySpaces[bestSpaceIdx];
        const bestCand = candidates.find(c => c.spaceIdx === bestSpaceIdx);
        item.x = bestCand ? bestCand.x : chosenSpace.x;
        item.y = bestCand ? bestCand.y : chosenSpace.y;
        item.z = bestCand ? bestCand.z : chosenSpace.z;
        item.w_algo = iw; item.h_algo = ih; item.d_algo = id_;

        packedItems.push({ ...item });
        totalWeight += item.weight;

        let currentSpaces = [...emptySpaces];
        currentSpaces.splice(bestSpaceIdx, 1);
        const s = chosenSpace;
        const rw = s.w - iw, rh = s.h - ih, rd = s.d - id_;
        if (rw > 0) currentSpaces.push({ x: s.x + iw, y: s.y, z: s.z, w: rw, h: s.h, d: s.d });
        if (rd > 0) currentSpaces.push({ x: s.x, y: s.y, z: s.z + id_, w: iw, h: s.h, d: rd });
        if (rh > 0) currentSpaces.push({ x: s.x, y: s.y + ih, z: s.z, w: iw, h: rh, d: id_ });
        currentSpaces.sort((a, b) => (a.y - b.y) || (a.z - b.z) || (a.x - b.x));
        emptySpaces = currentSpaces;
    }

    return { packedItems, totalWeight, unpackedItems: unpacked };
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

// ==================== MAIN EXECUTE ENTRY POINT（V2.0）====================

export function executePacking(furnacePoolInput, itemsInput, spacing) {
    let result;
    if (placementRules.useShelfLayered) {
        result = solveShelfLayeredMultiFurnace(furnacePoolInput, itemsInput, spacing, placementRules.shelfHeight || 100);
    } else if (placementRules.centerOfGravity) {
        result = solveCenterOfGravityMultiFurnace(furnacePoolInput, itemsInput, spacing);
    } else {
        result = solveHeterogeneousPacking(furnacePoolInput, itemsInput, spacing);
    }
    // Task 2: 更新全局聚集率统计
    if (result.aggregationStats) {
        setAggregationStats(result.aggregationStats);
    }
    return result;
}