/**
 * ui.js - UI Rendering and Interactions (V2.3)
 *
 * Purpose:
 *   Contains all DOM-based UI rendering: furnace cards, material cards,
 *   detail panels, stats panels, modals, dialogs, notifications, and top summary.
 *
 * V2.3: 炉膛独立料框类型配置, basketType 参数传递
 * V2.0: 增加了搁板厚度、姿态优化规则UI，聚集率统计入口
 *
 * Dependencies:
 *   - state.js
 *   - three-scene.js
 */

import {
    furnaceCounter, materialCounter,
    selectedFurnaceCardId, selectedMaterialCardId,
    fdpCollapsed, mdpCollapsed,
    sortState, importPreviewData,
    globalFurnacesResult, globalUnpackedItems, globalSpacingValue,
    currentFurnaceIndex,
    placementRules, aggregationStats,
    groupingInfo,
    usedColors, masterPlans,
    furnaceTooling, toolingTemplates, defaultToolingType,
    setFurnaceCounter, setMaterialCounter,
    setSelectedFurnaceCardId, setSelectedMaterialCardId,
    setFdpCollapsed, setMdpCollapsed,
    setSortState, setImportPreviewData,
    setPlacementRules, setCurrentFurnaceIndex,
    setGlobalFurnacesResult, setGlobalUnpackedItems, setGlobalSpacingValue,
    setToolingTemplates, setDefaultToolingType,
    currentMaterialFilters, currentProcessFilters, currentHardnessFilters,
    toggleMaterialFilter, toggleProcessFilter, toggleHardnessFilter,
    clearMaterialFilters, clearProcessFilters, clearHardnessFilters
} from './state.js';
import {
    generateUniqueColor,
    findResultIndexByFid, getSelectedMaterialName
} from './three-scene.js';

export function getFurnaceDataFromCard(card) {
    const fid = parseInt(card.getAttribute('data-fid'));
    const name = card.querySelector('.f-card-name').textContent;
    const metaSpans = card.querySelectorAll('.f-card-meta span');
    const dimSpan = metaSpans[0] ? metaSpans[0].textContent.replace('📐 ', '') : '0×0×0';
    const dims = dimSpan.split('×');
    const countText = metaSpans[1] ? metaSpans[1].textContent : '可用数量 1';
    const count = parseInt(countText.replace(/[^0-9]/g, '')) || 1;
    const weightText = metaSpans[2] ? metaSpans[2].textContent : '0kg';
    const maxWeight = parseFloat(weightText.replace(/[^0-9.]/g, '')) || 0;
    // plannedHeats 是早期 Demo 字段，目前不参与算法，固定为 0 保持兼容
    const plannedHeats = 0;

    const spacingText = card.getAttribute('data-spacing') || '';
    const actualSpacing = spacingText !== '' ? parseFloat(spacingText) : null;
    /**
     * V2.3: 每个炉膛独立存储 basketType
     * 从 data-basket-type 属性读取，默认为 'grid'
     */
    const basketType = card.getAttribute('data-basket-type') || 'grid';
    /** V4.8: 工装类型扩展 — 读取 toolingType、maxLayers、allowedProcesses、placementMode */
    const toolingType = card.getAttribute('data-tooling-type') || 'standard-basket';
    const maxLayers = parseInt(card.getAttribute('data-max-layers')) || 5;
    const allowedProcesses = card.getAttribute('data-allowed-processes') || '';
    const placementMode = card.getAttribute('data-placement-mode') || 'free';
    const loadDirection = card.getAttribute('data-load-direction') || '前进前出';

    // 在 getFurnaceDataFromCard 函数末尾，return 语句的上方加上：
    const extrasStr = card.getAttribute('data-extras');
    const extras = extrasStr ? JSON.parse(extrasStr) : {};

    return { fid, name, width: parseFloat(dims[0]) || 0, height: parseFloat(dims[1]) || 0, depth: parseFloat(dims[2]) || 0, maxWeight, count, plannedHeats, actualSpacing, basketType, toolingType, maxLayers, allowedProcesses, placementMode, loadDirection, extras };
}

export function getMaterialDataFromCard(card) {
    const mid = parseInt(card.getAttribute('data-mid'));
    const name = card.querySelector('.m-name').textContent;
    const color = card.querySelector('.m-color-swatch').style.backgroundColor;
    const meta = card.querySelector('.m-meta').textContent;
    const isCylinder = meta.includes('圆柱体');
    const shape = isCylinder ? 'cylinder' : 'cuboid';
    let dim1 = 0, dim2 = 0, dim3 = 0;
    const dimMatch3 = meta.match(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)/);
    if (dimMatch3) { dim1 = parseFloat(dimMatch3[1]); dim2 = parseFloat(dimMatch3[2]); dim3 = parseFloat(dimMatch3[3]); }
    else { const cylDim = meta.match(/⌀(\d+(?:\.\d+)?)×H(\d+(?:\.\d+)?)/); if (cylDim) { dim1 = parseFloat(cylDim[1]); dim2 = parseFloat(cylDim[1]); dim3 = parseFloat(cylDim[2]); } }
    const countMatch = meta.match(/×(\d+)件/); const count = countMatch ? parseInt(countMatch[1]) : 0;
    const weightMatch = meta.match(/(\d+(?:\.\d+)?)\s*kg/); const totalWeight = weightMatch ? parseFloat(weightMatch[1]) : 0;
    const material = card.getAttribute('data-material') || ''; const process = card.getAttribute('data-process') || '';
    const orderDate = card.getAttribute('data-order-date') || ''; const deliveryDate = card.getAttribute('data-delivery-date') || '';
    const remark = card.getAttribute('data-remark') || ''; const hardness = card.getAttribute('data-hardness') || '';
    const cadImage = card.getAttribute('data-cad-image') || '';
    const showName = card.getAttribute('data-show-name') || '';
    const customer = card.getAttribute('data-customer') || '';
    const itemCode = card.getAttribute('data-item-code') || '';
    return { mid, name, shape, count, dim1, dim2, dim3, totalWeight, color, material, process, orderDate, deliveryDate, remark, hardness, cadImage, showName, customer, itemCode };
}

// ==================== FURNACE CARD CREATION ====================

/**
 * V4.8: createFurnaceCard 新增 toolingType 参数
 * 每个炉膛独立存储工装类型和料框类型，互不影响
 *
 * @param {string} name - 炉膛名称
 * @param {number} depth - 纵深 Z (mm)
 * @param {number} width - 宽度 X (mm)
 * @param {number} height - 高度 Y (mm)
 * @param {number} maxWeight - 承重上限 (kg)
 * @param {number} count - 可用数量
 * @param {number} plannedHeats - 计划装载炉次
 * @param {number|null} actualSpacing - 实际安全间距
 * @param {string} basketType - 料框类型 ('grid'|'honeycomb'|'tray'|'solid')，默认 'grid'
 * @param {string} toolingType - 工装类型 ('standard-basket'|'mesh-basket'|'special-jig'|'material-tray'|'hanger'|'ring-tooling')，默认 'standard-basket'
 */
export function createFurnaceCard(name, depth, width, height, maxWeight, count, plannedHeats, actualSpacing, basketType, toolingType) {
    const newFC = furnaceCounter + 1; setFurnaceCounter(newFC);
    const cardId = 'furnace-card-' + newFC;
    const card = document.createElement('div');
    card.className = 'furnace-card'; card.id = cardId;
    card.setAttribute('data-fid', newFC);
    const spacingToUse = actualSpacing !== undefined && actualSpacing !== null ? actualSpacing : 5;
    card.setAttribute('data-spacing', spacingToUse);
    card.setAttribute('data-basket-type', basketType || 'grid');
    /** V4.8: 存储工装类型及相关参数 */
    const tt = toolingType || defaultToolingType;
    const ttConfig = furnaceTooling[tt] || furnaceTooling['standard-basket'];
    card.setAttribute('data-tooling-type', tt);
    card.setAttribute('data-max-layers', ttConfig.maxLayers);
    // UI 上该卡片代表装载工装；内部仍复用 furnace 命名以兼容算法
    card.setAttribute('data-allowed-processes', '');
    card.setAttribute('data-load-direction', '前进前出');
    card.setAttribute('data-placement-mode', ttConfig.placementMode);
    card.innerHTML =
    '<span class="f-drag-handle" draggable="true" title="拖拽排序">⠿</span>' +
    '<button class="f-card-delete" data-action="delete-furnace" data-fid="' + newFC + '">✕</button>' +
    '<div class="f-card-name">' + name + '</div>' +
    '<div class="f-card-meta">' +
        '<span>📐 ' + width + '×' + height + '×' + depth + '</span>' +
        '<span>📦 工装数量 ' + count + '</span>' +
        '<span>⚖ ' + maxWeight + 'kg</span>' +
    '</div>' +
    '<div class="f-card-status">适用工艺：未配置 · 装载方向：前进前出</div>';
    // card.addEventListener('click', (e) => { if (e.target.closest('[data-action="delete-furnace"]')) return; if (e.target.closest('.f-drag-handle')) return; selectFurnaceCard(cardId); showFurnaceDetail(cardId); });
    card.addEventListener('click', (e) => { 
            if (e.target.closest('[data-action="delete-furnace"]')) return; 
            if (e.target.closest('.f-drag-handle')) return; 
            
            // 记录点击前的状态
            const wasSelected = card.classList.contains('active'); 
            // 执行选中/取消选中切换
            selectFurnaceCard(cardId); 
            
            if (!wasSelected) { 
                // 原本未选中，现在选中了，展示详情
                showFurnaceDetail(cardId); 
            } else { 
                // 原本已选中，现在取消选中了，隐藏详情并恢复默认提示
                document.getElementById('fdp-placeholder').style.display = 'block'; 
                document.getElementById('fdp-body').style.display = 'none'; 
                document.getElementById('fdp-title').textContent = '📋 工装参数'; 
            } 
        });
    setupFurnaceDrag(card);
    (document.getElementById('furnace-cards-container') || document.getElementById('equipment-cards-container'))?.appendChild(card);
    return { cardId, furnaceCounter: newFC, name, depth, width, height, maxWeight, count, plannedHeats: 0, basketType: basketType || 'grid', toolingType: tt };
}

// export function selectFurnaceCard(cardId) { document.querySelectorAll('.furnace-card').forEach(c => c.classList.remove('active')); const card = document.getElementById(cardId); if (card) { card.classList.add('active'); setSelectedFurnaceCardId(cardId); } }
export function selectFurnaceCard(cardId) { 
    const card = document.getElementById(cardId); 
    // 如果当前已经被选中，则取消选中
    if (card && card.classList.contains('active')) { 
        card.classList.remove('active'); 
        setSelectedFurnaceCardId(null); 
    } else { 
        // 否则，清除其他卡片的选中状态，并选中当前卡片
        document.querySelectorAll('.furnace-card').forEach(c => c.classList.remove('active')); 
        if (card) { 
            card.classList.add('active'); 
            setSelectedFurnaceCardId(cardId); 
        } 
    } 
}

export function showFurnaceDetail(cardId) {
    const card = document.getElementById(cardId); if (!card) return;
    const d = getFurnaceDataFromCard(card);
    document.getElementById('fdp-title').textContent = '📋 工装：' + d.name;
    document.getElementById('fdp-placeholder').style.display = 'none';
    const body = document.getElementById('fdp-body'); body.style.display = 'block';

    const processValue = d.allowedProcesses || '';
    const directionValue = d.loadDirection || '前进前出';

    let html =
        '<div class="fdp-row">' +
            '<div class="fdp-field">' +
                '<label>工装名称</label>' +
                '<input type="text" id="fdp-name" value="' + d.name + '">' +
            '</div>' +
            '<div class="fdp-field">' +
                '<label>工装类型</label>' +
                '<input type="text" id="fdp-equipment-type" value="' + (card.getAttribute('data-equipment-type') || '标准料框') + '" placeholder="如：标准料框、料盘、网篮、环形工装">' +
            '</div>' +
        '</div>' +

        '<div class="fdp-row">' +
            '<div class="fdp-field">' +
                '<label>工装宽度 X (mm)</label>' +
                '<input type="number" id="fdp-width" value="' + d.width + '">' +
            '</div>' +
            '<div class="fdp-field">' +
                '<label>工装高度 Y (mm)</label>' +
                '<input type="number" id="fdp-height" value="' + d.height + '">' +
            '</div>' +
            '<div class="fdp-field">' +
                '<label>工装纵深 Z (mm)</label>' +
                '<input type="number" id="fdp-depth" value="' + d.depth + '">' +
            '</div>' +
        '</div>' +

        '<div class="fdp-row">' +
            '<div class="fdp-field">' +
                '<label>工装承重上限 (kg)</label>' +
                '<input type="number" id="fdp-weight" value="' + d.maxWeight + '">' +
            '</div>' +
            '<div class="fdp-field">' +
                '<label>工装数量</label>' +
                '<input type="number" id="fdp-count" value="' + d.count + '" min="1">' +
            '</div>' +
        '</div>' +

        '<div class="fdp-row">' +
            '<div class="fdp-field">' +
                '<label>适用加工工艺</label>' +
                '<input type="text" id="fdp-processes" value="' + processValue + '" placeholder="如：渗碳淬火、氮化、真空淬火">' +
            '</div>' +
        '</div>' +

        '<div class="fdp-row">' +
            '<div class="fdp-field">' +
                '<label>装载方向</label>' +
                '<select id="fdp-load-direction">' +
                    '<option value="前进前出" ' + (directionValue === '前进前出' ? 'selected' : '') + '>前进前出</option>' +
                    '<option value="前进后出" ' + (directionValue === '前进后出' ? 'selected' : '') + '>前进后出</option>' +
                    '<option value="吊装入炉" ' + (directionValue === '吊装入炉' ? 'selected' : '') + '>吊装入炉</option>' +
                    '<option value="顶部装入" ' + (directionValue === '顶部装入' ? 'selected' : '') + '>顶部装入</option>' +
                '</select>' +
            '</div>' +
        '</div>' +

        '<div class="fdp-device-note">当前版本不设计真实炉膛，仅使用该工装的尺寸作为装载空间；真实车间、设备、炉膛关系后续在“生产车间”中链接。</div>' +
        '<button class="fdp-save-btn" id="fdp-save-btn">💾 保存工装参数</button>';

    body.innerHTML = html;
    document.getElementById('fdp-save-btn').addEventListener('click', () => { saveFurnaceDetail(cardId); });
    if (fdpCollapsed) { setFdpCollapsed(false); (document.getElementById('furnace-detail-panel') || document.getElementById('equipment-detail-panel'))?.classList.remove('collapsed'); document.getElementById('fdp-toggle-icon').textContent = '▲'; }
}

export function saveFurnaceDetail(cardId) {
    const card = document.getElementById(cardId); if (!card) return;
    const name = document.getElementById('fdp-name').value.trim() || '装载工装';
    const width = parseFloat(document.getElementById('fdp-width').value) || 0;
    const height = parseFloat(document.getElementById('fdp-height').value) || 0;
    const depth = parseFloat(document.getElementById('fdp-depth').value) || 0;
    const maxWeight = parseFloat(document.getElementById('fdp-weight').value) || 0;
    const count = parseInt(document.getElementById('fdp-count').value) || 1;
    const equipmentType = document.getElementById('fdp-equipment-type')?.value.trim() || '标准料框';
    const processes = document.getElementById('fdp-processes')?.value.trim() || '';
    const loadDirection = document.getElementById('fdp-load-direction')?.value || '前进前出';

    card.setAttribute('data-equipment-type', equipmentType);
    card.setAttribute('data-allowed-processes', processes);
    card.setAttribute('data-load-direction', loadDirection);

    card.querySelector('.f-card-name').textContent = name;
    card.querySelector('.f-card-meta').innerHTML =
    '<span>📐 ' + width + '×' + height + '×' + depth + '</span>' +
    '<span>📦 工装数量 ' + count + '</span>' +
    '<span>⚖ ' + maxWeight + 'kg</span>';

    const processLabel = processes || '未配置';
    card.querySelector('.f-card-status').textContent = '适用工艺：' + processLabel + ' · 装载方向：' + loadDirection;

    document.getElementById('fdp-title').textContent = '📋 工装：' + name;
    updateTopSummary();
    const btn = document.getElementById('fdp-save-btn');
    if (btn) { btn.textContent = '✅ 已保存'; setTimeout(() => { btn.textContent = '💾 保存工装参数'; }, 1500); }
}

export function deleteFurnaceCard(fid) {
    const card = document.getElementById('furnace-card-' + fid); if (card) card.remove();
    if (selectedFurnaceCardId === 'furnace-card-' + fid) { setSelectedFurnaceCardId(null); document.getElementById('fdp-placeholder').style.display = 'block'; document.getElementById('fdp-body').style.display = 'none'; document.getElementById('fdp-title').textContent = '📋 工装参数'; }
    updateTopSummary();
}

let dragSrcCard = null;
function setupFurnaceDrag(card) {
    const handle = card.querySelector('.f-drag-handle');
    handle.addEventListener('dragstart', (e) => { dragSrcCard = card; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    handle.addEventListener('dragend', () => { card.classList.remove('dragging'); document.querySelectorAll('.furnace-card').forEach(c => c.classList.remove('drag-over')); dragSrcCard = null; });
    card.addEventListener('dragover', (e) => { e.preventDefault(); if (dragSrcCard && dragSrcCard !== card) { document.querySelectorAll('.furnace-card').forEach(c => c.classList.remove('drag-over')); card.classList.add('drag-over'); } });
    card.addEventListener('drop', (e) => { e.preventDefault(); if (dragSrcCard && dragSrcCard !== card) { const container = document.getElementById('furnace-cards-container') || document.getElementById('equipment-cards-container'); if (!container) return; const cards = [...container.querySelectorAll('.furnace-card')]; const srcIdx = cards.indexOf(dragSrcCard); const tgtIdx = cards.indexOf(card); if (srcIdx < tgtIdx) container.insertBefore(dragSrcCard, card.nextSibling); else container.insertBefore(dragSrcCard, card); } card.classList.remove('drag-over'); });
}

export function sortFurnaceCards(field) {
    if (sortState.field === field) setSortState({ field, dir: sortState.dir === 'asc' ? 'desc' : 'asc' }); else setSortState({ field, dir: 'asc' });
    const currentDir = (sortState.field === field) ? sortState.dir : 'asc';
    document.querySelectorAll('.sort-btn').forEach(b => { b.classList.remove('active', 'asc', 'desc'); if (b.getAttribute('data-field') === field) b.classList.add('active', currentDir); });
    const container = document.getElementById('furnace-cards-container');
    const cards = [...container.querySelectorAll('.furnace-card')];
    cards.sort((a, b) => {
        let va, vb;
        if (field === 'name') { va = a.querySelector('.f-card-name').textContent; vb = b.querySelector('.f-card-name').textContent; return currentDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va); }
        const getSpans = (card) => card.querySelectorAll('.f-card-meta span');
        if (field === 'volume') { const dimA = getSpans(a)[0]?.textContent.replace('📐 ', '').split('×').map(Number) || [0,0,0]; const dimB = getSpans(b)[0]?.textContent.replace('📐 ', '').split('×').map(Number) || [0,0,0]; va = dimA.reduce((p,c) => p*c, 1); vb = dimB.reduce((p,c) => p*c, 1); }
        else if (field === 'weight') { va = parseFloat(getSpans(a)[2]?.textContent.replace(/[^0-9.]/g,'')) || 0; vb = parseFloat(getSpans(b)[2]?.textContent.replace(/[^0-9.]/g,'')) || 0; }
        else if (field === 'count') { va = parseInt(getSpans(a)[1]?.textContent.replace(/[^0-9]/g,'')) || 0; vb = parseInt(getSpans(b)[1]?.textContent.replace(/[^0-9]/g,'')) || 0; }
        return currentDir === 'asc' ? va - vb : vb - va;
    });
    cards.forEach(c => container.appendChild(c));
}

// ==================== MATERIAL CARD CREATION ====================

export function createMaterialCard(name, shape, count, dim1, dim2, dim3, totalWeight, color, extraData) {
    const newMC = materialCounter + 1; setMaterialCounter(newMC);
    const cardId = 'material-card-' + newMC;
    const shapeLabel = shape === 'cylinder' ? '圆柱体' : '立方体';
    const dimLabel = shape === 'cylinder' ? '⌀' + dim1 + '×H' + dim3 : dim1 + '×' + dim2 + '×' + dim3;
    const card = document.createElement('div');
    card.className = 'material-card'; card.id = cardId; card.setAttribute('data-mid', newMC); card.style.borderLeftColor = color;
    if (extraData) { if (extraData.material) card.setAttribute('data-material', extraData.material); if (extraData.process) card.setAttribute('data-process', extraData.process); if (extraData.orderDate) card.setAttribute('data-order-date', extraData.orderDate); if (extraData.deliveryDate) card.setAttribute('data-delivery-date', extraData.deliveryDate); if (extraData.remark) card.setAttribute('data-remark', extraData.remark); if (extraData.hardness) card.setAttribute('data-hardness', extraData.hardness); if (extraData.cadImage) card.setAttribute('data-cad-image', extraData.cadImage); if (extraData.showName) card.setAttribute('data-show-name', extraData.showName); if (extraData.customer) card.setAttribute('data-customer', extraData.customer); if (extraData.itemCode) card.setAttribute('data-item-code', extraData.itemCode); }
    const itemCode = extraData && extraData.itemCode ? extraData.itemCode : '';
    const customer = extraData && extraData.customer ? extraData.customer : '';
    const metaExtra = (itemCode || customer) ? '<div class="item-meta">编码: ' + itemCode + ' | 客户: ' + customer + '</div>' : '';
    card.innerHTML = '<button class="m-delete" data-action="delete-material" data-mid="' + newMC + '">✕</button><div class="m-color-swatch" style="background-color:' + color + ';" title="' + name + '"></div><div class="m-info"><div class="m-name">' + name + '</div><div class="m-meta">' + shapeLabel + ' · ' + dimLabel + 'mm · ×' + count + '件 · ' + totalWeight + 'kg</div>' + metaExtra + '</div>';
    card.addEventListener('click', (e) => { if (e.target.closest('[data-action="delete-material"]')) return; const wasSelected = card.classList.contains('active'); selectMaterialCard(cardId); if (!wasSelected) { showMaterialDetail(cardId); } else { document.getElementById('mdp-placeholder').style.display = 'block'; document.getElementById('mdp-body').style.display = 'none'; document.getElementById('mdp-title').textContent = '📋 工件详情'; } });
    document.getElementById('material-cards-container').appendChild(card);
    // 刷新筛选条
    renderFilterBars(window._clearFurnaceResults);
    // ✅ 立即应用当前筛选到新卡片
    applyFilterAndClear(window._clearFurnaceResults);
    return { cardId, materialCounter: newMC, name, shape, count, dim1, dim2, dim3, totalWeight, color };
}

export function selectMaterialCard(cardId) { const card = document.getElementById(cardId); if (card && card.classList.contains('active')) { card.classList.remove('active'); setSelectedMaterialCardId(null); } else { document.querySelectorAll('.material-card').forEach(c => c.classList.remove('active')); if (card) { card.classList.add('active'); setSelectedMaterialCardId(cardId); } } }

export function showMaterialDetail(cardId) {
    const card = document.getElementById(cardId); if (!card) return;
    const d = getMaterialDataFromCard(card);
    document.getElementById('mdp-title').textContent = '📋 ' + d.name;
    document.getElementById('mdp-placeholder').style.display = 'none';
    const body = document.getElementById('mdp-body'); body.style.display = 'block';
    const colorHex = rgbToHex(d.color) || '#888888';
    const cadPreview = d.cadImage ? '<div style="margin-top:4px;"><img src="' + d.cadImage + '" style="max-width:100%;max-height:60px;border-radius:3px;border:1px solid #333;" alt="CAD图纸预览"></div>' : '';
    body.innerHTML = '<div class="mdp-row"><div class="mdp-field" style="flex:2;"><label>名称</label><input type="text" id="mdp-name" value="' + d.name + '"></div><div class="mdp-field"><label>形态</label><select id="mdp-shape"><option value="cuboid" ' + (d.shape==='cuboid'?'selected':'') + '>立方体</option><option value="cylinder" ' + (d.shape==='cylinder'?'selected':'') + '>圆柱体</option></select></div></div><div class="mdp-row"><div class="mdp-field"><label>长度 L (mm)</label><input type="number" id="mdp-dim1" value="' + (d.shape==='cuboid'?d.dim1:'') + '"></div><div class="mdp-field"><label>宽度 W (mm)</label><input type="number" id="mdp-dim2" value="' + (d.shape==='cuboid'?d.dim2:'') + '"></div><div class="mdp-field"><label>高度 H (mm)</label><input type="number" id="mdp-dim3" value="' + d.dim3 + '"></div><div class="mdp-field"><label>直径 D (mm)</label><input type="number" id="mdp-diam" value="' + (d.shape==='cylinder'?d.dim1:'') + '"></div></div><div class="mdp-row"><div class="mdp-field"><label>数量</label><input type="number" id="mdp-count" value="' + d.count + '" min="1"></div><div class="mdp-field"><label>总重量 (kg)</label><input type="number" id="mdp-weight" value="' + d.totalWeight + '"></div><div class="mdp-field" style="max-width:52px;"><label>颜色</label><input type="color" id="mdp-color" value="' + colorHex + '" style="padding:0;height:28px;width:100%;"></div></div><div class="mdp-row"><div class="mdp-field"><label>材质</label><input type="text" id="mdp-material" value="' + d.material + '"></div><div class="mdp-field"><label>硬度要求</label><input type="text" id="mdp-hardness" value="' + d.hardness + '"></div></div><div class="mdp-row"><div class="mdp-field"><label>工艺</label><input type="text" id="mdp-process" value="' + d.process + '"></div></div><div class="mdp-row"><div class="mdp-field"><label>下单日期</label><input type="date" id="mdp-order-date" value="' + d.orderDate + '"></div><div class="mdp-field"><label>交付日期</label><input type="date" id="mdp-delivery-date" value="' + d.deliveryDate + '"></div></div><div class="mdp-row"><div class="mdp-field"><label>CAD图纸 <span style="color:#555;font-size:9px;">（可选，图片文件）</span></label><input type="file" id="mdp-cad-file" accept="image/*" style="font-size:9px;padding:2px;">' + cadPreview + '</div></div><div class="mdp-row"><div class="mdp-field"><label>备注</label><textarea id="mdp-remark">' + d.remark + '</textarea></div></div><button class="mdp-save-btn" id="mdp-save-btn">💾 保存工件参数</button><button class="mdp-import-btn" id="mdp-import-btn-inline">📥 从Excel导入工件列表</button>';
    document.getElementById('mdp-save-btn').addEventListener('click', () => saveMaterialDetail(cardId));
    document.getElementById('mdp-import-btn-inline').addEventListener('click', () => { document.getElementById('excel-file-input').click(); });
    document.getElementById('mdp-cad-file').addEventListener('change', function(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { card.setAttribute('data-cad-image', ev.target.result); const existingPreview = document.querySelector('#mdp-body .mdp-field img'); if (existingPreview) existingPreview.src = ev.target.result; else { const previewDiv = document.createElement('div'); previewDiv.style.marginTop = '4px'; previewDiv.innerHTML = '<img src="' + ev.target.result + '" style="max-width:100%;max-height:60px;border-radius:3px;border:1px solid #333;" alt="CAD图纸预览">'; document.getElementById('mdp-cad-file').parentNode.appendChild(previewDiv); } }; reader.readAsDataURL(file); });
    document.getElementById('mdp-shape').addEventListener('change', function() { const isCyl = this.value === 'cylinder'; document.getElementById('mdp-dim1').disabled = isCyl; document.getElementById('mdp-dim2').disabled = isCyl; document.getElementById('mdp-diam').disabled = !isCyl; if (isCyl) { document.getElementById('mdp-dim1').value = ''; document.getElementById('mdp-dim2').value = ''; } else { document.getElementById('mdp-diam').value = ''; } });
    const isCyl = d.shape === 'cylinder'; document.getElementById('mdp-dim1').disabled = isCyl; document.getElementById('mdp-dim2').disabled = isCyl; document.getElementById('mdp-diam').disabled = !isCyl;
    if (mdpCollapsed) { setMdpCollapsed(false); document.getElementById('material-detail-panel').classList.remove('collapsed'); document.getElementById('mdp-toggle-icon').textContent = '▲'; }
}

export function saveMaterialDetail(cardId) {
    const card = document.getElementById(cardId); if (!card) return;
    const name = document.getElementById('mdp-name').value.trim() || '工件'; const shape = document.getElementById('mdp-shape').value;
    const count = parseInt(document.getElementById('mdp-count').value) || 1; const totalWeight = parseFloat(document.getElementById('mdp-weight').value) || 0;
    const color = document.getElementById('mdp-color').value; const material = document.getElementById('mdp-material').value; const hardness = document.getElementById('mdp-hardness').value;
    const process = document.getElementById('mdp-process').value; const orderDate = document.getElementById('mdp-order-date').value;
    const deliveryDate = document.getElementById('mdp-delivery-date').value; const remark = document.getElementById('mdp-remark').value;
    let dim1, dim2, dim3;
    if (shape === 'cylinder') { dim1 = parseFloat(document.getElementById('mdp-diam').value) || 0; dim2 = dim1; dim3 = parseFloat(document.getElementById('mdp-dim3').value) || 0; }
    else { dim1 = parseFloat(document.getElementById('mdp-dim1').value) || 0; dim2 = parseFloat(document.getElementById('mdp-dim2').value) || 0; dim3 = parseFloat(document.getElementById('mdp-dim3').value) || 0; }
    const shapeLabel = shape === 'cylinder' ? '圆柱体' : '立方体'; const dimLabel = shape === 'cylinder' ? '⌀' + dim1 + '×H' + dim3 : dim1 + '×' + dim2 + '×' + dim3;
    card.querySelector('.m-name').textContent = name; card.querySelector('.m-color-swatch').style.backgroundColor = color; card.style.borderLeftColor = color;
    card.querySelector('.m-meta').innerHTML = shapeLabel + ' · ' + dimLabel + 'mm · ×' + count + '件 · ' + totalWeight + 'kg';
    card.setAttribute('data-material', material); card.setAttribute('data-hardness', hardness); card.setAttribute('data-process', process);
    card.setAttribute('data-order-date', orderDate); card.setAttribute('data-delivery-date', deliveryDate); card.setAttribute('data-remark', remark);
    document.getElementById('mdp-title').textContent = '📋 ' + name; updateTopSummary();
    renderFilterBars(window._clearFurnaceResults);
    applyFilterAndClear(window._clearFurnaceResults);
    const btn = document.getElementById('mdp-save-btn'); if (btn) { btn.textContent = '✅ 已保存'; setTimeout(() => { btn.textContent = '💾 保存工件参数'; }, 1500); }
}

export function deleteMaterialCard(mid) { const card = document.getElementById('material-card-' + mid); if (card) card.remove(); if (selectedMaterialCardId === 'material-card-' + mid) { setSelectedMaterialCardId(null); document.getElementById('mdp-placeholder').style.display = 'block'; document.getElementById('mdp-body').style.display = 'none'; document.getElementById('mdp-title').textContent = '📋 工件详情'; } updateTopSummary(); renderFilterBars(window._clearFurnaceResults); applyFilterAndClear(window._clearFurnaceResults);}

export function rgbToHex(rgb) { if (!rgb) return '#888888'; if (rgb.startsWith('#')) return rgb; const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/); if (!m) return '#888888'; return '#' + [m[1],m[2],m[3]].map(x => parseInt(x).toString(16).padStart(2,'0')).join(''); }

export function updateTopSummary() { document.getElementById('top-furnace-count').textContent = document.querySelectorAll('.furnace-card').length; document.getElementById('top-item-count').textContent = document.querySelectorAll('.material-card').length; }

export function updateFurnaceNav() {
    const navDiv = document.getElementById('furnace-nav');
    if (!navDiv) return;

    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        navDiv.style.display = 'none';
        return;
    }

    navDiv.style.display = 'flex';

    if (currentFurnaceIndex < 0 || currentFurnaceIndex >= globalFurnacesResult.length) {
        setCurrentFurnaceIndex(0);
    }

    const furnace = globalFurnacesResult[currentFurnaceIndex];

    const navTitle = document.getElementById('nav-title');
    if (navTitle) {
        navTitle.textContent = furnace.instanceId || `炉次 #${currentFurnaceIndex + 1}`;
    }

    const navInfo = document.getElementById('nav-info');
    if (navInfo) {
        navInfo.textContent = '';
        navInfo.style.display = 'none';
    }
}

function escapeSimHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getSimulationItemLayer(item, furnace) {
    if (
        furnace &&
        Array.isArray(furnace.shelvesUsed) &&
        furnace.shelvesUsed.length > 0 &&
        typeof item.y === 'number'
    ) {
        const sortedShelves = [...furnace.shelvesUsed].sort((a, b) => a.y - b.y);

        for (let i = sortedShelves.length - 1; i >= 0; i--) {
            if (item.y >= sortedShelves[i].y - 0.5) {
                return i + 2;
            }
        }

        return 1;
    }

    if (typeof item.layer === 'number' && item.layer >= 1) {
        return item.layer;
    }

    return 1;
}

function getSimulationItemDimensions(item) {
    if (item.originalDims) {
        const l = item.originalDims.l ?? item.originalDims.length ?? item.w ?? 0;
        const w = item.originalDims.w ?? item.d ?? 0;
        const h = item.originalDims.h ?? item.h ?? 0;
        return `${l}×${w}×${h}mm`;
    }

    return `${item.w || 0}×${item.d || 0}×${item.h || 0}mm`;
}

export function buildLoadingSimulationSteps(furnace) {
    if (!furnace || !Array.isArray(furnace.packedItems)) {
        return [];
    }

    const layerMap = new Map();

    furnace.packedItems.forEach(item => {
        const layer = getSimulationItemLayer(item, furnace);

        if (!layerMap.has(layer)) {
            layerMap.set(layer, {
                layer,
                items: new Map(),
                totalItems: 0,
                totalWeight: 0,
                shelfInfo: null
            });
        }

        const entry = layerMap.get(layer);
        const mat = item.material || '未知材质';
        const proc = item.process || '未知工艺';
        const dims = getSimulationItemDimensions(item);
        const key = `${item.name}|${mat}|${proc}|${dims}`;

        if (!entry.items.has(key)) {
            entry.items.set(key, {
                name: item.name || '工件',
                material: mat,
                process: proc,
                dimensions: dims,
                count: 0,
                totalWeight: 0
            });
        }

        const itemEntry = entry.items.get(key);
        itemEntry.count += 1;
        itemEntry.totalWeight += item.weight || 0;

        entry.totalItems += 1;
        entry.totalWeight += item.weight || 0;
    });

    if (Array.isArray(furnace.shelvesUsed) && furnace.shelvesUsed.length > 0) {
        const sortedShelves = [...furnace.shelvesUsed].sort((a, b) => a.y - b.y);

        sortedShelves.forEach((shelf, idx) => {
            const targetLayer = idx + 2;

            if (layerMap.has(targetLayer)) {
                layerMap.get(targetLayer).shelfInfo = {
                    index: idx + 1,
                    y: shelf.y || 0,
                    thickness: shelf.thickness || placementRules.shelfThickness || 20,
                    dimensions: `${furnace.w}×${furnace.d}mm`
                };
            }
        });
    }

    const sortedLayers = [...layerMap.values()].sort((a, b) => a.layer - b.layer);
    const steps = [];
    let stepNo = 1;

    sortedLayers.forEach(layerData => {
        const layerTitle = layerData.layer === 1
            ? '底层摆放'
            : `第 ${layerData.layer} 层摆放`;

        const shelfNote = layerData.shelfInfo
            ? `先安装第 ${layerData.shelfInfo.index} 块搁板，Y=${Math.round(layerData.shelfInfo.y)}mm，厚度 ${layerData.shelfInfo.thickness}mm。`
            : '';

        steps.push({
            no: stepNo++,
            type: 'place',
            title: layerTitle,
            meta: `${layerData.totalItems} 件 · ${layerData.totalWeight.toFixed(1)}kg`,
            layer: layerData.layer,
            shelfNote,
            items: [...layerData.items.values()].sort((a, b) => b.count - a.count)
        });
    });

    steps.push({
        no: stepNo++,
        type: 'review',
        title: '完成装炉复核',
        meta: `${furnace.packedItems.length} 件`,
        note: `当前炉次共 ${sortedLayers.length} 层，${furnace.packedItems.length} 件工件，合计 ${Number(furnace.totalWeight || 0).toFixed(1)}kg。`
    });

    return steps;
}

export function renderLoadingSimulationPanel() {
    const panel = document.getElementById('loading-simulation-panel');
    if (!panel) return;

    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        panel.innerHTML = `
            <div class="simulation-empty">
                生成方案后显示装炉步骤仿真
            </div>
        `;
        return;
    }

    const furnace = globalFurnacesResult[currentFurnaceIndex];
    if (!furnace) {
        panel.innerHTML = `
            <div class="simulation-empty">
                当前炉次不存在，请重新生成方案
            </div>
        `;
        return;
    }

    const steps = buildLoadingSimulationSteps(furnace);

    const stepsHtml = steps.map(step => {
        if (step.type === 'place') {
            const itemRows = (step.items || []).map(item => `
                <div class="sim-item-row">
                    <div class="sim-item-name">
                        ${escapeSimHtml(item.name)}
                        <span class="sim-item-desc">
                            ${escapeSimHtml(item.material)} · ${escapeSimHtml(item.process)} · ${escapeSimHtml(item.dimensions)}
                        </span>
                    </div>
                    <div class="sim-item-count">× ${item.count}</div>
                </div>
            `).join('');

            const shelfNoteHtml = step.shelfNote
                ? `<div class="sim-shelf-note">🧩 ${escapeSimHtml(step.shelfNote)}</div>`
                : '';

            return `
                <div class="sim-step-card place" data-layer="${step.layer || ''}">
                    <div class="sim-step-top">
                        <div class="sim-step-title">${String(step.no).padStart(2, '0')} · ${escapeSimHtml(step.title)}</div>
                        <div class="sim-step-meta">${escapeSimHtml(step.meta)}</div>
                    </div>
                    ${shelfNoteHtml}
                    ${itemRows}
                </div>
            `;
        }

            const layerAttr = step.layer ? `data-layer="${step.layer}"` : '';

            return `
                <div class="sim-step-card ${step.type}" ${layerAttr}>
                    <div class="sim-step-top">
                        <div class="sim-step-title">${String(step.no).padStart(2, '0')} · ${escapeSimHtml(step.title)}</div>
                        <div class="sim-step-meta">${escapeSimHtml(step.meta)}</div>
                    </div>
                    <div class="sim-note">${escapeSimHtml(step.note || '')}</div>
                </div>
            `;
    }).join('');

    panel.innerHTML = `
        <div class="sim-header-card">
            <div class="sim-title">🎬 ${escapeSimHtml(furnace.instanceId || '当前炉次')}</div>
            <div class="sim-subtitle">
                按层展示装炉顺序。第一版先用于现场复核和动画说明，后续再联动 3D 分层高亮。
            </div>
            <div class="sim-mode-row">
                <button class="sim-mode-pill active" type="button" data-sim-view-mode="cumulative">累计到此步</button>
                <button class="sim-mode-pill" type="button" data-sim-view-mode="single">仅看本层</button>
                <button class="sim-mode-pill" type="button" data-action="sim-show-all">显示全部</button>
            </div>

            <div class="sim-action-row">
                <button class="sim-play-btn" type="button" data-action="sim-play">
                    ▶ 播放装炉仿真
                </button>
            </div>
        </div>
        <div class="sim-step-list">
            ${stepsHtml}
        </div>
    `;
}

export function updateLeftPanelActiveForIndex(index) { document.querySelectorAll('.furnace-card').forEach(c => c.classList.remove('active')); if (!globalFurnacesResult || index >= globalFurnacesResult.length) return; const furnace = globalFurnacesResult[index]; document.querySelectorAll('.furnace-card').forEach(card => { if (card.querySelector('.f-card-name').textContent === furnace.typeName) card.classList.add('active'); }); }

export function updateCenterStats(onFurnaceClick) {
    const panel = document.getElementById('center-stats-panel'); const body = document.getElementById('csp-body'); const unpackedDiv = document.getElementById('center-stats-unpacked');
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    let totalWeight = 0, totalCount = 0;
    globalFurnacesResult.forEach(f => { totalWeight += f.totalWeight; totalCount += f.packedItems.length; });

    // V3.0: 在摘要中显示分组规则信息
    let summaryExtra = '';
    const gi = groupingInfo;
    if (gi && gi.rulesText && gi.rulesText.length > 0 && !gi.rulesText.includes('✗ 无分组规则')) {
        summaryExtra = ' | 规则：' + gi.rulesText.join(' ');
    }

    document.getElementById('csp-summary').textContent = '共' + globalFurnacesResult.length + '炉 · ' + totalCount + '件 · ' + totalWeight.toFixed(1) + 'kg' + summaryExtra;
    body.innerHTML = '';

    // V3.0: 如果启用了分组规则，显示分组结果摘要
    if (gi && gi.summaryText && gi.summaryText.length > 0) {
        const groupingDiv = document.createElement('div');
        groupingDiv.className = 'csp-grouping-info';
        groupingDiv.style.cssText = 'background:rgba(8,145,178,0.1);border:1px solid rgba(8,145,178,0.3);border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:10px;color:#67e8f9;';
        groupingDiv.innerHTML = '<strong>🔀 分组结果（' + gi.totalGroups + '组）：</strong><br>' + gi.summaryText.join('<br>');
        body.appendChild(groupingDiv);
    }

    globalFurnacesResult.forEach((f, idx) => { const totalVol = f.w * f.h * f.d; const packedVol = f.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0); const div = document.createElement('div'); div.className = 'csp-furnace-item' + (idx === currentFurnaceIndex ? ' active' : ''); div.innerHTML = '<strong>' + f.instanceId + '</strong>负载: ' + f.totalWeight.toFixed(1) + '/' + f.max_weight + 'kg<br>利用率: ' + ((packedVol/totalVol)*100).toFixed(1) + '% · ' + f.packedItems.length + '件'; div.addEventListener('click', () => { if (onFurnaceClick) onFurnaceClick(idx); }); body.appendChild(div); });
    if (globalUnpackedItems.length > 0) { let summary = {}; globalUnpackedItems.forEach(u => { summary[u.name] = (summary[u.name] || 0) + 1; }); unpackedDiv.style.display = 'block'; unpackedDiv.innerHTML = '<strong>⚠️ ' + globalUnpackedItems.length + ' 件无法装炉：</strong> ' + Object.entries(summary).map(([k,v]) => k + '×' + v).join(' · '); } else { unpackedDiv.style.display = 'none'; }
}

export function showCapacityFeedback(type, message) { const existing = document.getElementById('capacity-feedback'); if (existing) existing.remove(); const banner = document.createElement('div'); banner.id = 'capacity-feedback'; const bgColor = type === 'success' ? 'rgba(31,122,58,0.9)' : 'rgba(179,36,36,0.9)'; const borderColor = type === 'success' ? '#10b981' : '#ff4444'; banner.style.cssText = 'position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 999; max-width: 800px; width: fit-content; background: ' + bgColor + '; border: 2px solid ' + borderColor + '; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; text-align: center; line-height: 1.6; box-shadow: 0 4px 20px rgba(0,0,0,0.5); transition: opacity 0.5s ease; opacity: 1;'; banner.textContent = message; document.body.appendChild(banner); setTimeout(() => { const el = document.getElementById('capacity-feedback'); if (el) { el.style.opacity = '0'; setTimeout(() => { if (el.parentNode) el.remove(); }, 500); } }, 5000); }

// ==================== AI SUMMARY BAR (V6.0) ====================

/**
 * 计算热场均匀性得分（0-100）
 * 基于工件在炉膛内的位置分布方差
 * @param {Array} items - 炉膛内的工件列表
 * @param {Object} furnace - 炉膛尺寸信息
 * @returns {number} 0-100 的得分
 */
function calculateThermalUniformity(items, furnace) {
    if (!items || items.length === 0) return 0;
    
    // 收集所有工件的中心点坐标
    const centers = items.map(item => ({
        x: (item.x || 0) + (item.w || 0) / 2,
        y: (item.y || 0) + (item.h || 0) / 2,
        z: (item.z || 0) + (item.d || 0) / 2
    }));
    
    // 计算质心
    const cx = centers.reduce((s, c) => s + c.x, 0) / centers.length;
    const cy = centers.reduce((s, c) => s + c.y, 0) / centers.length;
    const cz = centers.reduce((s, c) => s + c.z, 0) / centers.length;
    
    // 计算各维度的方差（相对于炉膛尺寸归一化）
    const fw = furnace.w || 1, fh = furnace.h || 1, fd = furnace.d || 1;
    const varX = centers.reduce((s, c) => s + Math.pow((c.x - cx) / fw, 2), 0) / centers.length;
    const varY = centers.reduce((s, c) => s + Math.pow((c.y - cy) / fh, 2), 0) / centers.length;
    const varZ = centers.reduce((s, c) => s + Math.pow((c.z - cz) / fd, 2), 0) / centers.length;
    
    // 方差越小越均匀，理想方差约为 0.02-0.08
    const avgVar = (varX + varY + varZ) / 3;
    // 映射到 0-100 分：方差=0 → 100分，方差=0.15 → 0分
    const score = Math.max(0, Math.min(100, 100 - (avgVar / 0.15) * 100));
    return Math.round(score);
}

/**
 * 计算交期满足率（0-100）
 * 基于物料卡片上的 deliveryDate 属性
 * @returns {number} 0-100 的满足率
 */
function calculateDeliveryRate() {
    const materialCards = document.querySelectorAll('.material-card');
    if (materialCards.length === 0) return 100;
    
    let totalWithDate = 0;
    let overdue = 0;
    const now = new Date();
    
    materialCards.forEach(card => {
        const deliveryDate = card.getAttribute('data-delivery-date');
        if (deliveryDate) {
            totalWithDate++;
            const d = new Date(deliveryDate);
            if (d < now) overdue++;
        }
    });
    
    if (totalWithDate === 0) return 100;
    return Math.round(((totalWithDate - overdue) / totalWithDate) * 100);
}

/**
 * V6.0: 渲染 AI 推荐方案水平信息条
 * 替代旧的悬浮卡片，置于3D区域顶部，不遮挡3D模型
 * @param {Function} onFurnaceClick - 点击炉次明细的回调
 */
export function renderAISummaryBar(onFurnaceClick) {
    const bar = document.getElementById('ai-summary-bar');
    const emptyEl = document.getElementById('ai-bar-empty');
    const contentEl = document.getElementById('ai-bar-content');
    const toggleBtn = document.getElementById('ai-bar-toggle');
    
    if (!bar || !contentEl) return;
    
    // 无方案时显示空状态
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        contentEl.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'none';
        // 移除旧 dropdown
        const oldDropdown = bar.querySelector('.ai-bar-dropdown');
        if (oldDropdown) oldDropdown.remove();
        return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    contentEl.style.display = 'flex';
    if (toggleBtn) toggleBtn.style.display = 'flex';
    
    // === 计算全局指标 ===
    let totalWeight = 0, totalCount = 0, totalPackedVol = 0, totalFurnaceVol = 0;
    
    globalFurnacesResult.forEach(f => {
        totalWeight += f.totalWeight || 0;
        totalCount += (f.packedItems ? f.packedItems.length : 0);
        const fVol = (f.w || 0) * (f.h || 0) * (f.d || 0);
        totalFurnaceVol += fVol;
        if (f.packedItems) {
            f.packedItems.forEach(item => {
                totalPackedVol += (item.w || 0) * (item.h || 0) * (item.d || 0);
            });
        }
    });
    
    // 空间利用率
    const spaceUtilization = totalFurnaceVol > 0 ? (totalPackedVol / totalFurnaceVol) * 100 : 0;
    
    // 重量利用率
    const totalMaxWeight = globalFurnacesResult.reduce((s, f) => s + (f.max_weight || 0), 0);
    const weightUtilization = totalMaxWeight > 0 ? (totalWeight / totalMaxWeight) * 100 : 0;
    
    // 热场均匀性（各炉膛平均）
    let thermalScores = [];
    globalFurnacesResult.forEach(f => {
        if (f.packedItems && f.packedItems.length > 0) {
            thermalScores.push(calculateThermalUniformity(f.packedItems, f));
        }
    });
    const thermalUniformity = thermalScores.length > 0
        ? Math.round(thermalScores.reduce((s, v) => s + v, 0) / thermalScores.length)
        : 0;
    
    // 交期满足率
    const deliveryRate = calculateDeliveryRate();
    
    // 预计炉次
    const estimatedHeats = globalFurnacesResult.length;
    
    // === 综合评分计算（加权） ===
    const activePlanAnalysis = window._currentPlanAnalysis || null;

    const compositeScore = activePlanAnalysis && activePlanAnalysis.compositeScore != null
        ? activePlanAnalysis.compositeScore
        : Math.round(
            spaceUtilization * 0.35 +
            thermalUniformity * 0.30 +
            deliveryRate * 0.25 +
            weightUtilization * 0.10
        );
    
    // === 构建水平信息条 HTML ===
    let html = '';
    
    // 综合评分
    html += '<div class="ai-bar-score">';
    html += '<span class="ai-bar-score-num">' + compositeScore + '</span>';
    html += '<span class="ai-bar-score-label">⭐ 综合评分</span>';
    html += '</div>';
    
    // 分隔
    html += '<div class="ai-bar-separator"></div>';
    
    // 空间利用率
    html += '<div class="ai-bar-metric">';
    html += '<span class="ai-bar-metric-icon">📐</span>';
    html += '<span>空间利用率</span>';
    html += '<span class="ai-bar-metric-value ' + (spaceUtilization >= 80 ? 'good' : (spaceUtilization >= 60 ? '' : 'warn')) + '">' + spaceUtilization.toFixed(1) + '%</span>';
    html += '</div>';
    
    // 热场均匀性
    html += '<div class="ai-bar-metric">';
    html += '<span class="ai-bar-metric-icon">🔥</span>';
    html += '<span>热场均匀性</span>';
    html += '<span class="ai-bar-metric-value ' + (thermalUniformity >= 80 ? 'good' : (thermalUniformity >= 60 ? '' : 'warn')) + '">' + thermalUniformity + '%</span>';
    html += '</div>';
    
    // 交期满足率
    html += '<div class="ai-bar-metric">';
    html += '<span class="ai-bar-metric-icon">📅</span>';
    html += '<span>交期满足率</span>';
    html += '<span class="ai-bar-metric-value ' + (deliveryRate >= 90 ? 'good' : (deliveryRate >= 70 ? '' : 'warn')) + '">' + deliveryRate + '%</span>';
    html += '</div>';
    
    // 分隔
    html += '<div class="ai-bar-separator"></div>';
    
    // 概览摘要
    html += '<div class="ai-bar-summary">共 <strong>' + estimatedHeats + '</strong> 炉 · <strong>' + totalCount + '</strong> 件 · <strong>' + totalWeight.toFixed(1) + '</strong>kg</div>';
    
    // 未装载警告
    if (globalUnpackedItems && globalUnpackedItems.length > 0) {
        html += '<div class="ai-bar-unpacked" title="' + globalUnpackedItems.length + ' 件无法装炉">⚠️ ' + globalUnpackedItems.length + ' 件未装载</div>';
    }
    
    contentEl.innerHTML = html;
    
    // === 构建炉次明细下拉面板 ===
    // 移除旧 dropdown
    const oldDropdown = bar.querySelector('.ai-bar-dropdown');
    if (oldDropdown) oldDropdown.remove();
    
    const dropdown = document.createElement('div');
    dropdown.className = 'ai-bar-dropdown';
    dropdown.id = 'ai-bar-dropdown';
    
    let dropdownHtml = '';
    globalFurnacesResult.forEach((f, idx) => {
        const fVol = (f.w || 0) * (f.h || 0) * (f.d || 0);
        const pVol = (f.packedItems || []).reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
        const util = fVol > 0 ? ((pVol / fVol) * 100).toFixed(1) : '0';
        const count = (f.packedItems || []).length;
        const activeClass = (idx === currentFurnaceIndex) ? ' active' : '';
        dropdownHtml += '<div class="ai-furnace-item' + activeClass + '" data-furnace-idx="' + idx + '">';
        dropdownHtml += '<span class="ai-furnace-name">' + (f.instanceId || ('炉 #' + (idx + 1))) + '</span>';
        dropdownHtml += '<span class="ai-furnace-meta">利用率 ' + util + '% · ' + count + '件</span>';
        dropdownHtml += '</div>';
    });
    
    if (globalUnpackedItems && globalUnpackedItems.length > 0) {
        const summary = {};
        globalUnpackedItems.forEach(u => { summary[u.name] = (summary[u.name] || 0) + 1; });
        const uList = Object.entries(summary).map(([k, v]) => k + '×' + v).join(' · ');
        dropdownHtml += '<div class="ai-unpacked-warn">⚠️ ' + globalUnpackedItems.length + ' 件未装载: ' + uList + '</div>';
    }
    
    dropdown.innerHTML = dropdownHtml;
    bar.appendChild(dropdown);
    
    // 绑定炉次明细点击事件
    dropdown.querySelectorAll('.ai-furnace-item').forEach(item => {
        item.addEventListener('click', function() {
            const idx = parseInt(this.getAttribute('data-furnace-idx'));
            if (!isNaN(idx) && onFurnaceClick) {
                onFurnaceClick(idx);
                // 更新 active 状态
                dropdown.querySelectorAll('.ai-furnace-item').forEach(el => el.classList.remove('active'));
                this.classList.add('active');
                // 关闭下拉
                dropdown.classList.remove('visible');
                if (toggleBtn) toggleBtn.classList.remove('active');
            }
        });
    });
    
    // 绑定 toggle 按钮
    if (toggleBtn) {
        const newToggle = toggleBtn.cloneNode(true);
        toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);
        newToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const dd = bar.querySelector('.ai-bar-dropdown');
            if (dd) {
                const isVisible = dd.classList.contains('visible');
                dd.classList.toggle('visible');
                newToggle.classList.toggle('active', !isVisible);
            }
        });
    }
    
    // 点击外部关闭下拉
    document.addEventListener('click', function closeDropdown(e) {
        if (!bar.contains(e.target)) {
            const dd = bar.querySelector('.ai-bar-dropdown');
            if (dd) dd.classList.remove('visible');
            const tb = bar.querySelector('.ai-bar-toggle');
            if (tb) tb.classList.remove('active');
        }
    }, { once: false });
}

/**
 * 渲染材质和工艺筛选条
 * @param {Function} onClearResults - 清空装炉结果的回调
 */
export function renderFilterBars(onClearResults) {
    const materialContainer = document.getElementById('material-filter-tags');
    const processContainer = document.getElementById('process-filter-tags');
    const hardnessContainer = document.getElementById('hardness-filter-tags');
    if (!materialContainer || !processContainer || !hardnessContainer) return;

    // 统计材质和工艺数量
    const materialMap = new Map();   // 材质名 -> 数量
    const processMap = new Map();    // 工艺名 -> 数量
    const hardnessMap = new Map();   // 硬度名 -> 数量
    let totalCards = 0;

    document.querySelectorAll('.material-card').forEach(card => {
        totalCards++;
        const material = card.getAttribute('data-material');
        if (material) materialMap.set(material, (materialMap.get(material) || 0) + 1);
        const process = card.getAttribute('data-process');
        if (process) processMap.set(process, (processMap.get(process) || 0) + 1);
        const hardness = card.getAttribute('data-hardness');
        if (hardness) hardnessMap.set(hardness, (hardnessMap.get(hardness) || 0) + 1);
    });

    // 构建材质标签HTML
    let materialHtml = `<div class="filter-tag ${currentMaterialFilters.size === 0 ? 'active' : ''}" data-type="material" data-filter="all">全部 (${totalCards})</div>`;
    for (let [mat, cnt] of materialMap.entries()) {
        materialHtml += `<div class="filter-tag ${currentMaterialFilters.has(mat) ? 'active' : ''}" data-type="material" data-filter="${mat.replace(/"/g, '&quot;')}">${escapeHtml(mat)} (${cnt})</div>`;
    }
    materialContainer.innerHTML = materialHtml;

    // 构建工艺标签HTML
    let processHtml = `<div class="filter-tag ${currentProcessFilters.size === 0 ? 'active' : ''}" data-type="process" data-filter="all">全部 (${totalCards})</div>`;
    for (let [proc, cnt] of processMap.entries()) {
        processHtml += `<div class="filter-tag ${currentProcessFilters.has(proc) ? 'active' : ''}" data-type="process" data-filter="${proc.replace(/"/g, '&quot;')}">${escapeHtml(proc)} (${cnt})</div>`;
    }
    processContainer.innerHTML = processHtml;

    // 构建硬度标签HTML
    let hardnessHtml = `<div class="filter-tag ${currentHardnessFilters.size === 0 ? 'active' : ''}" data-type="hardness" data-filter="all">全部 (${totalCards})</div>`;
    for (let [hard, cnt] of hardnessMap.entries()) {
        hardnessHtml += `<div class="filter-tag ${currentHardnessFilters.has(hard) ? 'active' : ''}" data-type="hardness" data-filter="${hard.replace(/"/g, '&quot;')}">${escapeHtml(hard)} (${cnt})</div>`;
    }
    hardnessContainer.innerHTML = hardnessHtml;

    // 绑定点击事件
    materialContainer.querySelectorAll('.filter-tag').forEach(tag => {
        tag.addEventListener('click', (e) => {
            e.stopPropagation();
            const filterValue = tag.getAttribute('data-filter');
            if (filterValue === 'all') {
                clearMaterialFilters();
            } else {
                toggleMaterialFilter(filterValue);
            }
            applyFilterAndClear(onClearResults);
        });
    });
    processContainer.querySelectorAll('.filter-tag').forEach(tag => {
        tag.addEventListener('click', (e) => {
            e.stopPropagation();
            const filterValue = tag.getAttribute('data-filter');
            if (filterValue === 'all') {
                clearProcessFilters();
            } else {
                toggleProcessFilter(filterValue);
            }
            applyFilterAndClear(onClearResults);
        });
    });
    hardnessContainer.querySelectorAll('.filter-tag').forEach(tag => {
        tag.addEventListener('click', (e) => {
            e.stopPropagation();
            const filterValue = tag.getAttribute('data-filter');
            if (filterValue === 'all') {
                clearHardnessFilters();
            } else {
                toggleHardnessFilter(filterValue);
            }
            applyFilterAndClear(onClearResults);
        });
    });

    // 绑定折叠按钮事件
    document.querySelectorAll('.filter-collapse-btn').forEach(btn => {
        const targetId = btn.getAttribute('data-target');
        const target = document.getElementById(targetId);
        const filterBar = btn.closest('.filter-bar');
        if (!target || !filterBar) return;

        // 从 localStorage 读取折叠状态并恢复（可选）
        const storageKey = `filter_${targetId}_collapsed`;
        const savedState = localStorage.getItem(storageKey);
        if (savedState === 'true') {
            filterBar.classList.add('collapsed');
            btn.textContent = '▶';
        } else {
            btn.textContent = '▼';
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            filterBar.classList.toggle('collapsed');
            const isCollapsed = filterBar.classList.contains('collapsed');
            btn.textContent = isCollapsed ? '▶' : '▼';
            localStorage.setItem(storageKey, isCollapsed);
        });
    });
}

/**
 * 辅助：转义HTML特殊字符
 */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// }
function applyFilterAndClear(onClearResults) {
    // 先应用筛选：隐藏不符合条件的卡片
    document.querySelectorAll('.material-card').forEach(card => {
        const material = card.getAttribute('data-material');
        const process = card.getAttribute('data-process');
        const hardness = card.getAttribute('data-hardness');
        const materialPass =
            currentMaterialFilters.size === 0 ||
            currentMaterialFilters.has(material);

        const processPass =
            currentProcessFilters.size === 0 ||
            currentProcessFilters.has(process);

        const hardnessPass =
            currentHardnessFilters.size === 0 ||
            currentHardnessFilters.has(hardness);

        card.style.display = materialPass && processPass && hardnessPass ? 'flex' : 'none';
    });

    // 清空装炉结果
    if (onClearResults) onClearResults();

    // 刷新筛选条（更新数量和激活状态）
    renderFilterBars(onClearResults);
}

/**
 * 渲染炉膛缩略图栏
 * @param {Array} furnaces - globalFurnacesResult 数组
 * @param {number} currentIdx - 当前显示的炉膛索引
 * @param {Function} onClickCallback - 点击缩略图时的回调函数 (index) => void
 */
export function renderFurnaceThumbnails(furnaces, currentIdx, onClickCallback) {
    const thumbBar = document.getElementById('furnace-thumb-bar');
    const container = document.getElementById('thumb-scroll-container');
    if (!thumbBar || !container) return;

    if (!furnaces || furnaces.length === 0) {
        thumbBar.style.display = 'none';
        return;
    }

    thumbBar.style.display = 'block';
    container.innerHTML = '';

    furnaces.forEach((f, idx) => {
        const totalVol = f.w * f.h * f.d;
        const packedVol = (f.packedItems || []).reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
        const utilization = totalVol > 0 ? ((packedVol / totalVol) * 100).toFixed(0) : '0';

        let emoji = '📦';
        if (utilization >= 80) emoji = '🟩';
        else if (utilization >= 60) emoji = '🟨';
        else if (utilization > 0) emoji = '🟧';
        else emoji = '⬜';

        const card = document.createElement('div');
        card.className = 'thumb-card' + (idx === currentIdx ? ' active' : '');
        card.setAttribute('data-furnace-idx', idx);

        card.innerHTML = `
            <div class="thumb-preview">${emoji}</div>
            <div class="thumb-name" title="${f.instanceId}">${f.instanceId}</div>
        `;

        card.addEventListener('click', (e) => {
            e.stopPropagation();
            if (onClickCallback) onClickCallback(idx);
        });

        container.appendChild(card);
    });
}

// ==================== RULES MODAL (V2.0) ====================

export function openRulesModal() {
    document.getElementById('rules-modal-overlay').style.display = 'flex';
    // 🔧 V2.6 清理：只保留对核心逻辑有数值影响的参数
    // 基础/尺寸规则：最小安全间距、炉壁间距、允许旋转90°
    // document.getElementById('rule-min-spacing').value = placementRules.minSpacing;
    // document.getElementById('rule-wall-spacing').value = placementRules.wallSpacing;
    // document.getElementById('rule-rotate').checked = placementRules.rotate;
    // 重量与安全规则：承重安全余量
    document.getElementById('rule-weight-margin').value = placementRules.weightMargin;
    // 搁板参数：主开关、层高、实体厚度
    document.getElementById('rule-shelf-layered').checked = placementRules.useShelfLayered;
    document.getElementById('rule-shelf-thickness').value = placementRules.shelfThickness || 20;

    // 姿态优化
    document.getElementById('rule-posture-optimization').checked = placementRules.allowPostureOptimization !== false;
    // V4.5: 圆盘翻转阈值
    document.getElementById('rule-disc-flip-ratio').value = placementRules.discFlipRatio != null ? placementRules.discFlipRatio : 1.0;

    // 在 openRulesModal 内部，现有代码之后
    const strategySelect = document.getElementById('rule-strategy');
    if (strategySelect) {
        strategySelect.value = placementRules.strategy || 'balanced';
        // 更新描述
        const descSpan = document.getElementById('rule-strategy-desc');
        if (descSpan) {
            // 需要导入 strategyConfig，或者简单映射
            const descMap = {
                balanced: '少工件贴边对称，多工件兼顾重心，物理稳定',
                spaceUtil: '塞满炉子，忽略重心，强力贴边紧凑',
                thermalBalance: '温度均匀，避免中心聚集，控制局部密度',
                surfaceUniform: '最大暴露面积，避免遮挡，气流路径一致'
            };
            descSpan.textContent = descMap[strategySelect.value] || '';
        }
        // 监听下拉变化，动态更新描述
        strategySelect.addEventListener('change', (e) => {
            const descSpanLocal = document.getElementById('rule-strategy-desc');
            if (descSpanLocal) {
                const descMap = {
                    balanced: '少工件贴边对称，多工件兼顾重心，物理稳定',
                    spaceUtil: '塞满炉子，忽略重心，强力贴边紧凑',
                    thermalBalance: '温度均匀，避免中心聚集，控制局部密度',
                    surfaceUniform: '最大暴露面积，避免遮挡，气流路径一致'
                };
                descSpanLocal.textContent = descMap[e.target.value] || '';
            }
        });
    }
}

export function saveRulesModal() {
    const strategySelect = document.getElementById('rule-strategy');
    const selectedStrategy = strategySelect ? strategySelect.value : 'balanced';

    // V3.0: 保存核心有效参数，新增分组规则 sameMaterial / sameProcess
    setPlacementRules({
        gravity: true,                          // 重力优先已固化
        dense: true,                            // 密集排布已固化
        sameMaterial: false,
        sameProcess: false,
        // minSpacing: parseFloat(document.getElementById('rule-min-spacing').value) || 5,
        // wallSpacing: parseFloat(document.getElementById('rule-wall-spacing').value) || 30,
        rotate: true,
        weightMargin: parseFloat(document.getElementById('rule-weight-margin').value) || 10,
        balance: true,                          // 重心平衡已固化（搁板分层内嵌重心居中）
        sortStrategy: 'weight-desc',            // 排序策略固化为重量降序
        strategy: selectedStrategy,
        useShelfLayered: document.getElementById('rule-shelf-layered').checked,
        shelfThickness: parseFloat(document.getElementById('rule-shelf-thickness').value) || 20,
        allowPostureOptimization: document.getElementById('rule-posture-optimization').checked,
        discFlipRatio: parseFloat(document.getElementById('rule-disc-flip-ratio').value) || 1.0,
        centerOfGravity: true                   // 重心居中已固化，勾选搁板时无条件执行
    });
    const globalSpacingInput = document.getElementById('global-spacing');
    if (globalSpacingInput) {
        globalSpacingInput.value = placementRules.minSpacing;
    }
    document.getElementById('rules-modal-overlay').style.display = 'none';
    
    const btn = document.getElementById('btn-rules');
    if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✅ 规则已保存';
        setTimeout(() => { btn.textContent = orig; }, 1500);
    }
}

// ==================== MASTER VIEW ====================

export function initMasterView(renderMasterPlanFn) {
    const listEl = document.getElementById('master-list');
    listEl.innerHTML = '<div style="font-size:11px;color:#666;margin-bottom:10px;padding:4px 0;">共 ' + masterPlans.length + ' 个历史方案</div>';
    masterPlans.forEach((plan, idx) => { const card = document.createElement('div'); card.className = 'master-plan-card' + (idx === 0 ? ' active' : ''); const approverBadge = plan.approver ? '<span style="font-size:9px;color:#10b981;">✅ 审批: ' + plan.approver + '</span>' : ''; card.innerHTML = '<button class="mpc-delete" data-plan-id="' + plan.id + '" title="删除此方案">✕</button><div class="mpc-title">' + plan.title + '</div><div class="mpc-meta">' + plan.furnaceType + '<br>' + plan.date + ' · ' + plan.operator + '<br>利用率: ' + plan.utilization + ' · ' + plan.itemCount + '件<br>' + approverBadge + '</div><span class="mpc-tag ' + plan.tag + '">' + plan.tagLabel + '</span>'; card.addEventListener('click', (e) => { if (e.target.closest('.mpc-delete')) return; document.querySelectorAll('.master-plan-card').forEach(c => c.classList.remove('active')); card.classList.add('active'); if (renderMasterPlanFn) renderMasterPlanFn(plan); }); card.querySelector('.mpc-delete').addEventListener('click', (e) => { e.stopPropagation(); const planId = parseInt(e.target.getAttribute('data-plan-id')); const idx2 = masterPlans.findIndex(p => p.id === planId); if (idx2 >= 0) { masterPlans.splice(idx2, 1); initMasterView(renderMasterPlanFn); if (masterPlans.length > 0 && renderMasterPlanFn) renderMasterPlanFn(masterPlans[0]); else document.getElementById('master-detail-panel').innerHTML = '<strong>暂无方案</strong>'; } }); listEl.appendChild(card); });
    if (masterPlans.length > 0 && renderMasterPlanFn) renderMasterPlanFn(masterPlans[0]);
}

// ==================== EXCEL IMPORT ====================

export function parseExcelData(workbook) {
    const sheetName = workbook.SheetNames[0]; const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) return []; let headerRow = 0;
    for (let i = 0; i < Math.min(5, rows.length); i++) { if (rows[i].some(c => String(c).includes('名称') || String(c).includes('编码') || String(c).includes('规格'))) { headerRow = i; break; } }
    const headers = rows[headerRow].map(h => String(h).trim());
    const getCol = (keywords) => { for (let kw of keywords) { const idx = headers.findIndex(h => h.includes(kw)); if (idx >= 0) return idx; } return -1; };
    /** V3.4: 新表头 — 产品名称/工件名称、客户/客户名称、物料编码、规格、数量、单重、工艺、材质 */
    const colProductName = getCol(['产品名称', '工件名称']);
    const colCustomer = getCol(['客户名称', '客户']);
    const colItemCode = getCol(['物料编码']);
    const colSpec = getCol(['规格']);
    const colCount = getCol(['数量']);
    const colUnitWeight = getCol(['单重']);
    const colProcess = getCol(['工艺']);
    const colMaterial = getCol(['材质']);
    // 旧表头兼容
    const colNameOld = getCol(['名称']);
    const colL = getCol(['长度', 'L']); const colW = getCol(['宽度', 'W']); const colH = getCol(['高度', 'H']); const colD = getCol(['直径', 'D']);
    const colWeightOld = getCol(['总重', '重量']);
    const colHardness = getCol(['硬度']); const colDate = getCol(['日期', '下单']); const colRemark = getCol(['备注']);

    const results = [];
    /** 新格式规格解析器：支持 "60*150*150" 或 "⌀60×H150" 等格式 */
    const parseSpec = (specStr) => {
        if (!specStr) return null;
        const s = String(specStr).trim();
        const diamMatch = s.match(/[⌀Φ]?(\d+(?:\.\d+)?)\s*[×*]\s*H?\s*(\d+(?:\.\d+)?)/i);
        if (diamMatch) return { shape: 'cylinder', dim1: parseFloat(diamMatch[1]), dim2: parseFloat(diamMatch[1]), dim3: parseFloat(diamMatch[2]) };
        const parts = s.split(/[\*x×X]/);
        if (parts.length >= 3) return { shape: 'cuboid', dim1: parseFloat(parts[0]) || 0, dim2: parseFloat(parts[1]) || 0, dim3: parseFloat(parts[2]) || 0 };
        if (parts.length === 2) return { shape: 'cylinder', dim1: parseFloat(parts[0]) || 0, dim2: parseFloat(parts[0]) || 0, dim3: parseFloat(parts[1]) || 0 };
        return null;
    };

    for (let i = headerRow + 1; i < rows.length; i++) {
        const row = rows[i];
        let productName, customerName, itemCode, shape, dim1, dim2, dim3, count, weight, material, process;

        // ===== V3.5: 统一混合解析 — 新旧格式字段独立检测，不再互斥 =====

        // 1. 产品名称：优先新格式"产品名称/工件名称"列，回退旧格式"名称"列
        productName = String(row[colProductName >= 0 ? colProductName : colNameOld] || '').trim();
        // 2. 客户名称 & 物料编码：独立检测（与新旧格式无关）
        customerName = colCustomer >= 0 ? String(row[colCustomer] || '').trim() : '';
        itemCode = colItemCode >= 0 ? String(row[colItemCode] || '').trim() : '';
        if (!productName && !itemCode) continue;

        // 3. 尺寸解析：优先尝试"规格"列 → 失败回退 L/W/H/D 列
        const specStr = colSpec >= 0 ? String(row[colSpec] || '').trim() : '';
        const specParsed = specStr ? parseSpec(specStr) : null;
        if (specParsed) {
            shape = specParsed.shape; dim1 = specParsed.dim1; dim2 = specParsed.dim2; dim3 = specParsed.dim3;
        } else {
            // 回退到旧格式 L/W/H/D 列
            const L = colL >= 0 ? parseFloat(row[colL]) || 0 : 0;
            const W = colW >= 0 ? parseFloat(row[colW]) || 0 : 0;
            const H = colH >= 0 ? parseFloat(row[colH]) || 0 : 0;
            const D = colD >= 0 ? parseFloat(row[colD]) || 0 : 0;
            const hasDiam = D > 0; const hasCuboid = L > 0 && W > 0;
            if (hasDiam && H > 0) { shape = 'cylinder'; dim1 = D; dim2 = D; dim3 = H; }
            else if (hasCuboid) { shape = 'cuboid'; dim1 = L; dim2 = W; dim3 = H || Math.min(L, W); }
            else if (D > 0) { shape = 'cylinder'; dim1 = D; dim2 = D; dim3 = H || D; }
            else { shape = 'cuboid'; dim1 = L || 50; dim2 = W || 50; dim3 = H || 50; }
        }

        // 4. 数量 & 重量：优先"单重"列 → 回退旧"总重/重量"列
        count = colCount >= 0 ? (parseInt(row[colCount]) || 1) : 1;
        const unitWt = colUnitWeight >= 0 ? parseFloat(row[colUnitWeight]) || 0 : 0;
        const totalWt = colWeightOld >= 0 ? parseFloat(row[colWeightOld]) || 0 : 0;
        weight = unitWt > 0 ? unitWt : totalWt;

        // 5. 材质 & 工艺：统一读取
        material = colMaterial >= 0 ? String(row[colMaterial] || '').trim() : '';
        process = colProcess >= 0 ? String(row[colProcess] || '').trim() : '';

        // 6. 附加热处理信息（兼容旧表头）
        const hardness = colHardness >= 0 ? String(row[colHardness] || '').trim() : '';
        const orderDate = colDate >= 0 ? String(row[colDate] || '').trim() : '';
        const remark = colRemark >= 0 ? String(row[colRemark] || '').trim() : '';

        /** V3.4 核心：唯一标识 name = 产品名称_客户名称，防止重名 */
        const uniqueName = productName && customerName ? `${productName}_${customerName}` : (productName || itemCode || '未知工件');
        const valid = dim1 > 0 && dim3 > 0;
        results.push({
            name: uniqueName,
            showName: productName || uniqueName,
            customer: customerName,
            itemCode: itemCode,
            shape, dim1, dim2, dim3, count, weight, material,
            hardness, process,
            orderDate, deliveryDate: '', remark,
            valid
        });
    }
    return results;
}

export function showImportPreview(data) { setImportPreviewData(data); const content = document.getElementById('import-preview-content'); let html = '<table class="import-table"><thead><tr><th>产品名称</th><th>客户</th><th>物料编码</th><th>形态</th><th>尺寸</th><th>数量</th><th>单重(kg)</th><th>材质</th><th>工艺</th><th>状态</th></tr></thead><tbody>'; data.forEach(d => { const dimStr = d.shape === 'cylinder' ? '⌀' + d.dim1 + '×H' + d.dim3 : d.dim1 + '×' + d.dim2 + '×' + d.dim3; const cls = d.valid ? '' : ' class="error"'; const displayName = d.showName || d.name.split('_')[0]; const customer = d.customer || ''; html += '<tr' + cls + '><td>' + displayName + '</td><td>' + customer + '</td><td>' + (d.itemCode || '') + '</td><td>' + (d.shape==='cylinder'?'圆柱':'立方') + '</td><td>' + dimStr + 'mm</td><td>' + d.count + '</td><td>' + d.weight + '</td><td>' + d.material + '</td><td>' + d.process + '</td><td>' + (d.valid?'✅':'⚠️ 尺寸不足') + '</td></tr>'; }); html += '</tbody></table>'; content.innerHTML = html; document.getElementById('import-preview-overlay').style.display = 'flex'; }

export function applyImportData(replace) { if (replace) { document.querySelectorAll('.material-card').forEach(c => c.remove()); usedColors.clear(); clearMaterialFilters(); clearProcessFilters(); clearHardnessFilters();} importPreviewData.filter(d => d.valid).forEach(d => { const color = generateUniqueColor(usedColors); createMaterialCard(d.name, d.shape, d.count, d.dim1, d.dim2, d.dim3, d.weight, color, { material: d.material, hardness: d.hardness, process: d.process, orderDate: d.orderDate, deliveryDate: d.deliveryDate, remark: d.remark, showName: d.showName, customer: d.customer, itemCode: d.itemCode }); }); updateTopSummary(); document.getElementById('import-preview-overlay').style.display = 'none'; renderFilterBars(window._clearFurnaceResults); applyFilterAndClear(window._clearFurnaceResults);}

// ==================== JSON IMPORT (MASTER) ====================

export function openJsonImportModal() { document.getElementById('ji-json-textarea').value = ''; document.getElementById('ji-error-msg').textContent = ''; document.getElementById('ji-error-msg').classList.remove('visible'); document.getElementById('ji-preview-section').style.display = 'none'; document.getElementById('ji-preview-box').innerHTML = ''; document.getElementById('btn-ji-import').disabled = true; document.getElementById('json-import-overlay').style.display = 'flex'; }

export function parseJsonPlan(jsonStr) { try { const data = JSON.parse(jsonStr); if (!data.title) throw new Error('缺少 title 字段'); if (!data.furnace) throw new Error('缺少 furnace 字段'); if (!data.materials || !Array.isArray(data.materials)) throw new Error('缺少 materials 数组'); if (data.materials.length === 0) throw new Error('materials 数组不能为空'); const f = data.furnace; if (!f.name) throw new Error('furnace.name 不能为空'); if (!f.width || !f.height || !f.depth) throw new Error('furnace 缺少尺寸字段'); data.materials.forEach((m, i) => { if (!m.name) throw new Error('materials[' + i + '] 缺少 name'); if (!m.shape) throw new Error('materials[' + i + '] 缺少 shape'); if (!m.dim1 || !m.dim3) throw new Error('materials[' + i + '] 缺少尺寸字段'); }); return { ok: true, data }; } catch(e) { return { ok: false, error: e.message }; } }

export function renderJsonPreview(data) {
    if (
        data &&
        data.schemaVersion === 'heat-treatment-digital-twin-v1' &&
        data.loadingPlan &&
        Array.isArray(data.loadingPlan.furnaces)
    ) {
        const title = data.meta?.title || '装炉数字孪生记录';
        const furnaces = data.loadingPlan.furnaces || [];
        const materials = data.materials || [];

        const totalItems = furnaces.reduce((sum, f) => {
            return sum + ((f.packedItems && f.packedItems.length) || 0);
        }, 0);

        const totalWeight = furnaces.reduce((sum, f) => {
            return sum + (f.totalWeightKg || 0);
        }, 0);

        let html = '';
        html += '<div class="ji-preview-row">';
        html += '<span class="ji-preview-tag">📋 ' + title + '</span>';
        html += '<span class="ji-preview-tag">🧬 ' + data.schemaVersion + '</span>';
        html += '<span class="ji-preview-tag">🔥 ' + furnaces.length + ' 个炉次</span>';
        html += '<span class="ji-preview-tag">📦 ' + totalItems + ' 件已装</span>';
        html += '<span class="ji-preview-tag">⚖ ' + totalWeight.toFixed(1) + 'kg</span>';
        html += '</div>';

        html += '<div class="ji-preview-row" style="margin-top:6px;">';
        html += '<span class="ji-preview-tag">🧰 工装: ' + (furnaces[0]?.toolingType || '-') + '</span>';
        html += '<span class="ji-preview-tag">📐 尺寸: ' +
            (furnaces[0]?.dimensions?.width || 0) + '×' +
            (furnaces[0]?.dimensions?.height || 0) + '×' +
            (furnaces[0]?.dimensions?.depth || 0) + 'mm</span>';
        html += '<span class="ji-preview-tag">⚙️ 策略: ' + (data.loadingPlan.strategy || '-') + '</span>';
        html += '<span class="ji-preview-tag">🧾 工件批次: ' + materials.length + '</span>';
        html += '</div>';

        document.getElementById('ji-preview-box').innerHTML = html;
        document.getElementById('ji-preview-section').style.display = 'block';
        return;
    }

    // 下面保留你原来的旧格式 renderJsonPreview(data)
    // 旧格式预览
    const f = data.furnace || {};
    const materials = data.materials || [];

    let html = '';
    html += '<div class="ji-preview-row">';
    html += '<span class="ji-preview-tag">📋 ' + (data.title || '历史方案') + '</span>';
    html += '<span class="ji-preview-tag">🔥 ' + (f.name || '-') + '</span>';
    html += '<span class="ji-preview-tag">📐 ' + (f.width || 0) + '×' + (f.height || 0) + '×' + (f.depth || 0) + 'mm</span>';
    html += '<span class="ji-preview-tag">📦 ' + materials.length + ' 个工件批次</span>';
    html += '</div>';

    document.getElementById('ji-preview-box').innerHTML = html;
    document.getElementById('ji-preview-section').style.display = 'block';
}

export function importJsonPlanToMaster(data, initMasterViewFn) {
    const f = data.furnace; if (!f || !f.name) { alert('❌ 导入失败：JSON 中缺少 furnace 信息或 furnace.name 字段'); return; } if (!f.width || !f.height || !f.depth) { alert('❌ 导入失败：炉膛 "' + f.name + '" 缺少完整尺寸字段 (width/height/depth)'); return; }
    const approver = data.approver || ''; const tag = data.tag || 'imported'; const tagLabel = data.tagLabel || '导入方案';
    const items3d = []; const hasPositions = (data.items && Array.isArray(data.items) && data.items.length > 0) || (data.packedPositions && Array.isArray(data.packedPositions) && data.packedPositions.length > 0);
    if (hasPositions) { const positionsSource = (data.items && data.items.length > 0) ? data.items : data.packedPositions; positionsSource.forEach((item) => { const pos = item.position || { x: item.x, y: item.y, z: item.z }; const dim = item.dimensions || { l: item.w || item.dim1, w: item.d || item.dim2, h: item.h || item.dim3 }; const shape = item.shape || 'cuboid'; const color = item.color || generateUniqueColor(usedColors); items3d.push({ name: item.name, shape: shape, w: dim.l || (item.w || 0), h: dim.h || (item.h || 0), d: dim.w || (item.d || 0), color: color, x: pos.x !== undefined ? pos.x : (item.x || 0), y: pos.y !== undefined ? pos.y : (item.y || 0), z: pos.z !== undefined ? pos.z : (item.z || 0) }); }); } else { let xOffset = 0; data.materials.forEach(m => { const count = m.count || 1; const color = m.color || generateUniqueColor(usedColors); for (let i = 0; i < Math.min(count, 5); i++) { const w = m.shape === 'cylinder' ? m.dim1 : m.dim1; const h = m.dim3; const d = m.shape === 'cylinder' ? m.dim1 : (m.dim2 || m.dim1); items3d.push({ name: m.name, shape: m.shape, w, h, d, color, x: xOffset, y: 0, z: 0 }); xOffset += w + 10; } }); }
    let utilization = '—'; if (data.metadata && data.metadata.spaceUtilization) utilization = data.metadata.spaceUtilization; else if (data.stats && data.stats.spaceUtilization) utilization = data.stats.spaceUtilization;
    let totalWeightDisplay = '—'; const metaTW = data.metadata && data.metadata.totalWeight; const statsTW = data.stats && data.stats.totalWeight; if (metaTW !== undefined) totalWeightDisplay = metaTW + 'kg'; else if (statsTW !== undefined) totalWeightDisplay = statsTW + 'kg'; else { const sumWeight = data.materials.reduce((s, m) => s + (m.weight || 0), 0); if (sumWeight > 0) totalWeightDisplay = sumWeight + 'kg'; }
    const totalItems = data.metadata ? data.metadata.totalItems : (data.stats ? data.stats.totalItems : data.materials.reduce((s, m) => s + (m.count || 1), 0));
    const plan = { id: Date.now(), title: data.title, tag, tagLabel, furnaceType: f.name + ' ' + f.width + '×' + f.height + '×' + f.depth + 'mm', date: data.date || new Date().toISOString().slice(0, 10), operator: data.operator || '未知', approver, utilization: utilization, totalWeight: totalWeightDisplay, itemCount: totalItems, description: data.description || ('由JSON导入的历史方案。炉膛：' + f.name), furnaceW: f.width, furnaceH: f.height, furnaceD: f.depth, items: items3d, rawMaterials: data.materials, rawFurnace: f };
    masterPlans.unshift(plan); if (initMasterViewFn) initMasterViewFn();
    const btn = document.getElementById('btn-master-import-json'); const orig = btn.textContent; btn.textContent = '✅ 导入成功'; setTimeout(() => { btn.textContent = orig; }, 2000);
}

export function renderPlanAnalysisPanel(analysis) {
    const el = document.getElementById('plan-analysis-panel');
    if (!el || !analysis) return;

    const recHtml = (analysis.recommendations || []).map(r => {
        return `<div class="analysis-rec-item">• ${r}</div>`;
    }).join('');

    const statusClass =
        analysis.status === '不可执行'
            ? 'danger'
            : (analysis.status === '需人工确认' ? 'warning' : 'success');

    const scoreText = analysis.compositeScore != null
            ? analysis.compositeScore
            : '-';

    const selectedPlanStatus =
        analysis.unpackedCount > 0
            ? `未装 ${analysis.unpackedCount} 件`
            : '全部装入';

    el.innerHTML = `
        <div class="analysis-score-card analysis-current-plan-card">
            <div class="analysis-current-plan-title">当前选中方案</div>
            <div class="analysis-score-row">
                <div class="analysis-score">${scoreText}</div>
                <div class="analysis-score-unit">分</div>
            </div>
            <div class="analysis-score-label">
                ${selectedPlanStatus} · ${analysis.status || '待评估'}
            </div>
        </div>

        <div class="analysis-diagnosis-card ${statusClass}">
            <div class="analysis-diagnosis-title">AI 诊断</div>

            <div class="analysis-diagnosis-row">
                <span>方案状态</span>
                <strong>${analysis.status || '-'}</strong>
            </div>

            <div class="analysis-diagnosis-row">
                <span>主要瓶颈</span>
                <strong>${analysis.bottleneck || '-'}</strong>
            </div>

            <div class="analysis-rec-list">
                ${recHtml || '<div class="analysis-rec-item">• 当前暂无明显风险。</div>'}
            </div>
        </div>

        <div class="analysis-grid">
            <div class="analysis-item">
                <span>空间利用率</span>
                <strong>${(analysis.spaceUtilization * 100).toFixed(1)}%</strong>
            </div>
            <div class="analysis-item">
                <span>重量利用率</span>
                <strong>${(analysis.weightUtilization * 100).toFixed(1)}%</strong>
            </div>
            <div class="analysis-item">
                <span>炉次数量</span>
                <strong>${analysis.furnaceCount}</strong>
            </div>
            <div class="analysis-item">
                <span>已装工件</span>
                <strong>${analysis.totalItems}</strong>
            </div>
            <div class="analysis-item">
                <span>未装工件</span>
                <strong>${analysis.unpackedCount}</strong>
            </div>
            <div class="analysis-item">
                <span>搁板数量</span>
                <strong>${analysis.totalShelves}</strong>
            </div>
            <div class="analysis-item">
                <span>最大层数</span>
                <strong>${analysis.maxLayerCount}</strong>
            </div>
            <div class="analysis-item">
                <span>预计电耗</span>
                <strong>${analysis.estimatedKwh.toFixed(1)} kWh</strong>
            </div>
            <div class="analysis-item">
                <span>预计氮气</span>
                <strong>${analysis.nitrogenNm3.toFixed(1)} Nm³</strong>
            </div>
            <div class="analysis-item">
                <span>质量评分</span>
                <strong>${analysis.qualityScore ? analysis.qualityScore.toFixed(0) : '-'}</strong>
            </div>
        </div>
    `;
}

export function renderCandidatePlanCards(plans = [], activeIndex = 0, onSelect) {
    const el = document.getElementById('candidate-plan-list');
    if (!el) return;

    if (!plans || plans.length === 0) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = plans.map((p, idx) => {
        const a = p.analysis || {};
        const isBest = idx === 0;
        const isActive = idx === activeIndex;

        const score = a.compositeScore != null ? a.compositeScore : 0;

        const statusText = a.unpackedCount > 0
            ? `未装 ${a.unpackedCount}`
            : '全装入';

        const statusClass = a.unpackedCount > 0
            ? 'warning'
            : 'success';

        return `
            <div class="candidate-plan-card ${isActive ? 'active' : ''}" data-plan-idx="${idx}">
                <div class="candidate-plan-top">
                    <div class="candidate-plan-title">
                        ${isBest ? '⭐ ' : ''}${p.label}
                    </div>
                    <div class="candidate-plan-score">${score}分</div>
                </div>
                <div class="candidate-plan-status ${statusClass}">
                    ${isActive ? '当前查看 · ' : ''}${statusText}
                </div>
            </div>
        `;
    }).join('');

    el.querySelectorAll('.candidate-plan-card').forEach(card => {
        card.addEventListener('click', () => {
            const idx = parseInt(card.getAttribute('data-plan-idx'));
            if (!isNaN(idx) && onSelect) {
                onSelect(idx);
            }
        });
    });
}