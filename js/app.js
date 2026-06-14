/**
 * app.js - Application Startup and Module Coordination (V2.7)
 *
 * V2.7 Updates:
 *   - Task 1: 多炉膛原点居中 — 移除 xOffset 计算，所有炉膛在原点渲染
 *   - Task 2: 爆炸图按钮 + 施工清单按钮事件绑定
 *   - Task 3: 动画性能优化（阴影降级由 three-scene.js 内部处理）
 *
 * V2.3 Updates:
 *   - 炉膛独立料框类型配置：basketType 从 furnace card 读取并传入 packing engine
 *   - 容量不足详细提示：显示缺少数值 (kg)
 */
import { createToolingModalController } from './tooling-modal.js';
const toolingModal = createToolingModalController({
    furnaceTooling,
    defaultToolingType,

    createFurnaceCard,
    selectFurnaceCard,
    updateTopSummary,

    buildFurnaceGroup,
    getFurnaceDataFromCard,

    itemsGroup,
    clearFurnaceGroups,
    furnaceGroups,
    setCurrentFurnaceIndex,

    controls,
    camera,

    hideExplodeBOMButtons,

    getSelectedFurnaceCardId: () => selectedFurnaceCardId
});
import { createWorkbenchRecordController } from './workbench-record.js';
const workbenchRecord = createWorkbenchRecordController({
    analyzeFurnaces,
    renderPlanAnalysisPanel,
    activateRightPanelTab,

    getRuntimeFurnacesFromRecord,

    setPlacementRules,
    setGlobalFurnacesResult,
    setGlobalUnpackedItems,
    setCurrentFurnaceIndex,
    setSelectedFurnaceCardId,
    setSelectedMaterialCardId,
    clearFurnaceGroups,

    createFurnaceCard,
    createMaterialCard,
    getFurnaceDataFromCard,

    getSelectedMaterialName,
    renderSingleFurnace,
    updateFurnaceNav,
    updateExplodeBOMButtons,
    renderFurnaceThumbnails,
    renderAISummaryBar,
    updateTopSummary,
    renderFilterBars,

    generateUniqueColor,
    usedColors,
    clearUsedColors,
    setFurnaceCounter,
    setMaterialCounter,
    clearMaterialFilters,
    clearProcessFilters,
    clearHardnessFilters,

    showPlanActionButtons,
    hidePlanActionButtons,
    hideExplodeBOMButtons,
    showCapacityFeedback,
    hideMasterView,
    onCenterFurnaceClick,
    clearFurnaceResults
});
import { createPlanLibraryController } from './plan-library.js';
import { analyzeFurnaces } from './plan-analysis.js';
import { renderPlanAnalysisPanel, renderCandidatePlanCards, renderLoadingSimulationPanel } from './ui.js';
import * as THREE from 'three';
import {
    isAnimating, animPaused, animStopped,
    globalFurnacesResult, globalUnpackedItems, aggregationStats,
    currentFurnaceIndex, selectedFurnaceCardId,
    itemsGroup, usedColors,
    displaySettings,
    defaultToolingType, furnaceTooling,
    setAnimPaused, setAnimStopped, setCurrentFurnaceIndex,
    setFdpCollapsed, setMdpCollapsed,
    placementRules,
    setPlacementRules,
    setGlobalFurnacesResult, setGlobalUnpackedItems, setGlobalSpacingValue,
    setGlobalPredictions,
    setDisplaySettings,
    clearFurnaceGroups,
    furnaceGroups, controls, camera,
    setFurnaceCounter, setMaterialCounter,
    setSelectedFurnaceCardId, setSelectedMaterialCardId,
    clearMaterialFilters, clearProcessFilters, clearHardnessFilters,
    clearUsedColors
} from './state.js';
import {
    initThree, renderSingleFurnace,
    buildFurnaceGroup,
    getSelectedMaterialName,
    playLayeredLoadingAnimation,
    findResultIndexByFid, generateUniqueColor,
    refreshAllDisplayVisibility,
    toggleExplodedView, showLayeredBOM,
    focusLayer,
    focusLayersUpTo,
    setTightFitCamera,
    showAILoadingLoading, hideAILoadingLoading
} from './three-scene.js';
import {
    createFurnaceCard, selectFurnaceCard, showFurnaceDetail,
    deleteFurnaceCard, sortFurnaceCards, getFurnaceDataFromCard,
    createMaterialCard, selectMaterialCard, showMaterialDetail,
    deleteMaterialCard, getMaterialDataFromCard,
    updateTopSummary, updateFurnaceNav,
    updateLeftPanelActiveForIndex, renderAISummaryBar,
    showCapacityFeedback, openRulesModal, saveRulesModal,
    renderFurnaceThumbnails, renderFilterBars,
    parseExcelData, showImportPreview, applyImportData,
    openJsonImportModal, parseJsonPlan, renderJsonPreview, 
} from './ui.js';
import { executePacking } from './furnace-engine.js';
import { showPdfSelectModal, exportSingleFurnacePDF, getSelectedPdfFurnaceIds } from './pdf-export.js';
import { generateSixPagePDF } from './pdf-six-page.js';
import {
    buildCurrentDigitalTwinRecord,
    downloadJsonFile,
    parseDigitalTwinRecord,
    getRuntimeFurnacesFromRecord,
    isDigitalTwinRecord
} from './plan-record.js';

let candidatePlans = [];
let currentCandidatePlanIndex = 0;
let simulationViewMode = 'cumulative';

const STRATEGY_LABELS = {
    balanced: '均衡方案',
    spaceUtil: '空间优先',
    thermalBalance: '热场均衡',
    surfaceUniform: '表面均匀'
};

function clonePlain(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function generateCandidatePlans(furnacePoolInput, itemsInput, spacing) {
    const currentStrategy = placementRules.strategy || 'balanced';

    const strategyListRaw = [
        {
            key: currentStrategy,
            label: '当前策略：' + (STRATEGY_LABELS[currentStrategy] || currentStrategy)
        },
        { key: 'balanced', label: '均衡方案' },
        { key: 'spaceUtil', label: '空间优先' },
        { key: 'thermalBalance', label: '热场均衡' },
        { key: 'surfaceUniform', label: '表面均匀' }
    ];

    // 去重：如果当前策略本来就是 balanced / spaceUtil 等，不重复跑
    const seen = new Set();
    const strategyList = strategyListRaw.filter(s => {
        if (seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
    });

    const plans = strategyList.map(strategyInfo => {
        const result = executePacking(
            clonePlain(furnacePoolInput),
            clonePlain(itemsInput),
            spacing,
            strategyInfo.key
        );

        const analysis = analyzeFurnaces(
            result.completedFurnaces || [],
            result.unpackedItems || [],
            result.predictions || []
        );

        return {
            strategy: strategyInfo.key,
            label: strategyInfo.label,
            result,
            analysis
        };
    });

    // 排序：能全部装入的优先，其次看综合评分
    plans.sort((a, b) => {
        const aExecutable = a.analysis.unpackedCount === 0 ? 1 : 0;
        const bExecutable = b.analysis.unpackedCount === 0 ? 1 : 0;

        if (aExecutable !== bExecutable) {
            return bExecutable - aExecutable;
        }

        return b.analysis.compositeScore - a.analysis.compositeScore;
    });

    return plans;
}

function applyCandidatePlan(index) {
    if (!candidatePlans || !candidatePlans[index]) return;

    currentCandidatePlanIndex = index;

    const plan = candidatePlans[index];
    const result = plan.result;

    setGlobalFurnacesResult(result.completedFurnaces || []);
    setGlobalUnpackedItems(result.unpackedItems || []);

    if (result.predictions) {
        setGlobalPredictions(result.predictions);
    }

    clearFurnaceGroups();
    setCurrentFurnaceIndex(0);

    window._currentPlanAnalysis = plan.analysis;

    renderPlanAnalysisPanel(plan.analysis);
    renderCandidatePlanCards(candidatePlans, index, applyCandidatePlan);
    renderLoadingSimulationPanel();
    updateSimulationModeButtons();
    activateRightPanelTab('analysis');

    if (result.completedFurnaces && result.completedFurnaces.length > 0) {
        document.getElementById("empty-state").style.display = "none";

        renderSingleFurnace(0, getSelectedMaterialName());
        updateFurnaceNav();
        updateLeftPanelActiveForIndex(0);
        updateExplodeBOMButtons();

        renderFurnaceThumbnails(
            result.completedFurnaces,
            0,
            handleThumbFurnaceClick
        );

        showPlanActionButtons();
    } else {
        document.getElementById("empty-state").style.display = "block";
        document.getElementById("furnace-nav").style.display = "none";
        hideExplodeBOMButtons();
        hidePlanActionButtons();
    }

    renderAISummaryBar(onCenterFurnaceClick);
    updateTopSummary();
    updateWorkbenchUiMode();
}

/**
 * V2.7: executeAndRender — 核心入口函数
 *
 * 流程：
 *   1. 读取炉膛卡片（含独立 basketType）+ 物料卡片
 *   2. 传入 executePacking 执行装炉算法
 *   3. 渲染 3D 场景（所有炉膛在原点创建，visible 切换）
 *   4. 容量不足时显示详细缺少数值
 * @returns {void}
 */
function executeAndRender() {
    if (isAnimating) return;

    let furnacePoolInput = [];
    document.querySelectorAll(".furnace-card").forEach(card => {
        const d = getFurnaceDataFromCard(card);
        // 从卡片读取工装参数
        const extrasStr = card.getAttribute('data-extras');
        const toolingParams = extrasStr ? JSON.parse(extrasStr) : {};        

        // ========== 环形工装：自动生成半径和搁板信息 ==========
        if (d.toolingType === 'ring-tooling') {
            const outerRadius = Math.min(d.width, d.depth) / 2 - 30;
            const discCount = toolingParams.ringCount || 3;
            const shelves = [];
            // 底部圆盘（Y=0）
            shelves.push({ y: 0, thickness: 5, radius: outerRadius });
            // 上方圆盘
            for (let i = 0; i < discCount; i++) {
                const discY = d.height * (i + 1) / (discCount + 1);
                shelves.push({ y: discY, thickness: 5, radius: outerRadius });
            }
            toolingParams.radialRadius = outerRadius;
            toolingParams.shelves = shelves;
            toolingParams.useInternalShelves = true;
            toolingParams.isRadialTooling = true;
        }
        // ====================================================

        furnacePoolInput.push({
            name: d.name, count: d.count,
            width: d.width, height: d.height, depth: d.depth,
            maxWeight: d.maxWeight, actualSpacing: d.actualSpacing,
            basketType: d.basketType || "grid",
            /** V4.8: 工装类型字段透传 */
            toolingType: d.toolingType || defaultToolingType,
            maxLayers: d.maxLayers || 5,
            allowedProcesses: d.allowedProcesses || "",
            placementMode: d.placementMode || "free",
            params: toolingParams   // 新增
        });
    });
    let itemsInput = [];
    document.querySelectorAll(".material-card").forEach(card => {
        // 关键：跳过被筛选隐藏的卡片
        if (card.style.display === 'none') return;
        const d = getMaterialDataFromCard(card);
        itemsInput.push({
            name: d.name,
            shape: d.shape,
            count: d.count,

            dim1: d.dim1,
            dim2: d.dim2,
            dim3: d.dim3,

            weight: d.totalWeight,
            color: d.color,

            material: d.material || "",
            process: d.process || "",
            hardness: d.hardness || "",

            customer: d.customer || "",
            itemCode: d.itemCode || "",
            showName: d.showName || "",

            orderDate: d.orderDate || "",
            deliveryDate: d.deliveryDate || "",
            remark: d.remark || "",
        });
    });

    // 全局安全间距已取消，保留 5mm 作为系统兜底值。
    // 实际装炉优先使用每个工装自己的 actualSpacing。
    const spacing = 5;
    setGlobalSpacingValue(spacing);

    /**
     * V2.7: 执行装炉算法
     * 移除 xOffset 计算 — 所有炉膛在原点渲染
     */
    candidatePlans = generateCandidatePlans(
        furnacePoolInput,
        itemsInput,
        spacing
    );

    currentCandidatePlanIndex = 0;

    const bestPlan = candidatePlans[0];
    const result = bestPlan.result;

    setGlobalFurnacesResult(result.completedFurnaces);
    setGlobalUnpackedItems(result.unpackedItems);

    // V5.0 P0: 存储预测结果供后续 UI 渲染使用
    if (result.predictions) {
        setGlobalPredictions(result.predictions);
    }

    const analysis = analyzeFurnaces(
        result.completedFurnaces || [],
        result.unpackedItems || [],
        result.predictions || []
    );

    window._currentPlanAnalysis = analysis;

    renderPlanAnalysisPanel(analysis);
    renderCandidatePlanCards(candidatePlans, currentCandidatePlanIndex, applyCandidatePlan);
    renderLoadingSimulationPanel();
    updateSimulationModeButtons();
    activateRightPanelTab('analysis');

    let startIndex = 0;
    if (selectedFurnaceCardId) {
        const card = document.getElementById(selectedFurnaceCardId);
        if (card) {
            const fid = parseInt(card.getAttribute("data-fid"));
            const idx = findResultIndexByFid(fid);
            if (idx >= 0) startIndex = idx;
        }
    }
    setCurrentFurnaceIndex(startIndex);

    // V2.7: 清理旧 furnaceGroups，确保重新构建
    clearFurnaceGroups();

    if (result.completedFurnaces.length > 0) {
        showPlanActionButtons();
        renderSingleFurnace(startIndex);
        updateFurnaceNav();
        updateLeftPanelActiveForIndex(startIndex);
        // 显示爆炸图和施工清单按钮
        updateExplodeBOMButtons();

        // 渲染底部缩略图栏
        renderFurnaceThumbnails(
            result.completedFurnaces,
            startIndex,
            handleThumbFurnaceClick
        );
    } else {
        document.getElementById("empty-state").style.display = "block";
        document.getElementById("furnace-nav").style.display = "none";
        hideExplodeBOMButtons();
        hidePlanActionButtons();
    }
    renderAISummaryBar(onCenterFurnaceClick);
    updateTopSummary();
    updateWorkbenchUiMode();

    const agg = aggregationStats;
    let aggInfo = "";
    if (agg && (agg.materialRate !== null || agg.processRate !== null)) {
        aggInfo = " | ";
        if (agg.materialRate !== null) aggInfo += "材质聚集率: " + agg.materialRate + "% ";
        if (agg.processRate !== null) aggInfo += "工艺聚集率: " + agg.processRate + "%";
    }

    if (globalUnpackedItems.length === 0) {
        const totalItemsIn = result.completedFurnaces.reduce((s, f) => s + f.packedItems.length, 0);
        showCapacityFeedback("success",
            "✅ 设备与工装容量充足：" + totalItemsIn + " 件工件已全部装载，共使用 " +
            result.completedFurnaces.length + " 个炉次" + aggInfo);
    } else {
        let summary = {};
        globalUnpackedItems.forEach(u => { summary[u.name] = (summary[u.name] || 0) + 1; });
        const uList = Object.entries(summary).map(([k, v]) => k + "×" + v).join("、");

        const missingWeight = globalUnpackedItems.reduce((s, u) => s + (u.weight || 0), 0);
        const missingInfo = missingWeight > 0 ? ("缺少容量: " + missingWeight.toFixed(1) + "kg") : "";

        showCapacityFeedback("danger",
            "⚠️ 装炉失败：当前可用炉膛容量不足\n" +
            globalUnpackedItems.length + " 件工件未能装炉（" + uList + "）\n" +
            (missingInfo ? missingInfo + "\n" : "") +
            "建议：增加炉膛设备台数 / 提高承重上限 / 减少工件数量" +
            aggInfo);

        // 渲染底部缩略图栏
        if (globalFurnacesResult && globalFurnacesResult.length > 0) {
            renderFurnaceThumbnails(
                globalFurnacesResult,
                currentFurnaceIndex,
                onCenterFurnaceClick   // 点击回调，用于切换炉膛
            );
        } else {
            const thumbBar = document.getElementById('furnace-thumb-bar');
            if (thumbBar) thumbBar.style.display = 'none';
        }
    }
}


function collectMaterialBatchesForRecord() {
    return [...document.querySelectorAll('.material-card')].map(card => {
        const d = getMaterialDataFromCard(card);

        return {
            materialBatchId: d.itemCode || `MAT-${d.mid}`,
            name: d.name,
            showName: d.showName || d.name,
            customer: d.customer || '',
            itemCode: d.itemCode || '',

            shape: d.shape,
            dimensions: {
                length: d.dim1,
                width: d.dim2,
                height: d.dim3,
                unit: 'mm'
            },

            quantity: d.count,
            totalWeightKg: d.totalWeight,
            unitWeightKg: d.count > 0 ? d.totalWeight / d.count : 0,

            material: d.material || '',
            process: d.process || '',
            hardnessTarget: d.hardness || '',
            orderDate: d.orderDate || '',
            deliveryDate: d.deliveryDate || '',
            remark: d.remark || '',
            cadImage: d.cadImage || ''
        };
    });
}

function collectToolingForRecord() {
    return [...document.querySelectorAll('.furnace-card')].map(card => {
        const d = getFurnaceDataFromCard(card);

        return {
            toolingId: `TOOLING-${d.fid}`,
            toolingName: d.name,
            toolingType: d.toolingType,
            basketType: d.basketType,

            dimensions: {
                width: d.width,
                height: d.height,
                depth: d.depth,
                unit: 'mm'
            },

            maxLoadKg: d.maxWeight,
            availableCount: d.count,
            actualSpacingMm: d.actualSpacing != null ? d.actualSpacing : 5,
            params: d.extras || {}
        };
    });
}

const planLibrary = createPlanLibraryController({
    canSaveCurrentPlan: () => {
        return !!(globalFurnacesResult && globalFurnacesResult.length > 0);
    },

    buildCurrentRecord: (title) => {
        return buildCurrentDigitalTwinRecord({
            title,
            materials: collectMaterialBatchesForRecord(),
            tooling: collectToolingForRecord()
        });
    },

    getFallbackStrategy: () => {
        return placementRules.strategy || '-';
    },

    onLoadRecord: (record, item) => {
        workbenchRecord.applyDigitalTwinRecordToWorkbench(record, {
            sourceTitle: item?.title || record.meta?.title || '',
            closeLibrary: true,
            showSuccess: true
        });

        updateWorkbenchUiMode();
    }
});

/**
 * 清空所有装炉结果，重置3D场景和UI
 */
export function clearFurnaceResults() {
    window._currentPlanAnalysis = null;

    setGlobalFurnacesResult(null);
    setGlobalUnpackedItems([]);
    clearFurnaceGroups();

    if (itemsGroup) {
        while (itemsGroup.children.length > 0) {
            itemsGroup.remove(itemsGroup.children[0]);
        }
    }

    hidePlanActionButtons();

    const furnaceNav = document.getElementById("furnace-nav");
    if (furnaceNav) furnaceNav.style.display = "none";

    const thumbBar = document.getElementById("furnace-thumb-bar");
    if (thumbBar) thumbBar.style.display = "none";

    hideExplodeBOMButtons();

    const emptyState = document.getElementById("empty-state");
    if (emptyState) emptyState.style.display = "block";

    renderAISummaryBar(null);
    renderLoadingSimulationPanel();
    updateSimulationModeButtons();
    showCapacityFeedback('success', '筛选条件已变更，请重新生成方案');
    updateWorkbenchUiMode();
}

window._clearFurnaceResults = clearFurnaceResults;

/**
 * 控制爆炸图和施工清单按钮的显示
 */
function updateExplodeBOMButtons() {
    const btnBOM = document.getElementById("btn-bom");

    if (btnBOM) {
        btnBOM.style.display = "inline-block";
    }
}

/**
 * 隐藏爆炸图和施工清单按钮
 */
function hideExplodeBOMButtons() {
    const btnBOM = document.getElementById("btn-bom");

    if (btnBOM) {
        btnBOM.style.display = "none";
    }
}

function showPlanActionButtons() {
    const ids = [
        'btn-export-pdf',
        'btn-animate',
        'btn-save-plan-library'
    ];

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = 'inline-block';
            el.disabled = false;
            el.style.opacity = '1';
        }
    });
}

function hidePlanActionButtons() {
    const ids = [
        'btn-export-pdf',
        'btn-animate',
        'btn-save-plan-library'
    ];

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = 'none';
        }
    });
}

let workbenchUiModeTimer = null;

function scheduleWorkbenchUiModeUpdate() {
    if (workbenchUiModeTimer) {
        clearTimeout(workbenchUiModeTimer);
    }

    workbenchUiModeTimer = setTimeout(() => {
        updateWorkbenchUiMode();
    }, 0);
}

function updateWorkbenchUiMode() {
    const furnaceCount = document.querySelectorAll('.furnace-card').length;
    const materialCount = document.querySelectorAll('.material-card').length;

    const hasFurnaces = furnaceCount > 0;
    const hasMaterials = materialCount > 0;
    const hasPlan = !!(globalFurnacesResult && globalFurnacesResult.length > 0);

    const hasSelectedFurnace = !!document.querySelector('.furnace-card.active');
    const hasSelectedMaterial = !!document.querySelector('.material-card.active');

    document.body.classList.toggle('ui-empty', !hasFurnaces && !hasMaterials && !hasPlan);
    document.body.classList.toggle('ui-has-furnaces', hasFurnaces);
    document.body.classList.toggle('ui-has-materials', hasMaterials);
    document.body.classList.toggle('ui-has-multiple-furnaces', furnaceCount >= 2);
    document.body.classList.toggle('ui-input-ready', hasFurnaces && hasMaterials && !hasPlan);
    document.body.classList.toggle('ui-plan-ready', hasPlan);
    document.body.classList.toggle('ui-has-selected-furnace', hasSelectedFurnace);
    document.body.classList.toggle('ui-has-selected-material', hasSelectedMaterial);

    updateEmptyStateCopy({
        hasFurnaces,
        hasMaterials,
        hasPlan
    });
}

function updateEmptyStateCopy({ hasFurnaces, hasMaterials, hasPlan }) {
    const msg = document.querySelector('#empty-state .msg');
    if (!msg || hasPlan) return;

    if (!hasFurnaces && !hasMaterials) {
        msg.innerHTML = `
            <b style="color:#1E293B;">开始创建装炉方案</b><br>
            ① 左侧添加炉膛设备，配置尺寸与工艺<br>
            ② 在“装载工装”确认料框/料盘/网篮<br>
            ③ 左侧“工件详情”添加或导入工件<br>
            ④ 点击右上角 <b style="color:#2563EB;">生成方案</b>
        `;
        return;
    }

    if (hasFurnaces && !hasMaterials) {
        msg.innerHTML = `
            <b style="color:#1E293B;">炉膛设备已准备</b><br>
            请在“装载工装”确认料框/料盘/网篮，并在左侧“工件详情”添加或导入工件<br>
            完成后点击右上角 <b style="color:#2563EB;">生成方案</b>
        `;
        return;
    }

    if (!hasFurnaces && hasMaterials) {
        msg.innerHTML = `
            <b style="color:#1E293B;">工件已准备</b><br>
            请在左侧添加炉膛设备，配置尺寸与可执行工艺<br>
            完成后点击右上角 <b style="color:#2563EB;">生成方案</b>
        `;
        return;
    }

    msg.innerHTML = `
        <b style="color:#1E293B;">输入数据已准备</b><br>
        点击右上角 <b style="color:#2563EB;">生成方案</b> 开始智能排布
    `;
}

function bindWorkbenchUiModeAutoRefresh() {
    const observer = new MutationObserver(scheduleWorkbenchUiModeUpdate);

    ['furnace-cards-container', 'material-cards-container', 'furnace-thumb-bar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            observer.observe(el, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style']
            });
        }
    });

    document.addEventListener('click', scheduleWorkbenchUiModeUpdate, true);
    document.addEventListener('change', scheduleWorkbenchUiModeUpdate, true);
    document.addEventListener('input', scheduleWorkbenchUiModeUpdate, true);
}

function markSimulationStepPlaying(layerIndex, stepIndex, totalSteps) {
    const panel = document.getElementById('loading-simulation-panel');
    if (!panel) return;

    panel.querySelectorAll('.sim-step-card').forEach(card => {
        card.classList.remove('playing', 'active');
    });

    const card = panel.querySelector(`.sim-step-card[data-layer="${layerIndex}"]`);
    if (card) {
        card.classList.add('playing', 'active');
        card.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
        });
    }
}

function clearSimulationPlayingState() {
    const panel = document.getElementById('loading-simulation-panel');
    if (!panel) return;

    panel.querySelectorAll('.sim-step-card').forEach(card => {
        card.classList.remove('playing');
    });
}

function playCurrentSimulation() {
    renderLoadingSimulationPanel();
    updateSimulationModeButtons();
    activateRightPanelTab('simulation');

    playLayeredLoadingAnimation({
        getViewMode: () => simulationViewMode,
        onStepChange: markSimulationStepPlaying,
        onFinish: clearSimulationPlayingState
    });
}

function applySimulationLayerFocus(layer) {
    if (layer === null || isNaN(layer)) {
        focusLayer(null);
        return;
    }

    if (simulationViewMode === 'single') {
        focusLayer(layer);
    } else {
        focusLayersUpTo(layer);
    }
}

function updateSimulationModeButtons() {
    const panel = document.getElementById('loading-simulation-panel');
    if (!panel) return;

    panel.querySelectorAll('[data-sim-view-mode]').forEach(btn => {
        const mode = btn.getAttribute('data-sim-view-mode');
        btn.classList.toggle('active', mode === simulationViewMode);
    });
}

function bindLoadingSimulationStepClicks() {
    const panel = document.getElementById('loading-simulation-panel');
    if (!panel) return;

    panel.addEventListener('click', (e) => {
        const playBtn = e.target.closest('[data-action="sim-play"]');
        if (playBtn) {
            playCurrentSimulation();
            return;
        }

        const modeBtn = e.target.closest('[data-sim-view-mode]');
        if (modeBtn) {
            simulationViewMode = modeBtn.getAttribute('data-sim-view-mode') || 'cumulative';
            updateSimulationModeButtons();

            const activeCard = panel.querySelector('.sim-step-card.active[data-layer]');
            if (activeCard) {
                const layer = parseInt(activeCard.getAttribute('data-layer'));
                applySimulationLayerFocus(layer);
            }

            return;
        }

        const showAllBtn = e.target.closest('[data-action="sim-show-all"]');
        if (showAllBtn) {
            focusLayer(null);

            panel.querySelectorAll('.sim-step-card').forEach(card => {
                card.classList.remove('active');
            });

            return;
        }

        const stepCard = e.target.closest('.sim-step-card[data-layer]');
        if (!stepCard) return;

        const layer = parseInt(stepCard.getAttribute('data-layer'));
        if (isNaN(layer)) return;

        applySimulationLayerFocus(layer);

        panel.querySelectorAll('.sim-step-card').forEach(card => {
            card.classList.remove('active');
        });

        stepCard.classList.add('active');
    });
}

/**
 * 导航至上一个或下一个炉膛方案
 */
function navigateFurnace(direction) {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;

    const newIndex =
        (currentFurnaceIndex + direction + globalFurnacesResult.length) %
        globalFurnacesResult.length;

    setCurrentFurnaceIndex(newIndex);

    const group = furnaceGroups.get(newIndex);
    if (group && controls) {
        controls.target.copy(group.position);
        controls.update();
    }

    const filterName = getSelectedMaterialName();

    renderSingleFurnace(newIndex, filterName);
    focusLayer(null);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(newIndex);
    renderAISummaryBar(onCenterFurnaceClick);
    renderLoadingSimulationPanel();
    updateSimulationModeButtons();

    renderFurnaceThumbnails(
        globalFurnacesResult,
        newIndex,
        handleThumbFurnaceClick
    );
}

function handleThumbFurnaceClick(clickedIdx) {
    setCurrentFurnaceIndex(clickedIdx);

    const filterName = getSelectedMaterialName();

    renderSingleFurnace(clickedIdx, filterName);
    focusLayer(null);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(clickedIdx);
    renderAISummaryBar(onCenterFurnaceClick);
    renderLoadingSimulationPanel();
    updateSimulationModeButtons();

    renderFurnaceThumbnails(
        globalFurnacesResult,
        clickedIdx,
        handleThumbFurnaceClick
    );
}

/**
 * 点击中心统计面板的炉膛项时触发，切换到对应炉膛
 */
function onCenterFurnaceClick(idx) {
    setCurrentFurnaceIndex(idx);

    const filterName = getSelectedMaterialName();

    renderSingleFurnace(idx, filterName);
    focusLayer(null);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(idx);
    renderAISummaryBar(onCenterFurnaceClick);

    renderFurnaceThumbnails(
        globalFurnacesResult,
        idx,
        handleThumbFurnaceClick
    );
    renderLoadingSimulationPanel();
    updateSimulationModeButtons();
}

/**
 * 显示方案库视图
 */
function showMasterView() {
    activateRightPanelTab('library');
    planLibrary.renderPlanLibraryList();
}

function exportCurrentPlanJson() {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        alert('请先生成装炉方案，再导出 JSON');
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const title = `装炉数字孪生记录_${today}`;

    const record = buildCurrentDigitalTwinRecord({
        title,
        materials: collectMaterialBatchesForRecord(),
        tooling: collectToolingForRecord()
    });

    downloadJsonFile(record, `${title}.json`);
}

/**
 * 隐藏总览视图 (Master View)，并恢复主场景的可见性。
 * @returns {void}
 */
function hideMasterView() {
    const masterView = document.getElementById("master-view");
    if (masterView) masterView.classList.add("active");

    if (globalFurnacesResult && globalFurnacesResult.length > 0) {
        activateRightPanelTab('analysis');
        const furnaceNav = document.getElementById("furnace-nav");
        if (furnaceNav) furnaceNav.style.display = "flex";
        updateExplodeBOMButtons();
    }

    updateWorkbenchUiMode();
}

/**
 * 初始化应用程序，设置 Three.js 场景、创建默认炉膛卡片和物料卡片，并绑定所有事件监听器。
 * @returns {void}
 */
function init() {
    initThree();
    updateTopSummary();
    hideExplodeBOMButtons();
    initLeftPanelTabs();
    initRightPanelTabs();
    planLibrary.renderPlanLibraryList();

    bindWorkbenchUiModeAutoRefresh();
    updateWorkbenchUiMode();
    bindLoadingSimulationStepClicks();
    syncPanelCollapsedBodyClasses();

    // ==================== EVENT LISTENERS ====================

    const btnMaster = document.getElementById("btn-master");
    if (btnMaster) btnMaster.addEventListener("click", showMasterView);
    const btnMasterBack = document.getElementById("btn-master-back");
    if (btnMasterBack) btnMasterBack.addEventListener("click", hideMasterView);
    const btnMasterImportJson = document.getElementById("btn-master-import-json");
    if (btnMasterImportJson) btnMasterImportJson.addEventListener("click", openJsonImportModal);

    const btnToolingMgmt = document.getElementById("btn-tooling-mgmt");
    if (btnToolingMgmt) btnToolingMgmt.addEventListener("click", () => activateLeftPanelTab('tooling'));
    const btnMaterialNav = document.getElementById("btn-material-nav");
    if (btnMaterialNav) btnMaterialNav.addEventListener("click", () => activateLeftPanelTab('material'));
    document.getElementById("btn-rules").addEventListener("click", openRulesModal);
    document.getElementById("btn-rules-cancel").addEventListener("click", () => {
        document.getElementById("rules-modal-overlay").style.display = "none";
    });
    document.getElementById("rules-modal-overlay").addEventListener("click", (e) => {
        if (e.target === document.getElementById("rules-modal-overlay"))
            document.getElementById("rules-modal-overlay").style.display = "none";
    });
    document.getElementById("btn-rules-save").addEventListener("click", saveRulesModal);
    document.getElementById("btn-generate-plan").addEventListener("click", showGenerationOptions);
    document.getElementById("btn-animate").addEventListener("click", playCurrentSimulation);
    document.getElementById("btn-export-pdf").addEventListener("click", showPdfSelectModal);
    // JSON 导出并入 PDF 导出弹窗，顶部不再单独提供入口
    // const btnExportJson = document.getElementById('btn-export-json');
    // if (btnExportJson) {
    //     btnExportJson.addEventListener('click', exportCurrentPlanJson);
    // }
    const btnSavePlanLibrary = document.getElementById('btn-save-plan-library');
    if (btnSavePlanLibrary) {
        btnSavePlanLibrary.addEventListener('click', planLibrary.saveCurrentPlanToLibrary);
    }

    // V2.7: 爆炸图按钮
    const btnExplode = document.getElementById("btn-explode");
    if (btnExplode) {
        btnExplode.addEventListener("click", toggleExplodedView);
    }

    // V2.7: 施工清单按钮
    const btnBOM = document.getElementById("btn-bom");
    if (btnBOM) {
        btnBOM.addEventListener("click", showLayeredBOM);
    }

    document.getElementById("btn-add-furnace").addEventListener("click", toolingModal.openToolingAddModal);
    const btnAddToolingInline = document.getElementById("btn-add-tooling-inline");
    if (btnAddToolingInline) btnAddToolingInline.addEventListener("click", addUnlinkedToolingCard);
    document.querySelectorAll(".sort-btn").forEach(btn => {
        btn.addEventListener("click", () => sortFurnaceCards(btn.getAttribute("data-field")));
    });
    document.getElementById("fdp-toggle-btn").addEventListener("click", () => {
        const collapsed = !document.getElementById("furnace-detail-panel").classList.contains("collapsed");
        setFdpCollapsed(collapsed);
        document.getElementById("furnace-detail-panel").classList.toggle("collapsed", collapsed);
        document.getElementById("fdp-toggle-icon").textContent = collapsed ? "▼" : "▲";
    });
    document.getElementById("mdp-toggle-btn").addEventListener("click", () => {
        const collapsed = !document.getElementById("material-detail-panel").classList.contains("collapsed");
        setMdpCollapsed(collapsed);
        document.getElementById("material-detail-panel").classList.toggle("collapsed", collapsed);
        document.getElementById("mdp-toggle-icon").textContent = collapsed ? "▼" : "▲";
    });
    document.getElementById("furnace-cards-container").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action=\"delete-furnace\"]");
        if (btn) {
            e.stopPropagation();
            deleteFurnaceCard(parseInt(btn.getAttribute("data-fid")));
            return;
        }
        // 拖拽手柄不触发 3D 切换
        if (e.target.closest(".f-drag-handle")) return;
        // 炉膛卡片点击 → 同步切换 3D 视图
        const card = e.target.closest(".furnace-card");
        if (!card) return;
        const fid = parseInt(card.getAttribute("data-fid"));
        if (globalFurnacesResult && globalFurnacesResult.length > 0) {
            const idx = findResultIndexByFid(fid);
            if (idx >= 0) {
                setCurrentFurnaceIndex(idx);
                const filterName = getSelectedMaterialName();
                renderSingleFurnace(idx, filterName);
                updateFurnaceNav();
                updateLeftPanelActiveForIndex(idx);
                renderAISummaryBar(onCenterFurnaceClick);
            }
        } else {
            // 无装炉结果时（仅空工装），切换 furnaceGroups 可见性
            const cards = document.querySelectorAll(".furnace-card");
            let targetIdx = 0;
            cards.forEach((c, i) => {
                if (parseInt(c.getAttribute("data-fid")) === fid) targetIdx = i;
            });
            setCurrentFurnaceIndex(targetIdx);
            furnaceGroups.forEach((group, grpIdx) => {
                group.visible = (grpIdx === targetIdx);
            });
            // 更新相机对准选中的料框
            const targetCard = document.getElementById(card.id);
            if (targetCard && controls) {
                const fd = getFurnaceDataFromCard(targetCard);
                const w = fd.width || 900;
                const h = fd.height || 900;
                const d = fd.depth || 1200;
                const baseY = -120;
                controls.target.set(0, h / 2 + baseY, 0);
                camera.position.set(w * 1.5, h * 1.8 + baseY, d * 2.5);
                controls.update();
            }
        }
    });
    document.getElementById("material-cards-container").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action=\"delete-material\"]");
        if (!btn) return;
        e.stopPropagation();
        deleteMaterialCard(parseInt(btn.getAttribute("data-mid")));
    });
    document.getElementById("btn-add-item").addEventListener("click", () => {
        const color = generateUniqueColor(usedColors);
        createMaterialCard("新工件批次", "cuboid", 50, 150, 150, 60, 10, color);
        updateTopSummary();
        updateWorkbenchUiMode();
    });
    document.getElementById("nav-prev").addEventListener("click", () => navigateFurnace(-1));
    document.getElementById("nav-next").addEventListener("click", () => navigateFurnace(1));
    const spacingEL = document.getElementById("global-spacing");
    if (spacingEL) {
        spacingEL.addEventListener("change", () => {
            setGlobalFurnacesResult(null);
            setGlobalUnpackedItems([]);
            setCurrentFurnaceIndex(0);
            clearFurnaceGroups();
            hidePlanActionButtons();
            document.getElementById("furnace-nav").style.display = "none";
            document.getElementById("empty-state").style.display = "block";
            hideExplodeBOMButtons();
            if (itemsGroup) {
                while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
            }
        });
    }
    document.getElementById("btn-anim-pause").addEventListener("click", () => {
        if (!isAnimating) return;
        const paused = !animPaused;
        setAnimPaused(paused);
        document.getElementById("btn-anim-pause").textContent = paused ? "▶ 继续" : "⏸ 暂停";
        document.getElementById("btn-anim-pause").style.background = paused ? "#10b981" : "#f59e0b";
        document.getElementById("btn-anim-pause").style.color = paused ? "#fff" : "#000";
    });
    document.getElementById("btn-anim-stop").addEventListener("click", () => {
        if (!isAnimating) return;
        setAnimStopped(true);
        setAnimPaused(false);
    });
    document.getElementById("btn-import-excel").addEventListener("click", () => {
        document.getElementById("excel-file-input").click();
    });
    document.getElementById("excel-file-input").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = new Uint8Array(ev.target.result);
                const workbook = XLSX.read(data, { type: "array" });
                const parsed = parseExcelData(workbook);
                if (parsed.length === 0) {
                    alert("未找到有效数据，请检查文件格式");
                    return;
                }
                showImportPreview(parsed);
            } catch (err) {
                alert("文件解析失败：" + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = "";
    });
    document.getElementById("btn-import-cancel").addEventListener("click", () => {
        document.getElementById("import-preview-overlay").style.display = "none";
    });
    document.getElementById("btn-import-replace").addEventListener("click", () => {
        applyImportData(true);
        scheduleWorkbenchUiModeUpdate();
    });

    document.getElementById("btn-import-append").addEventListener("click", () => {
        applyImportData(false);
        scheduleWorkbenchUiModeUpdate();
    });
    document.getElementById("btn-pdf-cancel").addEventListener("click", () => {
        document.getElementById("pdf-select-overlay").style.display = "none";
    });
    document.getElementById("pdf-select-overlay").addEventListener("click", (e) => {
        if (e.target === document.getElementById("pdf-select-overlay"))
            document.getElementById("pdf-select-overlay").style.display = "none";
    });
    document.getElementById("btn-pdf-confirm").addEventListener("click", () => {
        const selectedIds = getSelectedPdfFurnaceIds();
        if (selectedIds.length === 0) {
            alert("请至少选择一个炉膛方案");
            return;
        }

        const shouldExportJson = !!document.getElementById('pdf-opt-json')?.checked;

        document.getElementById("pdf-select-overlay").style.display = "none";

        generateSixPagePDF(selectedIds);

        if (shouldExportJson) {
            exportCurrentPlanJson();
        }
    });
    document.getElementById("btn-ji-parse").addEventListener("click", () => {
        const jsonStr = document.getElementById("ji-json-textarea").value.trim();

        if (!jsonStr) {
            document.getElementById("ji-error-msg").textContent = "请先输入或粘贴 JSON 内容";
            document.getElementById("ji-error-msg").classList.add("visible");
            return;
        }

        try {
            const raw = JSON.parse(jsonStr);

            // 新格式：装炉数字孪生记录
            if (isDigitalTwinRecord(raw)) {
                const record = parseDigitalTwinRecord(raw);

                document.getElementById("ji-error-msg").classList.remove("visible");
                renderJsonPreview(record);
                document.getElementById("btn-ji-import").disabled = false;
                window._jiParsedPlan = record;
                return;
            }

            // 旧格式：历史方案 JSON
            const result = parseJsonPlan(jsonStr);
            if (!result.ok) {
                throw new Error(result.error);
            }

            document.getElementById("ji-error-msg").classList.remove("visible");
            renderJsonPreview(result.data);
            document.getElementById("btn-ji-import").disabled = false;
            window._jiParsedPlan = result.data;

        } catch (e) {
            document.getElementById("ji-error-msg").textContent = "❌ 解析失败：" + e.message;
            document.getElementById("ji-error-msg").classList.add("visible");
            document.getElementById("btn-ji-import").disabled = true;
        }
});
    document.getElementById("btn-ji-import").addEventListener("click", () => {
        if (!window._jiParsedPlan) return;

        // 新格式：直接恢复到当前装炉工作台
        if (isDigitalTwinRecord(window._jiParsedPlan)) {
            const record = window._jiParsedPlan;

            workbenchRecord.applyDigitalTwinRecordToWorkbench(record, {
                sourceTitle: record.meta?.title || '导入方案',
                closeLibrary: true,
                showSuccess: true
            });

            updateWorkbenchUiMode();

            document.getElementById("json-import-overlay").style.display = "none";
            return;
        }

        // 旧格式：暂不进入旧历史方案库，避免与新版方案库混用
        alert('当前方案库仅支持新版“装炉数字孪生 JSON”。旧格式历史方案暂不支持直接导入工作台。');

        document.getElementById("json-import-overlay").style.display = "none";
    });
    document.getElementById("btn-ji-cancel").addEventListener("click", () => {
        document.getElementById("json-import-overlay").style.display = "none";
    });
    document.getElementById("json-import-overlay").addEventListener("click", (e) => {
        if (e.target === document.getElementById("json-import-overlay"))
            document.getElementById("json-import-overlay").style.display = "none";
    });
    const jiDropZone = document.getElementById("ji-drop-zone");
    jiDropZone.addEventListener("click", () => document.getElementById("json-file-input").click());
    jiDropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        jiDropZone.classList.add("drag-over");
    });
    jiDropZone.addEventListener("dragleave", () => jiDropZone.classList.remove("drag-over"));
    jiDropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        jiDropZone.classList.remove("drag-over");
        const file = e.dataTransfer.files[0];
        if (file) readJsonFile(file);
    });
    document.getElementById("json-file-input").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) readJsonFile(file);
        e.target.value = "";
    });
    function readJsonFile(file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById("ji-json-textarea").value = ev.target.result;
            document.getElementById("btn-ji-parse").click();
        };
        reader.readAsText(file, "utf-8");
    }


    // ==================== V2.2: 3D显示设置 ====================
    // const dsGrid = document.getElementById("ds-show-grid");
    // const dsAxes = document.getElementById("ds-show-axes");
    // const dsRulers = document.getElementById("ds-show-rulers");

    // function applyDisplaySettings() {
    //     setDisplaySettings({
    //         showGrid: dsGrid.checked,
    //         showAxes: dsAxes.checked,
    //         showRulers: dsRulers.checked
    //     });
    //     refreshAllDisplayVisibility();
    // }

    // if (dsGrid) dsGrid.addEventListener("change", applyDisplaySettings);
    // if (dsAxes) dsAxes.addEventListener("change", applyDisplaySettings);
    // if (dsRulers) dsRulers.addEventListener("change", applyDisplaySettings);


    // ==================== 生成模式选择弹窗事件 ====================
    initGenerationOptions();

    // 渲染筛选条（物料卡片变化时会自动刷新，但初始需要调用一次）
    renderFilterBars(clearFurnaceResults);
}

function initLeftPanelTabs() {
    const tabBtns = document.querySelectorAll('.left-tab-btn');
    const panes = document.querySelectorAll('.left-tab-pane');

    if (!tabBtns.length || !panes.length) return;

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');

            tabBtns.forEach(b => b.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');

            const pane = document.getElementById('left-tab-' + tab);
            if (pane) {
                pane.classList.add('active');
            }
        });
    });
}

function activateLeftPanelTab(tab) {
    const btn = document.querySelector('.left-tab-btn[data-tab="' + tab + '"]');
    if (btn) btn.click();
}

function addUnlinkedToolingCard() {
    const container = document.getElementById('tooling-cards-container');
    if (!container) return;

    const toolingName = prompt('请输入装载工装名称，例如：1#标准料框、井式炉环形工装', '未命名装载工装');
    if (!toolingName) return;

    const card = document.createElement('div');
    card.className = 'tooling-instance-card';
    card.innerHTML =
        '<div class="tooling-instance-head"><strong>' + toolingName + '</strong><span>未链接设备</span></div>' +
        '<div class="tooling-instance-meta">待配置类型 / 尺寸 / 搁板 / 间距 · 后续可链接炉膛设备</div>';

    container.appendChild(card);
}

function initRightPanelTabs() {
    const tabBtns = document.querySelectorAll('.right-tab-btn');
    const panes = document.querySelectorAll('.right-tab-pane');

    if (!tabBtns.length || !panes.length) return;

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');

            tabBtns.forEach(b => b.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');

            const pane = document.getElementById('right-tab-' + tab);
            if (pane) {
                pane.classList.add('active');
            }

            if (tab === 'library') {
                planLibrary.renderPlanLibraryList();
            }
        });
    });
}

function activateRightPanelTab(tab) {
    const btn = document.querySelector('.right-tab-btn[data-tab="' + tab + '"]');
    if (btn) btn.click();
}

/**
 * 初始化生成模式选择弹窗的事件监听器，处理卡片选择和取消操作。
 * @returns {void}
 */
function initGenerationOptions() {
    const overlay = document.getElementById("gen-option-overlay");
    const cards = document.querySelectorAll(".gen-option-card");
    const cancelBtn = document.getElementById("btn-gen-option-cancel");

    // 点击卡片选择模式
    cards.forEach(card => {
        card.addEventListener("click", () => {
            const mode = card.getAttribute("data-mode");

            // 添加选中效果
            cards.forEach(c => c.classList.remove("selected"));
            card.classList.add("selected");

            // 延迟关闭弹窗并执行对应模式
            setTimeout(() => {
                hideGenerationOptions();
                if (mode === "animate") {
                    executeWithAnimation();
                } else if (mode === "skip") {
                    executeWithAILoading();
                }
            }, 200);
        });
    });

    // 取消按钮
    cancelBtn.addEventListener("click", hideGenerationOptions);

    // 点击遮罩关闭
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) hideGenerationOptions();
    });
}

/**
 * 显示生成模式选择弹窗。在显示前会检查是否有足够的炉膛和物料数据。
 * @returns {void}
 */
function showGenerationOptions() {
    if (isAnimating) return;

    // 检查是否有炉膛和物料数据
    let hasFurnaces = document.querySelectorAll(".furnace-card").length > 0;
    let hasMaterials = document.querySelectorAll(".material-card").length > 0;
    if (!hasFurnaces || !hasMaterials) {
        alert("请先在左侧添加炉膛设备，确认装载工装列表，再在左侧“工件详情”添加待处理工件");
        return;
    }

    const overlay = document.getElementById("gen-option-overlay");
    const cards = document.querySelectorAll(".gen-option-card");
    // 清除之前的选中状态
    cards.forEach(c => c.classList.remove("selected"));
    overlay.classList.add("active");
}

/**
 * 隐藏生成模式选择弹窗。
 * @returns {void}
 */
function hideGenerationOptions() {
    const overlay = document.getElementById("gen-option-overlay");
    overlay.classList.remove("active");
}

/**
 * 执行装炉算法并播放逐帧装框动画。
 * @returns {void}
 */
function executeWithAnimation() {
    executeAndRender();

    setTimeout(() => {
        playCurrentSimulation();
    }, 300);
}

/**
 * 执行装炉算法，显示 AI 思考加载动画，然后直接呈现结果，跳过逐帧动画。
 * @returns {Promise<void>}
 */
async function executeWithAILoading() {
    // 显示 AI 思考加载动画
    showAILoadingLoading();

    // 在后台执行装炉算法
    executeAndRender();

    // AI 思考模拟：1~3 秒随机（单位 ms）
    const aiThinkDuration = 2000 + Math.floor(Math.random() * 2000);

    await sleep(aiThinkDuration);

    // 隐藏加载动画
    hideAILoadingLoading();
}

/**
 * 简易延时函数，用于异步操作中的等待。
 * @param {number} ms - 延时毫秒数。
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// ==================== 设备新增 / 装载工装列表逻辑 ====================

/**
 * 清空所有待摆放工件（保留炉膛设备与装载工装）
 */
function clearAllMaterials() {
    if (!confirm('确定要清空所有待摆放工件吗？\n这将清除方案统计和 3D 工件，但炉膛设备与装载工装将保留。')) return;

    // 1. 移除所有工件卡片
    document.querySelectorAll('.material-card').forEach(c => c.remove());

    // 2. 重置工件状态
    setSelectedMaterialCardId(null);
    setMaterialCounter(0);
    clearUsedColors();

    // 3. 清空装炉结果
    setGlobalFurnacesResult(null);
    setGlobalUnpackedItems([]);
    clearFurnaceGroups();

    // 4. 清空 3D 场景
    if (itemsGroup) {
        while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
    }
    // 5. 隐藏方案相关 UI
    hidePlanActionButtons();
    document.getElementById('furnace-nav').style.display = 'none';
    hideExplodeBOMButtons();

    // 隐藏缩略图栏
    const thumbBar = document.getElementById('furnace-thumb-bar');
    if (thumbBar) thumbBar.style.display = 'none';

    // 6. 显示空状态
    document.getElementById('empty-state').style.display = 'block';

    // 7. 重置工件详情面板
    document.getElementById('mdp-placeholder').style.display = 'block';
    document.getElementById('mdp-body').style.display = 'none';
    document.getElementById('mdp-title').textContent = '📋 工件详情';

    // 8. 如果还有炉膛设备，渲染空工装
    const hasFurnaces = document.querySelectorAll('.furnace-card').length > 0;
    if (hasFurnaces) {
        toolingModal.renderEmptyToolingOnly();
    }

    // 重置筛选状态
    clearMaterialFilters();
    clearProcessFilters();
    clearHardnessFilters();

    // 刷新筛选条（此时工件卡片已清空，筛选条应显示“全部 (0)”）
    renderFilterBars(clearFurnaceResults);

    // 9. 更新顶部摘要
    setCurrentFurnaceIndex(0);
    updateTopSummary();
    updateWorkbenchUiMode();
}

/**
 * 清空所有炉膛设备、装载工装和工件（完全重置）
 */
function clearAllFurnaces() {
    if (!confirm('确定要清空所有炉膛设备吗？\n这将清除所有设备、工件、方案统计和 3D 场景。装载工装列表会保留为未链接状态。')) return;

    // 1. 移除所有炉膛卡片
    document.querySelectorAll('.furnace-card').forEach(c => c.remove());

    // 2. 移除所有工件卡片
    document.querySelectorAll('.material-card').forEach(c => c.remove());

    // 3. 重置所有状态
    setSelectedFurnaceCardId(null);
    setSelectedMaterialCardId(null);
    setFurnaceCounter(0);
    setMaterialCounter(0);
    clearUsedColors();

    // 4. 清空装炉结果
    setGlobalFurnacesResult(null);
    setGlobalUnpackedItems([]);
    clearFurnaceGroups();

    // 5. 清空 3D 场景所有内容
    if (itemsGroup) {
        while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
    }
    // 6. 隐藏所有方案相关 UI
    hidePlanActionButtons();
    document.getElementById('furnace-nav').style.display = 'none';
    renderAISummaryBar(null);
    hideExplodeBOMButtons();

    // 隐藏缩略图栏
    const thumbBar = document.getElementById('furnace-thumb-bar');
    if (thumbBar) thumbBar.style.display = 'none';

    // 7. 显示空状态
    document.getElementById('empty-state').style.display = 'block';

    // 8. 重置详情面板
    document.getElementById('fdp-placeholder').style.display = 'block';
    document.getElementById('fdp-body').style.display = 'none';
    document.getElementById('fdp-title').textContent = '📋 进炉方向';
    document.getElementById('mdp-placeholder').style.display = 'block';
    document.getElementById('mdp-body').style.display = 'none';
    document.getElementById('mdp-title').textContent = '📋 工件详情';

    // 9. 更新顶部摘要
    clearMaterialFilters();
    clearProcessFilters();
    clearHardnessFilters();
    renderFilterBars(clearFurnaceResults);

    setCurrentFurnaceIndex(0);
    updateTopSummary();
    updateWorkbenchUiMode();
}

/**
 * 折叠/展开左面板
 */
function toggleLeftPanel() {
    const panel = document.getElementById('left-panel');
    const btn = document.getElementById('btn-toggle-left-panel');
    const expandBtn = document.getElementById('panel-expand-btn-left');

    if (!panel) return;

    if (panel.classList.contains('collapsed')) {
        // 展开
        panel.classList.remove('collapsed');
        document.body.classList.remove('left-panel-collapsed');

        if (btn) btn.textContent = '◀';
        if (expandBtn) expandBtn.style.display = 'none';
    } else {
        // 折叠
        panel.classList.add('collapsed');
        document.body.classList.add('left-panel-collapsed');

        if (btn) btn.textContent = '▶';
        if (expandBtn) expandBtn.style.display = 'flex';
    }

    updateWorkbenchUiMode();
}

/**
 * 折叠/展开右面板
 */
function toggleRightPanel() {
    const panel = document.getElementById('right-panel');
    const btn = document.getElementById('btn-toggle-right-panel');
    const expandBtn = document.getElementById('panel-expand-btn-right');

    if (!panel) return;

    if (panel.classList.contains('collapsed')) {
        // 展开
        panel.classList.remove('collapsed');
        document.body.classList.remove('right-panel-collapsed');

        if (btn) btn.textContent = '▶';
        if (expandBtn) expandBtn.style.display = 'none';
    } else {
        // 折叠
        panel.classList.add('collapsed');
        document.body.classList.add('right-panel-collapsed');

        if (btn) btn.textContent = '◀';
        if (expandBtn) expandBtn.style.display = 'flex';
    }

    updateWorkbenchUiMode();
}

function syncPanelCollapsedBodyClasses() {
    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');

    document.body.classList.toggle(
        'left-panel-collapsed',
        !!leftPanel && leftPanel.classList.contains('collapsed')
    );

    document.body.classList.toggle(
        'right-panel-collapsed',
        !!rightPanel && rightPanel.classList.contains('collapsed')
    );
}

/**
 * 折叠/展开中心方案统计面板
 */
// 暴露全局函数供 onclick 调用
window._selectAddToolingType = toolingModal.selectAddToolingType;

// 初始化 & 绑定新事件
init();

// ==================== 新增事件绑定 ====================
(function bindNewEvents() {
    // 重置按钮
    const btnClearFurnaces = document.getElementById('btn-clear-all-furnaces');
    if (btnClearFurnaces) btnClearFurnaces.addEventListener('click', clearAllFurnaces);

    const btnClearMaterials = document.getElementById('btn-clear-all-materials');
    if (btnClearMaterials) btnClearMaterials.addEventListener('click', clearAllMaterials);

    // 面板折叠按钮
    const btnToggleLeft = document.getElementById('btn-toggle-left-panel');
    if (btnToggleLeft) btnToggleLeft.addEventListener('click', toggleLeftPanel);

    const btnToggleRight = document.getElementById('btn-toggle-right-panel');
    if (btnToggleRight) btnToggleRight.addEventListener('click', toggleRightPanel);

    // 折叠面板展开按钮
    const expandLeft = document.getElementById('panel-expand-btn-left');
    if (expandLeft) expandLeft.addEventListener('click', toggleLeftPanel);

    const expandRight = document.getElementById('panel-expand-btn-right');
    if (expandRight) expandRight.addEventListener('click', toggleRightPanel);

    // ==================== 3D Dock 工具栏事件 ====================
    const dockTopView = document.getElementById('dock-top-view');
    const dockFrontView = document.getElementById('dock-front-view');
    const dockSideView = document.getElementById('dock-side-view');
    const dockRotate90 = document.getElementById('dock-rotate-90');
    const dockExplode = document.getElementById('dock-explode');
    // const dockGravity = document.getElementById('dock-gravity');
    // const dockThermal = document.getElementById('dock-thermal');

    if (dockTopView) {
        dockTopView.addEventListener('click', () => {
            setTightFitCamera(new THREE.Vector3(0, 1, 0));
            highlightDockBtn(dockTopView);
        });
    }
    function rotateCurrentView90() {
        if (!camera || !controls) {
            setTightFitCamera(new THREE.Vector3(1, 0, 0));
            return;
        }

        // 当前相机相对观察中心的方向
        const dir = camera.position.clone().sub(controls.target);

        if (dir.lengthSq() < 0.0001) {
            dir.set(0, 0, 1);
        }

        dir.normalize();

        // 如果当前是纯俯视，绕Y轴旋转视觉变化不明显，所以回到水平视角再旋转
        if (Math.abs(dir.y) > 0.92) {
            dir.set(0, 0, 1);
        }

        // 绕世界Y轴旋转90度
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        dir.normalize();

        // 复用第一步的完整场景适配逻辑
        setTightFitCamera(dir, 0.18);
    }

    if (dockRotate90) {
        dockRotate90.addEventListener('click', () => {
            rotateCurrentView90();
            highlightDockBtn(dockRotate90);
        });
    }
    if (dockFrontView) {
        dockFrontView.addEventListener('click', () => {
            setTightFitCamera(new THREE.Vector3(0, 0, 1));
            highlightDockBtn(dockFrontView);
        });
    }
    if (dockSideView) {
        dockSideView.addEventListener('click', () => {
            setTightFitCamera(new THREE.Vector3(1, 0, 0));
            highlightDockBtn(dockSideView);
        });
    }
    let dockExplodeMode = 'none'; // none | vertical | horizontal

    function updateDockExplodeButton() {
        if (!dockExplode) return;

        const icon = dockExplode.querySelector('.dock-icon');
        const label = dockExplode.querySelector('.dock-label');

        dockExplode.classList.toggle('active', dockExplodeMode !== 'none');

        if (dockExplodeMode === 'vertical') {
            if (icon) icon.textContent = '↕';
            if (label) label.textContent = '垂直爆炸';
            dockExplode.title = '当前：垂直爆炸。点击切换为水平爆炸';
        } else if (dockExplodeMode === 'horizontal') {
            if (icon) icon.textContent = '↔';
            if (label) label.textContent = '水平爆炸';
            dockExplode.title = '当前：水平爆炸。点击关闭爆炸图';
        } else {
            if (icon) icon.textContent = '💥';
            if (label) label.textContent = '爆炸';
            dockExplode.title = '点击开启垂直爆炸';
        }
    }

    function resetDockExplodeButton() {
        dockExplodeMode = 'none';
        updateDockExplodeButton();
    }

    if (dockExplode) {
        dockExplode.addEventListener('click', async () => {
            if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
                dockExplodeMode = 'none';
                updateDockExplodeButton();
                return;
            }

            await toggleExplodedView();

            if (dockExplodeMode === 'none') {
                dockExplodeMode = 'vertical';
            } else if (dockExplodeMode === 'vertical') {
                dockExplodeMode = 'horizontal';
            } else {
                dockExplodeMode = 'none';
            }

            updateDockExplodeButton();

        });

        updateDockExplodeButton();
    }

    function highlightDockBtn(activeBtn) {
        [
            dockTopView,
            dockFrontView,
            dockSideView,
            dockRotate90
        ].forEach(btn => {
            if (btn) btn.classList.remove('active');
        });

        if (activeBtn) activeBtn.classList.add('active');
    }

    // 3D 显示设置切换按钮（网格、坐标轴、标尺）
    const toggleGrid = document.getElementById('dock-toggle-grid');
    const toggleAxes = document.getElementById('dock-toggle-axes');
    const toggleRulers = document.getElementById('dock-toggle-rulers');

    if (toggleGrid) {
        toggleGrid.addEventListener('click', () => {
            setDisplaySettings({ ...displaySettings, showGrid: !displaySettings.showGrid });
            refreshAllDisplayVisibility();
            toggleGrid.classList.toggle('active', displaySettings.showGrid);
        });
        // 初始化高亮状态
        toggleGrid.classList.toggle('active', displaySettings.showGrid);
    }
    if (toggleAxes) {
        toggleAxes.addEventListener('click', () => {
            setDisplaySettings({ ...displaySettings, showAxes: !displaySettings.showAxes });
            refreshAllDisplayVisibility();
            toggleAxes.classList.toggle('active', displaySettings.showAxes);
        });
        toggleAxes.classList.toggle('active', displaySettings.showAxes);
    }
    if (toggleRulers) {
        toggleRulers.addEventListener('click', () => {
            setDisplaySettings({ ...displaySettings, showRulers: !displaySettings.showRulers });
            refreshAllDisplayVisibility();
            toggleRulers.classList.toggle('active', displaySettings.showRulers);
        });
        toggleRulers.classList.toggle('active', displaySettings.showRulers);
    }

})();

