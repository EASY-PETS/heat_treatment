// ==================== 模块4：方案3D预览 ====================

import { VIEW_CONFIGS, SCENE_CONFIG, ANIMATION_CONFIG } from '../utils/constants.js';
import { calculateVolume, sleep } from '../utils/helpers.js';

/**
 * 方案3D预览模块
 * 负责3D渲染控制、相机视角切换、动画播放、炉膛信息展示、物料高亮
 */
export class Preview3D {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.isAnimating = false;
        this.animationPaused = false;
        this.animationResolve = null;
        this.animationActive = false;
        this.animationItemSteps = [];
        this.animationCurrentIndex = 0;
        this.globalFurnacesResult = null;
        this.globalUnpackedItems = [];
        this.highlightedBatchName = null;
        this._onHighlightCallback = null;
        this._onAnimateCallback = null;
        // 当前显示的炉膛索引（单炉膛模式）
        this._currentFurnaceIndex = 0;
    }

    /**
     * 初始化3D预览 UI 事件
     */
    init() {
        // 视角切换按钮
        document.getElementById('btn-view-front').addEventListener('click', () => {
            if (this.globalFurnacesResult) {
                this.sceneManager.focusOnView('front', this.globalFurnacesResult);
            }
        });
        document.getElementById('btn-view-top').addEventListener('click', () => {
            if (this.globalFurnacesResult) {
                this.sceneManager.focusOnView('top', this.globalFurnacesResult);
            }
        });
        document.getElementById('btn-view-side').addEventListener('click', () => {
            if (this.globalFurnacesResult) {
                this.sceneManager.focusOnView('side', this.globalFurnacesResult);
            }
        });
        document.getElementById('btn-view-default').addEventListener('click', () => {
            if (this.globalFurnacesResult) {
                this.sceneManager.focusOnView('default', this.globalFurnacesResult);
            }
        });

        // 炉膛切换：上一台
        const btnPrev = document.getElementById('btn-furnace-prev');
        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                if (!this.globalFurnacesResult || this.globalFurnacesResult.length === 0) return;
                const total = this.globalFurnacesResult.length;
                this._currentFurnaceIndex = (this._currentFurnaceIndex - 1 + total) % total;
                this._switchToFurnace(this._currentFurnaceIndex);
            });
        }

        // 炉膛切换：下一台
        const btnNext = document.getElementById('btn-furnace-next');
        if (btnNext) {
            btnNext.addEventListener('click', () => {
                if (!this.globalFurnacesResult || this.globalFurnacesResult.length === 0) return;
                const total = this.globalFurnacesResult.length;
                this._currentFurnaceIndex = (this._currentFurnaceIndex + 1) % total;
                this._switchToFurnace(this._currentFurnaceIndex);
            });
        }

        // 炉膛速览按钮
        const btnOverview = document.getElementById('btn-furnace-overview');
        if (btnOverview) {
            btnOverview.addEventListener('click', () => {
                this._toggleFurnaceOverviewPanel();
            });
        }

        // 关闭炉膛速览
        const btnCloseOverview = document.getElementById('btn-close-furnace-overview');
        if (btnCloseOverview) {
            btnCloseOverview.addEventListener('click', () => {
                const panel = document.getElementById('furnace-overview-panel');
                if (panel) panel.style.display = 'none';
            });
        }

        // 动画控制按钮
        document.getElementById('btn-animate').addEventListener('click', () => {
            if (this._onAnimateCallback) this._onAnimateCallback();
        });
        document.getElementById('btn-pause-animation').addEventListener('click', () => {
            this.toggleAnimationPause();
        });
        document.getElementById('btn-stop-animation').addEventListener('click', () => {
            this.stopAnimation();
        });

        // 监听全局打开速览事件
        window.addEventListener('open-furnace-overview', () => {
            // 切换到结果预览标签页
            const tabBtn4 = document.querySelector('[data-tab="tab-module-4"]');
            if (tabBtn4) tabBtn4.click();

            // 打开速览面板
            const panel = document.getElementById('furnace-overview-panel');
            if (panel) {
                this._renderFurnaceOverviewList();
                panel.style.display = 'block';
                // 延迟滚动，确保标签页切换完成
                setTimeout(() => {
                    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
            }
        });
    }

    /**
     * 切换到指定炉膛（单炉膛模式）
     */
    _switchToFurnace(index) {
        if (!this.globalFurnacesResult || index < 0 || index >= this.globalFurnacesResult.length) return;
        this._currentFurnaceIndex = index;
        this.sceneManager.showSingleFurnace(index);
        this._updateFurnaceSwitcherLabel();
        this.updateFurnaceInfoPanel();
    }

    /**
     * 更新炉膛切换器标签文字
     */
    _updateFurnaceSwitcherLabel() {
        const label = document.getElementById('furnace-switcher-label');
        if (!label || !this.globalFurnacesResult) return;
        const total = this.globalFurnacesResult.length;
        const furnace = this.globalFurnacesResult[this._currentFurnaceIndex];
        if (furnace) {
            label.textContent = `${this._currentFurnaceIndex + 1} / ${total}`;
            label.title = furnace.instanceId;
        }
    }

    /**
     * 切换炉膛速览面板显示/隐藏
     */
    _toggleFurnaceOverviewPanel() {
        const panel = document.getElementById('furnace-overview-panel');
        if (!panel) return;
        if (panel.style.display === 'none' || panel.style.display === '') {
            this._renderFurnaceOverviewList();
            panel.style.display = 'block';
        } else {
            panel.style.display = 'none';
        }
    }

    /**
     * 渲染炉膛速览列表
     */
    _renderFurnaceOverviewList() {
        const listEl = document.getElementById('furnace-overview-list');
        if (!listEl || !this.globalFurnacesResult) return;

        let html = '';
        this.globalFurnacesResult.forEach((furnace, index) => {
            const totalVol = calculateVolume(furnace.w, furnace.h, furnace.d);
            let packedVol = furnace.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
            const utilPct = ((packedVol / totalVol) * 100).toFixed(1);
            const weightPct = ((furnace.totalWeight / furnace.maxWeight) * 100).toFixed(1);
            const isActive = index === this._currentFurnaceIndex;

            html += `<div class="furnace-overview-item${isActive ? ' furnace-overview-item-active' : ''}" data-furnace-index="${index}">`;
            html += `<div class="foi-header">`;
            html += `<span class="foi-num">${index + 1}</span>`;
            html += `<span class="foi-name">🔥 ${furnace.instanceId}</span>`;
            if (isActive) html += `<span class="foi-active-badge">当前</span>`;
            html += `</div>`;
            html += `<div class="foi-spec">${Math.round(furnace.w)} × ${Math.round(furnace.h)} × ${Math.round(furnace.d)} mm</div>`;
            html += `<div class="foi-stats">`;
            html += `<span class="foi-stat"><b>${furnace.packedItems.length}</b> 件</span>`;
            html += `<span class="foi-stat"><b>${utilPct}%</b> 利用率</span>`;
            html += `<span class="foi-stat"><b>${furnace.totalWeight.toFixed(1)}</b> kg</span>`;
            html += `<span class="foi-stat"><b>${weightPct}%</b> 负载</span>`;
            html += `</div>`;
            html += `</div>`;
        });

        listEl.innerHTML = html;

        // 绑定点击切换
        listEl.querySelectorAll('.furnace-overview-item').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.getAttribute('data-furnace-index'), 10);
                this._switchToFurnace(idx);
                // 刷新速览列表高亮
                this._renderFurnaceOverviewList();
            });
        });
    }

    /**
     * 设置数据更新回调
     */
    onAnimate(callback) {
        this._onAnimateCallback = callback;
    }

    onHighlight(callback) {
        this._onHighlightCallback = callback;
    }

    /**
     * 更新方案结果引用
     */
    updateResult(furnaces, unpacked) {
        this.globalFurnacesResult = furnaces;
        this.globalUnpackedItems = unpacked;
        // 重置当前炉膛索引到第一台
        this._currentFurnaceIndex = 0;
    }

    /**
     * 渲染装炉结果
     */
    renderPackingResult() {
        if (!this.globalFurnacesResult) return;
        // 重置炉膛索引
        this._currentFurnaceIndex = 0;
        this.sceneManager.renderPackingResult(this.globalFurnacesResult);
        this.updateFurnaceInfoPanel();
        this._renderFurnaceSwitcher();
    }

    /**
     * 渲染炉膛切换器（新设计：上一台/下一台/速览）
     */
    _renderFurnaceSwitcher() {
        const area = document.getElementById('furnace-switcher-area');
        if (!area) return;

        if (!this.globalFurnacesResult || this.globalFurnacesResult.length === 0) {
            area.style.display = 'none';
            return;
        }

        area.style.display = 'flex';
        this._updateFurnaceSwitcherLabel();

        // 单炉膛时隐藏上一台/下一台按钮
        const btnPrev = document.getElementById('btn-furnace-prev');
        const btnNext = document.getElementById('btn-furnace-next');
        if (this.globalFurnacesResult.length <= 1) {
            if (btnPrev) btnPrev.style.display = 'none';
            if (btnNext) btnNext.style.display = 'none';
        } else {
            if (btnPrev) btnPrev.style.display = '';
            if (btnNext) btnNext.style.display = '';
        }
    }

    /**
     * 更新炉膛装配信息面板
     */
    updateFurnaceInfoPanel() {
        const body = document.getElementById('furnace-info-body');
        const hint = document.getElementById('furnace-info-hint');
        if (!body) return;

        if (!this.globalFurnacesResult || this.globalFurnacesResult.length === 0) {
            body.innerHTML = '<div class="furnace-info-empty">暂无装炉方案，请先配置并点击「生成方案」</div>';
            if (hint) hint.textContent = '生成方案后查看当前进炉方向';
            return;
        }

        const furnaceIndex = this._currentFurnaceIndex;
        if (furnaceIndex >= this.globalFurnacesResult.length) {
            this._currentFurnaceIndex = 0;
        }
        const furnace = this.globalFurnacesResult[this._currentFurnaceIndex];

        const totalVol = calculateVolume(furnace.w, furnace.h, furnace.d);
        let packedVol = furnace.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
        const utilPct = ((packedVol / totalVol) * 100).toFixed(1);
        const weightPct = ((furnace.totalWeight / furnace.maxWeight) * 100).toFixed(1);

        if (hint) {
            hint.textContent = `当前显示: 第 ${this._currentFurnaceIndex + 1} / ${this.globalFurnacesResult.length} 台`;
        }

        const itemSummary = {};
        furnace.packedItems.forEach(item => {
            const key = item.name;
            if (!itemSummary[key]) {
                itemSummary[key] = {
                    name: key,
                    color: item.color,
                    count: 0,
                    totalWeight: 0,
                    dimensions: item.shape === 'cylinder'
                        ? `Φ${Math.round(item.w)}×H${Math.round(item.h)}`
                        : `${Math.round(item.w)}×${Math.round(item.h)}×${Math.round(item.d)}`
                };
            }
            itemSummary[key].count++;
            itemSummary[key].totalWeight += (item.weight || 0);
        });

        let itemsRows = '';
        const sortedKeys = Object.keys(itemSummary).sort();
        sortedKeys.forEach(key => {
            const s = itemSummary[key];
            itemsRows += `<tr>
                <td><span class="fi-item-color-dot" style="background:${s.color};box-shadow:0 0 4px ${s.color};"></span>${s.name}</td>
                <td>${s.dimensions}</td>
                <td>${s.count} 件</td>
                <td>${s.totalWeight.toFixed(1)} kg</td>
            </tr>`;
        });

        let html = '<div class="furnace-info-card">';
        html += `<div class="fi-name">🔥 ${furnace.instanceId}</div>`;
        html += `<div class="fi-spec">规格: ${Math.round(furnace.w)} × ${Math.round(furnace.h)} × ${Math.round(furnace.d)} mm · 容积: ${(totalVol / 1e6).toFixed(2)} m³</div>`;
        html += '<div class="fi-stats">';
        html += `<div class="fi-stat-item"><div class="fi-stat-value">${furnace.packedItems.length}</div><div class="fi-stat-label">装载工件总数/件</div></div>`;
        html += `<div class="fi-stat-item"><div class="fi-stat-value">${utilPct}%</div><div class="fi-stat-label">空间利用率</div></div>`;
        html += `<div class="fi-stat-item"><div class="fi-stat-value">${furnace.totalWeight.toFixed(1)}</div><div class="fi-stat-label">实际负载重 / kg</div></div>`;
        html += `<div class="fi-stat-item"><div class="fi-stat-value">${weightPct}%</div><div class="fi-stat-label">重量负载率 (max ${furnace.maxWeight}kg)</div></div>`;
        html += '</div>';

        if (sortedKeys.length > 0) {
            html += '<table class="fi-items-table">';
            html += '<thead><tr><th>物料名称</th><th>规格尺寸</th><th>数量</th><th>总重</th></tr></thead>';
            html += '<tbody>' + itemsRows + '</tbody>';
            html += '</table>';
        } else {
            html += '<div class="fi-no-items">此炉膛暂无装载工件</div>';
        }
        html += '</div>';
        body.innerHTML = html;
    }

    /**
     * 高亮指定批次的物料
     */
    highlightBatchInFurnace(batchName) {
        if (!this.sceneManager || !this.globalFurnacesResult) return;

        if (this.highlightedBatchName === batchName) {
            this.sceneManager.clearHighlight();
            this.highlightedBatchName = null;
        } else {
            this.sceneManager.highlightItemsByName(batchName);
            this.highlightedBatchName = batchName;
        }

        if (this._onHighlightCallback) {
            this._onHighlightCallback(this.highlightedBatchName);
        }

        if (this.highlightedBatchName && this.globalFurnacesResult.length > 0) {
            this.sceneManager.focusOnHighlightedItems(this.globalFurnacesResult);
        }
    }

    /**
     * 动画暂停/恢复切换
     */
    toggleAnimationPause() {
        if (!this.isAnimating) return;
        this.animationPaused = !this.animationPaused;

        const btnPause = document.getElementById('btn-pause-animation');
        if (this.animationPaused) {
            if (btnPause) { btnPause.textContent = '继续动画'; btnPause.style.background = '#16a34a'; }
        } else {
            if (btnPause) { btnPause.textContent = '暂停动画'; btnPause.style.background = '#f59e0b'; }
            if (this.animationResolve) {
                this.animationResolve();
                this.animationResolve = null;
            }
        }
    }

    /**
     * 停止动画
     */
    stopAnimation() {
        if (!this.isAnimating) return;
        this.animationActive = false;
        this.animationPaused = false;
        if (this.animationResolve) {
            this.animationResolve();
            this.animationResolve = null;
        }
    }

    /**
     * 获取动画状态
     */
    getIsAnimating() {
        return this.isAnimating;
    }

    setIsAnimating(val) {
        this.isAnimating = val;
    }

    getAnimationActive() {
        return this.animationActive;
    }

    setAnimationActive(val) {
        this.animationActive = val;
    }

    getAnimationItemSteps() {
        return this.animationItemSteps;
    }

    setAnimationItemSteps(steps) {
        this.animationItemSteps = steps;
    }

    getAnimationCurrentIndex() {
        return this.animationCurrentIndex;
    }

    setAnimationCurrentIndex(idx) {
        this.animationCurrentIndex = idx;
    }

    getAnimationPaused() {
        return this.animationPaused;
    }

    getAnimationResolve() {
        return this.animationResolve;
    }

    setAnimationResolve(resolve) {
        this.animationResolve = resolve;
    }

    /**
     * 播放装炉动画
     * 修复：每次播放前完整重置状态，使用当前 globalFurnacesResult 快照，
     * 避免跨页面操作后数据不一致导致的崩溃
     */
    async playLoadingAnimation(getStatsTextFn) {
        // 防止重入
        if (this.isAnimating) return;
        // 必须有有效的计算结果
        if (!this.globalFurnacesResult || this.globalFurnacesResult.length === 0) return;

        // 对当前结果做快照，防止动画过程中外部数据被修改
        const furnacesSnapshot = this.globalFurnacesResult.map(f => ({
            ...f,
            packedItems: f.packedItems ? [...f.packedItems] : []
        }));

        // ---- 重置所有动画状态 ----
        this.isAnimating = true;
        this.animationActive = true;
        this.animationPaused = false;
        this.animationResolve = null;
        this.animationItemSteps = [];
        this.animationCurrentIndex = 0;

        const btnAnimate = document.getElementById('btn-animate');
        if (btnAnimate) {
            btnAnimate.disabled = true;
            btnAnimate.style.opacity = '0.5';
        }

        const btnPause = document.getElementById('btn-pause-animation');
        const btnStop = document.getElementById('btn-stop-animation');
        if (btnPause) { btnPause.style.display = 'inline-block'; btnPause.textContent = '暂停动画'; btnPause.style.background = '#f59e0b'; }
        if (btnStop) btnStop.style.display = 'inline-block';

        // 清空场景中的工件，重新构建动画场景
        this.sceneManager.clearItems();
        this.sceneManager.clearHighlight();
        this.highlightedBatchName = null;
        if (this._onHighlightCallback) {
            this._onHighlightCallback(null);
        }

        const spaceGap = ANIMATION_CONFIG.spaceGap;

        // 计算总宽度，居中布局
        let totalWidth = 0;
        furnacesSnapshot.forEach(f => { totalWidth += f.w + spaceGap; });
        totalWidth -= spaceGap;
        const startX = -totalWidth / 2;
        let currentXOffset = startX;

        // 动画只针对当前显示的炉膛（单炉膛模式下只动画当前炉膛）
        const animFurnaceIndex = this._currentFurnaceIndex;

        furnacesSnapshot.forEach((furnace, fi) => {
            const xPos = currentXOffset + (furnace.w / 2);
            // 动画模式下只显示当前炉膛
            const isVisible = (fi === animFurnaceIndex);

            const furnaceBox = this.sceneManager.createFurnaceBox(furnace.w, furnace.h, furnace.d, xPos, furnace.instanceId);
            furnaceBox.visible = isVisible;
            this.sceneManager.itemsGroup.add(furnaceBox);

            if (isVisible) {
                furnace.packedItems.forEach((item, idx) => {
                    const mesh = this.sceneManager.createItemMesh(item);
                    const targetX = xPos + item.x - (furnace.w / 2) + (item.w / 2);
                    const targetY = item.y + (item.h / 2) + SCENE_CONFIG.groundOffset;
                    const targetZ = item.z - (furnace.d / 2) + (item.d / 2);
                    mesh.position.set(targetX, targetY, targetZ);
                    mesh.visible = false;

                    this.animationItemSteps.push({
                        mesh: mesh,
                        infoHtml: '操作指引：请将 【' + item.name + '】 的第 ' + (idx + 1) + ' 件工件，吊装推入 <b>' + furnace.instanceId + '</b><br><span style="color:#aaa; font-size:11px;">内部绝对参考零点定位坐标 (X, Y, Z): (' + Math.round(item.x) + ', ' + Math.round(item.y) + ', ' + Math.round(item.z) + ')</span>',
                        furnaceIndex: fi,
                        itemIndex: idx
                    });
                    this.sceneManager.itemsGroup.add(mesh);
                });
            }

            currentXOffset += furnace.w + spaceGap;
        });

        // 重建 furnaceGroups 引用（仅包含 Group 类型子节点）
        this.sceneManager.furnaceGroups = [];
        this.sceneManager.itemsGroup.children.forEach(child => {
            if (child.isGroup || (child.type === 'Group' && child.children.length > 0)) {
                this.sceneManager.furnaceGroups.push(child);
            }
        });

        const statsPanel = document.getElementById('summary-stats-preview');
        const baseStatsText = typeof getStatsTextFn === 'function' ? getStatsTextFn() : '';

        for (let i = 0; i < this.animationItemSteps.length; i++) {
            this.animationCurrentIndex = i;
            const step = this.animationItemSteps[i];

            // 暂停等待
            if (this.animationPaused) {
                await new Promise(resolve => { this.animationResolve = resolve; });
                this.animationResolve = null;
            }

            // 检查是否已停止
            if (!this.animationActive) break;

            step.mesh.visible = true;

            if (statsPanel) {
                statsPanel.innerHTML = '<div style="background:#4f46e5; padding:12px; border-radius:6px; margin-bottom:15px; border-left:4px solid #00ffff; box-shadow: 0 4px 12px rgba(0,0,0,0.4);"><strong style="color:#fff; display:block; margin-bottom:4px;">车间现场吊装动画引导 (' + (i + 1) + ' / ' + this.animationItemSteps.length + ')</strong>' + step.infoHtml + '</div>' + baseStatsText;
            }

            await sleep(ANIMATION_CONFIG.stepDelay);
        }

        if (statsPanel) {
            if (this.animationActive) {
                statsPanel.innerHTML = '<div style="background:#16a34a; padding:12px; border-radius:6px; margin-bottom:15px; color:#fff;">装炉模拟动画播放完毕！ 共指引完成 ' + this.animationItemSteps.length + ' 件资产配位，工人可核对现场。</div>' + baseStatsText;
            } else {
                statsPanel.innerHTML = '<div style="background:#f59e0b; padding:12px; border-radius:6px; margin-bottom:15px; color:#fff;">装炉动画已停止。</div>' + baseStatsText;
            }
        }

        // ---- 动画结束：恢复正常渲染 ----
        if (btnAnimate) {
            btnAnimate.disabled = false;
            btnAnimate.style.opacity = '1';
        }
        if (btnPause) btnPause.style.display = 'none';
        if (btnStop) btnStop.style.display = 'none';

        // 重置动画状态
        this.isAnimating = false;
        this.animationActive = false;
        this.animationPaused = false;
        this.animationResolve = null;
        this.animationItemSteps = [];
        this.animationCurrentIndex = 0;

        // 动画结束后恢复正常3D渲染（重新渲染当前结果）
        if (this.globalFurnacesResult && this.globalFurnacesResult.length > 0) {
            this.sceneManager.renderPackingResult(this.globalFurnacesResult);
            // 恢复到动画前的炉膛
            this.sceneManager.showSingleFurnace(animFurnaceIndex);
            this._currentFurnaceIndex = animFurnaceIndex;
            this.updateFurnaceInfoPanel();
        }
    }

}
