// ==================== 模块3：布局策略管理 ====================

import { ROUTING_STRATEGIES } from '../utils/constants.js';

/**
 * 布局策略管理模块
 * 负责装炉排布策略选择、安全间距配置、装炉优先级设置
 */
export class LayoutStrategy {
    constructor(formManager) {
        this.formManager = formManager;
    }

    /**
     * 初始化布局策略 UI 事件
     */
    init() {
        // 策略选择下拉框变化时触发重新计算（由外部协调器监听）
        const strategySelect = document.getElementById('routing-strategy');
        if (strategySelect) {
            strategySelect.addEventListener('change', () => {
                if (this._onStrategyChangeCallback) {
                    this._onStrategyChangeCallback(this.getSelectedStrategy());
                }
            });
        }

        // 安全间距变化时触发重新计算
        const spacingInput = document.getElementById('global-spacing');
        if (spacingInput) {
            spacingInput.addEventListener('change', () => {
                if (this._onSpacingChangeCallback) {
                    this._onSpacingChangeCallback(this.getSpacing());
                }
            });
        }
    }

    /**
     * 获取当前选中的排布策略
     */
    getSelectedStrategy() {
        const sel = document.getElementById('routing-strategy');
        return sel ? sel.value : 'STRATEGY_A';
    }

    /**
     * 获取安全间距值
     */
    getSpacing() {
        const input = document.getElementById('global-spacing');
        if (!input) return 5;
        const val = parseFloat(input.value);
        return isNaN(val) || val < 0 ? 5 : val;
    }

    /**
     * 策略变更回调
     */
    onStrategyChange(callback) {
        this._onStrategyChangeCallback = callback;
    }

    /**
     * 间距变更回调
     */
    onSpacingChange(callback) {
        this._onSpacingChangeCallback = callback;
    }
}