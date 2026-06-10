/**
 * strategies.js — 四种装炉策略的配置定义
 *
 * 每种策略通过 `weights`（权重）和 `specialRules`（特殊规则）控制装炉算法评分函数的行为。
 * 评分函数 `computePlacementScore()` 根据权重计算候选位置的优劣（分数越低越好）。
 *
 * ## 评分维度说明：
 *   - cgDeviation:      放置后 XZ 平面整体重心偏离炉膛中心的惩罚
 *   - centerDistance:   工件个体距炉膛 XZ 中心的距离（推动 center-out 分布）
 *   - edgeTouch:        贴边/邻接奖励（鼓励紧凑排列）
 *   - symmetry:         对称性奖励（鼓励工件关于中心对称放置）
 *   - isolation:        孤立惩罚（正权重惩罚孤立，负权重奖励填充空隙）
 *   - layerPriority:    外层优先（优先使用靠近炉壁的位置）
 *   - cornerSpread:     四角均衡（鼓励填充四个角落）
 *   - thermalEvenness:  热场均匀度（避免中心聚集、控制局部密度）
 *   - surfaceExposure:  表面暴露面积（最大化暴露、避免遮挡）
 *
 * ## 特殊规则说明：
 *   - enableSymmetry:      启用对称性检测
 *   - dynamicCgWeight:     少物料时动态降低重心权重
 *   - forceCompact:        填充小空隙额外奖励
 *   - avoidCenterClustering: 惩罚过于靠近中心
 *   - equalWallDistance:   奖励距各壁面等距
 *   - layerDecayWithItems: 工件越多外层优先级衰减越快
 *
 * Dependencies: furnace-engine.js (computePlacementScore 引用)
 */

export const PackingStrategy = {
  BALANCED: 'balanced',               // 重心稳定
  SPACE_UTIL: 'spaceUtil',            // 空间利用率优先
  THERMAL_BALANCE: 'thermalBalance',  // 热场均衡装载
  SURFACE_UNIFORM: 'surfaceUniform'   // 表面均匀性优先
};

export const strategyConfig = {
  [PackingStrategy.BALANCED]: {
    name: '重心稳定',
    description: '前期贴边并保持四边均衡，后期逐渐提升重心权重，形成由外向内收缩',
    weights: {
      cgDeviation: 0.6,
      centerDistance: 0,
      edgeTouch: 1.6,

      // 关键：先降低对称性，否则容易形成“左上 + 右下”对角两坨
      symmetry: 0.3,

      // 提高孤立惩罚，避免分成几个独立区域
      isolation: 0.8,

      // 外圈优先仍然保留
      layerPriority: 2.5,

      // 关键：重心稳定模式不要再使用四角均衡
      cornerSpread: 0,

      thermalEvenness: 0,
      surfaceExposure: 0
    },
    specialRules: {
      enableSymmetry: false,
      dynamicCgWeight: true,
      maxCgWeightFactor: 0.8, // 少物料时重心权重降低到80%
      layerDecayWithItems: true,
      forceCompact: false,
      avoidCenterClustering: false,
      equalWallDistance: false,
      maxLocalDensity: 1.0
    }
  },

  [PackingStrategy.SPACE_UTIL]: {
  name: '空间利用率优先',
  description: '从角落连续填充，强奖励贴边、邻接和小空隙填充，最大化装炉数量',
  weights: {
    cgDeviation: 0,
    centerDistance: 0,
    edgeTouch: 4.0,
    symmetry: 0,
    isolation: 1.0,
    thermalEvenness: 0,
    surfaceExposure: 0,
    cornerSpread: 0.5,
    layerPriority: 1.5
  },
  specialRules: {
    enableSymmetry: false,
    dynamicCgWeight: false,
    forceCompact: true,
    avoidCenterClustering: false,
    equalWallDistance: false,
    maxLocalDensity: 1.0
  }
},

  [PackingStrategy.THERMAL_BALANCE]: {
    name: '热场均衡装载',
    description: '中心留空、分散布置、控制局部密度，适合真空炉和高压气淬',
    weights: {
      cgDeviation: 0,
      centerDistance: 0,
      edgeTouch: 0,
      symmetry: 0,
      isolation: 1.5,
      thermalEvenness: 3.0,
      surfaceExposure: 0,
      cornerSpread: 1.0,
      layerPriority: 0
    },
    specialRules: {
      enableSymmetry: false,
      dynamicCgWeight: false,
      forceCompact: false,
      avoidCenterClustering: true,
      maxLocalDensity: 0.25,
      equalWallDistance: false,
      targetSpacing: 120
    }
  },

  // [PackingStrategy.SURFACE_UNIFORM]: {
  //   name: '表面均匀性优先',
  //   description: '最大化每个工件的有效暴露面，减少气氛 / 气流 / 热辐射遮挡，使同批工件获得接近一致的表面处理效果',
  //   weights: {
  //     cgDeviation: 0.05,
  //     centerDistance: 0.1,
  //     edgeTouch: 0.1,
  //     symmetry: 0.1,
  //     isolation: 0.05,
  //     thermalEvenness: 0.1,
  //     surfaceExposure: 0.6            // 主要目标
  //   },
  //   specialRules: {
  //     enableSymmetry: false,
  //     dynamicCgWeight: false,
  //     avoidCenterClustering: false,
  //     maxContactArea: 0.05,           // 接触面积不超过工件表面积5%（后续实现）
  //     minExposureAngle: 270,          // 最小暴露角（度）
  //     avoidShadowing: true,           // 惩罚被遮挡
  //     equalWallDistance: true,        // 奖励距各壁面等距
  //     forceCompact: false
  //   }
  // }
    [PackingStrategy.SURFACE_UNIFORM]: {
    name: '表面均匀性优先',
    description: '最大化有效暴露面，保持均匀间距，避免气流方向遮挡，适合渗碳、渗氮、碳氮共渗等表面处理',

    weights: {
      // 表面模式不以重心为主，只保留很小的防偏载权重
      cgDeviation: 0.05,

      // 不强迫靠中心，也不强迫贴边
      centerDistance: 0.05,

      // 关键：不要奖励贴边 / 贴工件
      edgeTouch: 0,

      symmetry: 0,
      isolation: 0,

      // 轻微考虑热场均匀
      thermalEvenness: 0.2,

      // 主目标
      surfaceExposure: 1.0,

      // 不走 BALANCED 的外圈优先
      layerPriority: 0,
      cornerSpread: 0
    },

    specialRules: {
      enableSymmetry: false,
      dynamicCgWeight: false,
      forceCompact: false,
      avoidCenterClustering: false,
      equalWallDistance: false,

      // 工件之间的目标安全间隙，单位 mm
      // 这个不是普通安全间距，而是表面处理需要的气流/气氛通道
      targetSpacing: 80,

      // 不贴炉壁 / 不贴料框
      minWallMargin: 60,

      // 太靠中心也不一定好，避免全部堆在中心区域
      maxWallMargin: 260,

      // 气流方向，先按 Z 轴处理
      airflowAxis: 'z',

      // 沿 Z 轴前后遮挡判断
      shadowOverlapRatio: 0.35,
      shadowClearance: 220,

      // 权重参数
      airflowShadowPenalty: 2600,
      spacingPenaltyWeight: 18,
      wallMarginPenaltyWeight: 12,

      // 未来可以给 UI 使用
      preferSingleLayer: true
    }
  }
};

/**
 * 获取策略配置
 * @param {string} strategyKey - 策略键，如 'balanced'
 * @returns {Object} 策略配置对象
 */
export function getStrategyConfig(strategyKey) {
  return strategyConfig[strategyKey] || strategyConfig[PackingStrategy.BALANCED];
}