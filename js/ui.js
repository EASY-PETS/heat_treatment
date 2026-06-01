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
    usedColors, masterPlans,
    setFurnaceCounter, setMaterialCounter,
    setSelectedFurnaceCardId, setSelectedMaterialCardId,
    setFdpCollapsed, setMdpCollapsed,
    setSortState, setImportPreviewData,
    setPlacementRules, setCurrentFurnaceIndex,
    setGlobalFurnacesResult, setGlobalUnpackedItems, setGlobalSpacingValue
} from './state.js';
import {
    generateUniqueColor, highlightItemsInScene,
    findResultIndexByFid, getSelectedMaterialName
} from './three-scene.js';

// ==================== FURNACE CARD HELPERS ====================

export function getFurnaceDataFromCard(card) {
    const fid = parseInt(card.getAttribute('data-fid'));
    const name = card.querySelector('.f-card-name').textContent;
    const metaSpans = card.querySelectorAll('.f-card-meta span');
    const dimSpan = metaSpans[0] ? metaSpans[0].textContent.replace('📐 ', '') : '0×0×0';
    const dims = dimSpan.split('×');
    const countText = metaSpans[1] ? metaSpans[1].textContent : '×1台';
    const count = parseInt(countText.replace(/[^0-9]/g, '')) || 1;
    const weightText = metaSpans[2] ? metaSpans[2].textContent : '0kg';
    const maxWeight = parseFloat(weightText.replace(/[^0-9.]/g, '')) || 0;
    const plannedText = metaSpans[3] ? metaSpans[3].textContent : '计划0炉';
    const plannedHeats = parseInt(plannedText.replace(/[^0-9]/g, '')) || 0;
    const spacingText = card.getAttribute('data-spacing') || '';
    const actualSpacing = spacingText !== '' ? parseFloat(spacingText) : null;
    /**
     * V2.3: 每个炉膛独立存储 basketType
     * 从 data-basket-type 属性读取，默认为 'grid'
     */
    const basketType = card.getAttribute('data-basket-type') || 'grid';
    return { fid, name, width: parseFloat(dims[0]) || 0, height: parseFloat(dims[1]) || 0, depth: parseFloat(dims[2]) || 0, maxWeight, count, plannedHeats, actualSpacing, basketType };
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
    return { mid, name, shape, count, dim1, dim2, dim3, totalWeight, color, material, process, orderDate, deliveryDate, remark, hardness, cadImage };
}

// ==================== FURNACE CARD CREATION ====================

/**
 * V2.3: createFurnaceCard 新增 basketType 参数
 * 每个炉膛独立存储自己的料框类型，互不影响
 *
 * @param {string} name - 炉膛名称
 * @param {number} depth - 纵深 Z (mm)
 * @param {number} width - 宽度 X (mm)
 * @param {number} height - 高度 Y (mm)
 * @param {number} maxWeight - 承重上限 (kg)
 * @param {number} count - 台数
 * @param {number} plannedHeats - 计划装载炉次
 * @param {number|null} actualSpacing - 实际安全间距
 * @param {string} basketType - 料框类型 ('grid'|'honeycomb'|'tray'|'solid')，默认 'grid'
 */
export function createFurnaceCard(name, depth, width, height, maxWeight, count, plannedHeats, actualSpacing, basketType) {
    const newFC = furnaceCounter + 1; setFurnaceCounter(newFC);
    const cardId = 'furnace-card-' + newFC;
    const card = document.createElement('div');
    card.className = 'furnace-card'; card.id = cardId;
    card.setAttribute('data-fid', newFC);
    if (actualSpacing !== undefined && actualSpacing !== null) card.setAttribute('data-spacing', actualSpacing);
    /**
     * V2.3: 存储料框类型到 data-basket-type 属性
     * 默认为 'grid'（普通网格料框）
     */
    card.setAttribute('data-basket-type', basketType || 'grid');
    const ph = plannedHeats || 0;
    card.innerHTML = '<span class="f-drag-handle" draggable="true" title="拖拽排序">⠿</span><button class="f-card-delete" data-action="delete-furnace" data-fid="' + newFC + '">✕</button><div class="f-card-name">' + name + '</div><div class="f-card-meta"><span>📐 ' + width + '×' + height + '×' + depth + '</span><span>📦 ×' + count + '台</span><span>⚖ ' + maxWeight + 'kg</span><span>计划' + ph + '炉</span></div><div class="f-card-status">点击查看详情 · 双击编辑</div>';
    card.addEventListener('click', (e) => { if (e.target.closest('[data-action="delete-furnace"]')) return; if (e.target.closest('.f-drag-handle')) return; selectFurnaceCard(cardId); showFurnaceDetail(cardId); });
    setupFurnaceDrag(card);
    document.getElementById('furnace-cards-container').appendChild(card);
    return { cardId, furnaceCounter: newFC, name, depth, width, height, maxWeight, count, plannedHeats: ph, basketType: basketType || 'grid' };
}

export function selectFurnaceCard(cardId) { document.querySelectorAll('.furnace-card').forEach(c => c.classList.remove('active')); const card = document.getElementById(cardId); if (card) { card.classList.add('active'); setSelectedFurnaceCardId(cardId); } }

export function showFurnaceDetail(cardId) {
    const card = document.getElementById(cardId); if (!card) return;
    const d = getFurnaceDataFromCard(card);
    document.getElementById('fdp-title').textContent = '📋 ' + d.name;
    document.getElementById('fdp-placeholder').style.display = 'none';
    const body = document.getElementById('fdp-body'); body.style.display = 'block';
    /**
     * V2.3: 炉膛详情面板新增料框类型下拉框
     * 每个炉膛独立选择料框类型，切换后保存到 data-basket-type 属性
     */
    const basketType = card.getAttribute('data-basket-type') || d.basketType || 'grid';
    body.innerHTML = '<div class="fdp-row"><div class="fdp-field"><label>名称</label><input type="text" id="fdp-name" value="' + d.name + '"></div></div><div class="fdp-row"><div class="fdp-field"><label>宽度 X (mm)</label><input type="number" id="fdp-width" value="' + d.width + '"></div><div class="fdp-field"><label>高度 Y (mm)</label><input type="number" id="fdp-height" value="' + d.height + '"></div><div class="fdp-field"><label>纵深 Z (mm)</label><input type="number" id="fdp-depth" value="' + d.depth + '"></div></div><div class="fdp-row"><div class="fdp-field"><label>承重上限 (kg)</label><input type="number" id="fdp-weight" value="' + d.maxWeight + '"></div><div class="fdp-field"><label>台数</label><input type="number" id="fdp-count" value="' + d.count + '" min="1"></div></div><div class="fdp-row"><div class="fdp-field"><label>计划装载炉次</label><input type="number" id="fdp-planned" value="' + d.plannedHeats + '" min="0"></div><div class="fdp-field"><label>实际安全间距 (mm) <span style="color:#666;font-size:9px;">留空=用默认</span></label><input type="number" id="fdp-spacing" value="' + (d.actualSpacing != null ? d.actualSpacing : '') + '" placeholder="默认' + (document.getElementById('global-spacing') ? document.getElementById('global-spacing').value : '5') + 'mm"></div></div><div class="fdp-row"><div class="fdp-field"><label>📦 料框类型 <span style="color:#666;font-size:9px;">V2.3</span></label><select id="fdp-basket-type"><option value="grid"' + (basketType === 'grid' ? ' selected' : '') + '>普通网格料框</option><option value="honeycomb"' + (basketType === 'honeycomb' ? ' selected' : '') + '>蜂窝料框</option><option value="tray"' + (basketType === 'tray' ? ' selected' : '') + '>托盘式搁板</option><option value="solid"' + (basketType === 'solid' ? ' selected' : '') + '>实心料框</option></select></div></div><button class="fdp-save-btn" id="fdp-save-btn">💾 保存炉膛参数</button>';
    document.getElementById('fdp-save-btn').addEventListener('click', () => { saveFurnaceDetail(cardId); });
    if (fdpCollapsed) { setFdpCollapsed(false); document.getElementById('furnace-detail-panel').classList.remove('collapsed'); document.getElementById('fdp-toggle-icon').textContent = '▲'; }
}

export function saveFurnaceDetail(cardId) {
    const card = document.getElementById(cardId); if (!card) return;
    const name = document.getElementById('fdp-name').value.trim() || '炉膛';
    const width = parseFloat(document.getElementById('fdp-width').value) || 0;
    const height = parseFloat(document.getElementById('fdp-height').value) || 0;
    const depth = parseFloat(document.getElementById('fdp-depth').value) || 0;
    const maxWeight = parseFloat(document.getElementById('fdp-weight').value) || 0;
    const count = parseInt(document.getElementById('fdp-count').value) || 1;
    const plannedHeats = parseInt(document.getElementById('fdp-planned').value) || 0;
    const spacingVal = document.getElementById('fdp-spacing').value;
    const actualSpacing = spacingVal !== '' ? parseFloat(spacingVal) : null;
    /**
     * V2.3: 保存料框类型到 data-basket-type 属性
     */
    const basketSelect = document.getElementById('fdp-basket-type');
    if (basketSelect) {
        card.setAttribute('data-basket-type', basketSelect.value);
    }
    card.querySelector('.f-card-name').textContent = name;
    card.querySelector('.f-card-meta').innerHTML = '<span>📐 ' + width + '×' + height + '×' + depth + '</span><span>📦 ×' + count + '台</span><span>⚖ ' + maxWeight + 'kg</span><span>计划' + plannedHeats + '炉</span>';
    if (actualSpacing !== null) card.setAttribute('data-spacing', actualSpacing); else card.removeAttribute('data-spacing');
    document.getElementById('fdp-title').textContent = '📋 ' + name; updateTopSummary();
    const btn = document.getElementById('fdp-save-btn'); if (btn) { btn.textContent = '✅ 已保存'; setTimeout(() => { btn.textContent = '💾 保存炉膛参数'; }, 1500); }
}

export function deleteFurnaceCard(fid) {
    const card = document.getElementById('furnace-card-' + fid); if (card) card.remove();
    if (selectedFurnaceCardId === 'furnace-card-' + fid) { setSelectedFurnaceCardId(null); document.getElementById('fdp-placeholder').style.display = 'block'; document.getElementById('fdp-body').style.display = 'none'; document.getElementById('fdp-title').textContent = '📋 炉膛详情'; }
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
    if (extraData) { if (extraData.material) card.setAttribute('data-material', extraData.material); if (extraData.process) card.setAttribute('data-process', extraData.process); if (extraData.orderDate) card.setAttribute('data-order-date', extraData.orderDate); if (extraData.deliveryDate) card.setAttribute('data-delivery-date', extraData.deliveryDate); if (extraData.remark) card.setAttribute('data-remark', extraData.remark); if (extraData.hardness) card.setAttribute('data-hardness', extraData.hardness); if (extraData.cadImage) card.setAttribute('data-cad-image', extraData.cadImage); }
    card.innerHTML = '<button class="m-delete" data-action="delete-material" data-mid="' + newMC + '">✕</button><div class="m-color-swatch" style="background-color:' + color + ';" title="' + name + '"></div><div class="m-info"><div class="m-name">' + name + '</div><div class="m-meta">' + shapeLabel + ' · ' + dimLabel + 'mm · ×' + count + '件 · ' + totalWeight + 'kg</div></div>';
    card.addEventListener('click', (e) => { if (e.target.closest('[data-action="delete-material"]')) return; const wasSelected = card.classList.contains('active'); selectMaterialCard(cardId); if (!wasSelected) { showMaterialDetail(cardId); if (globalFurnacesResult && globalFurnacesResult.length > 0) highlightItemsInScene(cardId); } else { document.getElementById('mdp-placeholder').style.display = 'block'; document.getElementById('mdp-body').style.display = 'none'; document.getElementById('mdp-title').textContent = '📋 工件详情'; if (globalFurnacesResult && globalFurnacesResult.length > 0) highlightItemsInScene(null); } });
    document.getElementById('material-cards-container').appendChild(card);
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
    const btn = document.getElementById('mdp-save-btn'); if (btn) { btn.textContent = '✅ 已保存'; setTimeout(() => { btn.textContent = '💾 保存工件参数'; }, 1500); }
}

export function deleteMaterialCard(mid) { const card = document.getElementById('material-card-' + mid); if (card) card.remove(); if (selectedMaterialCardId === 'material-card-' + mid) { setSelectedMaterialCardId(null); document.getElementById('mdp-placeholder').style.display = 'block'; document.getElementById('mdp-body').style.display = 'none'; document.getElementById('mdp-title').textContent = '📋 工件详情'; } updateTopSummary(); }

export function rgbToHex(rgb) { if (!rgb) return '#888888'; if (rgb.startsWith('#')) return rgb; const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/); if (!m) return '#888888'; return '#' + [m[1],m[2],m[3]].map(x => parseInt(x).toString(16).padStart(2,'0')).join(''); }

export function updateTopSummary() { document.getElementById('top-furnace-count').textContent = document.querySelectorAll('.furnace-card').length; document.getElementById('top-item-count').textContent = document.querySelectorAll('.material-card').length; }

export function updateFurnaceNav() { const navDiv = document.getElementById('furnace-nav'); if (!globalFurnacesResult || globalFurnacesResult.length === 0) { navDiv.style.display = 'none'; return; } navDiv.style.display = 'flex'; if (currentFurnaceIndex < 0 || currentFurnaceIndex >= globalFurnacesResult.length) setCurrentFurnaceIndex(0); const furnace = globalFurnacesResult[currentFurnaceIndex]; document.getElementById('nav-title').textContent = furnace.instanceId; const packedVol = furnace.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0); const totalVol = furnace.w * furnace.h * furnace.d; document.getElementById('nav-info').textContent = furnace.packedItems.length + '件 · ' + furnace.totalWeight.toFixed(1) + 'kg · 利用率 ' + ((packedVol / totalVol) * 100).toFixed(1) + '%'; }

export function updateLeftPanelActiveForIndex(index) { document.querySelectorAll('.furnace-card').forEach(c => c.classList.remove('active')); if (!globalFurnacesResult || index >= globalFurnacesResult.length) return; const furnace = globalFurnacesResult[index]; document.querySelectorAll('.furnace-card').forEach(card => { if (card.querySelector('.f-card-name').textContent === furnace.typeName) card.classList.add('active'); }); }

export function updateCenterStats(onFurnaceClick) {
    const panel = document.getElementById('center-stats-panel'); const body = document.getElementById('csp-body'); const unpackedDiv = document.getElementById('center-stats-unpacked');
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    let totalWeight = 0, totalCount = 0;
    globalFurnacesResult.forEach(f => { totalWeight += f.totalWeight; totalCount += f.packedItems.length; });
    document.getElementById('csp-summary').textContent = '共' + globalFurnacesResult.length + '炉 · ' + totalCount + '件 · ' + totalWeight.toFixed(1) + 'kg';
    body.innerHTML = '';
    globalFurnacesResult.forEach((f, idx) => { const totalVol = f.w * f.h * f.d; const packedVol = f.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0); const div = document.createElement('div'); div.className = 'csp-furnace-item' + (idx === currentFurnaceIndex ? ' active' : ''); div.innerHTML = '<strong>' + f.instanceId + '</strong>负载: ' + f.totalWeight.toFixed(1) + '/' + f.max_weight + 'kg<br>利用率: ' + ((packedVol/totalVol)*100).toFixed(1) + '% · ' + f.packedItems.length + '件'; div.addEventListener('click', () => { if (onFurnaceClick) onFurnaceClick(idx); }); body.appendChild(div); });
    if (globalUnpackedItems.length > 0) { let summary = {}; globalUnpackedItems.forEach(u => { summary[u.name] = (summary[u.name] || 0) + 1; }); unpackedDiv.style.display = 'block'; unpackedDiv.innerHTML = '<strong>⚠️ ' + globalUnpackedItems.length + ' 件无法装炉：</strong> ' + Object.entries(summary).map(([k,v]) => k + '×' + v).join(' · '); } else { unpackedDiv.style.display = 'none'; }
}

export function showCapacityFeedback(type, message) { const existing = document.getElementById('capacity-feedback'); if (existing) existing.remove(); const banner = document.createElement('div'); banner.id = 'capacity-feedback'; const bgColor = type === 'success' ? 'rgba(31,122,58,0.9)' : 'rgba(179,36,36,0.9)'; const borderColor = type === 'success' ? '#10b981' : '#ff4444'; banner.style.cssText = 'position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 999; max-width: 800px; width: fit-content; background: ' + bgColor + '; border: 2px solid ' + borderColor + '; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; text-align: center; line-height: 1.6; box-shadow: 0 4px 20px rgba(0,0,0,0.5); transition: opacity 0.5s ease; opacity: 1;'; banner.textContent = message; document.body.appendChild(banner); setTimeout(() => { const el = document.getElementById('capacity-feedback'); if (el) { el.style.opacity = '0'; setTimeout(() => { if (el.parentNode) el.remove(); }, 500); } }, 5000); }

// ==================== RULES MODAL (V2.0) ====================

export function openRulesModal() {
    document.getElementById('rules-modal-overlay').style.display = 'flex';
    document.getElementById('rule-gravity').checked = placementRules.gravity;
    document.getElementById('rule-dense').checked = placementRules.dense;
    document.getElementById('rule-same-material').checked = placementRules.sameMaterial;
    document.getElementById('rule-same-process').checked = placementRules.sameProcess;
    document.getElementById('rule-min-spacing').value = placementRules.minSpacing;
    document.getElementById('rule-wall-spacing').value = placementRules.wallSpacing;
    document.getElementById('rule-rotate').checked = placementRules.rotate;
    document.getElementById('rule-weight-margin').value = placementRules.weightMargin;
    document.getElementById('rule-balance').checked = placementRules.balance;
    document.getElementById('rule-sort-strategy').value = placementRules.sortStrategy;
    document.getElementById('rule-shelf-layered').checked = placementRules.useShelfLayered;
    document.getElementById('rule-shelf-height').value = placementRules.shelfHeight || 100;
    document.getElementById('rule-shelf-thickness').value = placementRules.shelfThickness || 20;
    document.getElementById('rule-posture-optimization').checked = placementRules.allowPostureOptimization !== false;
    document.getElementById('rule-center-of-gravity').checked = placementRules.centerOfGravity || false;
}

export function saveRulesModal() {
    setPlacementRules({
        gravity: document.getElementById('rule-gravity').checked,
        dense: document.getElementById('rule-dense').checked,
        sameMaterial: document.getElementById('rule-same-material').checked,
        sameProcess: document.getElementById('rule-same-process').checked,
        minSpacing: parseFloat(document.getElementById('rule-min-spacing').value) || 5,
        wallSpacing: parseFloat(document.getElementById('rule-wall-spacing').value) || 30,
        rotate: document.getElementById('rule-rotate').checked,
        weightMargin: parseFloat(document.getElementById('rule-weight-margin').value) || 10,
        balance: document.getElementById('rule-balance').checked,
        sortStrategy: document.getElementById('rule-sort-strategy').value,
        useShelfLayered: document.getElementById('rule-shelf-layered').checked,
        shelfHeight: parseFloat(document.getElementById('rule-shelf-height').value) || 100,
        shelfThickness: parseFloat(document.getElementById('rule-shelf-thickness').value) || 20,
        allowPostureOptimization: document.getElementById('rule-posture-optimization').checked,
        centerOfGravity: document.getElementById('rule-center-of-gravity').checked
    });
    document.getElementById('global-spacing').value = placementRules.minSpacing;
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
    for (let i = 0; i < Math.min(5, rows.length); i++) { if (rows[i].some(c => String(c).includes('名称'))) { headerRow = i; break; } }
    const headers = rows[headerRow].map(h => String(h).trim());
    const getCol = (keywords) => { for (let kw of keywords) { const idx = headers.findIndex(h => h.includes(kw)); if (idx >= 0) return idx; } return -1; };
    const colName = getCol(['名称']); const colL = getCol(['长度', 'L']); const colW = getCol(['宽度', 'W']); const colH = getCol(['高度', 'H']); const colD = getCol(['直径', 'D']); const colCount = getCol(['数量']); const colWeight = getCol(['总重', '重量']); const colMaterial = getCol(['材质']); const colHardness = getCol(['硬度']); const colProcess = getCol(['工艺']); const colDate = getCol(['日期', '下单']); const colRemark = getCol(['备注']);
    const results = [];
    for (let i = headerRow + 1; i < rows.length; i++) { const row = rows[i]; const name = String(row[colName] || '').trim(); if (!name) continue; const L = parseFloat(row[colL]) || 0; const W = parseFloat(row[colW]) || 0; const H = parseFloat(row[colH]) || 0; const D = parseFloat(row[colD]) || 0; const count = parseInt(row[colCount]) || 1; const weight = parseFloat(row[colWeight]) || 0; const material = String(row[colMaterial] || '').trim(); const hardness = String(row[colHardness] || '').trim(); const process = String(row[colProcess] || '').trim(); const date = String(row[colDate] || '').trim(); const remark = String(row[colRemark] || '').trim(); let shape, dim1, dim2, dim3; const hasDiam = D > 0; const hasCuboid = L > 0 && W > 0; if (hasDiam && H > 0) { shape = 'cylinder'; dim1 = D; dim2 = D; dim3 = H; } else if (hasCuboid) { shape = 'cuboid'; dim1 = L; dim2 = W; dim3 = H || Math.min(L, W); } else if (D > 0) { shape = 'cylinder'; dim1 = D; dim2 = D; dim3 = H || D; } else { shape = 'cuboid'; dim1 = L || 50; dim2 = W || 50; dim3 = H || 50; } const valid = dim1 > 0 && dim3 > 0; results.push({ name, shape, dim1, dim2, dim3, count, weight, material, hardness, process, orderDate: date, deliveryDate: '', remark, valid }); }
    return results;
}

export function showImportPreview(data) { setImportPreviewData(data); const content = document.getElementById('import-preview-content'); let html = '<table class="import-table"><thead><tr><th>名称</th><th>形态</th><th>尺寸</th><th>数量</th><th>总重(kg)</th><th>材质</th><th>工艺</th><th>状态</th></tr></thead><tbody>'; data.forEach(d => { const dimStr = d.shape === 'cylinder' ? '⌀' + d.dim1 + '×H' + d.dim3 : d.dim1 + '×' + d.dim2 + '×' + d.dim3; const cls = d.valid ? '' : ' class="error"'; html += '<tr' + cls + '><td>' + d.name + '</td><td>' + (d.shape==='cylinder'?'圆柱':'立方') + '</td><td>' + dimStr + 'mm</td><td>' + d.count + '</td><td>' + d.weight + '</td><td>' + d.material + '</td><td>' + d.process + '</td><td>' + (d.valid?'✅':'⚠️ 尺寸不足') + '</td></tr>'; }); html += '</tbody></table>'; content.innerHTML = html; document.getElementById('import-preview-overlay').style.display = 'flex'; }

export function applyImportData(replace) { if (replace) { document.querySelectorAll('.material-card').forEach(c => c.remove()); usedColors.clear(); } importPreviewData.filter(d => d.valid).forEach(d => { const color = generateUniqueColor(usedColors); createMaterialCard(d.name, d.shape, d.count, d.dim1, d.dim2, d.dim3, d.weight, color, { material: d.material, hardness: d.hardness, process: d.process, orderDate: d.orderDate, deliveryDate: d.deliveryDate, remark: d.remark }); }); updateTopSummary(); document.getElementById('import-preview-overlay').style.display = 'none'; }

// ==================== JSON IMPORT (MASTER) ====================

export function openJsonImportModal() { document.getElementById('ji-json-textarea').value = ''; document.getElementById('ji-error-msg').textContent = ''; document.getElementById('ji-error-msg').classList.remove('visible'); document.getElementById('ji-preview-section').style.display = 'none'; document.getElementById('ji-preview-box').innerHTML = ''; document.getElementById('btn-ji-import').disabled = true; document.getElementById('json-import-overlay').style.display = 'flex'; }

export function parseJsonPlan(jsonStr) { try { const data = JSON.parse(jsonStr); if (!data.title) throw new Error('缺少 title 字段'); if (!data.furnace) throw new Error('缺少 furnace 字段'); if (!data.materials || !Array.isArray(data.materials)) throw new Error('缺少 materials 数组'); if (data.materials.length === 0) throw new Error('materials 数组不能为空'); const f = data.furnace; if (!f.name) throw new Error('furnace.name 不能为空'); if (!f.width || !f.height || !f.depth) throw new Error('furnace 缺少尺寸字段'); data.materials.forEach((m, i) => { if (!m.name) throw new Error('materials[' + i + '] 缺少 name'); if (!m.shape) throw new Error('materials[' + i + '] 缺少 shape'); if (!m.dim1 || !m.dim3) throw new Error('materials[' + i + '] 缺少尺寸字段'); }); return { ok: true, data }; } catch(e) { return { ok: false, error: e.message }; } }

export function renderJsonPreview(data) { const f = data.furnace; const approver = data.approver || '未指定'; let html = '<div class="ji-preview-row"><span class="ji-preview-tag">📋 ' + data.title + '</span><span class="ji-preview-tag">🏭 ' + f.name + ' (' + f.width + '×' + f.height + '×' + f.depth + 'mm)</span><span class="ji-preview-tag">⚖ 承重 ' + (f.maxWeight || '未知') + 'kg</span></div><div class="ji-preview-row" style="margin-top:6px;"><span class="ji-preview-tag">📅 ' + (data.date || '未知日期') + '</span><span class="ji-preview-tag">👤 操作员: ' + (data.operator || '未知') + '</span><span class="ji-preview-tag">✅ 审批人: ' + approver + '</span><span class="ji-preview-tag">📦 ' + data.materials.length + ' 种物料</span></div><div style="margin-top:10px;font-size:10px;color:#666;">物料列表：</div><div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">'; data.materials.forEach(m => { const shapeLabel = m.shape === 'cylinder' ? '圆柱' : '立方'; const dimLabel = m.shape === 'cylinder' ? '⌀' + m.dim1 + '×H' + m.dim3 : m.dim1 + '×' + (m.dim2||'?') + '×' + m.dim3; html += '<span style="padding:2px 8px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);border-radius:10px;font-size:10px;color:#c4b5fd;">' + m.name + ' (' + shapeLabel + ' ' + dimLabel + 'mm ×' + (m.count||1) + '件)</span>'; }); html += '</div>'; document.getElementById('ji-preview-box').innerHTML = html; document.getElementById('ji-preview-section').style.display = 'block'; }

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