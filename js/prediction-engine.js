/**
 * prediction-engine.js — 综合效益预测引擎（V5.0 P0）
 *
 * 在生成装炉方案的瞬间（无需耗时的物理仿真），基于统计学与物理公式输出预估效益。
 *
 * 三大预测维度:
 *   1. 电力消耗预估 — 设备基础热损耗 + 升温有效热吸收
 *   2. 气体能耗预估 — 基于炉膛空置率计算回填保护气体需求
 *   3. 质量安全评分 — 基于热辐射遮挡率、垂直叠放压伤风险、循环气流阻力
 *
 * 设计原则:
 *   - 所有函数为纯函数，仅接收参数返回结果，不依赖任何全局状态
 *   - 可独立于现有代码进行单元测试
 *
 * Dependencies: 无（零外部依赖）
 */

// ==================== 物理常数 ====================

/** 钢材比热容 — 单位: kJ/(kg·℃)，取中碳合金钢典型值 */
const STEEL_SPECIFIC_HEAT = 0.49;

/** 基础热损耗系数 — 单位: kW，炉膛每立方米体积的基础散热功率 */
const BASE_HEAT_LOSS_PER_CUBIC_METER = 12.5;

/** 升温阶段设备效率系数（0-1），电热转换 + 炉壁吸热损耗 */
const HEATING_EFFICIENCY = 0.72;

/**
 * 氮气消耗映射表 — 炉膛空置率 → 氮气消耗 (Nm³)
 *
 * 物理逻辑: 炉膛净空体积 V_void = V_chamber - V_packed 越小，
 *           所需回填的冷却/保护气体越少。
 *
 * 典型数据（以 1m³ 炉膛为基准）:
 *   - 空置率 80% → 需要大量氮气填充空腔 → ~60 Nm³
 *   - 空置率 50% → 中等需求 → ~35 Nm³
 *   - 空置率 20% → 高效装载 → ~15 Nm³
 */
const GAS_CONSUMPTION_TABLE = [
    { voidRatioMax: 0.99, nitrogenNm3PerM3: 75 },
    { voidRatioMax: 0.85, nitrogenNm3PerM3: 60 },
    { voidRatioMax: 0.70, nitrogenNm3PerM3: 45 },
    { voidRatioMax: 0.55, nitrogenNm3PerM3: 30 },
    { voidRatioMax: 0.40, nitrogenNm3PerM3: 20 },
    { voidRatioMax: 0.25, nitrogenNm3PerM3: 12 },
    { voidRatioMax: 0.10, nitrogenNm3PerM3: 6 },
    { voidRatioMax: 0.00, nitrogenNm3PerM3: 3 }
];

// ==================== 辅助函数 ====================

/**
 * 将 mm³ 转换为 m³
 * @param {number} volumeMm3 - 体积 (mm³)
 * @returns {number} 体积 (m³)
 */
function mm3ToM3(volumeMm3) {
    return volumeMm3 / 1e9;
}

/**
 * 将 kg 转换为吨
 * @param {number} kg
 * @returns {number} 吨
 */
function kgToTons(kg) {
    return kg / 1000;
}

// ==================== 预测函数 ====================

/**
 * 电力消耗预估
 *
 * 公式: E = P_base_loss × t_total + (M × C_p × ΔT) / (η × 3600)
 *
 * 其中:
 *   - P_base_loss = BASE_HEAT_LOSS_PER_CUBIC_METER × V_chamber
 *   - t_total = t_heat_up + t_hold（升温时间 + 保温时间）
 *   - ΔT = T_target - T_ambient（假设室温 25℃）
 *   - η = HEATING_EFFICIENCY
 *
 * @param {number} chamberVolumeMm3 - 炉膛有效加热区体积 (mm³)
 * @param {number} totalMassKg       - 总装载质量 (kg)
 * @param {number} [targetTemp=850]  - 目标温度 (℃)
 * @param {number} [holdTimeH=2]     - 保温时间 (小时)
 * @param {number} [ambientTemp=25]  - 环境温度 (℃)
 * @returns {{ estimatedKwh: number, efficiencyTier: string }}
 *          estimatedKwh - 预估电力消耗 (kWh)
 *          efficiencyTier - 能效等级 'A'|'B'|'C'
 */
export function predictPowerConsumption(
    chamberVolumeMm3,
    totalMassKg,
    targetTemp = 850,
    holdTimeH = 2,
    ambientTemp = 25
) {
    const chamberVolumeM3 = mm3ToM3(chamberVolumeMm3);

    // 基础热损耗功率 (kW)
    const baseLossPower = BASE_HEAT_LOSS_PER_CUBIC_METER * chamberVolumeM3;

    // 升温时间估算 (小时) — 基于炉膛体积的经验公式
    // 体积越大，升温越慢
    const heatUpTimeH = Math.max(0.5, chamberVolumeM3 * 1.8);

    // 总运行时间
    const totalTimeH = heatUpTimeH + holdTimeH;

    // 基础热损耗 (kWh)
    const baseLossEnergy = baseLossPower * totalTimeH;

    // 有效热吸收 (kJ) → (kWh)
    // Q = M × C_p × ΔT
    const deltaT = targetTemp - ambientTemp;
    const effectiveHeatKJ = totalMassKg * STEEL_SPECIFIC_HEAT * deltaT;
    const effectiveHeatKWh = effectiveHeatKJ / (HEATING_EFFICIENCY * 3600);

    // 总计 (kWh)
    const estimatedKwh = Math.round(baseLossEnergy + effectiveHeatKWh);

    // 能效等级判定
    // 基于单位质量能耗: kWh / (吨·100℃)
    const tons = kgToTons(totalMassKg);
    let efficiencyTier;
    if (tons > 0) {
        const kwhPerTonPer100C = estimatedKwh / (tons * (deltaT / 100));
        if (kwhPerTonPer100C <= 55) {
            efficiencyTier = 'A';
        } else if (kwhPerTonPer100C <= 75) {
            efficiencyTier = 'B';
        } else {
            efficiencyTier = 'C';
        }
    } else {
        efficiencyTier = 'C'; // 空炉默认 C
    }

    return { estimatedKwh, efficiencyTier };
}

/**
 * 气体能耗预估
 *
 * 物理逻辑: 炉膛净空体积 V_void = V_chamber - V_packed 越小，
 *           所需回填的冷却/保护气体越少。
 *
 * @param {number} chamberVolumeMm3 - 炉膛有效加热区体积 (mm³)
 * @param {number} packedVolumeMm3  - 已装工件总体积 (mm³)
 * @returns {{ nitrogenNm3: number }} 预估氮气消耗 (Nm³)
 */
export function predictGasConsumption(chamberVolumeMm3, packedVolumeMm3) {
    const chamberVolumeM3 = mm3ToM3(chamberVolumeMm3);

    if (chamberVolumeM3 <= 0) {
        return { nitrogenNm3: 0 };
    }

    // 计算空置率
    const voidVolumeM3 = Math.max(0, mm3ToM3(chamberVolumeMm3 - packedVolumeMm3));
    const voidRatio = voidVolumeM3 / chamberVolumeM3;

    // 查表获取单位体积氮气消耗基准
    let nitrogenNm3PerM3 = 75; // 默认最大值
    for (const entry of GAS_CONSUMPTION_TABLE) {
        if (voidRatio <= entry.voidRatioMax) {
            nitrogenNm3PerM3 = entry.nitrogenNm3PerM3;
            break;
        }
    }

    // 按炉膛体积缩放
    const nitrogenNm3 = Math.round(nitrogenNm3PerM3 * chamberVolumeM3 * 10) / 10;

    return { nitrogenNm3 };
}

/**
 * 质量安全评分
 *
 * 三维度加权评分:
 *   1. 热辐射遮挡率 (权重 0.45) — 工件间距 < 5mm 的接触面占比
 *   2. 垂直叠放压伤风险 (权重 0.30) — 上方工件对下方工件的压应力
 *   3. 循环气流阻力 (权重 0.25) — 工件体积占炉膛容积比
 *
 * 评分范围: 0-100，越高越安全
 *
 * @param {Array<Object>} packedItems  - 已装工件列表 [{ x, y, z, w, h, d, weight }]
 * @param {number}        chamberVolumeMm3 - 炉膛有效加热区体积 (mm³)
 * @returns {{ score: number, deformationRisk: 'LOW'|'MEDIUM'|'HIGH' }}
 */
export function predictQualityRisk(packedItems, chamberVolumeMm3) {
    if (!packedItems || packedItems.length === 0) {
        return { score: 100, deformationRisk: 'LOW' };
    }

    const n = packedItems.length;

    // ---- 1. 热辐射遮挡率得分 (0-45) ----
    // 检测工件间水平方向间隙（XZ 平面），紧贴面越多遮挡越严重
    let totalAdjacentFaces = 0;   // 紧贴面总数
    let maxPossibleAdjacent = 0;  // 理论最大紧贴面数 (每对工件最多 4 个方向贴面)

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const a = packedItems[i];
            const b = packedItems[j];

            // 检查 XZ 平面包围盒是否在 Y 方向重叠（同一层）
            const yOverlap = (a.y + a.h_algo || a.y + a.h) > b.y && (b.y + b.h_algo || b.y + b.h) > a.y;
            if (!yOverlap) continue;

            maxPossibleAdjacent += 4;

            // 右邻接: a 右面贴 b 左面
            const axRight = a.x + (a.w_algo || a.w);
            const bxLeft = b.x;
            // Z 方向有重叠
            const zOverlapAB = (a.z + (a.d_algo || a.d)) > b.z && (b.z + (b.d_algo || b.d)) > a.z;
            if (zOverlapAB && Math.abs(axRight - bxLeft) <= 5) totalAdjacentFaces++;
            // 左邻接: a 左面贴 b 右面
            const bxRight = b.x + (b.w_algo || b.w);
            const axLeft = a.x;
            if (zOverlapAB && Math.abs(bxRight - axLeft) <= 5) totalAdjacentFaces++;
            // 前邻接: a 前面贴 b 后面
            const xOverlapAB = axRight > b.x && bxRight > a.x;
            const azFront = a.z + (a.d_algo || a.d);
            const bzBack = b.z;
            if (xOverlapAB && Math.abs(azFront - bzBack) <= 5) totalAdjacentFaces++;
            // 后邻接: a 后面贴 b 前面
            const bzFront = b.z + (b.d_algo || b.d);
            const azBack = a.z;
            if (xOverlapAB && Math.abs(bzFront - azBack) <= 5) totalAdjacentFaces++;
        }
    }

    const radiationRatio = maxPossibleAdjacent > 0
        ? Math.min(1, totalAdjacentFaces / maxPossibleAdjacent)
        : 0;
    const radiationScore = 45 * (1 - radiationRatio); // 遮挡越少分越高

    // ---- 2. 垂直叠放压伤风险得分 (0-30) ----
    // 检测每个工件上方是否有工件直接叠压（Y 方向间隙 < 5mm 且 XZ 投影重叠）
    let stackingPenalty = 0;

    for (let i = 0; i < n; i++) {
        const lower = packedItems[i];
        const lowerTop = lower.y + (lower.h_algo || lower.h);

        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const upper = packedItems[j];
            const upperBottom = upper.y;

            // Y 方向间隙检测
            const yGap = upperBottom - lowerTop;
            if (yGap < -5) continue; // 上方工件在下方工件之下
            if (yGap > 5) continue;  // 间隙过大，非直接叠压

            // XZ 投影重叠检测
            const xOverlap = (lower.x + (lower.w_algo || lower.w)) > upper.x
                          && (upper.x + (upper.w_algo || upper.w)) > lower.x;
            const zOverlap = (lower.z + (lower.d_algo || lower.d)) > upper.z
                          && (upper.z + (upper.d_algo || upper.d)) > lower.z;

            if (xOverlap && zOverlap) {
                // 上方工件重量 / 下方工件顶面积 → 压应力
                const contactArea = (lower.w_algo || lower.w) * (lower.d_algo || lower.d);
                if (contactArea > 0) {
                    const pressure = (upper.weight || 1) / contactArea;
                    stackingPenalty += Math.min(pressure * 5000, 15); // 单次惩罚上限 15
                }
            }
        }
    }

    const stackingScore = Math.max(0, 30 - Math.min(30, stackingPenalty)); // 上限 30 分

    // ---- 3. 循环气流阻力得分 (0-25) ----
    // 工件体积占炉膛容积比 → 填充率越高，气流阻力越大
    let packedVolume = 0;
    for (const item of packedItems) {
        packedVolume += (item.w || 0) * (item.h || 0) * (item.d || 0);
    }
    const fillRatio = chamberVolumeMm3 > 0
        ? Math.min(1, packedVolume / chamberVolumeMm3)
        : 0;

    // 填充率理想值 0.7-0.85，过高气流不畅，过低浪费空间
    let flowScore;
    if (fillRatio <= 0.30) {
        flowScore = 25 * (fillRatio / 0.30); // 太少也不好（气流短路）
    } else if (fillRatio <= 0.70) {
        flowScore = 25; // 理想范围
    } else if (fillRatio <= 0.90) {
        flowScore = 25 * (1 - (fillRatio - 0.70) / 0.20 * 0.6); // 渐降
    } else {
        flowScore = 25 * (1 - 0.6 - (fillRatio - 0.90) / 0.10 * 0.4); // 急剧下降
    }
    flowScore = Math.max(0, flowScore);

    // ---- 综合评分 ----
    const score = Math.round(radiationScore + stackingScore + flowScore);
    const clampedScore = Math.max(0, Math.min(100, score));

    // 变形风险判定
    let deformationRisk;
    if (clampedScore >= 80) {
        deformationRisk = 'LOW';
    } else if (clampedScore >= 50) {
        deformationRisk = 'MEDIUM';
    } else {
        deformationRisk = 'HIGH';
    }

    return { score: clampedScore, deformationRisk };
}

/**
 * 为装炉结果批量生成预测数据
 *
 * 便捷函数 — 一次性为所有已完成炉膛生成完整预测数据。
 * 在 executePacking 返回结果后调用。
 *
 * @param {Array<Object>} completedFurnaces - 已完成炉膛列表
 * @returns {Array<Object>} 每个炉膛的预测结果
 */
export function generatePredictions(completedFurnaces) {
    if (!completedFurnaces || completedFurnaces.length === 0) {
        return [];
    }

    return completedFurnaces.map(furnace => {
        const chamberVolume = (furnace.w || 0) * (furnace.h || 0) * (furnace.d || 0);
        let packedVolume = 0;
        if (furnace.packedItems) {
            furnace.packedItems.forEach(item => {
                packedVolume += (item.w || 0) * (item.h || 0) * (item.d || 0);
            });
        }

        const powerConsumption = predictPowerConsumption(
            chamberVolume,
            furnace.totalWeight || 0,
            850,
            2
        );

        const gasConsumption = predictGasConsumption(chamberVolume, packedVolume);

        const qualityRisk = predictQualityRisk(
            furnace.packedItems || [],
            chamberVolume
        );

        return {
            furnaceId: furnace.instanceId || furnace.typeName || 'unknown',
            powerConsumption,
            gasConsumption,
            qualityRisk
        };
    });
}