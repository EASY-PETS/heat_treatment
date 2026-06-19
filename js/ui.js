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

    // 在 getFurnaceDataFromCard 函数末尾，return 语句的上方加上：
    const extrasStr = card.getAttribute('data-extras');
    const extras = extrasStr ? JSON.parse(extrasStr) : {};

    return { fid, name, width: parseFloat(dims[0]) || 0, height: parseFloat(dims[1]) || 0, depth: parseFloat(dims[2]) || 0, maxWeight, count, plannedHeats, actualSpacing, basketType, toolingType, maxLayers, allowedProcesses, placementMode, extras };
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
    card.setAttribute('data-allowed-processes', (ttConfig.allowedProcesses || []).join(','));
    card.setAttribute('data-placement-mode', ttConfig.placementMode);
    card.innerHTML =
    '<span class="f-drag-handle" draggable="true" title="拖拽排序">⠿</span>' +
    '<button class="f-card-delete" data-action="delete-furnace" data-fid="' + newFC + '">✕</button>' +
    '<div class="f-card-name">' + name + '</div>' +
    '<div class="f-card-meta">' +
        '<span>📐 ' + width + '×' + height + '×' + depth + '</span>' +
        '<span>📦 可用数量 ' + count + '</span>' +
        '<span>⚖ ' + maxWeight + 'kg</span>' +
    '</div>' +
    '<div class="f-card-status">' + ttConfig.label + ' · 点击选择 · 再次点击取消</div>';
    card.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="delete-furnace"]')) return;
        if (e.target.closest('.f-drag-handle')) return;
        if (e.target.closest('.furnace-inline-detail')) return;

        const wasSelected = card.classList.contains('active');
        selectFurnaceCard(cardId);

        if (wasSelected) {
            removeFurnaceInlineDetail(cardId);
        } else {
            showFurnaceDetail(cardId);
        }
    });
    setupFurnaceDrag(card);
    document.getElementById('furnace-cards-container').appendChild(card);
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

function removeFurnaceInlineDetail(cardId) {
    document.querySelectorAll('.furnace-inline-detail').forEach(drawer => {
        if (!cardId || drawer.getAttribute('data-card-id') === cardId) {
            drawer.remove();
        }
    });

    const panel = document.getElementById('furnace-detail-panel');
    const placeholder = document.getElementById('fdp-placeholder');
    const body = document.getElementById('fdp-body');
    const title = document.getElementById('fdp-title');
    const icon = document.getElementById('fdp-toggle-icon');

    if (panel) panel.classList.add('collapsed');
    if (placeholder) placeholder.style.display = 'block';
    if (body) {
        body.style.display = 'none';
        body.innerHTML = '';
    }
    if (title) title.textContent = '📋 工装参数';
    if (icon) icon.textContent = '▼';
    setFdpCollapsed(true);
}

function buildFurnaceDetailFormHtml(d) {
    let labelW = '宽度 X (mm)';
    let labelD = '纵深 Z (mm)';
    if (d.toolingType === 'ring-tooling') {
        labelW = '外径 (mm)';
        labelD = '等效外径 (mm)';
    }

    const ex = d.extras || {};

    let html =
        '<div class="fdp-row">' +
            '<div class="fdp-field">' +
                '<label>名称</label>' +
                '<input type="text" id="fdp-name" value="' + d.name + '">' +
            '</div>' +
        '</div>' +

        '<div class="fdp-row">' +
            '<div class="fdp-field">' +
                '<label>' + labelW + '</label>' +
                '<input type="number" id="fdp-width" value="' + d.width + '">' +
            '</div>' +
            '<div class="fdp-field">' +
                '<label>高度 Y (mm)</label>' +
                '<input type="number" id="fdp-height" value="' + d.height + '">' +
            '</div>' +
            '<div class="fdp-field">' +
                '<label>' + labelD + '</label>' +
                '<input type="number" id="fdp-depth" value="' + d.depth + '">' +
            '</div>' +
        '</div>' +

        '<div class="fdp-row">' +
            '<div class="fdp-field">' +
                '<label>承重上限 (kg)</label>' +
                '<input type="number" id="fdp-weight" value="' + d.maxWeight + '">' +
            '</div>' +
            '<div class="fdp-field">' +
                '<label>可用数量</label>' +
                '<input type="number" id="fdp-count" value="' + d.count + '" min="1">' +
            '</div>' +
        '</div>' +

        '<div class="fdp-row">' +
            '<div class="fdp-field"><label>安全间距 (mm) <span style="color:#666;font-size:9px;">不填=5mm</span></label><input type="number" id="fdp-spacing" value="' + (d.actualSpacing != null ? d.actualSpacing : '') + '" placeholder="默认 5mm"></div>' +
        '</div>';

    html += '<div class="fid-extra-section">';
    html += '<div class="fid-extra-title">🛠️ 该工装专属结构参数</div>';

    if (d.toolingType === 'special-jig') {
        html += '<div class="fdp-row"><div class="fdp-field"><label>卡槽数量 (个)</label><input type="number" id="fdp-ex-slotCount" value="' + (ex.slotCount || 8) + '"></div><div class="fdp-field"><label>卡槽间距 (mm)</label><input type="number" id="fdp-ex-slotPitch" value="' + (ex.slotPitch || 100) + '"></div></div>';
    } else if (d.toolingType === 'material-tray') {
        html += '<div class="fdp-row"><div class="fdp-field"><label>盘身侧边高 (mm)</label><input type="number" id="fdp-ex-trayDepth" value="' + (ex.trayDepth || 50) + '"></div></div>';
    } else if (d.toolingType === 'hanger') {
        html += '<div class="fdp-row"><div class="fdp-field"><label>顶部挂梁数量 (根)</label><input type="number" id="fdp-ex-beamCount" value="' + (ex.beamCount || 2) + '"></div><div class="fdp-field"><label>挂梁挂钩高度 (mm)</label><input type="number" id="fdp-ex-beamHeight" value="' + (ex.beamHeight || (d.height - 30)) + '"></div></div>';
    } else if (d.toolingType === 'ring-tooling') {
        html += '<div class="fdp-row"><div class="fdp-field"><label>环形内径 (mm)</label><input type="number" id="fdp-ex-innerDia" value="' + (ex.innerDia || 200) + '"></div><div class="fdp-field"><label>圆盘层数 (层)</label><input type="number" id="fdp-ex-stationCount" value="' + (ex.stationCount || ex.ringCount || 3) + '"></div></div>';
    } else {
        html += '<div class="fid-muted">（此基础工装暂无需要调节的额外特征尺寸）</div>';
    }

    html += '</div>';
    html += '<button class="fdp-save-btn" id="fdp-save-btn">💾 保存工装参数</button>';
    return html;
}

export function showFurnaceDetail(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;

    const d = getFurnaceDataFromCard(card);
    removeFurnaceInlineDetail();

    const drawer = document.createElement('div');
    drawer.className = 'furnace-inline-detail';
    drawer.setAttribute('data-card-id', cardId);
    drawer.innerHTML =
        '<div class="fid-header">' +
            '<div class="fid-title">📋 ' + d.name + '</div>' +
            '<button class="fid-close" type="button" title="收起详情">收起 ▲</button>' +
        '</div>' +
        '<div class="fdp-body">' + buildFurnaceDetailFormHtml(d) + '</div>';

    card.insertAdjacentElement('afterend', drawer);

    const closeBtn = drawer.querySelector('.fid-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const activeCard = document.getElementById(cardId);
            if (activeCard && activeCard.classList.contains('active')) {
                activeCard.classList.remove('active');
                setSelectedFurnaceCardId(null);
            }
            removeFurnaceInlineDetail(cardId);
        });
    }

    const saveBtn = drawer.querySelector('#fdp-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => saveFurnaceDetail(cardId));

    if (d.toolingType === 'ring-tooling') {
        const wInput = drawer.querySelector('#fdp-width');
        const dInput = drawer.querySelector('#fdp-depth');
        if (wInput && dInput) {
            wInput.addEventListener('input', () => dInput.value = wInput.value);
            dInput.addEventListener('input', () => wInput.value = dInput.value);
        }
    }

    setFdpCollapsed(false);
    drawer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function saveFurnaceDetail(cardId) {
    const card = document.getElementById(cardId); if (!card) return;
    const name = document.getElementById('fdp-name').value.trim() || '装载工装';
    const width = parseFloat(document.getElementById('fdp-width').value) || 0;
    const height = parseFloat(document.getElementById('fdp-height').value) || 0;
    const depth = parseFloat(document.getElementById('fdp-depth').value) || 0;
    const maxWeight = parseFloat(document.getElementById('fdp-weight').value) || 0;
    const count = parseInt(document.getElementById('fdp-count').value) || 1;
    const plannedHeats = 0;
    const spacingVal = document.getElementById('fdp-spacing').value;
    const actualSpacing = spacingVal !== '' ? parseFloat(spacingVal) : 5;

    // 删除原本在这里读取 fdp-tooling-type、fdp-max-layers、fdp-basket-type 等等赋值给 setAttribute 的几十行代码
    // ----- 新增：根据不同工装类型保存其专属参数 -----
    const tt = card.getAttribute('data-tooling-type') || 'standard-basket';
    const extras = {};
    if (tt === 'special-jig') {
        const sc = document.getElementById('fdp-ex-slotCount');
        const sp = document.getElementById('fdp-ex-slotPitch');
        if (sc) extras.slotCount = parseInt(sc.value) || 8;
        if (sp) extras.slotPitch = parseFloat(sp.value) || 100;
    } else if (tt === 'material-tray') {
        const td = document.getElementById('fdp-ex-trayDepth');
        if (td) extras.trayDepth = parseFloat(td.value) || 50;
    } else if (tt === 'hanger') {
        const bc = document.getElementById('fdp-ex-beamCount');
        const bh = document.getElementById('fdp-ex-beamHeight');
        if (bc) extras.beamCount = parseInt(bc.value) || 2;
        if (bh) extras.beamHeight = parseFloat(bh.value) || (height - 30);
        } else if (tt === 'ring-tooling') {
            const idia = document.getElementById('fdp-ex-innerDia');
            const scnt = document.getElementById('fdp-ex-stationCount');

            const innerDia = parseFloat(idia?.value) || 200;
            const ringCount = parseInt(scnt?.value) || 3;

            /**
             * 环形工装参数说明：
             * - innerDia：中心不可放料区域直径
             * - innerRadius / centerVoidRadius：算法使用的中心避障半径
             * - ringCount：上方圆盘层数量
             * - rodDiameter：视觉中心立柱直径，不等于中心避障直径
             * - useInternalShelves：强制算法使用环形工装内置圆盘层
             */
            extras.useInternalShelves = true;

            extras.innerDia = innerDia;
            extras.innerRadius = innerDia / 2;
            extras.centerVoidRadius = innerDia / 2;

            extras.stationCount = ringCount;
            extras.ringCount = ringCount;

            extras.rodDiameter = 40;
        }
    // 将打包好的专属参数转为 JSON 字符串存在 HTML 属性里
    card.setAttribute('data-extras', JSON.stringify(extras));
    // ----------------------------------------------
    
    card.querySelector('.f-card-name').textContent = name;
    card.querySelector('.f-card-meta').innerHTML =
    '<span>📐 ' + width + '×' + height + '×' + depth + '</span>' +
    '<span>📦 可用数量 ' + count + '</span>' +
    '<span>⚖ ' + maxWeight + 'kg</span>';

    // 卡片底部标签依然从原始的 data 属性读取（由添加工装时决定）
    // const tt = card.getAttribute('data-tooling-type') || 'standard-basket';
    const ttCfg = furnaceTooling[tt] || { label: '标准料框' };
    card.querySelector('.f-card-status').textContent = ttCfg.label + ' · 点击选择 · 再次点击取消';
    
    if (actualSpacing !== null) card.setAttribute('data-spacing', actualSpacing); else card.removeAttribute('data-spacing');
    const fdpTitle = document.getElementById('fdp-title'); if (fdpTitle) fdpTitle.textContent = '📋 ' + name; const drawerTitle = document.querySelector('.furnace-inline-detail[data-card-id="' + cardId + '"] .fid-title'); if (drawerTitle) drawerTitle.textContent = '📋 ' + name; updateTopSummary();
    const btn = document.getElementById('fdp-save-btn'); if (btn) { btn.textContent = '✅ 已保存'; setTimeout(() => { btn.textContent = '💾 保存工装参数'; }, 1500); }
}

export function deleteFurnaceCard(fid) {
    const cardId = 'furnace-card-' + fid;
    removeFurnaceInlineDetail(cardId);
    const card = document.getElementById(cardId); if (card) card.remove();
    if (selectedFurnaceCardId === cardId) { setSelectedFurnaceCardId(null); removeFurnaceInlineDetail(cardId); }
    updateTopSummary();
}

let dragSrcCard = null;
function setupFurnaceDrag(card) {
    const handle = card.querySelector('.f-drag-handle');
    handle.addEventListener('dragstart', (e) => { dragSrcCard = card; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    handle.addEventListener('dragend', () => { card.classList.remove('dragging'); document.querySelectorAll('.furnace-card').forEach(c => c.classList.remove('drag-over')); dragSrcCard = null; });
    card.addEventListener('dragover', (e) => { e.preventDefault(); if (dragSrcCard && dragSrcCard !== card) { document.querySelectorAll('.furnace-card').forEach(c => c.classList.remove('drag-over')); card.classList.add('drag-over'); } });
    card.addEventListener('drop', (e) => { e.preventDefault(); if (dragSrcCard && dragSrcCard !== card) { const container = document.getElementById('furnace-cards-container'); const cards = [...container.querySelectorAll('.furnace-card')]; const srcIdx = cards.indexOf(dragSrcCard); const tgtIdx = cards.indexOf(card); if (srcIdx < tgtIdx) container.insertBefore(dragSrcCard, card.nextSibling); else container.insertBefore(dragSrcCard, card); } card.classList.remove('drag-over'); });
}

export function sortFurnaceCards(field) {
    removeFurnaceInlineDetail();
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


function removeMaterialInlineDetail(cardId) {
    document.querySelectorAll('.material-inline-detail').forEach(drawer => {
        if (!cardId || drawer.getAttribute('data-card-id') === cardId) {
            drawer.remove();
        }
    });

    const panel = document.getElementById('material-detail-panel');
    const placeholder = document.getElementById('mdp-placeholder');
    const body = document.getElementById('mdp-body');
    const title = document.getElementById('mdp-title');
    const icon = document.getElementById('mdp-toggle-icon');

    if (panel) panel.classList.add('collapsed');
    if (placeholder) placeholder.style.display = 'block';
    if (body) {
        body.style.display = 'none';
        body.innerHTML = '';
    }
    if (title) title.textContent = '📋 工件详情';
    if (icon) icon.textContent = '▼';
    setMdpCollapsed(true);
}

function buildMaterialDetailFormHtml(d, colorHex, cadPreview) {
    return '<div class="mdp-row"><div class="mdp-field" style="flex:2;"><label>名称</label><input type="text" id="mdp-name" value="' + d.name + '"></div><div class="mdp-field"><label>形态</label><select id="mdp-shape"><option value="cuboid" ' + (d.shape==='cuboid'?'selected':'') + '>立方体</option><option value="cylinder" ' + (d.shape==='cylinder'?'selected':'') + '>圆柱体</option></select></div></div>' +
        '<div class="mdp-row"><div class="mdp-field"><label>长度 L (mm)</label><input type="number" id="mdp-dim1" value="' + (d.shape==='cuboid'?d.dim1:'') + '"></div><div class="mdp-field"><label>宽度 W (mm)</label><input type="number" id="mdp-dim2" value="' + (d.shape==='cuboid'?d.dim2:'') + '"></div><div class="mdp-field"><label>高度 H (mm)</label><input type="number" id="mdp-dim3" value="' + d.dim3 + '"></div><div class="mdp-field"><label>直径 D (mm)</label><input type="number" id="mdp-diam" value="' + (d.shape==='cylinder'?d.dim1:'') + '"></div></div>' +
        '<div class="mdp-row"><div class="mdp-field"><label>数量</label><input type="number" id="mdp-count" value="' + d.count + '" min="1"></div><div class="mdp-field"><label>总重量 (kg)</label><input type="number" id="mdp-weight" value="' + d.totalWeight + '"></div><div class="mdp-field" style="max-width:52px;"><label>颜色</label><input type="color" id="mdp-color" value="' + colorHex + '" style="padding:0;height:28px;width:100%;"></div></div>' +
        '<div class="mdp-row"><div class="mdp-field"><label>材质</label><input type="text" id="mdp-material" value="' + d.material + '"></div><div class="mdp-field"><label>硬度要求</label><input type="text" id="mdp-hardness" value="' + d.hardness + '"></div></div>' +
        '<div class="mdp-row"><div class="mdp-field"><label>工艺</label><input type="text" id="mdp-process" value="' + d.process + '"></div></div>' +
        '<div class="mdp-row"><div class="mdp-field"><label>下单日期</label><input type="date" id="mdp-order-date" value="' + d.orderDate + '"></div><div class="mdp-field"><label>交付日期</label><input type="date" id="mdp-delivery-date" value="' + d.deliveryDate + '"></div></div>' +
        '<div class="mdp-row"><div class="mdp-field"><label>CAD图纸 <span style="color:#555;font-size:9px;">（可选，图片文件）</span></label><input type="file" id="mdp-cad-file" accept="image/*" style="font-size:9px;padding:2px;">' + cadPreview + '</div></div>' +
        '<div class="mdp-row"><div class="mdp-field"><label>备注</label><textarea id="mdp-remark">' + d.remark + '</textarea></div></div>' +
        '<button class="mdp-save-btn" id="mdp-save-btn">💾 保存工件参数</button>';
}

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
    card.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="delete-material"]')) return;
        if (e.target.closest('.material-inline-detail')) return;

        const wasSelected = card.classList.contains('active');
        selectMaterialCard(cardId);

        if (wasSelected) {
            removeMaterialInlineDetail(cardId);
        } else {
            showMaterialDetail(cardId);
        }
    });
    document.getElementById('material-cards-container').appendChild(card);
    // 刷新筛选条
    renderFilterBars(window._clearFurnaceResults);
    // ✅ 立即应用当前筛选到新卡片
    applyFilterAndClear(window._clearFurnaceResults);
    return { cardId, materialCounter: newMC, name, shape, count, dim1, dim2, dim3, totalWeight, color };
}

export function selectMaterialCard(cardId) { const card = document.getElementById(cardId); if (card && card.classList.contains('active')) { card.classList.remove('active'); setSelectedMaterialCardId(null); } else { document.querySelectorAll('.material-card').forEach(c => c.classList.remove('active')); if (card) { card.classList.add('active'); setSelectedMaterialCardId(cardId); } } }

export function showMaterialDetail(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;

    const d = getMaterialDataFromCard(card);
    const colorHex = rgbToHex(d.color) || '#888888';
    const cadPreview = d.cadImage
        ? '<div style="margin-top:4px;"><img src="' + d.cadImage + '" style="max-width:100%;max-height:60px;border-radius:3px;border:1px solid #333;" alt="CAD图纸预览"></div>'
        : '';

    removeMaterialInlineDetail();

    const drawer = document.createElement('div');
    drawer.className = 'material-inline-detail';
    drawer.setAttribute('data-card-id', cardId);
    drawer.innerHTML =
        '<div class="mid-header">' +
            '<div class="mid-title">📋 ' + d.name + '</div>' +
            '<button class="mid-close" type="button" title="收起详情">收起 ▲</button>' +
        '</div>' +
        '<div class="mdp-body">' + buildMaterialDetailFormHtml(d, colorHex, cadPreview) + '</div>';

    card.insertAdjacentElement('afterend', drawer);

    const closeBtn = drawer.querySelector('.mid-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const activeCard = document.getElementById(cardId);
            if (activeCard && activeCard.classList.contains('active')) {
                activeCard.classList.remove('active');
                setSelectedMaterialCardId(null);
            }
            removeMaterialInlineDetail(cardId);
        });
    }

    const saveBtn = drawer.querySelector('#mdp-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => saveMaterialDetail(cardId));

    const cadFileInput = drawer.querySelector('#mdp-cad-file');
    if (cadFileInput) {
        cadFileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                card.setAttribute('data-cad-image', ev.target.result);
                const existingPreview = drawer.querySelector('.mdp-field img');
                if (existingPreview) {
                    existingPreview.src = ev.target.result;
                } else {
                    const previewDiv = document.createElement('div');
                    previewDiv.style.marginTop = '4px';
                    previewDiv.innerHTML = '<img src="' + ev.target.result + '" style="max-width:100%;max-height:60px;border-radius:3px;border:1px solid #333;" alt="CAD图纸预览">';
                    cadFileInput.parentNode.appendChild(previewDiv);
                }
            };
            reader.readAsDataURL(file);
        });
    }

    const shapeSelect = drawer.querySelector('#mdp-shape');
    if (shapeSelect) {
        shapeSelect.addEventListener('change', function() {
            const isCyl = this.value === 'cylinder';
            drawer.querySelector('#mdp-dim1').disabled = isCyl;
            drawer.querySelector('#mdp-dim2').disabled = isCyl;
            drawer.querySelector('#mdp-diam').disabled = !isCyl;
            if (isCyl) {
                drawer.querySelector('#mdp-dim1').value = '';
                drawer.querySelector('#mdp-dim2').value = '';
            } else {
                drawer.querySelector('#mdp-diam').value = '';
            }
        });
    }

    const isCyl = d.shape === 'cylinder';
    const dim1 = drawer.querySelector('#mdp-dim1');
    const dim2 = drawer.querySelector('#mdp-dim2');
    const diam = drawer.querySelector('#mdp-diam');
    if (dim1) dim1.disabled = isCyl;
    if (dim2) dim2.disabled = isCyl;
    if (diam) diam.disabled = !isCyl;

    setMdpCollapsed(false);
    drawer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    const mdpTitle = document.getElementById('mdp-title'); if (mdpTitle) mdpTitle.textContent = '📋 ' + name; const drawerTitle = document.querySelector('.material-inline-detail[data-card-id="' + cardId + '"] .mid-title'); if (drawerTitle) drawerTitle.textContent = '📋 ' + name; updateTopSummary();
    renderFilterBars(window._clearFurnaceResults);
    applyFilterAndClear(window._clearFurnaceResults);
    const btn = document.getElementById('mdp-save-btn'); if (btn) { btn.textContent = '✅ 已保存'; setTimeout(() => { btn.textContent = '💾 保存工件参数'; }, 1500); }
}

export function deleteMaterialCard(mid) {
    const cardId = 'material-card-' + mid;
    removeMaterialInlineDetail(cardId);
    const card = document.getElementById(cardId);
    if (card) card.remove();
    if (selectedMaterialCardId === cardId) {
        setSelectedMaterialCardId(null);
        removeMaterialInlineDetail(cardId);
    }
    updateTopSummary();
    renderFilterBars(window._clearFurnaceResults);
    applyFilterAndClear(window._clearFurnaceResults);
}

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



export function renderThermalSimulationPanel(metrics = null, mode = null) {
    const panel = document.getElementById('thermal-simulation-panel');
    if (!panel) return;

    const activeMode = mode || metrics?.mode || 'thermal';

    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        panel.innerHTML = `
            <div class="thermal-sim-empty">
                生成方案后显示工艺仿真。<br>
                当前版本包含：炉内阶段（升温热场、辐射暴露、气流冷却、气氛覆盖）+ 淬火阶段（淬火介质）。
            </div>
        `;
        return;
    }

    const furnace = globalFurnacesResult[currentFurnaceIndex];
    if (!furnace) {
        panel.innerHTML = `<div class="thermal-sim-empty">当前炉次不存在，请重新生成方案。</div>`;
        return;
    }

    const items = furnace.packedItems || [];
    const packedVolume = items.reduce((sum, item) => sum + Number((item.w || 0) * (item.h || 0) * (item.d || 0)), 0);
    const furnaceVolume = Math.max(1, Number((furnace.w || 1) * (furnace.h || 1) * (furnace.d || 1)));
    const densityRate = metrics?.densityRate ?? Math.round((packedVolume / furnaceVolume) * 1000) / 10;

    if (activeMode === 'idle') {
        panel.innerHTML = `
            <div class="thermal-sim-empty process-sim-idle-card">
                <div style="font-weight:800;color:#0f172a;margin-bottom:8px;">请选择一个工艺阶段 / 仿真模式</div>
                <div style="line-height:1.7;color:#64748b;">
                    炉内阶段检查升温、辐射、气流、气氛；淬火阶段检查入油/沸腾/对流冷却与变形开裂风险。
                </div>
                <div style="margin-top:10px;color:#94a3b8;font-size:11px;">再次点击已打开的模式会退出仿真；点击“退出仿真”会清空 3D 仿真层。</div>
            </div>
        `;
        return;
    }

    if (activeMode === 'atmosphere') {
        const atmosphereCoverage = metrics?.atmosphereCoverage ?? Math.max(50, Math.round(86 - densityRate * 0.42));
        const minAtmosphereCoverage = metrics?.minAtmosphereCoverage ?? Math.max(30, atmosphereCoverage - 24);
        const weakExchangeItemCount = metrics?.weakExchangeItemCount ?? 0;
        const deadCornerItemCount = metrics?.deadCornerItemCount ?? 0;
        const severeDeadCornerItemCount = metrics?.severeDeadCornerItemCount ?? 0;
        const surfaceUniformityScore = metrics?.surfaceUniformityScore ?? Math.max(45, Math.round(88 - densityRate * 0.36));
        const effectiveFaceRate = metrics?.effectiveFaceRate ?? Math.max(52, Math.round(90 - densityRate * 0.28));
        const worstItemName = metrics?.worstItemName || '-';
        const worstFaceLabel = metrics?.worstFaceLabel || '-';
        const worstBlocker = metrics?.worstBlocker || '-';
        const localDensityRate = metrics?.localDensityRate ?? Math.round(densityRate);
        const mediumType = metrics?.mediumType || 'nitriding';
        const mediumLabel = metrics?.mediumLabel || '氮化气氛';
        const mediumShortLabel = metrics?.mediumShortLabel || 'NH₃ / N₂ / H₂';
        const activeSpecies = metrics?.activeSpecies || '活性氮';
        const processHint = metrics?.processHint || '适合氮化 / 渗碳 / 保护气氛等表面处理，重点关注工件表面是否被有效气氛包覆。';
        const suggestion = metrics?.suggestion || '点击“气氛覆盖”后，系统会按气氛类型显示覆盖评分、表面反应层和死角风险。';
        const visualNote = metrics?.visualNote || '气氛雾场 = 有效介质浓度；亮色表面 = 有效反应/覆盖；橙红色线框 = 表面遮蔽或贴靠死角。';
        const coverageLabel = metrics?.coverageLabel || '平均气氛覆盖';
        const minLabel = metrics?.minLabel || '最低覆盖工件';
        const weakExchangeLabel = metrics?.weakExchangeLabel || '气氛交换弱区';
        const deadLabel = metrics?.deadLabel || '真实气氛死角';
        const severeLabel = metrics?.severeLabel || '严重死角';
        const uniformityLabel = metrics?.uniformityLabel || '表面覆盖均匀性';
        const faceRateLabel = metrics?.faceRateLabel || '有效接触面比例';
        const riskFaceLabel = metrics?.riskFaceLabel || '主要风险面';
        const modeName = metrics?.modeName || '气氛覆盖';
        const atmosphereProgress = typeof metrics?.progress === 'number' ? metrics.progress : 100;
        const atmospherePlaying = !!metrics?.animationPlaying;
        const atmosphereStageLabel = metrics?.atmosphereStageLabel || (atmosphereProgress < 35 ? '气氛充入' : (atmosphereProgress < 75 ? '浓度扩散' : '表面反应'));
        const atmosphereStageDesc = metrics?.atmosphereStageDesc || '气氛浓度场、入口扩散方向与表面反应层用于解释介质覆盖是否充分。';
        const inletReachabilityRate = metrics?.inletReachabilityRate ?? 0;
        const inletDirections = Array.isArray(metrics?.inletDirections) && metrics.inletDirections.length ? metrics.inletDirections : ['x-', 'x+', 'z-', 'z+', 'y+'];
        const inletDirectionLabel = metrics?.inletDirectionLabel || '多面补给';
        const inletModeLabel = metrics?.inletModeLabel || (inletDirections.length >= 4 ? '多面补给' : (inletDirections.length >= 2 ? '双向补给' : '单侧补给'));
        const topRiskAreas = Array.isArray(metrics?.topRiskAreas) ? metrics.topRiskAreas : [];
        const primaryRiskReason = metrics?.primaryRiskReason || '当前气氛覆盖较均匀，未发现需要优先处理的集中死角。';
        const primaryAdjustment = metrics?.primaryAdjustment || suggestion;
        const isCarbonMode = mediumType === 'carburizing' || mediumType === 'carbonitriding';
        const gradientStyle = mediumType === 'carburizing'
            ? 'linear-gradient(90deg,#7f1d1d,#dc2626,#f97316,#facc15,#ffb703)'
            : (mediumType === 'carbonitriding'
                ? 'linear-gradient(90deg,#dc2626,#f97316,#fde047,#4ade80,#22d3ee)'
                : (mediumType === 'protective'
                    ? 'linear-gradient(90deg,#f59e0b,#fde68a,#93c5fd,#38bdf8,#bae6fd)'
                    : 'linear-gradient(90deg,#ef4444,#f97316,#fde047,#34d399,#2dd4bf)'));
        const carbonRowsHtml = isCarbonMode ? `
                <div class="thermal-risk-row"><span>${mediumType === 'carburizing' ? '估算碳势 Cp' : '复合活性势'}</span><strong>${metrics?.carbonPotential != null ? metrics.carbonPotential : '-'}${mediumType === 'carburizing' ? '%' : ''}</strong></div>
                <div class="thermal-risk-row"><span>${mediumType === 'carburizing' ? '模拟渗层深度' : '模拟共渗层深度'}</span><strong>${escapeSimHtml(metrics?.estimatedCaseDepth || '-')}</strong></div>
            ` : '';
        const mediumOptions = [
            { key: 'nitriding', label: '氮化气氛', sub: 'NH₃/N₂/H₂' },
            { key: 'carburizing', label: '渗碳气氛', sub: 'CO/CH₄/N₂' },
            { key: 'protective', label: '保护气氛', sub: 'N₂/Ar/H₂' },
            { key: 'carbonitriding', label: '碳氮共渗', sub: '渗碳气+NH₃' }
        ];
        const optionHtml = mediumOptions.map(opt => `
            <option value="${opt.key}" ${mediumType === opt.key ? 'selected' : ''}>${escapeSimHtml(opt.label)} · ${escapeSimHtml(opt.sub)}</option>
        `).join('');
        const presetHtml = mediumOptions.map(opt => `
            <button class="plan-action-btn atmosphere-medium-preset ${mediumType === opt.key ? 'active' : ''}" type="button" data-action="atmosphere-medium-preset" data-atmosphere-medium="${opt.key}">
                ${escapeSimHtml(opt.label)}
            </button>
        `).join('');
        const inletOptions = [
            { key: 'x-', label: '-X', desc: '左侧' },
            { key: 'x+', label: '+X', desc: '右侧' },
            { key: 'z-', label: '-Z', desc: '前侧' },
            { key: 'z+', label: '+Z', desc: '后侧' },
            { key: 'y+', label: '+Y', desc: '顶部' },
            { key: 'y-', label: '-Y', desc: '底部' }
        ];
        const inletButtonsHtml = inletOptions.map(opt => `
            <button class="airflow-dir-btn ${inletDirections.includes(opt.key) ? 'active' : ''}" type="button" data-action="atmosphere-inlet-direction" data-atmosphere-inlet="${opt.key}">
                <strong>${escapeSimHtml(opt.label)}</strong><span>${escapeSimHtml(opt.desc)}</span>
            </button>
        `).join('');
        const inletPresets = [
            { label: '四侧环流', inlets: 'x-,x+,z-,z+' },
            { label: '顶部补给', inlets: 'y+,x-,x+,z-,z+' },
            { label: '前后循环', inlets: 'z-,z+' },
            { label: '上下循环', inlets: 'y+,y-' }
        ];
        const inletPresetHtml = inletPresets.map(preset => `
            <button class="plan-action-btn atmosphere-medium-preset" type="button" data-action="atmosphere-inlet-preset" data-atmosphere-inlets="${preset.inlets}">
                ${escapeSimHtml(preset.label)}
            </button>
        `).join('');

        const topRiskHtml = topRiskAreas.length ? topRiskAreas.map(risk => `
                <div class="thermal-risk-row">
                    <span>#${risk.rank} ${escapeSimHtml(risk.riskTypeLabel || '风险区')} · ${escapeSimHtml(risk.itemName || '风险工件')}</span>
                    <strong>${escapeSimHtml(risk.faceLabel || '-')} · ${risk.score ?? '-'}%</strong>
                </div>
                <div class="thermal-mini-note" style="margin-top:0;margin-bottom:6px;">${escapeSimHtml(risk.reason || '')}</div>
            `).join('') : '<div class="thermal-mini-note">暂无真实死角或明显低交换区，当前覆盖较均匀。</div>';

        panel.innerHTML = `
            <div class="thermal-header-card compact atmosphere-card">
                <div class="thermal-title">${isCarbonMode ? '🔥' : '🌫️'} ${escapeSimHtml(furnace.instanceId || '当前炉次')} · 介质场 · ${escapeSimHtml(modeName)} V1.6</div>
                <div class="thermal-subtitle">
                    ${isCarbonMode
                        ? '渗碳/碳氮共渗模式强调“碳势气氛 → 表面吸附 → 向内扩散 → 渗层形成”。金橙色浓度云从边界扩散，入口箭头表示碳势补给路径，工件金色外轮廓表示表面吸碳/渗层逐步形成。'
                        : '气氛覆盖用于解释氮化、保护气氛、渗碳等表面处理阶段：动态浓度点云表示介质扩散，入口箭头表示补给路径，工件表面薄层表示反应/保护层形成，Top 3 标签区分低交换区和真实死角。'}
                </div>
                <div class="thermal-metric-grid">
                    <div class="thermal-metric"><span>${escapeSimHtml(coverageLabel)}</span><strong>${atmosphereCoverage}%</strong></div>
                    <div class="thermal-metric"><span>${escapeSimHtml(minLabel)}</span><strong>${minAtmosphereCoverage}%</strong></div>
                    <div class="thermal-metric"><span>${escapeSimHtml(weakExchangeLabel)}</span><strong>${weakExchangeItemCount} 件</strong></div>
                    <div class="thermal-metric"><span>${escapeSimHtml(deadLabel)}</span><strong>${deadCornerItemCount} 件</strong></div>
                </div>
                <div class="thermal-legend atmosphere-legend">
                    <span>${isCarbonMode ? '碳势不足' : '低交换'}</span><div class="atmosphere-gradient" style="flex:1;height:8px;border-radius:999px;background:${gradientStyle};"></div><span>${isCarbonMode ? '碳势充足' : '覆盖充分'}</span>
                </div>
                <div class="thermal-mini-note">${escapeSimHtml(visualNote)} 3D 中入口箭头表示介质补给方向，Top 3 标签会区分“低交换区”和“真实死角”：间距足够但路径较弱时不再直接判死角。</div>
                <div class="thermal-risk-row" style="margin-top:10px;"><span>动画阶段</span><strong class="atmosphere-stage-label">${escapeSimHtml(atmosphereStageLabel)} · <span class="atmosphere-progress-value">${atmosphereProgress}%</span></strong></div>
                <div class="thermal-mini-note atmosphere-stage-desc">${escapeSimHtml(atmosphereStageDesc)} 播放、暂停、重置、速度和进度位于顶部“当前模式操作”区；本卡片只保留介质参数和诊断。</div>
            </div>

            <div class="thermal-risk-card atmosphere-card">
                <div class="thermal-stage-title">气氛介质</div>
                <div class="thermal-risk-row"><span>当前介质</span><strong>${escapeSimHtml(mediumLabel)}</strong></div>
                <div class="thermal-risk-row"><span>活性组分</span><strong>${escapeSimHtml(activeSpecies)} · ${escapeSimHtml(mediumShortLabel)}</strong></div>
                <select class="thermal-speed-select atmosphere-medium-select" data-action="atmosphere-medium-type" style="width:100%;margin-top:8px;">
                    ${optionHtml}
                </select>
                <div class="airflow-preset-row" style="margin-top:8px;">${presetHtml}</div>
                <div class="thermal-mini-note">${escapeSimHtml(processHint)}</div>
            </div>

            <div class="thermal-risk-card atmosphere-card">
                <div class="thermal-stage-title">气氛入口配置</div>
                <div class="thermal-risk-row"><span>当前入口</span><strong>${escapeSimHtml(inletDirectionLabel)}</strong></div>
                <div class="thermal-risk-row"><span>补给模式</span><strong>${escapeSimHtml(inletModeLabel)}</strong></div>
                <div class="airflow-dir-grid" style="margin-top:8px;">${inletButtonsHtml}</div>
                <div class="airflow-preset-row" style="margin-top:8px;">${inletPresetHtml}</div>
                <button class="plan-action-btn" type="button" data-action="atmosphere-inlet-reset" style="width:100%;margin-top:8px;">恢复默认入口</button>
                <div class="thermal-mini-note">入口方向会直接影响 3D 中的边界面、扩散箭头和浓度粒子路径。可按真实炉型选择侧进、顶进、上下循环或多面补给。</div>
            </div>

            <div class="thermal-risk-card atmosphere-card">
                <div class="thermal-stage-title">${isCarbonMode ? '表面反应 / 渗层诊断' : '表面覆盖诊断'}</div>
                <div class="thermal-risk-row"><span>${escapeSimHtml(uniformityLabel)}</span><strong>${surfaceUniformityScore} 分</strong></div>
                <div class="thermal-risk-row"><span>${escapeSimHtml(faceRateLabel)}</span><strong>${effectiveFaceRate}%</strong></div>
                ${carbonRowsHtml}
                <div class="thermal-risk-row"><span>${escapeSimHtml(minLabel)}</span><strong>${escapeSimHtml(worstItemName)}</strong></div>
                <div class="thermal-risk-row"><span>${escapeSimHtml(riskFaceLabel)}</span><strong>${escapeSimHtml(worstFaceLabel)}</strong></div>
                <div class="thermal-risk-row"><span>主要遮蔽来源</span><strong>${escapeSimHtml(worstBlocker)}</strong></div>
                <div class="thermal-risk-row"><span>局部密集度</span><strong>${localDensityRate}%</strong></div>
                <div class="thermal-risk-row"><span>当前模式</span><strong>介质场 · ${escapeSimHtml(modeName)} V1.6</strong></div>
            </div>

            <div class="thermal-risk-card atmosphere-card">
                <div class="thermal-stage-title">主要风险诊断</div>
                <div class="thermal-mini-note strong-note">${escapeSimHtml(primaryRiskReason)}</div>
                <div class="thermal-stage-title" style="margin-top:10px;">Top 3 低交换 / 真实死角</div>
                ${topRiskHtml}
            </div>

            <div class="thermal-stage-card atmosphere-card">
                <div class="thermal-stage-title">调整建议</div>
                <div class="thermal-mini-note strong-note">${escapeSimHtml(primaryAdjustment)}</div>
            </div>
        `;
        return;
    }

    if (activeMode === 'quench') {
        const mediumType = metrics?.mediumType || 'oil';
        const mediumLabel = metrics?.mediumLabel || '淬火油';
        const mediumShortLabel = metrics?.mediumShortLabel || 'Oil · 60℃';
        const oilTemperature = metrics?.oilTemperature || '60℃';
        const agitationLevel = metrics?.agitationLevel || '中';
        const transferDelaySec = metrics?.transferDelaySec ?? 8;
        const immersionUniformity = metrics?.immersionUniformity ?? Math.max(48, Math.round(86 - densityRate * 0.38));
        const coolingUniformity = metrics?.coolingUniformity ?? Math.max(42, Math.round(84 - densityRate * 0.42));
        const vaporFilmRiskCount = metrics?.vaporFilmRiskCount ?? 0;
        const deformationRisk = metrics?.deformationRisk || '中';
        const crackRisk = metrics?.crackRisk || '低';
        const coreLagRisk = metrics?.coreLagRisk || '中';
        const worstItemName = metrics?.worstItemName || '-';
        const progress = typeof metrics?.progress === 'number' ? metrics.progress : 8;
        const stageLabel = metrics?.quenchStageLabel || (progress < 18 ? '入油前转移' : (progress < 45 ? '入油穿透' : (progress < 76 ? '沸腾冷却' : '对流冷却')));
        const stageDesc = metrics?.quenchStageDesc || '淬火介质仿真用于解释出炉转移、入油一致性、蒸汽膜和中心冷却滞后。';
        const suggestion = metrics?.suggestion || '建议结合工件厚薄、单框密度和油槽搅拌强度复核变形/开裂风险。';
        const visualNote = metrics?.visualNote || '油槽/液面表示淬火介质；波纹表示入油冲击；蓝白气泡表示沸腾换热；紫灰薄膜表示蒸汽膜风险；红橙线框表示高风险工件。';
        const primaryRiskReason = metrics?.primaryRiskReason || '优先复核中心/下层厚大件、贴靠面和搅拌覆盖不足区域。';
        const layerProgressText = metrics?.layerProgressText || '分层入油数据计算中';
        const bottomImmersionTime = metrics?.bottomImmersionTime || '-';
        const middleImmersionTime = metrics?.middleImmersionTime || '-';
        const topImmersionTime = metrics?.topImmersionTime || '-';
        const slowestCoolingLayer = metrics?.slowestCoolingLayer || '-';
        const quenchFurnaceVisibilityMode = metrics?.quenchFurnaceVisibilityMode || 'auto';
        const quenchFurnaceVisibilityLabel = metrics?.quenchFurnaceVisibilityLabel || '自动 · 阶段联动';
        const quenchFurnaceVisibilityDesc = metrics?.quenchFurnaceVisibilityDesc || '出炉转移显示炉体，入油穿透弱化炉体，沸腾/对流冷却阶段隐藏炉体。';
        const interLayerCoolingRisk = metrics?.interLayerCoolingRisk || '低';
        const layerCoolingSpreadLabel = metrics?.layerCoolingSpreadLabel || interLayerCoolingRisk;
        const mediumOptions = [
            { key: 'oil', label: '淬火油', sub: 'Oil · 60℃' },
            { key: 'polymer', label: '聚合物淬火液', sub: 'Polymer' },
            { key: 'water', label: '水淬', sub: 'Water' }
        ];
        const optionHtml = mediumOptions.map(opt => `
            <option value="${opt.key}" ${mediumType === opt.key ? 'selected' : ''}>${escapeSimHtml(opt.label)} · ${escapeSimHtml(opt.sub)}</option>
        `).join('');
        const presetHtml = mediumOptions.map(opt => `
            <button class="plan-action-btn quench-medium-preset ${mediumType === opt.key ? 'active' : ''}" type="button" data-action="quench-medium-preset" data-quench-medium="${opt.key}">
                ${escapeSimHtml(opt.label)}
            </button>
        `).join('');
        const riskColor = deformationRisk === '高' || crackRisk === '高' ? '#dc2626' : (deformationRisk === '中' || crackRisk === '中' ? '#f97316' : '#16a34a');

        panel.innerHTML = `
            <div class="thermal-header-card compact quench-card">
                <div class="thermal-title">🛢️ ${escapeSimHtml(furnace.instanceId || '当前炉次')} · 淬火阶段 · 淬火介质 V3.3</div>
                <div class="thermal-subtitle">
                    V3.4 增强场景主题：淬火/气流/气氛可在顶部选择浅灰、工业蓝灰或默认黑色；淬火阶段继续按进度显示/弱化/隐藏炉体，让油槽、液面和风险件更清楚。
                </div>
                <div class="thermal-metric-grid">
                    <div class="thermal-metric"><span>入油一致性</span><strong>${immersionUniformity} 分</strong></div>
                    <div class="thermal-metric"><span>冷却均匀性</span><strong>${coolingUniformity} 分</strong></div>
                    <div class="thermal-metric"><span>蒸汽膜风险件</span><strong>${vaporFilmRiskCount} 件</strong></div>
                    <div class="thermal-metric"><span>最高风险工件</span><strong>${escapeSimHtml(worstItemName)}</strong></div>
                </div>
                <div class="thermal-legend airflow-legend">
                    <span>冷却不足</span><div class="airflow-gradient" style="background:linear-gradient(90deg,#ef4444,#f97316,#fbbf24,#38bdf8);"></div><span>冷却充分</span>
                </div>
                <div class="thermal-mini-note">${escapeSimHtml(visualNote)}</div>
            </div>

            <div class="thermal-risk-card quench-card">
                <div class="thermal-stage-title">淬火介质</div>
                <div class="thermal-risk-row"><span>当前介质</span><strong>${escapeSimHtml(mediumLabel)}</strong></div>
                <div class="thermal-risk-row"><span>参考温度</span><strong>${escapeSimHtml(oilTemperature)}</strong></div>
                <div class="thermal-risk-row"><span>搅拌强度</span><strong>${escapeSimHtml(agitationLevel)}</strong></div>
                <select class="thermal-speed-select" data-action="quench-medium-type" style="width:100%;margin-top:8px;">
                    ${optionHtml}
                </select>
                <div class="airflow-preset-row" style="margin-top:8px;">${presetHtml}</div>
                <div class="thermal-mini-note">${escapeSimHtml(mediumShortLabel)}：V3.3 为解释型近似仿真，不做真实 CFD；用于展示入油顺序、层间冷却差、液面冲击、沸腾换热、视图过滤和风险位置。</div>
            </div>

            <div class="thermal-risk-card quench-card">
                <div class="thermal-stage-title">淬火视图过滤</div>
                <div class="thermal-risk-row"><span>炉体显示</span><strong>${escapeSimHtml(quenchFurnaceVisibilityLabel)}</strong></div>
                <select class="thermal-speed-select" data-action="quench-furnace-visibility" style="width:100%;margin-top:8px;">
                    <option value="auto" ${quenchFurnaceVisibilityMode === 'auto' ? 'selected' : ''}>自动：按阶段显示/弱化/隐藏</option>
                    <option value="hidden" ${quenchFurnaceVisibilityMode === 'hidden' ? 'selected' : ''}>隐藏炉体：只看油槽和工件</option>
                    <option value="ghost" ${quenchFurnaceVisibilityMode === 'ghost' ? 'selected' : ''}>半透明炉体：保留空间参照</option>
                    <option value="shown" ${quenchFurnaceVisibilityMode === 'shown' ? 'selected' : ''}>显示炉体：查看出炉空间关系</option>
                </select>
                <div class="thermal-mini-note">${escapeSimHtml(quenchFurnaceVisibilityDesc)}</div>
            </div>

            <div class="thermal-risk-card quench-card">
                <div class="thermal-stage-title">淬火动画阶段</div>
                <div class="thermal-risk-row"><span>当前阶段</span><strong class="quench-stage-label">${escapeSimHtml(stageLabel)}</strong></div>
                <div class="thermal-risk-row"><span>动画进度</span><strong class="quench-progress-text">${Math.round(progress)}%</strong></div>
                <div class="thermal-risk-row"><span>分层状态</span><strong>${escapeSimHtml(layerProgressText)}</strong></div>
                <input class="atmosphere-progress-range quench-progress-range" type="range" min="0" max="100" value="${Math.round(progress)}" disabled style="width:100%;margin:8px 0 4px;">
                <div class="thermal-mini-note quench-stage-desc">${escapeSimHtml(stageDesc)}</div>
            </div>

            <div class="thermal-risk-card quench-card">
                <div class="thermal-stage-title">层间冷却诊断</div>
                <div class="thermal-risk-row"><span>底层入油时间</span><strong>${escapeSimHtml(bottomImmersionTime)}</strong></div>
                <div class="thermal-risk-row"><span>中层入油时间</span><strong>${escapeSimHtml(middleImmersionTime)}</strong></div>
                <div class="thermal-risk-row"><span>上层入油时间</span><strong>${escapeSimHtml(topImmersionTime)}</strong></div>
                <div class="thermal-risk-row"><span>最慢冷却层</span><strong>${escapeSimHtml(slowestCoolingLayer)}</strong></div>
                <div class="thermal-risk-row"><span>层间冷却差</span><strong>${escapeSimHtml(layerCoolingSpreadLabel)}</strong></div>
                <div class="thermal-mini-note">V3.3 按工件 Y 高度/搁板层计算入油顺序：底层先冷却，上层后冷却；密集层和厚大件会保留更长的红橙滞后区。</div>
            </div>

            <div class="thermal-risk-card quench-card">
                <div class="thermal-stage-title">质量风险诊断</div>
                <div class="thermal-risk-row"><span>出炉到入油延迟</span><strong>${transferDelaySec}s</strong></div>
                <div class="thermal-risk-row"><span>中心冷却滞后</span><strong>${escapeSimHtml(coreLagRisk)}</strong></div>
                <div class="thermal-risk-row"><span>变形风险</span><strong style="color:${riskColor};">${escapeSimHtml(deformationRisk)}</strong></div>
                <div class="thermal-risk-row"><span>开裂风险</span><strong style="color:${riskColor};">${escapeSimHtml(crackRisk)}</strong></div>
                <div class="thermal-risk-row"><span>装载密度</span><strong>${densityRate}%</strong></div>
                <div class="thermal-mini-note strong-note">${escapeSimHtml(primaryRiskReason)}</div>
            </div>

            <div class="thermal-stage-card quench-card">
                <div class="thermal-stage-title">调整建议</div>
                <div class="thermal-mini-note strong-note">${escapeSimHtml(suggestion)}</div>
            </div>
        `;
        return;
    }

    if (activeMode === 'airflow') {
        const coolingReachability = metrics?.coolingReachability ?? Math.max(50, Math.round(88 - densityRate * 0.55));
        const minCoolingReachability = metrics?.minCoolingReachability ?? Math.max(28, coolingReachability - 26);
        const leewardItemCount = metrics?.leewardItemCount ?? 0;
        const severeLeewardItemCount = metrics?.severeLeewardItemCount ?? 0;
        const blockedFlowPathCount = metrics?.blockedFlowPathCount ?? 0;
        const worstItemName = metrics?.worstItemName || '-';
        const coolingUniformityScore = metrics?.coolingUniformityScore ?? Math.max(45, Math.round(90 - densityRate * 0.5));
        const airflowDirections = Array.isArray(metrics?.airflowDirections) && metrics.airflowDirections.length ? metrics.airflowDirections : [metrics?.airflowDirection || 'z+'];
        const airflowDirectionLabel = metrics?.airflowDirectionLabel || '+Z → 后侧';
        const inletLabel = metrics?.inletLabel || '前侧进风';
        const outletLabel = metrics?.outletLabel || '后侧出风';
        const airflowModeLabel = metrics?.airflowModeLabel || (airflowDirections.length > 1 ? `多入口环流 · ${airflowDirections.length} 个入口` : '单向进出');
        const gasType = metrics?.gasType || 'n2';
        const gasLabel = metrics?.gasLabel || '高压氮气 N₂';
        const gasPressureLabel = metrics?.gasPressureLabel || '6–10 bar';
        const gasDensityHint = metrics?.gasDensityHint || '标准气淬介质，综合成本低，适合大多数真空淬火。';
        const animationPlaying = !!metrics?.animationPlaying;
        const suggestion = metrics?.suggestion || '点击“气流冷却”后，系统会用解释型路径线评估高压气淬阶段的迎风/背风风险。';
        const dirs = [
            { key: 'x+', label: '+X', desc: '右侧' },
            { key: 'x-', label: '-X', desc: '左侧' },
            { key: 'y+', label: '+Y', desc: '上层' },
            { key: 'y-', label: '-Y', desc: '下层' },
            { key: 'z+', label: '+Z', desc: '后侧' },
            { key: 'z-', label: '-Z', desc: '前侧' }
        ];
        const dirButtons = dirs.map(d => {
            const active = airflowDirections.includes(d.key);
            return `
                <button class="airflow-dir-btn ${active ? 'active' : ''}" type="button" data-action="airflow-toggle-direction" data-airflow-dir="${d.key}" title="点击切换该入口；可多选">
                    <strong>${d.label}</strong><span>${escapeSimHtml(d.desc)}</span>
                </button>
            `;
        }).join('');
        const presetButtons = `
            <button class="plan-action-btn airflow-preset-btn" type="button" data-action="airflow-preset" data-airflow-preset="z+">单向</button>
            <button class="plan-action-btn airflow-preset-btn" type="button" data-action="airflow-preset" data-airflow-preset="z+,z-">前后双向</button>
            <button class="plan-action-btn airflow-preset-btn" type="button" data-action="airflow-preset" data-airflow-preset="y-,y+">上下循环</button>
            <button class="plan-action-btn airflow-preset-btn" type="button" data-action="airflow-preset" data-airflow-preset="x+,x-,z+,z-">四侧环流</button>
        `;

        panel.innerHTML = `
            <div class="thermal-header-card compact airflow-card">
                <div class="thermal-title">💨 ${escapeSimHtml(furnace.instanceId || '当前炉次')} · 介质场 · 气流冷却 V2.1</div>
                <div class="thermal-subtitle">
                    V2.1 增强曲线绕流与碰撞减速：蓝色粒子表示高速通畅气流，遇到工件后会沿障碍物侧向曲线绕行，红橙粒子表示减速弱流 / 背风区域。
                </div>
                <div class="thermal-metric-grid">
                    <div class="thermal-metric"><span>平均冷却可达</span><strong>${coolingReachability}%</strong></div>
                    <div class="thermal-metric"><span>最低冷却件</span><strong>${minCoolingReachability}%</strong></div>
                    <div class="thermal-metric"><span>背风风险件</span><strong>${leewardItemCount} 件</strong></div>
                    <div class="thermal-metric"><span>严重背风</span><strong>${severeLeewardItemCount} 件</strong></div>
                </div>
                <div class="thermal-legend airflow-legend">
                    <span>背风</span><div class="airflow-gradient"></div><span>通畅</span>
                </div>
                <div class="thermal-mini-note">蓝色半透明面 = 进/出风边界；蓝色粒子 = 高速流；橙红粒子 = 碰撞减速流；曲线表示绕障路径。</div>
            </div>

            <div class="thermal-risk-card airflow-card">
                <div class="thermal-stage-title">冷却介质</div>
                <div class="thermal-risk-row"><span>当前气体</span><strong>${escapeSimHtml(gasLabel)}</strong></div>
                <div class="thermal-risk-row"><span>参考压力</span><strong>${escapeSimHtml(gasPressureLabel)}</strong></div>
                <select class="thermal-speed-select" data-action="airflow-gas-type" style="width:100%;margin-top:8px;">
                    <option value="n2" ${gasType === 'n2' ? 'selected' : ''}>高压氮气 N₂ · 常规气淬</option>
                    <option value="ar" ${gasType === 'ar' ? 'selected' : ''}>氩气 Ar · 惰性保护</option>
                    <option value="he" ${gasType === 'he' ? 'selected' : ''}>氦气 He · 高冷却强度</option>
                </select>
                <div class="thermal-mini-note">${escapeSimHtml(gasDensityHint)} 当前为解释型参数：不同气体会影响粒子速度、颜色和冷却评分微调。</div>
            </div>

            <div class="thermal-risk-card airflow-card">
                <div class="thermal-stage-title">气流入口配置</div>
                <div class="thermal-risk-row"><span>当前模式</span><strong>${escapeSimHtml(airflowModeLabel)}</strong></div>
                <div class="thermal-risk-row"><span>入口方向</span><strong>${escapeSimHtml(airflowDirectionLabel)}</strong></div>
                <div class="thermal-risk-row"><span>入口 / 出口</span><strong>${escapeSimHtml(inletLabel)} → ${escapeSimHtml(outletLabel)}</strong></div>
                <div class="airflow-dir-grid">${dirButtons}</div>
                <div class="airflow-preset-row">${presetButtons}</div>
                <div class="thermal-mini-note">按钮支持多选。单向适合基础验证；前后双向 / 四侧环流更接近多风机或环向气淬的解释型表达。</div>
            </div>

            <div class="thermal-risk-card airflow-card">
                <div class="thermal-stage-title">气流流线动画</div>
                <div class="thermal-risk-row"><span>动画状态</span><strong>${animationPlaying ? '循环流动中' : '循环已暂停 / 诊断视图'}</strong></div>
                <div class="thermal-risk-row"><span>进度语义</span><strong>循环相位，不代表冷却完成度</strong></div>
                <div class="thermal-mini-note">这是解释型流线动画，不是 CFD：用于展示气流进入、遇到工件后曲线绕流、速度衰减、弱流区和背风风险。气流模式不显示 0–100% 完成进度；顶部“当前模式操作”只控制流线循环、暂停和速度。</div>
            </div>

            <div class="thermal-risk-card airflow-card">
                <div class="thermal-stage-title">背风冷却诊断</div>
                <div class="thermal-risk-row"><span>冷却均匀性</span><strong>${coolingUniformityScore} 分</strong></div>
                <div class="thermal-risk-row"><span>被遮挡气流路径</span><strong>${blockedFlowPathCount}</strong></div>
                <div class="thermal-risk-row"><span>最低冷却工件</span><strong>${escapeSimHtml(worstItemName)}</strong></div>
                <div class="thermal-risk-row"><span>装载密度</span><strong>${densityRate}%</strong></div>
                <div class="thermal-risk-row"><span>当前模式</span><strong>介质场 · 气流冷却 V2.1</strong></div>
            </div>

            <div class="thermal-stage-card airflow-card">
                <div class="thermal-stage-title">调整建议</div>
                <div class="thermal-mini-note strong-note">${escapeSimHtml(suggestion)}</div>
            </div>
        `;
        return;
    }

    if (activeMode === 'radiation') {
        const radiationExposure = metrics?.radiationExposure ?? Math.max(55, Math.round(92 - densityRate * 0.45));
        const minExposure = metrics?.minRadiationExposure ?? Math.max(35, radiationExposure - 22);
        const blockedItemCount = metrics?.blockedItemCount ?? 0;
        const severeBlockedItemCount = metrics?.severeBlockedItemCount ?? 0;
        const blockedRayCount = metrics?.blockedRayCount ?? 0;
        const worstItemName = metrics?.worstItemName || '-';
        const suggestion = metrics?.suggestion || '点击“辐射暴露”后，系统会用少量有效/遮挡射线解释工件辐射可达性。';
        const selected = metrics?.selectedItem || null;
        const selectedBatch = metrics?.selectedBatch || null;
        const sectionView = selected?.sectionView || metrics?.sectionView || null;
        const sectionActive = !!sectionView?.active;
        const sectionButtonHtml = selected
            ? `<button class="plan-action-btn" type="button" data-action="${sectionActive ? 'radiation-section-exit' : 'radiation-section-view'}" style="margin-top:10px;width:100%;">${sectionActive ? '退出真实剖面' : '开启真实剖面切割'}</button>`
            : '';
        const sectionDirections = [
            { key: 'x+', label: '+X' },
            { key: 'x-', label: '-X' },
            { key: 'y+', label: '+Y' },
            { key: 'y-', label: '-Y' },
            { key: 'z+', label: '+Z' },
            { key: 'z-', label: '-Z' }
        ];
        const sectionDirectionButtons = sectionDirections.map(d => `
            <button class="clip-dir-btn ${sectionView?.directionKey === d.key ? 'active' : ''}" type="button" data-action="radiation-section-direction" data-section-dir="${d.key}">
                ${d.label}
            </button>
        `).join('');
        const sectionOffset = Number(sectionView?.offset || 0);
        const sectionMinOffset = Number(sectionView?.minOffset ?? -300);
        const sectionMaxOffset = Number(sectionView?.maxOffset ?? 300);
        const sectionInfoHtml = sectionActive ? `
                <div class="thermal-stage-title" style="margin-top:10px;">真实剖面切割 Clip Plane</div>
                <div class="thermal-risk-row"><span>切割面</span><strong>${escapeSimHtml(sectionView.axisLabel || '-')}</strong></div>
                <div class="thermal-risk-row"><span>法线方向</span><strong>${escapeSimHtml(sectionView.normalText || '-')} · ${escapeSimHtml(sectionView.keepLabel || '-')}</strong></div>
                <div class="thermal-risk-row"><span>当前偏移</span><strong>${Math.round(sectionOffset)}mm</strong></div>
                <div class="thermal-risk-row"><span>切面坐标</span><strong>${escapeSimHtml(sectionView.axis || '-').toUpperCase()}=${Math.round(sectionView.planeCoord || 0)}mm</strong></div>
                <div class="clip-plane-control">
                    <div class="clip-plane-control-title">选择切割方向</div>
                    <div class="clip-dir-grid">${sectionDirectionButtons}</div>
                    <div class="clip-offset-head">
                        <span>沿法线拖动</span>
                        <strong>${Math.round(sectionOffset)}mm</strong>
                    </div>
                    <input class="clip-offset-slider" type="range"
                        data-action="radiation-section-offset"
                        min="${sectionMinOffset}"
                        max="${sectionMaxOffset}"
                        value="${sectionOffset}"
                        step="5">
                    <div class="clip-offset-scale">
                        <span>${sectionMinOffset}mm</span>
                        <span>0</span>
                        <span>${sectionMaxOffset}mm</span>
                    </div>
                    <button class="clip-reset-btn" type="button" data-action="radiation-section-reset">回到选中工件中心</button>
                </div>
                <div class="thermal-mini-note strong-note">蓝色半透明面是真实 Three.js clipping plane：可直接在 3D 里拖动蓝色切面，也可用上方滑块沿法线移动。</div>
                <div class="thermal-risk-row"><span>主要遮挡方向</span><strong>${escapeSimHtml(sectionView.dominantDirection || '-')}</strong></div>
                <div class="thermal-risk-row"><span>遮挡来源</span><strong>${escapeSimHtml(sectionView.blockerText || '-')}</strong></div>
            ` : '';
        const blockerList = selected?.blockers?.length
            ? selected.blockers.map(b => `<div class="thermal-risk-row"><span>${escapeSimHtml(b.name)}</span><strong>${b.count} 条路径</strong></div>`).join('')
            : '<div class="thermal-mini-note">暂无明确遮挡来源。</div>';
        const batchBlockerList = selectedBatch?.blockers?.length
            ? selectedBatch.blockers.map(b => `<div class="thermal-risk-row"><span>${escapeSimHtml(b.name)}</span><strong>${b.count} 条路径</strong></div>`).join('')
            : '<div class="thermal-mini-note">该批次暂无明确集中遮挡来源。</div>';
        const selectedHtml = selected ? `
            <div class="thermal-risk-card radiation-card radiation-selected-card">
                <div class="thermal-stage-title">单件辐射诊断</div>
                <div class="thermal-title">🎯 ${escapeSimHtml(selected.name)}</div>
                <div class="thermal-subtitle">${escapeSimHtml(selected.material)} · ${escapeSimHtml(selected.process)} · 风险 ${escapeSimHtml(selected.riskLevel)}</div>
                <div class="thermal-metric-grid">
                    <div class="thermal-metric"><span>单件暴露</span><strong>${selected.score}%</strong></div>
                    <div class="thermal-metric"><span>遮挡来源</span><strong>${selected.blockerCount} 件</strong></div>
                    <div class="thermal-metric"><span>有效路径</span><strong>${selected.visibleRayCount}</strong></div>
                    <div class="thermal-metric"><span>遮挡路径</span><strong>${selected.blockedRayCount}</strong></div>
                </div>
                <div class="thermal-mini-note strong-note">${escapeSimHtml(selected.suggestion)}</div>
                ${sectionButtonHtml}
                ${sectionInfoHtml}
                <div class="thermal-stage-title" style="margin-top:10px;">主要遮挡工件</div>
                ${blockerList}
            </div>
        ` : (selectedBatch ? `
            <div class="thermal-risk-card radiation-card radiation-selected-card">
                <div class="thermal-stage-title">批次辐射诊断</div>
                <div class="thermal-title">📦 ${escapeSimHtml(selectedBatch.name)}</div>
                <div class="thermal-subtitle">共 ${selectedBatch.count} 件 · 风险 ${escapeSimHtml(selectedBatch.riskLevel)} · ${escapeSimHtml(selectedBatch.riskLocation || '-')}</div>
                <div class="thermal-metric-grid">
                    <div class="thermal-metric"><span>平均暴露</span><strong>${selectedBatch.avgScore}%</strong></div>
                    <div class="thermal-metric"><span>最低暴露</span><strong>${selectedBatch.minScore}%</strong></div>
                    <div class="thermal-metric"><span>风险实例</span><strong>${selectedBatch.highRiskCount} / ${selectedBatch.count} 件</strong></div>
                    <div class="thermal-metric"><span>遮挡路径</span><strong>${selectedBatch.blockedRayCount}</strong></div>
                </div>
                <div class="thermal-mini-note strong-note">${escapeSimHtml(selectedBatch.suggestion)}</div>
                <button class="plan-action-btn" type="button" data-action="radiation-locate-worst" style="margin-top:10px;width:100%;">定位最低暴露件</button>
                <div class="thermal-stage-title" style="margin-top:10px;">主要遮挡来源</div>
                ${batchBlockerList}
            </div>
        ` : `
            <div class="thermal-risk-card radiation-card radiation-selected-card">
                <div class="thermal-stage-title">辐射诊断</div>
                <div class="thermal-mini-note">点击 3D 中任意工件查看“单件辐射诊断”；点击左侧物料卡片查看“批次辐射诊断”。</div>
            </div>
        `);

        panel.innerHTML = `
            <div class="thermal-header-card compact radiation-card">
                <div class="thermal-title">☀️ ${escapeSimHtml(furnace.instanceId || '当前炉次')} · 辐射暴露</div>
                <div class="thermal-subtitle">
                    这一层不是继续模拟温度，而是解释真空炉热源是否能“看见”工件：金色射线代表有效辐射，红色射线代表被遮挡路径，工件颜色表示辐射暴露评分。
                </div>
                <div class="thermal-metric-grid">
                    <div class="thermal-metric"><span>平均辐射覆盖</span><strong>${radiationExposure}%</strong></div>
                    <div class="thermal-metric"><span>最低暴露工件</span><strong>${minExposure}%</strong></div>
                    <div class="thermal-metric"><span>遮挡风险件</span><strong>${blockedItemCount} 件</strong></div>
                    <div class="thermal-metric"><span>严重遮挡</span><strong>${severeBlockedItemCount} 件</strong></div>
                </div>
                <div class="thermal-legend radiation-legend">
                    <span>遮挡</span><div class="radiation-gradient"></div><span>充分</span>
                </div>
                <div class="thermal-mini-note">炉壁/顶部橙色发光面 = 热源；金色线 = 可达路径；红色线 = 被其他工件包围盒遮挡；红色线框 = 需复核工件。</div>
            </div>

            ${selectedHtml}

            <div class="thermal-risk-card radiation-card">
                <div class="thermal-stage-title">辐射遮挡诊断</div>
                <div class="thermal-risk-row"><span>被遮挡射线权重</span><strong>${blockedRayCount}</strong></div>
                <div class="thermal-risk-row"><span>最低暴露工件</span><strong>${escapeSimHtml(worstItemName)}</strong></div>
                <div class="thermal-risk-row"><span>中心/背辐射风险</span><strong>${severeBlockedItemCount > 0 ? '高' : (blockedItemCount > 0 ? '中' : '低')}</strong></div>
                <div class="thermal-risk-row"><span>当前模式</span><strong>辐射可达性分析</strong></div>
            </div>

            <div class="thermal-stage-card radiation-card">
                <div class="thermal-stage-title">调整建议</div>
                <div class="thermal-mini-note strong-note">${escapeSimHtml(suggestion)}</div>
            </div>
        `;
        return;
    }

    const progress = metrics?.progress ?? 0;
    const currentTemp = metrics?.currentTemp ?? 120;
    const targetTemp = metrics?.targetTemp ?? 1040;
    const uniformityScore = metrics?.uniformityScore ?? Math.max(50, Math.round(92 - densityRate * 0.55));
    const coldSpotCount = metrics?.coldSpotCount ?? 0;
    const radiationExposure = metrics?.radiationExposure ?? Math.max(55, Math.round(92 - densityRate * 0.45));
    const coreLagRisk = metrics?.coreLagRisk ?? (densityRate > 35 ? '中' : '低');
    const heatmapView = metrics?.heatmapView || 'middle';
    const heatmapViewLabel = metrics?.heatmapViewLabel || '中层热力图';
    const heatmapViewDescription = metrics?.heatmapViewDescription || '默认查看装载中心区热场，必要时切换底面、底层、上层、可移动纵剖面或三层对比。';
    const heatmapVerticalAxis = metrics?.heatmapVerticalAxis || 'z';
    const heatmapVerticalAxisLabel = metrics?.heatmapVerticalAxisLabel || (heatmapVerticalAxis === 'x' ? 'X向剖面 · YZ面' : 'Z向剖面 · XY面');
    const heatmapSectionOffset = Number(metrics?.heatmapSectionOffset || 0);
    const heatmapSectionMinOffset = Number(metrics?.heatmapSectionMinOffset ?? -450);
    const heatmapSectionMaxOffset = Number(metrics?.heatmapSectionMaxOffset ?? 450);
    const thermalSpread = metrics?.thermalSpread ?? Math.max(12, Math.round(28 + densityRate * 0.42));
    const coldSpotLocation = metrics?.coldSpotLocation || '未见明显冷点';
    const minThermalRatio = metrics?.minThermalRatio ?? '-';
    const heatmapDisplayMode = metrics?.heatmapDisplayMode || 'balanced';
    const heatmapDisplayModeLabel = metrics?.heatmapDisplayModeLabel || '标准诊断';
    const heatmapDisplayModeDescription = metrics?.heatmapDisplayModeDescription || '热力剖面、工件结构和冷点标记均衡显示。';
    const heatmapSliceSectionText = metrics?.heatmapSliceSectionText || heatmapViewLabel;
    const heatmapSliceRiskText = metrics?.heatmapSliceRiskText || '温度分布较均衡';
    const heatmapSliceReason = metrics?.heatmapSliceReason || '当前剖面未见明显异常。';
    const heatmapSliceSuggestion = metrics?.heatmapSliceSuggestion || '';

    const stage = progress < 22
        ? '预热升温'
        : progress < 65
            ? '奥氏体化升温'
            : progress < 90
                ? '保温均热'
                : '气淬前热态复核';

    const heatmapViews = [
        { key: 'middle', label: '中层', desc: '中心区' },
        { key: 'floor', label: '底面', desc: '炉底/支撑' },
        { key: 'bottom', label: '底层', desc: '下层冷点' },
        { key: 'top', label: '上层', desc: '顶部热源' },
        { key: 'vertical', label: '纵剖面', desc: '可移动' },
        { key: 'all', label: '三层', desc: '层间对比' }
    ];
    const heatmapButtons = heatmapViews.map(view => `
        <button class="plan-action-btn thermal-heatmap-btn ${heatmapView === view.key ? 'active' : ''}" type="button" data-action="thermal-heatmap-view" data-thermal-view="${view.key}" style="flex:1;min-width:76px;padding:7px 8px;">
            <strong>${escapeSimHtml(view.label)}</strong><span style="display:block;font-size:9px;font-weight:600;opacity:.72;margin-top:2px;">${escapeSimHtml(view.desc)}</span>
        </button>
    `).join('');

    const displayModes = [
        { key: 'balanced', label: '标准诊断', desc: '均衡' },
        { key: 'workpiece', label: '工件优先', desc: '看摆放' },
        { key: 'coldspot', label: '冷点优先', desc: '找异常' }
    ];
    const displayModeButtons = displayModes.map(mode => `
        <button class="plan-action-btn thermal-heatmap-btn ${heatmapDisplayMode === mode.key ? 'active' : ''}" type="button" data-action="thermal-heatmap-display-mode" data-thermal-display-mode="${mode.key}" style="flex:1;min-width:86px;padding:7px 8px;">
            <strong>${escapeSimHtml(mode.label)}</strong><span style="display:block;font-size:9px;font-weight:600;opacity:.72;margin-top:2px;">${escapeSimHtml(mode.desc)}</span>
        </button>
    `).join('');

    const verticalControlHtml = heatmapView === 'vertical' ? `
        <div class="thermal-stage-title" style="margin-top:12px;">纵向剖面控制</div>
        <div class="thermal-risk-row"><span>剖面方向</span><strong>${escapeSimHtml(heatmapVerticalAxisLabel)}</strong></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
            <button class="plan-action-btn thermal-heatmap-btn ${heatmapVerticalAxis === 'x' ? 'active' : ''}" type="button" data-action="thermal-heatmap-axis" data-thermal-axis="x">X向剖面<span style="display:block;font-size:9px;opacity:.72;">YZ面 / 沿X移动</span></button>
            <button class="plan-action-btn thermal-heatmap-btn ${heatmapVerticalAxis === 'z' ? 'active' : ''}" type="button" data-action="thermal-heatmap-axis" data-thermal-axis="z">Z向剖面<span style="display:block;font-size:9px;opacity:.72;">XY面 / 沿Z移动</span></button>
        </div>
        <div class="thermal-risk-row" style="margin-top:6px;"><span>剖面位置</span><strong>${heatmapSectionOffset} mm</strong></div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
            <span style="font-size:10px;color:#94a3b8;">${heatmapSectionMinOffset}</span>
            <input type="range" data-action="thermal-heatmap-offset" min="${heatmapSectionMinOffset}" max="${heatmapSectionMaxOffset}" value="${heatmapSectionOffset}" step="10" style="flex:1;accent-color:#f97316;">
            <span style="font-size:10px;color:#94a3b8;">${heatmapSectionMaxOffset}</span>
        </div>
        <button class="plan-action-btn" type="button" data-action="thermal-heatmap-reset-offset" style="margin-top:8px;width:100%;">回到中心剖面</button>
        <div class="thermal-mini-note">移动纵向剖面会重新采样该截面的温度场，低温区标记也会跟随当前剖面更新。</div>
    ` : '';

    const stageRows = [
        { p: 20, name: '预热升温', desc: '炉壁与工装先升温，厚大件中心仍偏冷' },
        { p: 60, name: '奥氏体化升温', desc: '真空环境以辐射加热为主，遮挡面升温滞后' },
        { p: 85, name: '保温均热', desc: '温差逐渐收敛，冷区风险开始下降' },
        { p: 100, name: '气淬前热态复核', desc: '检查中心大件、密集堆叠区和背辐射区域' }
    ].map(row => `
        <div class="thermal-stage ${progress >= row.p - 8 ? 'active' : ''}">
            <div class="thermal-stage-progress">${row.p}%</div>
            <div>
                <div class="thermal-stage-name">${escapeSimHtml(row.name)}</div>
                <div class="thermal-stage-desc">${escapeSimHtml(row.desc)}</div>
            </div>
            <div>${progress >= row.p ? '✓' : '·'}</div>
        </div>
    `).join('');

    panel.innerHTML = `
        <div class="thermal-header-card compact thermal-heatmap-card">
            <div class="thermal-title">🌡️ ${escapeSimHtml(furnace.instanceId || '当前炉次')} · 升温热场 · 热力图 V1.3</div>
            <div class="thermal-subtitle">
                热场使用半透明热力切片 + 等温线表达温度分布：V1.3 增强冷点优先显示、当前剖面解释和工件/剖面视觉层级，蓝色代表低温滞后，黄橙红代表受热充分。
            </div>
            <div class="thermal-metric-grid">
                <div class="thermal-metric"><span>当前阶段</span><strong>${escapeSimHtml(stage)}</strong></div>
                <div class="thermal-metric"><span>温度进度</span><strong>${currentTemp} / ${targetTemp} ℃</strong></div>
                <div class="thermal-metric"><span>热场均匀性</span><strong>${uniformityScore} 分</strong></div>
                <div class="thermal-metric"><span>估算温差</span><strong>±${thermalSpread} ℃</strong></div>
            </div>
            <div class="thermal-legend">
                <span>低温/滞后</span><div class="thermal-gradient"></div><span>高温/充分</span>
            </div>
            <div class="thermal-mini-note">热力图 = 看温度结果；辐射暴露 = 解释加热遮挡；气流冷却 = 解释迎风/背风；气氛覆盖 = 解释表面处理介质死角。</div>
        </div>

        <div class="thermal-risk-card thermal-heatmap-card">
            <div class="thermal-stage-title">热力图视角</div>
            <div class="thermal-risk-row"><span>当前视角</span><strong>${escapeSimHtml(heatmapViewLabel)}</strong></div>
            <div class="thermal-mini-note" style="margin-bottom:8px;">${escapeSimHtml(heatmapViewDescription)}</div>
            <div class="thermal-heatmap-view-row" style="display:flex;flex-wrap:wrap;gap:6px;">${heatmapButtons}</div>
            ${verticalControlHtml}
        </div>

        <div class="thermal-risk-card thermal-heatmap-card">
            <div class="thermal-stage-title">显示模式</div>
            <div class="thermal-risk-row"><span>当前模式</span><strong>${escapeSimHtml(heatmapDisplayModeLabel)}</strong></div>
            <div class="thermal-mini-note" style="margin-bottom:8px;">${escapeSimHtml(heatmapDisplayModeDescription)}</div>
            <div class="thermal-heatmap-view-row" style="display:flex;flex-wrap:wrap;gap:6px;">${displayModeButtons}</div>
        </div>

        <div class="thermal-stage-card thermal-heatmap-card">
            <div class="thermal-stage-title">升温阶段</div>
            <div class="thermal-stage-list">${stageRows}</div>
        </div>

        <div class="thermal-risk-card thermal-heatmap-card">
            <div class="thermal-stage-title">当前剖面诊断</div>
            <div class="thermal-risk-row"><span>剖面位置</span><strong>${escapeSimHtml(heatmapSliceSectionText)}</strong></div>
            <div class="thermal-risk-row"><span>剖面判断</span><strong>${escapeSimHtml(heatmapSliceRiskText)}</strong></div>
            <div class="thermal-mini-note strong-note">${escapeSimHtml(heatmapSliceReason)}</div>
        </div>

        <div class="thermal-risk-card thermal-heatmap-card">
            <div class="thermal-stage-title">冷点 / 温差诊断</div>
            <div class="thermal-risk-row"><span>冷区风险点</span><strong>${coldSpotCount} 处</strong></div>
            <div class="thermal-risk-row"><span>最低热量区域</span><strong>${escapeSimHtml(coldSpotLocation)}</strong></div>
            <div class="thermal-risk-row"><span>最低热量比例</span><strong>${minThermalRatio === '-' ? '-' : minThermalRatio + '%'}</strong></div>
            <div class="thermal-risk-row"><span>辐射覆盖估算</span><strong>${radiationExposure}%</strong></div>
            <div class="thermal-risk-row"><span>厚大件中心滞后</span><strong>${escapeSimHtml(coreLagRisk)}</strong></div>
            <div class="thermal-risk-row"><span>当前模式</span><strong>升温热场 · 热力图 V1.3</strong></div>
        </div>

        <div class="thermal-stage-card thermal-heatmap-card">
            <div class="thermal-stage-title">调整建议</div>
            <div class="thermal-mini-note strong-note">${escapeSimHtml(heatmapSliceSuggestion || (coldSpotCount > 0 || coreLagRisk !== '低'
                ? '优先复核 3D 中“冷点风险区”标记和蓝色/青色冷区所在层，必要时增加工件间距、减少中心堆叠，或将厚大件调整到更靠近热源/外圈的位置。'
                : '当前热力图未显示明显冷点，高低温分布较均衡，可继续结合辐射暴露与气流冷却复核。'))}</div>
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

        // 从 localStorage 读取折叠状态并恢复（可选）。紧凑筛选条默认收起，节省物料列表空间。
        const storageKey = `filter_${targetId}_collapsed`;
        const savedState = localStorage.getItem(storageKey);
        const isCompactStrip = !!filterBar.closest('.material-filter-strip');

        if (isCompactStrip) {
            if (savedState === 'false') {
                filterBar.classList.remove('collapsed');
                btn.textContent = '▲';
            } else {
                filterBar.classList.add('collapsed');
                btn.textContent = '▼';
            }
        } else if (savedState === 'true') {
            filterBar.classList.add('collapsed');
            btn.textContent = '▶';
        } else {
            btn.textContent = '▼';
        }

        const toggleFilterBar = (e) => {
            if (e) e.stopPropagation();

            if (isCompactStrip) {
                document.querySelectorAll('.material-filter-strip .filter-bar').forEach(bar => {
                    if (bar !== filterBar) {
                        bar.classList.add('collapsed');
                        const otherBtn = bar.querySelector('.filter-collapse-btn');
                        if (otherBtn) otherBtn.textContent = '▼';
                    }
                });
            }

            filterBar.classList.toggle('collapsed');
            const isCollapsed = filterBar.classList.contains('collapsed');
            btn.textContent = isCompactStrip ? (isCollapsed ? '▼' : '▲') : (isCollapsed ? '▶' : '▼');
            localStorage.setItem(storageKey, isCollapsed);
        };

        btn.addEventListener('click', toggleFilterBar);

        // 紧凑筛选条：扩大命中区域，点击整条 header 都可以展开/收起。
        const header = filterBar.querySelector('.filter-bar-header');
        if (header && !header.dataset.filterHeaderBound) {
            header.dataset.filterHeaderBound = 'true';
            header.addEventListener('click', (e) => {
                if (e.target.closest('.filter-collapse-btn')) return;
                toggleFilterBar(e);
            });
        }
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
                balanced: '少物料贴边对称，多物料兼顾重心，物理稳定',
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
                    balanced: '少物料贴边对称，多物料兼顾重心，物理稳定',
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
    
    const btn = document.getElementById('btn-rules'); const orig = btn.textContent;
    btn.textContent = '✅ 规则已保存'; setTimeout(() => { btn.textContent = orig; }, 1500);
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

export function showImportPreview(data) {
    setImportPreviewData(data);
    const content = document.getElementById('import-preview-content');
    if (!content) return;

    const lang = localStorage.getItem('heat_furnace_ui_language_v0731') === 'en' ? 'en' : 'zh';
    const t = (zh, en) => lang === 'en' ? en : zh;
    const escapeCell = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const shapeLabel = (shape) => {
        if (shape === 'cylinder') return t('圆柱', 'Cylinder');
        return t('立方', 'Cuboid');
    };

    let html = '<div class="import-preview-table-wrap"><table class="import-table import-table-wide"><thead><tr>' +
        '<th>' + t('产品名称', 'Product') + '</th>' +
        '<th>' + t('客户', 'Customer') + '</th>' +
        '<th>' + t('物料编码', 'Item Code') + '</th>' +
        '<th>' + t('形态', 'Shape') + '</th>' +
        '<th>' + t('尺寸', 'Size') + '</th>' +
        '<th>' + t('数量', 'Qty') + '</th>' +
        '<th>' + t('单重/总重(kg)', 'Weight (kg)') + '</th>' +
        '<th>' + t('材质', 'Material') + '</th>' +
        '<th>' + t('工艺', 'Process') + '</th>' +
        '<th>' + t('硬度', 'Hardness') + '</th>' +
        '<th>' + t('日期/交期', 'Date / Due') + '</th>' +
        '<th>' + t('备注', 'Remarks') + '</th>' +
        '<th>' + t('状态', 'Status') + '</th>' +
        '</tr></thead><tbody>';

    data.forEach(d => {
        const dimStr = d.shape === 'cylinder'
            ? '⌀' + d.dim1 + '×H' + d.dim3
            : d.dim1 + '×' + d.dim2 + '×' + d.dim3;
        const cls = d.valid ? '' : ' class="error"';
        const displayName = d.showName || String(d.name || '').split('_')[0];
        const dateText = [d.orderDate || d.date || '', d.deliveryDate || d.dueDate || ''].filter(Boolean).join(' / ');
        const status = d.valid ? '✅' : '⚠️ ' + t('尺寸不足', 'Invalid size');
        html += '<tr' + cls + '>' +
            '<td class="import-name-cell">' + escapeCell(displayName) + '</td>' +
            '<td>' + escapeCell(d.customer || '') + '</td>' +
            '<td>' + escapeCell(d.itemCode || '') + '</td>' +
            '<td>' + shapeLabel(d.shape) + '</td>' +
            '<td class="nowrap">' + escapeCell(dimStr + 'mm') + '</td>' +
            '<td>' + escapeCell(d.count) + '</td>' +
            '<td>' + escapeCell(d.weight) + '</td>' +
            '<td>' + escapeCell(d.material || '') + '</td>' +
            '<td>' + escapeCell(d.process || '') + '</td>' +
            '<td>' + escapeCell(d.hardness || '') + '</td>' +
            '<td class="nowrap">' + escapeCell(dateText) + '</td>' +
            '<td class="import-remark-cell">' + escapeCell(d.remark || '') + '</td>' +
            '<td class="nowrap">' + status + '</td>' +
            '</tr>';
    });
    html += '</tbody></table></div>';
    content.innerHTML = html;
    document.getElementById('import-preview-overlay').style.display = 'flex';
}

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
        html += '<span class="ji-preview-tag">🧾 物料批次: ' + materials.length + '</span>';
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
    html += '<span class="ji-preview-tag">📦 ' + materials.length + ' 个物料批次</span>';
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