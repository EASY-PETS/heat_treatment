// ==================== 应用入口 ====================

import SceneManager from './three/scene.js';
import { solveHeterogeneousPacking, calculateFurnaceUtilization, getPackingStats } from './packing/solver.js';
import FormManager from './ui/forms.js';
import dataStore from './data/store.js';
import { DEFAULT_FURNACES, DEFAULT_ITEMS, DEFAULT_SPACING, ANIMATION_CONFIG, PDF_CONFIG, VIEW_CONFIGS, BATCH_COLORS } from './utils/constants.js';
import { formatNumber, sleep, generatePDFFilename, formatDateTime, calculateUtilization, calculateVolume } from './utils/helpers.js';
import { exportPDF } from '../PDF/exportPDF.js';

// 全局变量
let sceneManager = null;
let formManager = null;
let globalFurnacesResult = null;
let globalUnpackedItems = [];
let globalSpacingValue = DEFAULT_SPACING;
let isAnimating = false;
let animationPaused = false;
let animationResolve = null;
let animationActive = false;
let animationItemSteps = [];
let animationCurrentIndex = 0;
let batchColorIndex = 0;

/**
 * 生成炉膛显示/隐藏切换按钮
 */
function renderFurnaceToggles() {
    const container = document.getElementById('furnace-toggles');
    if (!container) return;
    container.innerHTML = '';

    if (!globalFurnacesResult || globalFurnacesResult.length <= 1) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';

    // "全部显示" 按钮
    const allBtn = document.createElement('button');
    allBtn.textContent = '👁 全部显示';
    allBtn.className = 'btn btn-secondary';
    allBtn.style.cssText = 'flex:1; min-width:80px; padding:6px 8px; font-size:11px; background:#4f46e5; color:#fff; border:1px solid #6366f1;';
    allBtn.addEventListener('click', () => {
        sceneManager.showAllFurnaces();
        // 更新所有按钮状态
        container.querySelectorAll('.furnace-toggle-btn').forEach((btn, i) => {
            btn.style.background = '#e67e22';
            btn.style.color = '#fff';
            btn.style.border = '2px solid #f39c12';
            btn.querySelector('span').textContent = '👁';
        });
    });
    container.appendChild(allBtn);

    // 每个炉膛的切换按钮
    globalFurnacesResult.forEach((furnace, index) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary furnace-toggle-btn';
        btn.style.cssText = 'flex:1; min-width:80px; padding:6px 8px; font-size:11px; background:#e67e22; color:#fff; border:2px solid #f39c12; cursor:pointer; border-radius:4px; transition:all 0.2s;';
        btn.innerHTML = `<span>👁</span> ${furnace.instanceId}`;

        btn.addEventListener('click', () => {
            const visible = sceneManager.toggleFurnaceVisible(index);
            if (visible) {
                btn.style.background = '#e67e22';
                btn.style.color = '#fff';
                btn.style.border = '2px solid #f39c12';
                btn.querySelector('span').textContent = '👁';
            } else {
                btn.style.background = '#374151';
                btn.style.color = '#9ca3af';
                btn.style.border = '2px solid #4b5563';
                btn.querySelector('span').textContent = '🚫';
            }
        });

        container.appendChild(btn);
    });
}

/**
 * 更新统计面板
 */
function updateStatsText() {
    if (!globalFurnacesResult) return '';
    
    let htmlStats = `<strong>多规格混合装炉计算完成！</strong><br>已启用物理炉膛台数: <span style="color:#00ffff; font-size:15px; font-weight:bold;">${globalFurnacesResult.length}</span> 台<br><br>`;
    
    globalFurnacesResult.forEach(f => {
        const totalVol = calculateVolume(f.w, f.h, f.d);
        let packedVol = f.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
        htmlStats += `
            <div style="background:#171722; padding:10px; border-radius:4px; margin-bottom:8px; border-left:4px solid #e67e22;">
                <strong style="color:#fff;">${f.instanceId}</strong> <span style="font-size:10px;color:#aaa;">(${Math.round(f.w)}x${Math.round(f.h)}x${Math.round(f.d)})</span><br>
                • 实际负载重: ${f.totalWeight.toFixed(1)} / ${f.maxWeight} kg<br>
                • 空间利用率: ${((packedVol / totalVol) * 100).toFixed(2)} %<br>
            </div>
        `;
    });

    if (globalUnpackedItems.length > 0) {
        htmlStats += `<div style="background:rgba(179,36,36,0.2); padding:10px; border-radius:4px; border:1px solid #b32424; color:#ff6666; margin-top:10px;">`;
        htmlStats += `<strong>⚠️ 异常提示 (车间剩余炉膛总容量暴库)：</strong><br>以下共计 <strong style="color:#fff;">${globalUnpackedItems.length}</strong> 件工件无法塞入现有炉膛资产，请增加车间炉膛或拆分批次：<br>`;
        
        let summaryUnpacked = {};
        globalUnpackedItems.forEach(u => { summaryUnpacked[u.name] = (summaryUnpacked[u.name] || 0) + 1; });
        for(let k in summaryUnpacked) {
            htmlStats += `• ${k} × ${summaryUnpacked[k]} 件<br>`;
        }
        htmlStats += `</div>`;
    }
    return htmlStats;
}

/**
 * 执行计算并渲染
 */
function executeAndRender() {
    if (isAnimating) return;

    const furnacePoolInput = formManager.getFurnacesData();
    const itemsInput = formManager.getItemsData();
    const spacing = formManager.getSpacing();
    globalSpacingValue = spacing;

    // 执行排布算法
    const result = solveHeterogeneousPacking(furnacePoolInput, itemsInput, spacing);
    globalFurnacesResult = result.completedFurnaces;
    globalUnpackedItems = result.unpackedItems;

    // 激活按钮
    document.getElementById('btn-export-pdf').style.display = 'block';
    document.getElementById('btn-animate').style.display = 'block';

    // 渲染3D场景
    sceneManager.renderPackingResult(globalFurnacesResult);

    // 生成炉膛显隐切换按钮
    renderFurnaceToggles();

    // 更新统计
    document.getElementById('summary-stats').innerHTML = updateStatsText();

    // 保存结果
    dataStore.saveResults({
        furnaces: globalFurnacesResult,
        unpacked: globalUnpackedItems
    });
}

/**
 * 根据不同批次名称自动分配颜色
 */
function getBatchColor(batchName) {
    if (!batchName) return BATCH_COLORS[0];
    // 使用简单哈希确保同一批次名称始终获得相同颜色
    let hash = 0;
    for (let i = 0; i < batchName.length; i++) {
        hash = ((hash << 5) - hash) + batchName.charCodeAt(i);
        hash |= 0;
    }
    const idx = Math.abs(hash) % BATCH_COLORS.length;
    return BATCH_COLORS[idx];
}

/**
 * 装炉动画（支持暂停/继续，兼容隐藏/显示炉膛）
 */
async function playLoadingAnimation() {
    if (isAnimating || !globalFurnacesResult || globalFurnacesResult.length === 0) return;
    isAnimating = true;
    animationActive = true;
    animationPaused = false;

    const btnAnimate = document.getElementById('btn-animate');
    btnAnimate.disabled = true;
    btnAnimate.style.opacity = '0.5';

    // 显示暂停/停止按钮
    const btnPause = document.getElementById('btn-pause-animation');
    const btnStop = document.getElementById('btn-stop-animation');
    if (btnPause) { btnPause.style.display = 'inline-block'; btnPause.textContent = '⏸ 暂停动画'; btnPause.style.background = '#f59e0b'; }
    if (btnStop) btnStop.style.display = 'inline-block';

    // 清空场景
    sceneManager.clearItems();

    // 保存当前炉膛可见状态
    const savedVisibility = [];
    if (sceneManager.furnaceGroups.length > 0) {
        sceneManager.furnaceGroups.forEach(g => savedVisibility.push(g.visible));
    }

    const spaceGap = ANIMATION_CONFIG.spaceGap;
    let currentXOffset = 0;
    animationItemSteps = [];
    animationCurrentIndex = 0;

    // 渲染所有炉膛边框
    globalFurnacesResult.forEach((furnace, fi) => {
        const xPos = currentXOffset + (furnace.w / 2);
        const isVisible = savedVisibility.length > 0 ? (savedVisibility[fi] !== false) : true;
        
        const furnaceBox = sceneManager.createFurnaceBox(furnace.w, furnace.h, furnace.d, xPos, furnace.instanceId);
        furnaceBox.visible = isVisible; // 根据先前可见性设置
        sceneManager.itemsGroup.add(furnaceBox);

        // 只处理可见炉膛的工件
        if (isVisible) {
            furnace.packedItems.forEach((item, idx) => {
                const mesh = sceneManager.createItemMesh(item);
                const targetX = xPos + item.x - (furnace.w / 2) + (item.w / 2);
                const targetY = item.y + (item.h / 2) - 120;
                const targetZ = item.z - (furnace.d / 2) + (item.d / 2);
                mesh.position.set(targetX, targetY, targetZ);
                mesh.visible = false;

                animationItemSteps.push({
                    mesh: mesh,
                    infoHtml: `👉 <b>操作指引：</b>请将 【${item.name}】 的第 ${idx + 1} 件工件，吊装推入 <b>${furnace.instanceId}</b><br><span style="color:#aaa; font-size:11px;">内部绝对参考零点定位坐标 (X, Y, Z): (${Math.round(item.x)}, ${Math.round(item.y)}, ${Math.round(item.z)})</span>`,
                    furnaceIndex: fi,
                    itemIndex: idx
                });
                sceneManager.itemsGroup.add(mesh);
            });
        }

        currentXOffset += furnace.w + spaceGap;
    });

    // 重新建立 furnaceGroups 索引（仅包含渲染的边框对象）
    sceneManager.furnaceGroups = [];
    sceneManager.itemsGroup.children.forEach(child => {
        // 边框组直接放在itemsGroup下（不是group包裹的）
        if (child.type === 'Group' && child.children.length > 0) {
            sceneManager.furnaceGroups.push(child);
        }
    });

    const statsPanel = document.getElementById('summary-stats');
    const baseStatsText = updateStatsText();

    for (let i = 0; i < animationItemSteps.length; i++) {
        animationCurrentIndex = i;
        const step = animationItemSteps[i];

        // 检查暂停
        if (animationPaused) {
            await new Promise(resolve => { animationResolve = resolve; });
        }

        // 如果动画被取消则中断
        if (!animationActive) break;

        // 显示工件
        step.mesh.visible = true;

        statsPanel.innerHTML = `
            <div style="background:#4f46e5; padding:12px; border-radius:6px; margin-bottom:15px; border-left:4px solid #00ffff; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
                <strong style="color:#fff; display:block; margin-bottom:4px;">🚚 车间现场吊装动画引导 (${i + 1} / ${animationItemSteps.length})</strong>
                ${step.infoHtml}
            </div>
        ` + baseStatsText;

        await sleep(ANIMATION_CONFIG.stepDelay);
    }

    // 动画结束
    if (animationActive) {
        statsPanel.innerHTML = `
            <div style="background:#16a34a; padding:12px; border-radius:6px; margin-bottom:15px; color:#fff;">
                🎉 <b>装炉模拟动画播放完毕！</b> 共指引完成 ${animationItemSteps.length} 件资产配位，工人可核对现场。
            </div>
        ` + baseStatsText;
    } else {
        statsPanel.innerHTML = `
            <div style="background:#f59e0b; padding:12px; border-radius:6px; margin-bottom:15px; color:#fff;">
                ⏹ <b>装炉动画已停止。</b>
            </div>
        ` + baseStatsText;
    }

    btnAnimate.disabled = false;
    btnAnimate.style.opacity = '1';
    if (btnPause) btnPause.style.display = 'none';
    if (btnStop) btnStop.style.display = 'none';
    isAnimating = false;
    animationActive = false;
    animationPaused = false;
    animationItemSteps = [];
    animationCurrentIndex = 0;
}

/**
 * 暂停/继续装炉动画
 */
function toggleAnimationPause() {
    if (!isAnimating) return;
    animationPaused = !animationPaused;

    const btnPause = document.getElementById('btn-pause-animation');
    if (animationPaused) {
        if (btnPause) btnPause.textContent = '▶ 继续动画';
        if (btnPause) btnPause.style.background = '#16a34a';
    } else {
        if (btnPause) btnPause.textContent = '⏸ 暂停动画';
        if (btnPause) btnPause.style.background = '#f59e0b';
        if (animationResolve) {
            animationResolve();
            animationResolve = null;
        }
    }
}

/**
 * 停止装炉动画
 */
function stopAnimation() {
    if (!isAnimating) return;
    animationActive = false;
    animationPaused = false;
    if (animationResolve) {
        animationResolve();
        animationResolve = null;
    }
}

// ==================== PDF 生成 (已迁移至 PDF/ 模块) ====================

/**
 * 导出工业标准PDF工艺报告
 * 使用 PDF/ 目录下的模块化PDF生成系统
 */
function exportToProfessionalPDF() {
    if (!globalFurnacesResult) return;
    
    exportPDF({
        furnaces: globalFurnacesResult,
        unpacked: globalUnpackedItems
    });
}

// ==================== 初始化 ====================

function init() {
    // 初始化3D场景
    sceneManager = new SceneManager('canvas-container');
    sceneManager.init();

    // 初始化表单管理
    formManager = new FormManager();

    // 绑定按钮事件
    document.getElementById('btn-add-furnace').addEventListener('click', () => {
        formManager.addFurnaceRow('自定义新增空闲炉膛', 400, 200, 200, 15000, 1);
    });
    document.getElementById('btn-add-item').addEventListener('click', () => {
        // 新批次使用自动分配的颜色
        batchColorIndex++;
        const color = BATCH_COLORS[batchColorIndex % BATCH_COLORS.length];
        const batchName = `工件批次_${batchColorIndex}`;
        formManager.addItemRow(batchName, 'cuboid', 10, 50, 50, 60, 1500, color);
    });
    document.getElementById('btn-calculate').addEventListener('click', executeAndRender);
    document.getElementById('btn-animate').addEventListener('click', playLoadingAnimation);
    document.getElementById('btn-export-pdf').addEventListener('click', exportToProfessionalPDF);

    // 暂停/继续动画按钮
    document.getElementById('btn-pause-animation').addEventListener('click', toggleAnimationPause);
    document.getElementById('btn-stop-animation').addEventListener('click', stopAnimation);

    // 视角对准按钮
    document.getElementById('btn-view-front').addEventListener('click', () => {
        if (globalFurnacesResult) sceneManager.focusOnView('front', globalFurnacesResult);
    });
    document.getElementById('btn-view-top').addEventListener('click', () => {
        if (globalFurnacesResult) sceneManager.focusOnView('top', globalFurnacesResult);
    });
    document.getElementById('btn-view-side').addEventListener('click', () => {
        if (globalFurnacesResult) sceneManager.focusOnView('side', globalFurnacesResult);
    });
    document.getElementById('btn-view-default').addEventListener('click', () => {
        if (globalFurnacesResult) sceneManager.focusOnView('default', globalFurnacesResult);
    });

    // 加载默认数据
    formManager.initDefaultData(DEFAULT_FURNACES, DEFAULT_ITEMS);

    // 延迟执行初始计算
    setTimeout(executeAndRender, 350);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);