// ==================== 模块6：装炉历史 ====================

import { calculateVolume } from '../utils/helpers.js';

/**
 * 装炉历史模块
 * 负责记录和展示每次生成方案的炉膛层级装炉历史
 */
export class LoadingHistory {
    constructor() {
        this.historyRecords = [];
        this.STORAGE_KEY = 'heatTreatment_loadingHistory';
    }

    /**
     * 初始化装炉历史UI事件
     */
    init() {
        // 加载历史记录
        this._loadHistory();

        // 渲染
        this._renderHistory();

        // 绑定炉膛筛选器事件
        const furnaceFilter = document.getElementById('history-furnace-filter');
        if (furnaceFilter) {
            furnaceFilter.addEventListener('change', () => {
                this._renderHistory();
            });
        }

        // 绑定日期筛选器事件
        const dateFilter = document.getElementById('history-date-filter');
        if (dateFilter) {
            dateFilter.addEventListener('change', () => {
                this._renderHistory();
            });
        }

        // 绑定策略筛选器事件
        const strategyFilter = document.getElementById('history-strategy-filter');
        if (strategyFilter) {
            strategyFilter.addEventListener('change', () => {
                this._renderHistory();
            });
        }

        // 重置筛选按钮
        const btnReset = document.getElementById('btn-reset-history-filter');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                if (furnaceFilter) furnaceFilter.value = 'all';
                if (dateFilter) dateFilter.value = '';
                if (strategyFilter) strategyFilter.value = 'all';
                this._renderHistory();
            });
        }

        // 清空历史按钮
        const btnClear = document.getElementById('btn-clear-history');
        if (btnClear) {
            btnClear.addEventListener('click', () => {
                if (confirm('确定要清空所有装炉历史记录吗？此操作不可撤销。')) {
                    this._clearHistory();
                }
            });
        }
    }

    /**
     * 从localStorage加载历史
     */
    _loadHistory() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                this.historyRecords = JSON.parse(raw);
            }
        } catch (e) {
            this.historyRecords = [];
        }
    }

    /**
     * 保存历史到localStorage
     */
    _saveHistory() {
        try {
            // 最多保留50条记录
            if (this.historyRecords.length > 50) {
                this.historyRecords = this.historyRecords.slice(-50);
            }
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.historyRecords));
        } catch (e) {
            console.warn('装炉历史保存失败:', e);
        }
    }

    /**
     * 记录一次装炉方案
     * @param {Array} furnacesResult - 所有炉膛结果
     * @param {Array} unpackedItems - 未装载工件
     * @param {string} strategy - 使用的排布策略
     * @param {number} spacing - 安全间距
     */
    recordLoading(furnacesResult, unpackedItems, strategy, spacing) {
        if (!furnacesResult || furnacesResult.length === 0) return;

        const record = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            dateFormatted: new Date().toLocaleString('zh-CN'),
            strategy: strategy || '未知',
            spacing: spacing || 0,
            totalFurnaces: furnacesResult.length,
            totalPackedItems: 0,
            totalUnpackedItems: unpackedItems ? unpackedItems.length : 0,
            furnaces: []
        };

        furnacesResult.forEach(furnace => {
            const totalVol = calculateVolume(furnace.w, furnace.h, furnace.d);
            let packedVol = furnace.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
            const utilPct = ((packedVol / totalVol) * 100).toFixed(1);
            const weightPct = ((furnace.totalWeight / furnace.maxWeight) * 100).toFixed(1);

            // 汇总物料
            const itemSummary = {};
            furnace.packedItems.forEach(item => {
                const key = item.name;
                if (!itemSummary[key]) {
                    itemSummary[key] = {
                        name: key,
                        color: item.color,
                        count: 0,
                        totalWeight: 0
                    };
                }
                itemSummary[key].count++;
                itemSummary[key].totalWeight += (item.weight || 0);
            });

            record.furnaces.push({
                instanceId: furnace.instanceId,
                name: furnace.name || furnace.instanceId,
                dimensions: {
                    w: Math.round(furnace.w),
                    h: Math.round(furnace.h),
                    d: Math.round(furnace.d)
                },
                totalVolume: totalVol,
                packedItemsCount: furnace.packedItems.length,
                utilization: utilPct,
                totalWeight: furnace.totalWeight.toFixed(1),
                maxWeight: furnace.maxWeight,
                weightLoadPct: weightPct,
                items: Object.keys(itemSummary).sort().map(k => itemSummary[k])
            });

            record.totalPackedItems += furnace.packedItems.length;
        });

        this.historyRecords.unshift(record);
        this._saveHistory();
        this._renderHistory();
    }

    /**
     * 清空历史
     */
    _clearHistory() {
        this.historyRecords = [];
        localStorage.removeItem(this.STORAGE_KEY);
        this._renderHistory();
    }

    /**
     * 渲染历史记录列表
     */
    _renderHistory() {
        const container = document.getElementById('loading-history-container');
        if (!container) return;

        const furnaceFilter = document.getElementById('history-furnace-filter');
        const dateFilter = document.getElementById('history-date-filter');
        const strategyFilter = document.getElementById('history-strategy-filter');

        const furnaceValue = furnaceFilter ? furnaceFilter.value : 'all';
        const dateValue = dateFilter ? dateFilter.value : '';
        const strategyValue = strategyFilter ? strategyFilter.value : 'all';

        // 更新筛选下拉框
        this._updateFurnaceFilter();

        if (this.historyRecords.length === 0) {
            container.innerHTML = '<div style="color: #999; font-size: 12px; text-align: center; padding: 30px;">暂无装炉历史记录，请先生成装炉方案</div>';
            return;
        }

        let html = '';

        this.historyRecords.forEach((record, recordIdx) => {
            // 策略筛选
            if (strategyValue !== 'all' && record.strategy !== strategyValue) {
                return;
            }

            // 日期筛选
            if (dateValue) {
                const recordDate = new Date(record.timestamp).toISOString().split('T')[0];
                if (recordDate !== dateValue) {
                    return;
                }
            }

            // 如果筛选了特定炉膛，检查是否包含
            let filteredFurnaces = record.furnaces;
            if (furnaceValue !== 'all') {
                filteredFurnaces = record.furnaces.filter(f => f.instanceId === furnaceValue);
                if (filteredFurnaces.length === 0) return; // 跳过不匹配的记录
            }

            html += '<div class="history-record-card">';
            html += '<div class="history-record-header">';
            html += '<div class="history-record-meta">';
            html += '<span class="history-record-time">📅 ' + record.dateFormatted + '</span>';
            html += '<span class="history-record-summary">';
            html += '策略: <strong>' + record.strategy + '</strong> · ';
            html += '间距: <strong>' + record.spacing + 'mm</strong> · ';
            html += '启用炉膛: <strong>' + record.totalFurnaces + '</strong>台 · ';
            html += '装载工件: <strong>' + record.totalPackedItems + '</strong>件';
            if (record.totalUnpackedItems > 0) {
                html += ' · <span style="color:#ff3b30;">未装载: ' + record.totalUnpackedItems + '件</span>';
            }
            html += '</span>';
            html += '</div>';
            html += '<span class="history-record-id"># ' + (recordIdx + 1) + '</span>';
            html += '</div>';

            // 每台炉膛的详情
            html += '<div class="history-furnace-list">';
            filteredFurnaces.forEach(furnace => {
                html += '<div class="history-furnace-item">';
                html += '<div class="hfi-header">';
                html += '<span class="hfi-name">🔥 ' + furnace.instanceId + '</span>';
                html += '<span class="hfi-dims">' + furnace.dimensions.w + ' × ' + furnace.dimensions.h + ' × ' + furnace.dimensions.d + ' mm</span>';
                html += '</div>';
                html += '<div class="hfi-stats">';
                html += '<div class="hfi-stat"><span class="hfi-stat-val">' + furnace.packedItemsCount + '</span><span class="hfi-stat-lbl">工件数</span></div>';
                html += '<div class="hfi-stat"><span class="hfi-stat-val">' + furnace.utilization + '%</span><span class="hfi-stat-lbl">空间利用</span></div>';
                html += '<div class="hfi-stat"><span class="hfi-stat-val">' + furnace.totalWeight + '</span><span class="hfi-stat-lbl">实际负载/kg</span></div>';
                html += '<div class="hfi-stat"><span class="hfi-stat-val">' + furnace.weightLoadPct + '%</span><span class="hfi-stat-lbl">重量负载</span></div>';
                html += '</div>';

                // 物料明细
                if (furnace.items.length > 0) {
                    html += '<div class="hfi-items">';
                    furnace.items.forEach(item => {
                        html += '<span class="hfi-item-tag">';
                        html += '<span class="hfi-item-dot" style="background:' + item.color + ';"></span>';
                        html += item.name + ' ×' + item.count + ' (' + item.totalWeight.toFixed(1) + 'kg)';
                        html += '</span>';
                    });
                    html += '</div>';
                }

                html += '</div>';
            });
            html += '</div>';

            html += '</div>';
        });

        if (html === '') {
            container.innerHTML = '<div style="color: #999; font-size: 12px; text-align: center; padding: 30px;">该炉膛暂无历史记录</div>';
        } else {
            container.innerHTML = html;
        }
    }

    /**
     * 更新炉膛筛选下拉框（根据所有历史记录中的炉膛名称）
     */
    _updateFurnaceFilter() {
        const filter = document.getElementById('history-furnace-filter');
        if (!filter) return;

        const currentValue = filter.value;

        // 收集所有历史记录中出现过的炉膛
        const furnaceNames = new Set();
        this.historyRecords.forEach(record => {
            record.furnaces.forEach(f => {
                furnaceNames.add(f.instanceId);
            });
        });

        let optionsHtml = '<option value="all">全部炉膛</option>';
        furnaceNames.forEach(name => {
            const selected = name === currentValue ? ' selected' : '';
            optionsHtml += '<option value="' + name + '"' + selected + '>' + name + '</option>';
        });

        filter.innerHTML = optionsHtml;
    }
}