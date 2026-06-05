// strategies.js
// 四种装炉策略的配置定义

export const PackingStrategy = {
  BALANCED: 'balanced',               // 重心稳定 + 贴边对称
  SPACE_UTIL: 'spaceUtil',            // 空间利用率优先
  THERMAL_BALANCE: 'thermalBalance',  // 热场均衡装载
  SURFACE_UNIFORM: 'surfaceUniform'   // 表面均匀性优先
};

export const strategyConfig = {
  [PackingStrategy.BALANCED]: {
    name: '重心稳定 + 贴边对称',
    description: '少物料时贴边对称，多物料时兼顾重心，物理稳定',
    weights: {
      cgDeviation: 0.3,       // 重心偏离惩罚
      centerDistance: 0.2,    // 个体距中心距离
      edgeTouch: 0.4,         // 贴边/邻接奖励
      symmetry: 0.1,          // 对称性奖励
      isolation: 0,           // 孤立惩罚（不启用）
      thermalEvenness: 0,     // 热场均匀（不启用）
      surfaceExposure: 0      // 表面积暴露（不启用）
    },
    specialRules: {
      enableSymmetry: true,
      dynamicCgWeight: true,          // 少物料时降低重心权重
      maxCgWeightFactor: 0.4,         // 满载时重心权重最大0.4
      avoidCenterClustering: false,
      forceCompact: false,
      maxLocalDensity: 1.0
    }
  },

  [PackingStrategy.SPACE_UTIL]: {
    name: '空间利用率优先',
    description: '塞满炉子，忽略重心，强力贴边紧凑',
    weights: {
      cgDeviation: 0.05,
      centerDistance: 0.05,
      edgeTouch: 0.8,
      symmetry: 0.1,
      isolation: -0.2,        // 负权重 → 奖励孤立空隙填充
      thermalEvenness: 0,
      surfaceExposure: 0
    },
    specialRules: {
      enableSymmetry: false,
      dynamicCgWeight: false,
      forceCompact: true,             // 额外奖励填充小间隙
      allowAnyStacking: true,         // 允许垂直堆叠（评分辅助）
      avoidCenterClustering: false,
      maxLocalDensity: 1.0
    }
  },

  [PackingStrategy.THERMAL_BALANCE]: {
    name: '热场均衡装载',
    description: '温度均匀 + 气流均匀，避免中心聚集，控制局部密度',
    weights: {
      cgDeviation: 0.1,
      centerDistance: 0.2,
      edgeTouch: 0.1,
      symmetry: 0.2,
      isolation: 0.1,
      thermalEvenness: 0.4,           // 新增热场均匀维度
      surfaceExposure: 0
    },
    specialRules: {
      enableSymmetry: true,
      dynamicCgWeight: false,
      avoidCenterClustering: true,    // 惩罚过于靠近中心
      maxLocalDensity: 0.4,           // 局部密度超过阈值惩罚
      forceCompact: false
    }
  },

  [PackingStrategy.SURFACE_UNIFORM]: {
    name: '表面均匀性优先',
    description: '每个工件“吃到一样的气氛”，最大暴露面积，避免遮挡',
    weights: {
      cgDeviation: 0.05,
      centerDistance: 0.1,
      edgeTouch: 0.1,
      symmetry: 0.1,
      isolation: 0.05,
      thermalEvenness: 0.1,
      surfaceExposure: 0.6            // 主要目标
    },
    specialRules: {
      enableSymmetry: false,
      dynamicCgWeight: false,
      avoidCenterClustering: false,
      maxContactArea: 0.05,           // 接触面积不超过工件表面积5%（后续实现）
      minExposureAngle: 270,          // 最小暴露角（度）
      avoidShadowing: true,           // 惩罚被遮挡
      equalWallDistance: true,        // 奖励距各壁面等距
      forceCompact: false
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