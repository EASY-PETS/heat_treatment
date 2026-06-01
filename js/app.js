/**
 * app.js - Application Startup and Module Coordination
 *
 * Purpose:
 *   Initializes the system, binds event listeners, and coordinates all modules.
 *   No business logic here — only wiring and orchestration.
 *
 * Dependencies:
 *   - THREE.js (loaded via importmap)
 *   - state.js
 *   - three-scene.js
 *   - ui.js
 *   - furnace-engine.js
 *   - pdf-export.js
 *
 * Future Extension:
 *   - Route-based navigation (for future pages: furnace management, material management, etc.)
 *   - Lazy-loading of modules
 *   - Error boundary / global error handling
 */

import {
    // State readers
    isAnimating, animPaused, animStopped,
    globalFurnacesResult, globalUnpackedItems,
    currentFurnaceIndex,
    selectedFurnaceCardId,
    masterRenderer,
    itemsGroup,
    usedColors,
    // State setters
    setAnimPaused, setAnimStopped,
    setCurrentFurnaceIndex,
    setFdpCollapsed, setMdpCollapsed,
    setGlobalFurnacesResult, setGlobalUnpackedItems, setGlobalSpacingValue
} from './state.js';

import {
    // Three.js init
    initThree,
    initMasterThree,
    // Rendering
    renderSingleFurnace,
    // Highlight / transparency
    resetAllItemOpacityToOpaque,
    getSelectedMaterialName,
    // Animation
    playLoadingAnimation,
    // Master view
    renderMasterPlan,
    // Helper
    findResultIndexByFid,
    generateUniqueColor
} from './three-scene.js';

import {
    // Furnace cards
    createFurnaceCard,
    selectFurnaceCard,
    showFurnaceDetail,
    deleteFurnaceCard,
    sortFurnaceCards,
    getFurnaceDataFromCard,
    // Material cards
    createMaterialCard,
    selectMaterialCard,
    showMaterialDetail,
    deleteMaterialCard,
    getMaterialDataFromCard,
    // UI updates
    updateTopSummary,
    updateFurnaceNav,
    updateLeftPanelActiveForIndex,
    updateCenterStats,
    showCapacityFeedback,
    // Rules modal
    openRulesModal,
    saveRulesModal,
    // Master view
    initMasterView,
    // Excel import
    parseExcelData,
    showImportPreview,
    applyImportData,
    // JSON import
    openJsonImportModal,
    parseJsonPlan,
    renderJsonPreview,
    importJsonPlanToMaster
} from './ui.js';

import { executePacking } from './furnace-engine.js';

import {
    showPdfSelectModal,
    exportSingleFurnacePDF
} from './pdf-export.js';

// ==================== MAIN EXECUTE (Plan Generation) ====================

/**
 * Generate a loading plan and render to 3D scene + UI.
 * Collects data from DOM cards, runs packing algorithm, updates state, renders scene.
 *
 * Future Extension:
 *   - Progress bar for long-running algorithms
 *   - Web Worker for AI optimization
 */
function executeAndRender() {
    if (isAnimating) return;

    // Reset transparency before generating new plan
    resetAllItemOpacityToOpaque();

    let furnacePoolInput = [];
    document.querySelectorAll('.furnace-card').forEach(card => {
        const d = getFurnaceDataFromCard(card);
        furnacePoolInput.push({
            name: d.name, count: d.count, width: d.width, height: d.height,
            depth: d.depth, maxWeight: d.maxWeight, actualSpacing: d.actualSpacing
        });
    });

    let itemsInput = [];
    document.querySelectorAll('.material-card').forEach(card => {
        const d = getMaterialDataFromCard(card);
        itemsInput.push({
            name: d.name, shape: d.shape, count: d.count,
            dim1: d.dim1, dim2: d.dim2, dim3: d.dim3,
            weight: d.totalWeight, color: d.color
        });
    });

    const spacing = parseFloat(document.getElementById('global-spacing').value || 0);
    setGlobalSpacingValue(spacing);

    const result = executePacking(furnacePoolInput, itemsInput, spacing);
    setGlobalFurnacesResult(result.completedFurnaces);
    setGlobalUnpackedItems(result.unpackedItems);

    document.getElementById('btn-export-pdf').style.display = 'inline-block';
    document.getElementById('btn-animate').style.display = 'inline-block';

    // Start from currently selected furnace if possible
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

    // Capacity feedback
    if (globalUnpackedItems.length === 0) {
        const totalItemsIn = result.completedFurnaces.reduce((s, f) => s + f.packedItems.length, 0);
        const totalFurnaces = result.completedFurnaces.length;
        const totalFurnaceCapacity = document.querySelectorAll('.furnace-card').length;
        showCapacityFeedback('success',
            `✅ 炉膛容量充足：${totalItemsIn} 件物料已全部装炉，共使用 ${totalFurnaces} 个炉次（共计 ${totalFurnaceCapacity} 台炉膛可供使用）`
        );
    } else {
        let summary = {};
        globalUnpackedItems.forEach(u => { summary[u.name] = (summary[u.name] || 0) + 1; });
        const unpackedList = Object.entries(summary).map(([k, v]) => `${k}×${v}`).join('、');
        const totalFurnaces = result.completedFurnaces.length;
        const totalFurnaceCapacity = document.querySelectorAll('.furnace-card').length;
        const reason = '因空间/承重限制，部分物料无法装入';

        let suggestion = '';
        if (totalFurnaces < totalFurnaceCapacity) {
            suggestion = '建议增加炉膛台数（当前仍有空闲炉膛未被使用，但算法判定剩余物料在当前炉膛内无法装入）。可尝试调整安全间距或搁板层高参数。';
        } else if (totalFurnaces >= totalFurnaceCapacity) {
            suggestion = '建议增加炉膛台数或更换更大尺寸的炉膛，也可尝试调整安全间距/搁板层高参数以提升利用率。';
        }

        showCapacityFeedback('danger',
            `⚠️ 炉膛容量不足：${globalUnpackedItems.length} 件物料未能装炉（${unpackedList}）。`
            + ` 共使用 ${totalFurnaces} 个炉次（${totalFurnaceCapacity} 台炉膛可供使用）。`
            + ` ${reason}。${suggestion}`
        );
    }
}

// ==================== FURNACE NAVIGATION ====================

/**
 * Navigate furnace by direction (-1 for prev, +1 for next).
 */
function navigateFurnace(direction) {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;

    resetAllItemOpacityToOpaque();

    const newIndex = (currentFurnaceIndex + direction + globalFurnacesResult.length) % globalFurnacesResult.length;
    setCurrentFurnaceIndex(newIndex);

    const filterName = getSelectedMaterialName();
    renderSingleFurnace(newIndex, filterName);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(newIndex);
    updateCenterStats(onCenterFurnaceClick);
}

/**
 * Callback when a center stats furnace item is clicked.
 */
function onCenterFurnaceClick(idx) {
    setCurrentFurnaceIndex(idx);
    const filterName = getSelectedMaterialName();
    renderSingleFurnace(idx, filterName);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(idx);
    updateCenterStats(onCenterFurnaceClick);
}

// ==================== MASTER VIEW ====================

function showMasterView() {
    const masterView = document.getElementById('master-view');
    masterView.classList.add('active');
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

// ==================== INITIALIZATION ====================

/**
 * Initialize the entire application.
 * Sets up Three.js, creates default cards, binds all event listeners.
 */
function init() {
    // 1. Initialize Three.js scene
    initThree();

    // 2. Create default furnace cards
    createFurnaceCard('标准炉膛 600×600×900', 900, 600, 600, 500, 1, 0, null);
    createFurnaceCard('大型炉膛 900×900×1200', 1200, 900, 900, 1000, 1, 0, null);

    updateTopSummary();

    // 3. Bind event listeners

    // === Top bar buttons ===
    document.getElementById('btn-master').addEventListener('click', showMasterView);
    document.getElementById('btn-master-back').addEventListener('click', hideMasterView);
    document.getElementById('btn-master-import-json').addEventListener('click', openJsonImportModal);

    document.getElementById('btn-rules').addEventListener('click', openRulesModal);
    document.getElementById('btn-rules-cancel').addEventListener('click', () => {
        document.getElementById('rules-modal-overlay').style.display = 'none';
    });
    document.getElementById('rules-modal-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('rules-modal-overlay')) {
            document.getElementById('rules-modal-overlay').style.display = 'none';
        }
    });
    document.getElementById('btn-rules-save').addEventListener('click', saveRulesModal);

    document.getElementById('btn-generate-plan').addEventListener('click', executeAndRender);
    document.getElementById('btn-animate').addEventListener('click', playLoadingAnimation);
    document.getElementById('btn-export-pdf').addEventListener('click', showPdfSelectModal);

    // === Furnace panel ===
    document.getElementById('btn-add-furnace').addEventListener('click', () => {
        createFurnaceCard('自定义炉膛', 400, 200, 200, 15000, 1, 0, null);
        updateTopSummary();
    });

    // Sort buttons
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => sortFurnaceCards(btn.getAttribute('data-field')));
    });

    // Detail panel toggle
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

    // === Delete handlers ===
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

    // === Double-click edit ===
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

    // === Material panel ===
    document.getElementById('btn-add-item').addEventListener('click', () => {
        const color = generateUniqueColor(usedColors);
        createMaterialCard('新工件批次', 'cuboid', 10, 50, 50, 60, 0, color);
        updateTopSummary();
    });

    // === Furnace navigation (prev/next) ===
    document.getElementById('nav-prev').addEventListener('click', () => navigateFurnace(-1));
    document.getElementById('nav-next').addEventListener('click', () => navigateFurnace(1));

    // === Spacing change ===
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

    // === Animation controls ===
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

    // === Excel import ===
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
                if (parsed.length === 0) { alert('未找到有效数据，请检查文件格式'); return; }
                showImportPreview(parsed);
            } catch(err) { alert('文件解析失败：' + err.message); }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    });

    document.getElementById('btn-import-cancel').addEventListener('click', () => {
        document.getElementById('import-preview-overlay').style.display = 'none';
    });
    document.getElementById('btn-import-replace').addEventListener('click', () => applyImportData(true));
    document.getElementById('btn-import-append').addEventListener('click', () => applyImportData(false));

    // === PDF export modal ===
    document.getElementById('btn-pdf-cancel').addEventListener('click', () => {
        document.getElementById('pdf-select-overlay').style.display = 'none';
    });
    document.getElementById('pdf-select-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('pdf-select-overlay')) {
            document.getElementById('pdf-select-overlay').style.display = 'none';
        }
    });
    document.getElementById('btn-pdf-confirm').addEventListener('click', () => {
        const selected = document.querySelector('input[name="pdf-furnace"]:checked');
        if (!selected) return;
        const options = {
            exportJson: document.getElementById('pdf-opt-json').checked,
            worklist: document.getElementById('pdf-opt-worklist').checked
        };
        document.getElementById('pdf-select-overlay').style.display = 'none';
        exportSingleFurnacePDF(parseInt(selected.value), options);
    });

    // === JSON import modal ===
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
        // Store parsed plan for import
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
        if (e.target === document.getElementById('json-import-overlay')) {
            document.getElementById('json-import-overlay').style.display = 'none';
        }
    });

    // JSON drop zone
    const jiDropZone = document.getElementById('ji-drop-zone');
    jiDropZone.addEventListener('click', () => document.getElementById('json-file-input').click());
    jiDropZone.addEventListener('dragover', (e) => { e.preventDefault(); jiDropZone.classList.add('drag-over'); });
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
}

// ==================== LAUNCH ====================
init();