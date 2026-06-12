// plan-analysis.js

export function analyzeFurnaces(furnaces = [], unpackedItems = [], predictions = []) {
    let totalWeight = 0;
    let totalMaxWeight = 0;
    let totalPackedVolume = 0;
    let totalFurnaceVolume = 0;
    let totalItems = 0;
    let totalShelves = 0;
    let maxLayerCount = 1;

    furnaces.forEach(f => {
        const items = f.packedItems || [];
        totalItems += items.length;
        totalWeight += f.totalWeight || f.totalWeightKg || 0;
        totalMaxWeight += f.max_weight || f.maxWeightKg || 0;

        const fw = f.w || f.dimensions?.width || 0;
        const fh = f.h || f.dimensions?.height || 0;
        const fd = f.d || f.dimensions?.depth || 0;

        totalFurnaceVolume += fw * fh * fd;

        items.forEach(item => {
            const w = item.w || item.size?.width || 0;
            const h = item.h || item.size?.height || 0;
            const d = item.d || item.size?.depth || 0;
            totalPackedVolume += w * h * d;
        });

        const shelves = f.shelvesUsed || [];
        totalShelves += shelves.length;

        if (shelves.length > 0) {
            maxLayerCount = Math.max(maxLayerCount, shelves.length + 1);
        }
    });

    const spaceUtilization = totalFurnaceVolume > 0
        ? totalPackedVolume / totalFurnaceVolume
        : 0;

    const weightUtilization = totalMaxWeight > 0
        ? totalWeight / totalMaxWeight
        : 0;

    const estimatedKwh = predictions.reduce((sum, p) => {
        return sum + (p.powerConsumption?.estimatedKwh || 0);
    }, 0);

    const nitrogenNm3 = predictions.reduce((sum, p) => {
        return sum + (p.gasConsumption?.nitrogenNm3 || 0);
    }, 0);

    const qualityScores = predictions
        .map(p => p.qualityRisk?.score)
        .filter(v => typeof v === 'number');

    const qualityScore = qualityScores.length > 0
        ? qualityScores.reduce((s, v) => s + v, 0) / qualityScores.length
        : null;

    const compositeScore = Math.round(
        Math.min(spaceUtilization * 100, 100) * 0.35 +
        Math.min(weightUtilization * 100, 100) * 0.15 +
        (qualityScore || 80) * 0.30 +
        (unpackedItems.length === 0 ? 100 : 60) * 0.20
    );

    const recommendations = [];
    let status = '可执行';
    let bottleneck = '无明显瓶颈';

    if (unpackedItems.length > 0) {
        status = '不可执行';

        if (weightUtilization >= 0.95 && spaceUtilization < 0.3) {
            bottleneck = '承重不足';
            recommendations.push('当前重量利用率已接近上限，但空间利用率较低，说明主要瓶颈是承重，不是空间。');
            recommendations.push('建议增加炉次数量，或选择承重更高的工装。');
            recommendations.push('可将当前订单拆分为多炉次处理。');
        } else if (spaceUtilization >= 0.85) {
            bottleneck = '空间不足';
            recommendations.push('当前空间利用率较高，说明主要瓶颈是有效装载空间。');
            recommendations.push('建议增加料框数量，或调整摆放策略为“空间利用率优先”。');
        } else {
            bottleneck = '工装数量不足或规则限制';
            recommendations.push('当前仍有未装工件，但空间和重量均未充分使用，可能是工装数量不足、规则限制或物料尺寸约束导致。');
            recommendations.push('建议检查安全间距、搁板分层、姿态优化和工装类型。');
        }
    }

    if (totalShelves > 0) {
        recommendations.push(`当前使用 ${totalShelves} 块搁板，最大 ${maxLayerCount} 层，请确认现场工装是否支持该层数。`);
    }

    if (qualityScore !== null && qualityScore < 75) {
        recommendations.push('质量评分偏低，建议检查热场均匀性、物料聚集区域和高风险遮挡区域。');
    }

    return {
        furnaceCount: furnaces.length,
        totalItems,
        unpackedCount: unpackedItems.length,
        totalWeight,
        totalShelves,
        maxLayerCount,
        spaceUtilization,
        weightUtilization,
        estimatedKwh,
        nitrogenNm3,
        qualityScore,
        compositeScore,
        status,
        bottleneck,
        recommendations
    };
}