/**
 * app.js - Application Startup and Module Coordination (V2.3)
 *
 * V2.3 Updates:
 *   - 炉膛独立料框类型配置：basketType 从 furnace card 读取并传入 packing engine
 *   - 炉膛沿X轴排列：计算 xOffset 用于 3D 渲染
 *   - 容量不足详细提示：显示缺少数值 (kg)
 *   - 移除全局料框类型选择器事件（改为炉膛详情面板管理）
 *
 * V2.2 Updates:
 *   - 默认炉膛：标准台车炉 600×600×900mm, 500kg
 *   - 料框类型选择器事件处理
 *   - 3D显示设置 — 网格/标尺/坐标轴独立开关
 *   - 装料大师页面 — 统一料框类型和显示设置
 */
import {
    isAnimating, animPaused, animStopped,
    globalFurnacesResult, globalUnpackedItems, aggregationStats,
    currentFurnaceIndex, selectedFurnaceCardId,
    masterRenderer, itemsGroup, usedColors,
    currentBasketType, displaySettings,
    setAnimPaused, setAnimStopped, setCurrentFurnaceIndex,
    setFdpCollapsed, setMdpCollapsed,
    setGlobalFurnacesResult, setGlobalUnpackedItems, setGlobalSpacingValue,
    setCurrentBasketType, setDisplaySettings
} from './state.js';
import {
    initThree, initMasterThree, renderSingleFurnace,
    getSelectedMaterialName,
    playLoadingAnimation, renderMasterPlan,
    findResultIndexByFid, generateUniqueColor,
    refreshAllDisplayVisibility
} from './three-scene.js';
import {
    createFurnaceCard, selectFurnaceCard, showFurnaceDetail,
    deleteFurnaceCard, sortFurnaceCards, getFurnaceDataFromCard,
    createMaterialCard, selectMaterialCard, showMaterialDetail,
    deleteMaterialCard, getMaterialDataFromCard,
    updateTopSummary, updateFurnaceNav,
    updateLeftPanelActiveForIndex, updateCenterStats,
    showCapacityFeedback, openRulesModal, saveRulesModal,
    initMasterView, parseExcelData, showImportPreview, applyImportData,
    openJsonImportModal, parseJsonPlan, renderJsonPreview, importJsonPlanToMaster
} from './ui.js';
import { executePacking } from './furnace-engine.js';
import { showPdfSelectModal, exportSingleFurnacePDF } from './pdf-export.js';

/**
 * V2.3: executeAndRender — 核心入口函数
 *
 * 流程：
 *   1. 读取炉膛卡片（含独立 basketType）+ 物料卡片
 *   2. 传入 executePacking 执行装炉算法（禁止自动生成炉膛）
 *   3. 计算每台炉膛的 xOffset（沿X轴排列）
 *   4. 渲染 3D 场景
 *   5. 容量不足时显示详细缺少数值
 */
function executeAndRender() {
    if (isAnimating) return;

    let furnacePoolInput = [];
    document.querySelectorAll('.furnace-card').forEach(card => {
        const d = getFurnaceDataFromCard(card);
        /**
         * V2.3: 传递 basketType 到 packing engine
         * 每个炉膛独立存储自己的料框类型（从 data-basket-type 读取）
         */
        furnacePoolInput.push({
            name: d.name, count: d.count,
            width: d.width, height: d.height, depth: d.depth,
            maxWeight: d.maxWeight, actualSpacing: d.actualSpacing,
            basketType: d.basketType || 'grid'
        });
    });
    let itemsInput = [];
    document.querySelectorAll('.material-card').forEach(card => {
        const d = getMaterialDataFromCard(card);
        itemsInput.push({
            name: d.name, shape: d.shape, count: d.count,
            dim1: d.dim1, dim2: d.dim2, dim3: d.dim3,
            weight: d.totalWeight, color: d.color,
            material: d.material || '', process: d.process || ''
        });
    });

    const spacing = parseFloat(document.getElementById('global-spacing').value || 0);
    setGlobalSpacingValue(spacing);

    /**
     * V2.3: 执行装炉算法
     * executePacking 内部仅使用用户已配置的炉膛实例
     * 禁止自动生成/复制/扩容炉膛
     */
    const result = executePacking(furnacePoolInput, itemsInput, spacing);

    /**
     * V2.3: 计算每台炉膛的 xOffset（沿X轴排列）
     *
     * 第1台炉 X=0（原点附近）
     * 第2台炉 X=炉宽1 + 200mm间距
     * 第3台炉 X=炉宽1 + 炉宽2 + 400mm间距
     *
     * 保持炉膛在 Z 轴居中对齐
     */
    const furnaceGap = 200; // 炉膛间距 200mm
    let cumulativeX = 0;
    result.completedFurnaces.forEach((f, idx) => {
        f.xOffset = cumulativeX;
        cumulativeX += f.w + furnaceGap;
    });

    setGlobalFurnacesResult(result.completedFurnaces);
    setGlobalUnpackedItems(result.unpackedItems);

    document.getElementById('btn-export-pdf').style.display = 'inline-block';
    document.getElementById('btn-animate').style.display = 'inline-block';

    let startIndex = 0;
    if (selectedFurnaceCardId) {
        const card = document.getElementById(selectedFurnaceCardId);
        if (card) {
            const fid = parseInt(card.getAttribute('data-fid'));
            const idx = findResultIndexByFid(fid);
            if (idx >= 0) startIndex = idx;
        }
    }
    setCurrentFurnaceIndex(startIndex);

    if (result.completedFurnaces.length > 0) {
        renderSingleFurnace(startIndex);
        updateFurnaceNav();
        updateLeftPanelActiveForIndex(startIndex);
    } else {
        document.getElementById('empty-state').style.display = 'block';
        document.getElementById('furnace-nav').style.display = 'none';
    }
    updateCenterStats(onCenterFurnaceClick);
    updateTopSummary();

    const agg = aggregationStats;
    let aggInfo = '';
    if (agg && (agg.materialRate !== null || agg.processRate !== null)) {
        aggInfo = ' | ';
        if (agg.materialRate !== null) aggInfo += '材质聚集率: ' + agg.materialRate + '% ';
        if (agg.processRate !== null) aggInfo += '工艺聚集率: ' + agg.processRate + '%';
    }

    if (globalUnpackedItems.length === 0) {
        const totalItemsIn = result.completedFurnaces.reduce((s, f) => s + f.packedItems.length, 0);
        showCapacityFeedback('success',
            '✅ 料框容量充足：' + totalItemsIn + ' 件物料已全部装框，共使用 ' +
            result.completedFurnaces.length + ' 个炉次' + aggInfo);
    } else {
        let summary = {};
        globalUnpackedItems.forEach(u => { summary[u.name] = (summary[u.name] || 0) + 1; });
        const uList = Object.entries(summary).map(([k, v]) => k + '×' + v).join('、');

        /**
         * V2.3: 容量不足时计算缺少数值
         * 汇总未装炉物料的重量作为 "缺少容量"
         */
        const missingWeight = globalUnpackedItems.reduce((s, u) => s + (u.weight || 0), 0);
        const missingInfo = missingWeight > 0 ? ('缺少容量: ' + missingWeight.toFixed(1) + 'kg') : '';

        showCapacityFeedback('danger',
            '⚠️ 装炉失败：当前可用炉膛容量不足\n' +
            globalUnpackedItems.length + ' 件物料未能装炉（' + uList + '）\n' +
            (missingInfo ? missingInfo + '\n' : '') +
            '建议：增加炉膛台数 / 提高承重上限 / 减少物料数量' +
            aggInfo);
    }
}

function navigateFurnace(direction) {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;
    const newIndex = (currentFurnaceIndex + direction + globalFurnacesResult.length) %
        globalFurnacesResult.length;
    setCurrentFurnaceIndex(newIndex);
    const filterName = getSelectedMaterialName();
    renderSingleFurnace(newIndex, filterName);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(newIndex);
    updateCenterStats(onCenterFurnaceClick);
}

function onCenterFurnaceClick(idx) {
    setCurrentFurnaceIndex(idx);
    const filterName = getSelectedMaterialName();
    renderSingleFurnace(idx, filterName);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(idx);
    updateCenterStats(onCenterFurnaceClick);
}

function showMasterView() {
    document.getElementById('master-view').classList.add('active');
    document.getElementById('furnace-nav').style.display = 'none';
    document.getElementById('canvas-container').style.display = 'none';
    document.getElementById('center-stats-panel').style.display = 'none';
    document.getElementById('anim-control-bar').classList.remove('visible');
    if (!masterRenderer) {
        setTimeout(() => {
            initMasterThree();
            initMasterView(renderMasterPlan);
        }, 100);
    } else {
        initMasterView(renderMasterPlan);
    }
}

function hideMasterView() {
    document.getElementById('master-view').classList.remove('active');
    document.getElementById('canvas-container').style.display = 'block';
    if (globalFurnacesResult && globalFurnacesResult.length > 0) {
        document.getElementById('furnace-nav').style.display = 'flex';
        document.getElementById('center-stats-panel').style.display = 'block';
    }
}

function init() {
    initThree();

    /**
     * V2.2: 默认炉膛配置
     * 系统首次打开自动生成标准台车炉（小型）
     * 尺寸: 600 × 600 × 900 mm
     * 承重: 500 kg
     *
     * V2.3: 第8个参数 basketType 默认 'grid'
     *
     * createFurnaceCard(name, depth, width, height, maxWeight, count, plannedHeats, actualSpacing, basketType)
     * 参数顺序: name, depth(Z), width(X), height(Y), maxWeight, count, plannedHeats, actualSpacing, basketType
     */
    createFurnaceCard('标准料框（小型）', 900, 600, 600, 500, 1, 0, null, 'grid');
    createFurnaceCard('标准料框（大型）', 1200, 900, 900, 1000, 1, 0, null, 'grid');
    updateTopSummary();

    // ==================== EVENT LISTENERS ====================

    document.getElementById('btn-master').addEventListener('click', showMasterView);
    document.getElementById('btn-master-back').addEventListener('click', hideMasterView);
    document.getElementById('btn-master-import-json').addEventListener('click', openJsonImportModal);
    document.getElementById('btn-rules').addEventListener('click', openRulesModal);
    document.getElementById('btn-rules-cancel').addEventListener('click', () => {
        document.getElementById('rules-modal-overlay').style.display = 'none';
    });
    document.getElementById('rules-modal-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('rules-modal-overlay'))
            document.getElementById('rules-modal-overlay').style.display = 'none';
    });
    document.getElementById('btn-rules-save').addEventListener('click', saveRulesModal);
    document.getElementById('btn-generate-plan').addEventListener('click', executeAndRender);
    document.getElementById('btn-animate').addEventListener('click', playLoadingAnimation);
    document.getElementById('btn-export-pdf').addEventListener('click', showPdfSelectModal);

    /**
     * V2.3: + 增加炉膛默认使用 grid 料框类型
     * 用户可在炉膛详情面板中修改料框类型
     */
    document.getElementById('btn-add-furnace').addEventListener('click', () => {
        createFurnaceCard('自定义料框', 1200, 900, 900, 1000, 1, 0, null, 'grid');
        updateTopSummary();
    });
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => sortFurnaceCards(btn.getAttribute('data-field')));
    });
    document.getElementById('fdp-toggle-btn').addEventListener('click', () => {
        const collapsed = !document.getElementById('furnace-detail-panel').classList.contains('collapsed');
        setFdpCollapsed(collapsed);
        document.getElementById('furnace-detail-panel').classList.toggle('collapsed', collapsed);
        document.getElementById('fdp-toggle-icon').textContent = collapsed ? '▼' : '▲';
    });
    document.getElementById('mdp-toggle-btn').addEventListener('click', () => {
        const collapsed = !document.getElementById('material-detail-panel').classList.contains('collapsed');
        setMdpCollapsed(collapsed);
        document.getElementById('material-detail-panel').classList.toggle('collapsed', collapsed);
        document.getElementById('mdp-toggle-icon').textContent = collapsed ? '▼' : '▲';
    });
    document.getElementById('furnace-cards-container').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="delete-furnace"]');
        if (!btn) return;
        e.stopPropagation();
        deleteFurnaceCard(parseInt(btn.getAttribute('data-fid')));
    });
    document.getElementById('material-cards-container').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="delete-material"]');
        if (!btn) return;
        e.stopPropagation();
        deleteMaterialCard(parseInt(btn.getAttribute('data-mid')));
    });
    document.getElementById('furnace-cards-container').addEventListener('dblclick', (e) => {
        const card = e.target.closest('.furnace-card');
        if (!card) return;
        selectFurnaceCard(card.id);
        showFurnaceDetail(card.id);
    });
    document.getElementById('material-cards-container').addEventListener('dblclick', (e) => {
        const card = e.target.closest('.material-card');
        if (!card) return;
        selectMaterialCard(card.id);
        showMaterialDetail(card.id);
    });
    document.getElementById('btn-add-item').addEventListener('click', () => {
        const color = generateUniqueColor(usedColors);
        createMaterialCard('新工件批次', 'cuboid', 10, 50, 50, 60, 0, color);
        updateTopSummary();
    });
    document.getElementById('nav-prev').addEventListener('click', () => navigateFurnace(-1));
    document.getElementById('nav-next').addEventListener('click', () => navigateFurnace(1));
    document.getElementById('global-spacing').addEventListener('change', () => {
        setGlobalFurnacesResult(null);
        setGlobalUnpackedItems([]);
        setCurrentFurnaceIndex(0);
        document.getElementById('btn-export-pdf').style.display = 'none';
        document.getElementById('btn-animate').style.display = 'none';
        document.getElementById('furnace-nav').style.display = 'none';
        document.getElementById('empty-state').style.display = 'block';
        document.getElementById('center-stats-panel').style.display = 'none';
        if (itemsGroup) {
            while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
        }
    });
    document.getElementById('btn-anim-pause').addEventListener('click', () => {
        if (!isAnimating) return;
        const paused = !animPaused;
        setAnimPaused(paused);
        document.getElementById('btn-anim-pause').textContent = paused ? '▶ 继续' : '⏸ 暂停';
        document.getElementById('btn-anim-pause').style.background = paused ? '#10b981' : '#f59e0b';
        document.getElementById('btn-anim-pause').style.color = paused ? '#fff' : '#000';
    });
    document.getElementById('btn-anim-stop').addEventListener('click', () => {
        if (!isAnimating) return;
        setAnimStopped(true);
        setAnimPaused(false);
    });
    document.getElementById('btn-import-excel').addEventListener('click', () => {
        document.getElementById('excel-file-input').click();
    });
    document.getElementById('excel-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = new Uint8Array(ev.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const parsed = parseExcelData(workbook);
                if (parsed.length === 0) {
                    alert('未找到有效数据，请检查文件格式');
                    return;
                }
                showImportPreview(parsed);
            } catch (err) {
                alert('文件解析失败：' + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    });
    document.getElementById('btn-import-cancel').addEventListener('click', () => {
        document.getElementById('import-preview-overlay').style.display = 'none';
    });
    document.getElementById('btn-import-replace').addEventListener('click', () => applyImportData(true));
    document.getElementById('btn-import-append').addEventListener('click', () => applyImportData(false));
    document.getElementById('btn-pdf-cancel').addEventListener('click', () => {
        document.getElementById('pdf-select-overlay').style.display = 'none';
    });
    document.getElementById('pdf-select-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('pdf-select-overlay'))
            document.getElementById('pdf-select-overlay').style.display = 'none';
    });
    document.getElementById('btn-pdf-confirm').addEventListener('click', () => {
        const selected = document.querySelector('input[name="pdf-furnace"]:checked');
        if (!selected) return;
        document.getElementById('pdf-select-overlay').style.display = 'none';
        exportSingleFurnacePDF(parseInt(selected.value), {
            exportJson: document.getElementById('pdf-opt-json').checked,
            worklist: document.getElementById('pdf-opt-worklist').checked
        });
    });
    document.getElementById('btn-ji-parse').addEventListener('click', () => {
        const jsonStr = document.getElementById('ji-json-textarea').value.trim();
        if (!jsonStr) {
            document.getElementById('ji-error-msg').textContent = '请先输入或粘贴 JSON 内容';
            document.getElementById('ji-error-msg').classList.add('visible');
            return;
        }
        const result = parseJsonPlan(jsonStr);
        if (!result.ok) {
            document.getElementById('ji-error-msg').textContent = '❌ 解析失败：' + result.error;
            document.getElementById('ji-error-msg').classList.add('visible');
            document.getElementById('btn-ji-import').disabled = true;
            return;
        }
        document.getElementById('ji-error-msg').classList.remove('visible');
        renderJsonPreview(result.data);
        document.getElementById('btn-ji-import').disabled = false;
        window._jiParsedPlan = result.data;
    });
    document.getElementById('btn-ji-import').addEventListener('click', () => {
        if (!window._jiParsedPlan) return;
        importJsonPlanToMaster(window._jiParsedPlan, () => initMasterView(renderMasterPlan));
        document.getElementById('json-import-overlay').style.display = 'none';
    });
    document.getElementById('btn-ji-cancel').addEventListener('click', () => {
        document.getElementById('json-import-overlay').style.display = 'none';
    });
    document.getElementById('json-import-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('json-import-overlay'))
            document.getElementById('json-import-overlay').style.display = 'none';
    });
    const jiDropZone = document.getElementById('ji-drop-zone');
    jiDropZone.addEventListener('click', () => document.getElementById('json-file-input').click());
    jiDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        jiDropZone.classList.add('drag-over');
    });
    jiDropZone.addEventListener('dragleave', () => jiDropZone.classList.remove('drag-over'));
    jiDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        jiDropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) readJsonFile(file);
    });
    document.getElementById('json-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) readJsonFile(file);
        e.target.value = '';
    });
    function readJsonFile(file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('ji-json-textarea').value = ev.target.result;
            document.getElementById('btn-ji-parse').click();
        };
        reader.readAsText(file, 'utf-8');
    }

    /**
     * V2.3: 移除全局料框类型选择器事件处理
     * 料框类型现在由每个炉膛详情面板独立管理
     * 全局选择器保留但仅影响新建炉膛的默认值（通过 state.currentBasketType）
     */
    const basketTypeSelect = document.getElementById('basket-type-select');
    if (basketTypeSelect) {
        basketTypeSelect.addEventListener('change', () => {
            setCurrentBasketType(basketTypeSelect.value);
            /**
             * V2.3: 仅更新新建炉膛的默认料框类型，不影响已有炉膛
             * 不再触发 3D 场景刷新（由每个炉膛独立管理）
             */
        });
    }

    // ==================== V2.2: 3D显示设置 ====================
    const dsGrid = document.getElementById('ds-show-grid');
    const dsAxes = document.getElementById('ds-show-axes');
    const dsRulers = document.getElementById('ds-show-rulers');

    function applyDisplaySettings() {
        setDisplaySettings({
            showGrid: dsGrid.checked,
            showAxes: dsAxes.checked,
            showRulers: dsRulers.checked
        });
        refreshAllDisplayVisibility();
    }

    if (dsGrid) dsGrid.addEventListener('change', applyDisplaySettings);
    if (dsAxes) dsAxes.addEventListener('change', applyDisplaySettings);
    if (dsRulers) dsRulers.addEventListener('change', applyDisplaySettings);
}

init();