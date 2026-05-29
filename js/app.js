// ==================== 应用入口 ====================

import SceneManager from './three/scene.js';
import { solveHeterogeneousPacking, calculateFurnaceUtilization, getPackingStats } from './packing/solver.js';
import FormManager from './ui/forms.js';
import dataStore from './data/store.js';
import { DEFAULT_FURNACES, DEFAULT_ITEMS, DEFAULT_SPACING, ANIMATION_CONFIG, SCENE_CONFIG, PDF_CONFIG, VIEW_CONFIGS, BATCH_COLORS, ROUTING_STRATEGIES, VACUUM_LEVEL_OPTIONS, HEATING_PROGRAM_OPTIONS } from './utils/constants.js';
import { formatNumber, sleep, generatePDFFilename, formatDateTime, calculateUtilization, calculateVolume } from './utils/helpers.js';
import { parseExcelFile, generateExcelTemplate } from './utils/excel.js';
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
// 规则8: 炉膛装载优先级排序状态
let furnacePriorityOrder = [];
// 当前高亮的物料批次名
let highlightedBatchName = null;

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
    allBtn.textContent = '全部显示';
    allBtn.className = 'btn btn-secondary';
    allBtn.style.cssText = 'flex:1; min-width:80px; padding:6px 8px; font-size:11px; background:#4f46e5; color:#fff; border:1px solid #6366f1;';
    allBtn.addEventListener('click', () => {
        sceneManager.showAllFurnaces();
        container.querySelectorAll('.furnace-toggle-btn').forEach((btn, i) => {
            btn.style.background = '#e67e22';
            btn.style.color = '#fff';
            btn.style.border = '2px solid #f39c12';
            btn.querySelector('span').textContent = '眼';
        });
    });
    container.appendChild(allBtn);

    globalFurnacesResult.forEach((furnace, index) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary furnace-toggle-btn';
        btn.style.cssText = 'flex:1; min-width:80px; padding:6px 8px; font-size:11px; background:#e67e22; color:#fff; border:2px solid #f39c12; cursor:pointer; border-radius:4px; transition:all 0.2s;';
        btn.innerHTML = '<span>眼</span> ' + furnace.instanceId;

        btn.addEventListener('click', () => {
            const visible = sceneManager.toggleFurnaceVisible(index);
            if (visible) {
                btn.style.background = '#e67e22';
                btn.style.color = '#fff';
                btn.style.border = '2px solid #f39c12';
                btn.querySelector('span').textContent = '眼';
            } else {
                btn.style.background = '#374151';
                btn.style.color = '#9ca3af';
                btn.style.border = '2px solid #4b5563';
                btn.querySelector('span').textContent = '禁';
            }
        });

        container.appendChild(btn);
    });
}

function updateStatsText() {
    if (!globalFurnacesResult) return '';
    
    let htmlStats = '<strong>多规格混合装炉计算完成！</strong><br>已启用物理炉膛台数: <span style="color:#00ffff; font-size:15px; font-weight:bold;">' + globalFurnacesResult.length + '</span> 台<br><br>';
    
    globalFurnacesResult.forEach(f => {
        const totalVol = calculateVolume(f.w, f.h, f.d);
        let packedVol = f.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
        htmlStats += '<div style="background:#171722; padding:10px; border-radius:4px; margin-bottom:8px; border-left:4px solid #e67e22;">';
        htmlStats += '<strong style="color:#fff;">' + f.instanceId + '</strong> <span style="font-size:10px;color:#aaa;">(' + Math.round(f.w) + 'x' + Math.round(f.h) + 'x' + Math.round(f.d) + ')</span><br>';
        htmlStats += '实际负载重: ' + f.totalWeight.toFixed(1) + ' / ' + f.maxWeight + ' kg<br>';
        htmlStats += '空间利用率: ' + ((packedVol / totalVol) * 100).toFixed(2) + ' %<br>';
        htmlStats += '</div>';
    });

    if (globalUnpackedItems.length > 0) {
        htmlStats += '<div style="background:rgba(179,36,36,0.2); padding:10px; border-radius:4px; border:1px solid #b32424; color:#ff6666; margin-top:10px;">';
        htmlStats += '<strong>异常提示 (车间剩余炉膛总容量暴库)：</strong><br>以下共计 <strong style="color:#fff;">' + globalUnpackedItems.length + '</strong> 件工件无法塞入现有炉膛资产，请增加车间炉膛或拆分批次：<br>';
        
        let summaryUnpacked = {};
        globalUnpackedItems.forEach(u => { summaryUnpacked[u.name] = (summaryUnpacked[u.name] || 0) + 1; });
        for(let k in summaryUnpacked) {
            htmlStats += k + ' x ' + summaryUnpacked[k] + ' 件<br>';
        }
        htmlStats += '</div>';
    }
    return htmlStats;
}

function getSelectedRoutingStrategy() {
    const sel = document.getElementById('routing-strategy');
    return sel ? sel.value : 'STRATEGY_A';
}

function executeAndRender() {
    if (isAnimating) return;

    const furnacePoolInput = formManager.getFurnacesData();
    const itemsInput = formManager.getItemsData();
    const spacing = formManager.getSpacing();
    const routingStrategy = getSelectedRoutingStrategy();
    globalSpacingValue = spacing;

    const priorityOrder = getFurnacePriorityOrder();

    const result = solveHeterogeneousPacking(furnacePoolInput, itemsInput, spacing, routingStrategy, priorityOrder);
    globalFurnacesResult = result.completedFurnaces;
    globalUnpackedItems = result.unpackedItems;

    document.getElementById('btn-export-pdf').style.display = 'block';
    document.getElementById('btn-animate').style.display = 'block';

    sceneManager.renderPackingResult(globalFurnacesResult);
    renderFurnaceToggles();
    document.getElementById('summary-stats').innerHTML = updateStatsText();

    dataStore.saveResults({
        furnaces: globalFurnacesResult,
        unpacked: globalUnpackedItems
    });

    // 刷新物料汇总速览（重新生成后可点击高亮）
    refreshItemQuickSummary();
}

function getBatchColor(batchName) {
    if (!batchName) return BATCH_COLORS[0];
    let hash = 0;
    for (let i = 0; i < batchName.length; i++) {
        hash = ((hash << 5) - hash) + batchName.charCodeAt(i);
        hash |= 0;
    }
    const idx = Math.abs(hash) % BATCH_COLORS.length;
    return BATCH_COLORS[idx];
}

async function playLoadingAnimation() {
    if (isAnimating || !globalFurnacesResult || globalFurnacesResult.length === 0) return;
    isAnimating = true;
    animationActive = true;
    animationPaused = false;

    const btnAnimate = document.getElementById('btn-animate');
    btnAnimate.disabled = true;
    btnAnimate.style.opacity = '0.5';

    const btnPause = document.getElementById('btn-pause-animation');
    const btnStop = document.getElementById('btn-stop-animation');
    if (btnPause) { btnPause.style.display = 'inline-block'; btnPause.textContent = '暂停动画'; btnPause.style.background = '#f59e0b'; }
    if (btnStop) btnStop.style.display = 'inline-block';

    sceneManager.clearItems();
    // 清除高亮状态
    sceneManager.clearHighlight();
    highlightedBatchName = null;
    refreshItemQuickSummary();

    const savedVisibility = [];
    if (sceneManager.furnaceGroups.length > 0) {
        sceneManager.furnaceGroups.forEach(g => savedVisibility.push(g.visible));
    }

    const spaceGap = ANIMATION_CONFIG.spaceGap;

    // 计算总宽度，所有炉膛居中放置在原点附近
    let totalWidth = 0;
    globalFurnacesResult.forEach(f => { totalWidth += f.w + spaceGap; });
    totalWidth -= spaceGap;
    const startX = -totalWidth / 2;
    let currentXOffset = startX;

    animationItemSteps = [];
    animationCurrentIndex = 0;

    globalFurnacesResult.forEach((furnace, fi) => {
        const xPos = currentXOffset + (furnace.w / 2);
        const isVisible = savedVisibility.length > 0 ? (savedVisibility[fi] !== false) : true;
        
        const furnaceBox = sceneManager.createFurnaceBox(furnace.w, furnace.h, furnace.d, xPos, furnace.instanceId);
        furnaceBox.visible = isVisible;
        sceneManager.itemsGroup.add(furnaceBox);

        if (isVisible) {
            furnace.packedItems.forEach((item, idx) => {
                const mesh = sceneManager.createItemMesh(item);
                const targetX = xPos + item.x - (furnace.w / 2) + (item.w / 2);
                const targetY = item.y + (item.h / 2) + SCENE_CONFIG.groundOffset;
                const targetZ = item.z - (furnace.d / 2) + (item.d / 2);
                mesh.position.set(targetX, targetY, targetZ);
                mesh.visible = false;

                animationItemSteps.push({
                    mesh: mesh,
                    infoHtml: '操作指引：请将 【' + item.name + '】 的第 ' + (idx + 1) + ' 件工件，吊装推入 <b>' + furnace.instanceId + '</b><br><span style="color:#aaa; font-size:11px;">内部绝对参考零点定位坐标 (X, Y, Z): (' + Math.round(item.x) + ', ' + Math.round(item.y) + ', ' + Math.round(item.z) + ')</span>',
                    furnaceIndex: fi,
                    itemIndex: idx
                });
                sceneManager.itemsGroup.add(mesh);
            });
        }

        currentXOffset += furnace.w + spaceGap;
    });

    sceneManager.furnaceGroups = [];
    sceneManager.itemsGroup.children.forEach(child => {
        if (child.type === 'Group' && child.children.length > 0) {
            sceneManager.furnaceGroups.push(child);
        }
    });

    const statsPanel = document.getElementById('summary-stats');
    const baseStatsText = updateStatsText();

    for (let i = 0; i < animationItemSteps.length; i++) {
        animationCurrentIndex = i;
        const step = animationItemSteps[i];

        if (animationPaused) {
            await new Promise(resolve => { animationResolve = resolve; });
        }

        if (!animationActive) break;

        step.mesh.visible = true;

        statsPanel.innerHTML = '<div style="background:#4f46e5; padding:12px; border-radius:6px; margin-bottom:15px; border-left:4px solid #00ffff; box-shadow: 0 4px 12px rgba(0,0,0,0.4);"><strong style="color:#fff; display:block; margin-bottom:4px;">车间现场吊装动画引导 (' + (i + 1) + ' / ' + animationItemSteps.length + ')</strong>' + step.infoHtml + '</div>' + baseStatsText;

        await sleep(ANIMATION_CONFIG.stepDelay);
    }

    if (animationActive) {
        statsPanel.innerHTML = '<div style="background:#16a34a; padding:12px; border-radius:6px; margin-bottom:15px; color:#fff;">装炉模拟动画播放完毕！ 共指引完成 ' + animationItemSteps.length + ' 件资产配位，工人可核对现场。</div>' + baseStatsText;
    } else {
        statsPanel.innerHTML = '<div style="background:#f59e0b; padding:12px; border-radius:6px; margin-bottom:15px; color:#fff;">装炉动画已停止。</div>' + baseStatsText;
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

function toggleAnimationPause() {
    if (!isAnimating) return;
    animationPaused = !animationPaused;

    const btnPause = document.getElementById('btn-pause-animation');
    if (animationPaused) {
        if (btnPause) { btnPause.textContent = '继续动画'; btnPause.style.background = '#16a34a'; }
    } else {
        if (btnPause) { btnPause.textContent = '暂停动画'; btnPause.style.background = '#f59e0b'; }
        if (animationResolve) {
            animationResolve();
            animationResolve = null;
        }
    }
}

function stopAnimation() {
    if (!isAnimating) return;
    animationActive = false;
    animationPaused = false;
    if (animationResolve) {
        animationResolve();
        animationResolve = null;
    }
}

// ==================== 规则8: 炉膛装载优先级节点排序 ====================

function refreshFurnacePriorityList() {
    const container = document.getElementById('furnace-priority-list');
    if (!container) return;

    const furnaceData = formManager.getFurnacesData();
    
    if (furnaceData.length === 0) {
        container.innerHTML = '<div style="color: #666; font-size: 11px; text-align: center; padding: 10px;">添加炉膛后自动生成排序节点</div>';
        return;
    }

    const existingOrder = getFurnacePriorityOrder();
    const currentNames = furnaceData.map(f => f.name);
    const needsInit = existingOrder.length === 0 || 
        !currentNames.every(n => existingOrder.includes(n)) ||
        currentNames.length !== existingOrder.length;

    if (needsInit) {
        const seen = new Set(existingOrder);
        const newOrder = [...existingOrder.filter(n => currentNames.includes(n))];
        currentNames.forEach(n => {
            if (!seen.has(n)) {
                newOrder.push(n);
            }
        });
        furnacePriorityOrder = newOrder;
    } else {
        furnacePriorityOrder = [...existingOrder];
    }

    // 计算每台炉膛的规格（用于排序节点缩进二次展开显示炉次明细）
    const furnaceSpecMap = {};
    furnaceData.forEach(f => {
        if (!furnaceSpecMap[f.name]) {
            furnaceSpecMap[f.name] = {
                width: f.width,
                height: f.height,
                depth: f.depth,
                count: 0,
                instances: []
            };
        }
        furnaceSpecMap[f.name].count++;
    });

    let html = '';
    furnacePriorityOrder.forEach((fName, idx) => {
        const fData = furnaceData.find(f => f.name === fName);
        if (!fData) return;
        
        // 炉次总数（同一名称的 count）
        const spec = furnaceSpecMap[fName];
        const instanceCount = spec ? spec.count : 1;
        
        // 序号标记
        const numberBadge = '<span class="priority-num-badge">' + (idx + 1) + '</span>';
        
        // 优先级文字标签
        let priorityLabel = '';
        if (idx === 0) {
            priorityLabel = '<span class="priority-label high">第1优先级·最优满载</span>';
        } else if (idx === 1) {
            priorityLabel = '<span class="priority-label high">第2优先级·优先装满</span>';
        } else if (idx >= furnacePriorityOrder.length - 2 && furnacePriorityOrder.length > 3) {
            priorityLabel = '<span class="priority-label low">后续装满</span>';
        }
        
        html += '<div class="furnace-priority-node" data-furnace-name="' + fName + '" draggable="true">';
        html += '<span class="priority-drag-handle">≡</span>';
        html += numberBadge;
        html += '<div class="priority-info">';
        html += '<span class="priority-name">' + fName + '</span>';
        html += '<span class="priority-dims">' + Math.round(fData.width) + ' × ' + Math.round(fData.height) + ' × ' + Math.round(fData.depth) + ' · ' + instanceCount + '台</span>';
        html += '</div>';
        html += priorityLabel;
        html += '</div>';
    });

    container.innerHTML = html;
    bindPriorityDragEvents(container);
}

function getFurnacePriorityOrder() {
    const container = document.getElementById('furnace-priority-list');
    if (!container) return furnacePriorityOrder;

    const nodes = container.querySelectorAll('.furnace-priority-node');
    if (nodes.length === 0) return furnacePriorityOrder;

    const order = [];
    nodes.forEach(node => {
        const name = node.getAttribute('data-furnace-name');
        if (name) order.push(name);
    });
    furnacePriorityOrder = order;
    return order;
}

function bindPriorityDragEvents(container) {
    const nodes = container.querySelectorAll('.furnace-priority-node');
    let dragSrcEl = null;
    let dragSrcIndex = -1;

    nodes.forEach(node => {
        node.addEventListener('dragstart', function(e) {
            dragSrcEl = this;
            const allNodes = [...container.querySelectorAll('.furnace-priority-node')];
            dragSrcIndex = allNodes.indexOf(this);
            this.classList.add('dragging');
            this.style.opacity = '0.5';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.getAttribute('data-furnace-name'));
        });

        node.addEventListener('dragenter', function(e) {
            e.preventDefault();
            if (this !== dragSrcEl) {
                this.classList.add('drag-over');
            }
        });

        node.addEventListener('dragleave', function(e) {
            this.classList.remove('drag-over');
        });

        node.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        node.addEventListener('drop', function(e) {
            e.stopPropagation();
            this.classList.remove('drag-over');

            const allNodes = [...container.querySelectorAll('.furnace-priority-node')];
            const dstIdx = allNodes.indexOf(this);

            if (dragSrcEl !== this && dragSrcIndex >= 0 && dstIdx >= 0) {
                if (dragSrcIndex < dstIdx) {
                    container.insertBefore(dragSrcEl, this.nextSibling);
                } else {
                    container.insertBefore(dragSrcEl, this);
                }

                refreshPriorityNumbers();
                getFurnacePriorityOrder();

                dragSrcEl.style.transition = 'background 0.3s, box-shadow 0.3s';
                dragSrcEl.style.background = '#2d2d1a';
                dragSrcEl.style.boxShadow = '0 0 12px rgba(243,156,18,0.3)';
                setTimeout(() => {
                    dragSrcEl.style.background = '';
                    dragSrcEl.style.boxShadow = '';
                }, 400);
            }

            return false;
        });

        node.addEventListener('dragend', function(e) {
            this.classList.remove('dragging');
            this.style.opacity = '1';
            nodes.forEach(n => n.classList.remove('drag-over'));
        });
    });
}

function refreshPriorityNumbers() {
    const container = document.getElementById('furnace-priority-list');
    if (!container) return;
    const nodes = container.querySelectorAll('.furnace-priority-node');
    const furnaceData = formManager.getFurnacesData();
    
    nodes.forEach((node, idx) => {
        const numBadge = node.querySelector('.priority-num-badge');
        if (numBadge) {
            numBadge.textContent = idx + 1;
        }
        
        const labelEl = node.querySelector('.priority-label');
        if (labelEl) {
            if (idx === 0) {
                labelEl.textContent = '第1优先级·最优满载';
                labelEl.className = 'priority-label high';
            } else if (idx === 1) {
                labelEl.textContent = '第2优先级·优先装满';
                labelEl.className = 'priority-label high';
            } else if (idx >= nodes.length - 2 && nodes.length > 3) {
                labelEl.textContent = '后续装满';
                labelEl.className = 'priority-label low';
            } else {
                labelEl.textContent = '';
                labelEl.className = 'priority-label';
            }
        }
    });
}

// ==================== 物料汇总速览 —— 点击高亮炉膛内对应物料 ====================

/**
 * 刷新物料汇总速览（精简列表：名称、数量、颜色、是否包炉）
 */
function refreshItemQuickSummary() {
    const container = document.getElementById('item-quick-summary-container');
    if (!container) return;

    const itemsData = formManager.getItemsData();
    
    if (itemsData.length === 0) {
        container.innerHTML = '<div class="quick-summary-empty">暂无物料，添加后可在此速览并点击高亮</div>';
        return;
    }

    let html = '<div class="quick-summary-header"><span>⚡ 物料速览</span><span class="quick-summary-hint">点击高亮定位</span></div>';
    html += '<div class="quick-summary-list">';
    
    itemsData.forEach((item, idx) => {
        const colorHex = item.color || getBatchColor(item.name);
        const isHighlighted = highlightedBatchName === item.name;
        const highlightClass = isHighlighted ? ' qs-item-highlighted' : '';
        
        html += '<div class="quick-summary-item' + highlightClass + '" data-batch-name="' + item.name + '" data-item-idx="' + idx + '">';
        // 颜色圆点
        html += '<span class="qs-color-dot" style="background:' + colorHex + '; box-shadow: 0 0 6px ' + colorHex + ';"></span>';
        // 名称
        html += '<span class="qs-name" title="' + item.name + '">' + item.name + '</span>';
        // 数量
        html += '<span class="qs-count">×' + item.count + '</span>';
        // 包炉标识
        if (item.isDedicated) {
            html += '<span class="qs-dedicated" title="专机包炉">🔒</span>';
        }
        html += '</div>';
    });
    
    html += '</div>';
    container.innerHTML = html;

    // 绑定点击事件
    container.querySelectorAll('.quick-summary-item').forEach(el => {
        el.addEventListener('click', function() {
            const batchName = this.getAttribute('data-batch-name');
            highlightBatchInFurnace(batchName);
        });
    });
}

/**
 * 点击物料速览项，在3D炉膛中高亮定位该批次物料
 */
function highlightBatchInFurnace(batchName) {
    if (!sceneManager || !globalFurnacesResult) return;

    // 切换高亮（再次点击同一批次取消高亮）
    if (highlightedBatchName === batchName) {
        sceneManager.clearHighlight();
        highlightedBatchName = null;
    } else {
        sceneManager.highlightItemsByName(batchName);
        highlightedBatchName = batchName;
    }

    // 刷新速览UI以更新高亮样式
    refreshItemQuickSummary();

    // 同时滚动到对应炉膛内第一个工件位置（可通过相机动画展示）
    if (highlightedBatchName && globalFurnacesResult.length > 0) {
        sceneManager.focusOnHighlightedItems(globalFurnacesResult);
    }
}

// ==================== Excel 导入功能 ====================

function handleExcelImport(file) {
    if (!file) return;

    const validTypes = ['.xlsx', '.xls', '.csv'];
    const fileName = file.name.toLowerCase();
    const isValid = validTypes.some(ext => fileName.endsWith(ext));
    
    if (!isValid) {
        alert('请选择 Excel (.xlsx/.xls) 或 CSV 文件');
        return;
    }

    parseExcelFile(file).then(result => {
        if (result.errors && result.errors.length > 0) {
            console.warn('Excel 解析警告:', result.errors);
        }
        showExcelPreviewModal(result);
    }).catch(err => {
        alert('Excel 导入失败: ' + err.message);
        console.error(err);
    });
}

function showExcelPreviewModal(parseResult) {
    const overlay = document.getElementById('excel-preview-overlay');
    const modal = document.getElementById('excel-preview-modal');
    if (!overlay || !modal) return;

    const { items, errors, sheetName, headers } = parseResult;

    let itemsHtml = '';
    items.forEach((item, idx) => {
        const shapeLabel = item.shape === 'cylinder' ? '圆柱体' : '立方体';
        const dimLabel = item.shape === 'cylinder' 
            ? 'Φ' + item.dim1 + ' x H' + item.dim3
            : item.dim1 + ' x ' + item.dim2 + ' x ' + item.dim3;
        
        itemsHtml += '<tr>';
        itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:12px;">' + (idx + 1) + '</td>';
        itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:12px; color:#fff;">' + item.name + '</td>';
        itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:11px;">' + shapeLabel + '</td>';
        itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:11px;">' + dimLabel + '</td>';
        itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:11px;">' + item.count + ' 件</td>';
        itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:11px;">' + item.weight.toFixed(1) + ' kg</td>';
        itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:11px; color:#f39c12;">' + (item.materialType || '-') + '</td>';
        itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:10px; color:#888;">' + (item.hardness || '-') + '</td>';
        itemsHtml += '</tr>';
    });

    let errorsHtml = '';
    if (errors && errors.length > 0) {
        errorsHtml = '<div style="background: rgba(179,36,36,0.2); border: 1px solid #b32424; border-radius: 6px; padding: 10px; margin-bottom: 15px;">';
        errorsHtml += '<strong style="color: #ff6666;">解析警告 (' + errors.length + '条):</strong>';
        errorsHtml += '<ul style="margin: 5px 0 0 16px; padding: 0; font-size: 11px; color: #ff9999;">';
        errors.forEach(e => { errorsHtml += '<li>' + e + '</li>'; });
        errorsHtml += '</ul></div>';
    }

    modal.innerHTML = (
        '<h3 style="margin: 0 0 4px 0; color: #fff; font-size: 18px;">Excel 数据预览</h3>' +
        '<p style="font-size: 11px; color: #666; margin: 0 0 16px 0;">' +
        '工作表: <span style="color: #2ecc71;">' + sheetName + '</span> . ' +
        '识别到 <span style="color: #f39c12;">' + items.length + '</span> 个工件批次 . ' +
        '表头列: ' + headers.join(', ') +
        '</p>' +
        errorsHtml +
        '<div style="max-height: 350px; overflow-y: auto; margin-bottom: 16px; border: 1px solid #333344; border-radius: 6px;">' +
        '<table style="width: 100%; border-collapse: collapse; color: #d1d1de;">' +
        '<thead><tr style="background: #222230; position: sticky; top: 0;">' +
        '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">#</th>' +
        '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">名称</th>' +
        '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">几何形态</th>' +
        '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">尺寸</th>' +
        '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">数量</th>' +
        '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">总重</th>' +
        '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">材质</th>' +
        '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">硬度</th>' +
        '</tr></thead>' +
        '<tbody>' + itemsHtml + '</tbody>' +
        '</table></div>' +
        '<div style="display: flex; gap: 10px;">' +
        '<button id="excel-preview-cancel" style="flex: 1; padding: 10px; background: #3e3e52; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold;">取消</button>' +
        '<button id="excel-preview-append" style="flex: 1; padding: 10px; background: #217346; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold;">追加到待处理列表</button>' +
        '<button id="excel-preview-replace" style="flex: 1; padding: 10px; background: #0066cc; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold;">替换当前列表</button>' +
        '</div>' +
        '<div style="margin-top: 10px;">' +
        '<button id="excel-preview-download-template" style="width: 100%; padding: 8px; background: transparent; color: #666; border: 1px dashed #444; border-radius: 6px; cursor: pointer; font-size: 11px;">下载 Excel 导入模板</button>' +
        '</div>'
    );

    overlay.style.display = 'flex';

    document.getElementById('excel-preview-cancel').addEventListener('click', () => {
        overlay.style.display = 'none';
    });

    document.getElementById('excel-preview-append').addEventListener('click', () => {
        applyExcelItems(items, false);
        overlay.style.display = 'none';
    });

    document.getElementById('excel-preview-replace').addEventListener('click', () => {
        applyExcelItems(items, true);
        overlay.style.display = 'none';
    });

    document.getElementById('excel-preview-download-template').addEventListener('click', () => {
        const blob = generateExcelTemplate();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '热处理工件导入模板.xlsx';
        a.click();
        URL.revokeObjectURL(url);
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.style.display = 'none';
        }
    });
}

function applyExcelItems(items, replace) {
    if (replace) {
        const container = document.getElementById('items-container');
        if (container) container.innerHTML = '';
        formManager.itemCounter = 0;
        batchColorIndex = 0;
    }

    items.forEach(item => {
        batchColorIndex++;
        const color = item.color || BATCH_COLORS[batchColorIndex % BATCH_COLORS.length];
        formManager.addItemRow(
            item.name,
            item.shape,
            item.count,
            item.dim1,
            item.dim2,
            item.dim3,
            item.weight,
            color,
            item.materialType || '',
            !!item.isDedicated
        );
    });

    // 刷新物料速览
    refreshItemQuickSummary();
}

// ==================== PDF 生成 ====================

function exportToProfessionalPDF() {
    if (!globalFurnacesResult) return;
    showSOPVerificationModal((sopData) => {
        exportPDF({
            furnaces: globalFurnacesResult,
            unpacked: globalUnpackedItems,
            sopData: sopData
        });
    });
}

function showSOPVerificationModal(callback) {
    const oldOverlay = document.getElementById('sop-modal-overlay');
    if (oldOverlay) oldOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'sop-modal-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 9999; display: flex; align-items: center; justify-content: center;';

    let vacuumOptions = '';
    VACUUM_LEVEL_OPTIONS.forEach(opt => {
        vacuumOptions += '<option value="' + opt.value + '">' + opt.label + '</option>';
    });
    let heatingOptions = '';
    HEATING_PROGRAM_OPTIONS.forEach(opt => {
        heatingOptions += '<option value="' + opt.value + '">' + opt.label + '</option>';
    });

    overlay.innerHTML = (
        '<div style="background: #1a1a24; border: 2px solid #0066cc; border-radius: 12px; padding: 28px 32px; width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.6); color: #d1d1de;">' +
        '<h2 style="margin: 0 0 6px 0; color: #fff; font-size: 20px; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">工艺校准单确认 (SOP Verification)</h2>' +
        '<p style="font-size: 12px; color: #9999aa; margin: 0 0 20px 0;">在导出 PDF 报告前，请确认以下工艺参数（必填项）</p>' +
        '<div style="margin-bottom: 18px;">' +
        '<label style="display: block; font-size: 13px; color: #9999aa; margin-bottom: 6px;">目标真空度 (Vacuum Level) <span style="color: #ef4444;">*</span></label>' +
        '<select id="sop-vacuum-level" style="width: 100%; padding: 10px 12px; background: #161620; border: 1px solid #333344; color: #fff; border-radius: 6px; font-size: 14px;">' + vacuumOptions + '</select>' +
        '</div>' +
        '<div style="margin-bottom: 18px;">' +
        '<label style="display: block; font-size: 13px; color: #9999aa; margin-bottom: 6px;">执行加热曲线程序号 (Heating Program) <span style="color: #ef4444;">*</span></label>' +
        '<select id="sop-heating-program" style="width: 100%; padding: 10px 12px; background: #161620; border: 1px solid #333344; color: #fff; border-radius: 6px; font-size: 14px;">' + heatingOptions + '</select>' +
        '</div>' +
        '<div style="margin-bottom: 18px;">' +
        '<label style="display: block; font-size: 13px; color: #9999aa; margin-bottom: 6px;">操作员姓名 (Operator)</label>' +
        '<input type="text" id="sop-operator" placeholder="输入主操手姓名" style="width: 100%; padding: 10px 12px; background: #161620; border: 1px solid #333344; color: #fff; border-radius: 6px; font-size: 14px; box-sizing: border-box;">' +
        '</div>' +
        '<div style="display: flex; gap: 12px; margin-top: 24px;">' +
        '<button id="sop-btn-cancel" style="flex: 1; padding: 12px; background: #3e3e52; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">取 消</button>' +
        '<button id="sop-btn-confirm" style="flex: 2; padding: 12px; background: #0066cc; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">确认校准并导出 PDF</button>' +
        '</div></div>'
    );

    document.body.appendChild(overlay);

    document.getElementById('sop-btn-cancel').addEventListener('click', () => {
        overlay.remove();
    });

    document.getElementById('sop-btn-confirm').addEventListener('click', () => {
        const vacuumLevel = document.getElementById('sop-vacuum-level').value;
        const heatingProgram = document.getElementById('sop-heating-program').value;
        const operator = document.getElementById('sop-operator').value || '未填写';

        if (!vacuumLevel || !heatingProgram) {
            alert('请填写必填项：目标真空度和加热曲线程序号');
            return;
        }

        overlay.remove();

        callback({
            vacuumLevel: vacuumLevel,
            heatingProgram: heatingProgram,
            operator: operator,
            verifiedAt: formatDateTime()
        });
    });

    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') overlay.remove();
    });
}

// ==================== 初始化 ====================

function init() {
    sceneManager = new SceneManager('canvas-container');
    sceneManager.init();

    formManager = new FormManager();

    document.getElementById('btn-add-furnace').addEventListener('click', () => {
        formManager.addFurnaceRow('自定义新增空闲炉膛', 400, 200, 200, 15000, 1);
        refreshFurnacePriorityList();
    });
    document.getElementById('btn-add-item').addEventListener('click', () => {
        batchColorIndex++;
        const color = BATCH_COLORS[batchColorIndex % BATCH_COLORS.length];
        const batchName = '工件批次_' + batchColorIndex;
        formManager.addItemRow(batchName, 'cuboid', 10, 50, 50, 60, 1500, color);
        refreshItemQuickSummary();
    });
    document.getElementById('btn-calculate').addEventListener('click', executeAndRender);
    document.getElementById('btn-animate').addEventListener('click', playLoadingAnimation);
    document.getElementById('btn-export-pdf').addEventListener('click', exportToProfessionalPDF);

    document.getElementById('btn-pause-animation').addEventListener('click', toggleAnimationPause);
    document.getElementById('btn-stop-animation').addEventListener('click', stopAnimation);

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

    // Excel 导入按钮事件
    const btnImportExcel = document.getElementById('btn-import-excel');
    const excelFileInput = document.getElementById('excel-file-input');
    
    if (btnImportExcel && excelFileInput) {
        btnImportExcel.addEventListener('click', () => {
            excelFileInput.click();
        });
        
        excelFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleExcelImport(file);
            }
            excelFileInput.value = '';
        });
    }

    // 监听炉膛删除事件，刷新优先级排序
    window.addEventListener('furnace-deleted', () => {
        refreshFurnacePriorityList();
    });

    // 监听工件变更事件，刷新物料速览
    window.addEventListener('item-changed', () => {
        refreshItemQuickSummary();
    });

    // 加载默认数据
    formManager.initDefaultData(DEFAULT_FURNACES, DEFAULT_ITEMS);

    // 初始化炉膛优先级排序
    refreshFurnacePriorityList();

    // 初始化物料汇总速览
    refreshItemQuickSummary();

    // 面板折叠/展开切换（窄屏响应式功能）
    initPanelToggle();

    // 标签页切换
    initTabSwitching();

    // 计算结果折叠面板切换
    initSummaryToggle();

    // 标签页内详情区块折叠切换
    initTabSectionCollapse();

    // 延迟执行初始计算
    setTimeout(executeAndRender, 350);
}

/**
 * 初始化计算结果折叠面板切换
 */
function initSummaryToggle() {
    const wrapper = document.getElementById('summary-wrapper');
    const header = document.getElementById('summary-header');
    if (!wrapper || !header) return;

    header.addEventListener('click', () => {
        if (wrapper.classList.contains('summary-expanded')) {
            wrapper.classList.remove('summary-expanded');
            wrapper.classList.add('summary-collapsed');
            document.getElementById('summary-toggle-icon').textContent = '▶';
        } else {
            wrapper.classList.remove('summary-collapsed');
            wrapper.classList.add('summary-expanded');
            document.getElementById('summary-toggle-icon').textContent = '▼';
        }
    });
}

/**
 * 初始化标签页切换逻辑
 */
function initTabSwitching() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');

            // 切换按钮激活状态
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 切换面板显示
            tabPanels.forEach(panel => panel.classList.remove('active'));
            const targetPanel = document.getElementById(targetTab);
            if (targetPanel) {
                targetPanel.classList.add('active');
            }
        });
    });
}

/**
 * 初始化标签页内详情区块折叠切换
 */
function initTabSectionCollapse() {
    document.querySelectorAll('.tab-section-header').forEach(header => {
        header.addEventListener('click', () => {
            const collapse = header.closest('.tab-section-collapse');
            if (!collapse) return;
            collapse.classList.toggle('collapsed');
        });
    });
}

/**
 * 初始化窄屏面板折叠/展开切换逻辑
 */
function initPanelToggle() {
    const panel = document.getElementById('control-panel');
    const toggleBtn = document.getElementById('panel-toggle-btn');
    const overlay = document.getElementById('panel-overlay');

    if (!panel || !toggleBtn || !overlay) return;

    function openPanel() {
        panel.classList.add('panel-open');
        overlay.classList.add('active');
        toggleBtn.textContent = '✕';
        toggleBtn.title = '关闭配置面板';
    }

    function closePanel() {
        panel.classList.remove('panel-open');
        overlay.classList.remove('active');
        toggleBtn.textContent = '☰';
        toggleBtn.title = '打开配置面板';
    }

    toggleBtn.addEventListener('click', () => {
        if (panel.classList.contains('panel-open')) {
            closePanel();
        } else {
            openPanel();
        }
    });

    // 点击遮罩层关闭面板
    overlay.addEventListener('click', closePanel);

    // 面板上的按钮点击后自动关闭（移动端体验优化）
    panel.addEventListener('click', (e) => {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'button' && window.innerWidth <= 900) {
            setTimeout(closePanel, 300);
        }
    });

    // 窗口大小变化时自动重置面板状态
    window.addEventListener('resize', () => {
        if (window.innerWidth > 900 && panel.classList.contains('panel-open')) {
            closePanel();
        }
    });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);