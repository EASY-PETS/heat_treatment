/**
 * PackingRuleEngine.js — 装炉规则引擎（分组逻辑）
 *
 * V3.0 新增模块。负责：
 *   - 规则读取（同材质优先 / 同工艺优先）
 *   - 工件分组逻辑（工艺优先 > 材质优先）
 *   - 分组统计摘要生成
 *
 * 设计原则：
 *   - 禁止将逻辑写入 UI 代码，所有分组逻辑统一收敛于此模块
 *   - groupMaterials() 是预处理步骤，不修改现有装炉算法
 *   - 关闭规则时返回单组 = 与当前版本行为完全一致
 *
 * Dependencies:
 *   - state.js (placementRules)
 */

import { placementRules } from './state.js';

// ==================== 分组核心逻辑 ====================

/**
 * 根据规则配置对工件列表进行分组预处理。
 *
 * 执行流程:
 *   Step 1 — 读取 placementRules.sameMaterial / placementRules.sameProcess
 *   Step 2 — 根据规则分组：
 *            - 两个都关闭 → 返回单组（所有工件在一组）= 原始行为
 *            - 仅同工艺 → 按 processType 分组
 *            - 仅同材质 → 按 materialType 分组
 *            - 两者都开启 → 工艺优先 > 材质优先（工艺为一级分组，材质为二级分组）
 *   Step 3 — 返回分组列表，每个组内工件保持传入时的顺序
 *
 * 优先级规则（两者同时开启）：
 *   工艺优先
 *   ↓
 *   材质优先
 *   ↓
 *   装炉
 *
 *   例如：
 *   渗碳
 *   ├─20CrMnTi
 *   ├─20Cr
 *   └─45#
 *   氮化
 *   ├─38CrMoAl
 *   └─40Cr
 *
 * @param {Array<Object>} items - 扁平化工件列表，每个工件必须有 material / process 字段
 * @param {Object} rules - 规则配置，{ sameMaterial: boolean, sameProcess: boolean }
 * @returns {Array<{ groupKey: string, groupLabel: string, items: Array<Object> }>}
 *          分组列表，按工艺→材质优先级排序
 *
 * @example
 *   // 输入
 *   const items = [
 *     { id: 'A_0', material: '20CrMnTi', process: '渗碳', ... },
 *     { id: 'B_0', material: '45#', process: '渗碳', ... },
 *     { id: 'C_0', material: '38CrMoAl', process: '氮化', ... },
 *   ];
 *
 *   // 规则：同工艺优先 + 同材质优先
 *   groupMaterials(items, { sameMaterial: true, sameProcess: true });
 *
 *   // 输出
 *   [
 *     {
 *       groupKey: '渗碳|20CrMnTi',
 *       groupLabel: '渗碳 → 20CrMnTi',
 *       items: [{ id: 'A_0', ... }]
 *     },
 *     {
 *       groupKey: '渗碳|45#',
 *       groupLabel: '渗碳 → 45#',
 *       items: [{ id: 'B_0', ... }]
 *     },
 *     {
 *       groupKey: '氮化|38CrMoAl',
 *       groupLabel: '氮化 → 38CrMoAl',
 *       items: [{ id: 'C_0', ... }]
 *     }
 *   ]
 */
export function groupMaterials(items, rules) {
    const { sameMaterial, sameProcess } = rules || {};

    // 两个规则都关闭 → 返回单组（所有工件在一组）= 与当前版本完全一致
    if (!sameMaterial && !sameProcess) {
        return [{
            groupKey: '__ALL__',
            groupLabel: '全部工件（未分组）',
            items: [...items]
        }];
    }

    // 构建分组 Map
    // Key 格式（根据规则组合）：
    //   - 仅工艺： processType
    //   - 仅材质： materialType
    //   - 工艺+材质： processType||materialType
    const groupMap = new Map();

    for (const item of items) {
        const process = (item.process || '未知工艺').trim();
        const material = (item.material || '未知材质').trim();

        let groupKey;
        let groupLabel;

        if (sameProcess && sameMaterial) {
            // 工艺优先 > 材质优先：二级分组
            groupKey = `${process}||${material}`;
            groupLabel = `${process} → ${material}`;
        } else if (sameProcess) {
            // 仅工艺分组
            groupKey = process;
            groupLabel = process;
        } else {
            // 仅材质分组（sameMaterial = true, sameProcess = false）
            groupKey = material;
            groupLabel = material;
        }

        if (!groupMap.has(groupKey)) {
            groupMap.set(groupKey, {
                groupKey,
                groupLabel,
                items: []
            });
        }
        groupMap.get(groupKey).items.push(item);
    }

    // 转换为数组并排序（按工艺名称 → 材质名称排序，与算法内部排序一致）
    const groups = [...groupMap.values()];
    groups.sort((a, b) => a.groupKey.localeCompare(b.groupKey, 'zh-CN'));

    return groups;
}

// ==================== 分组摘要生成 ====================

/**
 * 生成分组摘要信息，用于方案统计面板展示。
 *
 * 显示内容：
 *   - 分组规则：哪些规则被启用
 *   - 分组结果：每个分组包含的物料种类数
 *
 * @param {Array<{ groupKey: string, groupLabel: string, items: Array<Object> }>} groups
 *        分组列表（来自 groupMaterials() 的输出）
 * @param {Object} rules - 规则配置 { sameMaterial, sameProcess }
 * @returns {{ rulesText: string[], summaryText: string[], totalGroups: number }}
 *          rulesText — 启用的规则文本列表（如 ['✓ 同工艺优先', '✓ 同材质优先']）
 *          summaryText — 分组结果文本列表（如 ['渗碳（3种物料）', '氮化（2种物料）']）
 *          totalGroups — 分组总数
 *
 * @example
 *   getGroupingSummary(groups, { sameMaterial: true, sameProcess: true });
 *   // {
 *   //   rulesText: ['✓ 同工艺优先', '✓ 同材质优先'],
 *   //   summaryText: ['渗碳 → 20CrMnTi（5件）', '渗碳 → 45#（3件）'],
 *   //   totalGroups: 2
 *   // }
 */
export function getGroupingSummary(groups, rules) {
    const { sameMaterial, sameProcess } = rules || {};
    const rulesText = [];

    if (sameProcess) rulesText.push('✓ 同工艺优先');
    if (sameMaterial) rulesText.push('✓ 同材质优先');

    if (!sameMaterial && !sameProcess) {
        rulesText.push('✗ 无分组规则');
    }

    const summaryText = [];
    const uniqueMaterialsInGroup = new Map(); // groupKey → Set of material names

    for (const group of groups) {
        const matSet = new Set();
        for (const item of group.items) {
            matSet.add(item.material || '未知');
        }
        summaryText.push(`${group.groupLabel}（${matSet.size}种物料，${group.items.length}件）`);
    }

    return {
        rulesText,
        summaryText,
        totalGroups: groups.length
    };
}

// ==================== 规则读取辅助 ====================

/**
 * 从全局 placementRules 中读取当前分组规则配置。
 *
 * @returns {{ sameMaterial: boolean, sameProcess: boolean }}
 */
export function getGroupingRules() {
    return {
        sameMaterial: placementRules.sameMaterial || false,
        sameProcess: placementRules.sameProcess || false
    };
}