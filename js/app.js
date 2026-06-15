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
import { renderPlanAnalysisPanel, renderCandidatePlanCards, renderLoadingSimulationPanel, renderThermalSimulationPanel } from './ui.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
    renderVacuumQuenchThermalSimulation,
    playVacuumQuenchThermalSimulation,
    stopVacuumQuenchThermalSimulation,
    pauseVacuumQuenchThermalSimulation,
    resumeVacuumQuenchThermalSimulation,
    setVacuumQuenchThermalProgress,
    getVacuumQuenchThermalRuntime,
    renderRadiationExposureSimulation,
    getRadiationExposureRuntime,
    selectRadiationExposureItem,
    selectRadiationExposureBatch,
    selectLowestRadiationExposureItemInCurrentBatch,
    selectRadiationExposureItemAtClientPoint,
    enterRadiationSectionView,
    setRadiationSectionDirection,
    setRadiationSectionOffset,
    tryStartRadiationSectionDragAtClientPoint,
    dragRadiationSectionPlaneToClientPoint,
    endRadiationSectionDrag,
    exitRadiationSectionView,
    clearRadiationExposureSelection,
    clearThermalSimulationLayer,
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
let processSimulationMode = 'thermal';


let currentWorkspaceIdentity = {
    id: '',
    title: '当前工作台方案',
    source: 'draft',
    status: 'draft',
    createdAt: '',
    updatedAt: ''
};

function makeWorkspaceId() {
    return 'WS-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function formatWorkspaceTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
}

function ensureCurrentWorkspaceIdentity() {
    if (!currentWorkspaceIdentity.id) {
        const now = new Date().toISOString();
        currentWorkspaceIdentity = {
            id: makeWorkspaceId(),
            title: '当前工作台方案',
            source: 'draft',
            status: 'draft',
            createdAt: now,
            updatedAt: now
        };
    }
    return currentWorkspaceIdentity;
}

function buildAutoWorkspaceTitle(strategyLabel = '') {
    const furnaces = globalFurnacesResult || [];
    if (!furnaces.length) return '当前工作台方案';
    const first = furnaces[0] || {};
    const toolingName = first.typeName || first.instanceId || '装炉方案';
    const totalItems = furnaces.reduce((sum, f) => sum + ((f.packedItems || []).length), 0);
    const totalWeight = furnaces.reduce((sum, f) => sum + Number(f.totalWeight || 0), 0);
    const strategy = strategyLabel || STRATEGY_LABELS[placementRules.strategy] || placementRules.strategy || 'balanced';
    return `${toolingName}_${totalItems}件_${totalWeight.toFixed(1)}kg_${strategy}`;
}

function setCurrentWorkspaceIdentityFromPlan(strategyLabel = '') {
    const existed = ensureCurrentWorkspaceIdentity();
    const now = new Date().toISOString();
    currentWorkspaceIdentity = {
        ...existed,
        title: buildAutoWorkspaceTitle(strategyLabel),
        source: 'generated',
        status: 'unsaved',
        createdAt: existed.createdAt || now,
        updatedAt: now
    };
}

function getCurrentWorkspaceTitle() {
    ensureCurrentWorkspaceIdentity();
    return currentWorkspaceIdentity.title || '当前工作台方案';
}

function resetCurrentWorkspaceIdentity() {
    currentWorkspaceIdentity = {
        id: '',
        title: '当前工作台方案',
        source: 'draft',
        status: 'draft',
        createdAt: '',
        updatedAt: ''
    };
}

function markCurrentWorkspaceSaved(title) {
    const existed = ensureCurrentWorkspaceIdentity();
    currentWorkspaceIdentity = {
        ...existed,
        title: title || existed.title,
        status: 'saved',
        updatedAt: new Date().toISOString()
    };
    refreshPlanLibraryWorkbench();
}

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
    exitCompareMode(false);
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
    clearThermalSimulationLayer();
    setCurrentFurnaceIndex(0);

    window._currentPlanAnalysis = plan.analysis;
    setCurrentWorkspaceIdentityFromPlan(plan.label);

    renderPlanAnalysisPanel(plan.analysis);
    renderCandidatePlanCards(candidatePlans, index, applyCandidatePlan);
    renderLoadingSimulationPanel();
    renderThermalSimulationPanel(null, processSimulationMode);
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
    updateCurrentToolingHud();
    refreshPlanLibraryWorkbench();
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
    exitCompareMode(false);
    clearHistoryViewState();
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
    setCurrentWorkspaceIdentityFromPlan(bestPlan?.label || '');

    renderPlanAnalysisPanel(analysis);
    renderCandidatePlanCards(candidatePlans, currentCandidatePlanIndex, applyCandidatePlan);
    renderLoadingSimulationPanel();
    renderThermalSimulationPanel(null, processSimulationMode);
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
    clearThermalSimulationLayer();

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
    updateCurrentToolingHud();
    refreshPlanLibraryWorkbench();
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
            "✅ 料框容量充足：" + totalItemsIn + " 件物料已全部装框，共使用 " +
            result.completedFurnaces.length + " 个炉次" + aggInfo);
    } else {
        let summary = {};
        globalUnpackedItems.forEach(u => { summary[u.name] = (summary[u.name] || 0) + 1; });
        const uList = Object.entries(summary).map(([k, v]) => k + "×" + v).join("、");

        const missingWeight = globalUnpackedItems.reduce((s, u) => s + (u.weight || 0), 0);
        const missingInfo = missingWeight > 0 ? ("缺少容量: " + missingWeight.toFixed(1) + "kg") : "";

        showCapacityFeedback("danger",
            "⚠️ 装炉失败：当前可用炉膛容量不足\n" +
            globalUnpackedItems.length + " 件物料未能装炉（" + uList + "）\n" +
            (missingInfo ? missingInfo + "\n" : "") +
            "建议：增加炉膛台数 / 提高承重上限 / 减少物料数量" +
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
        const finalTitle = title || getCurrentWorkspaceTitle();
        markCurrentWorkspaceSaved(finalTitle);
        return buildCurrentDigitalTwinRecord({
            title: finalTitle,
            materials: collectMaterialBatchesForRecord(),
            tooling: collectToolingForRecord()
        });
    },

    getFallbackStrategy: () => {
        return placementRules.strategy || '-';
    },

    onLoadRecord: (record, item) => {
        const title = item?.title || record.meta?.title || getPlanRecordTitle(record) || '历史方案';
        markHistoryView(record, title);

        workbenchRecord.applyDigitalTwinRecordToWorkbench(record, {
            sourceTitle: title,
            closeLibrary: false,
            showSuccess: true
        });

        updateWorkbenchUiMode();
        refreshPlanLibraryWorkbench();
        updateCurrentToolingHud();
    }
});

/**
 * 清空所有装炉结果，重置3D场景和UI
 */
export function clearFurnaceResults() {
    exitCompareMode(false);
    clearHistoryViewState();
    resetCurrentWorkspaceIdentity();
    window._currentPlanAnalysis = null;

    setGlobalFurnacesResult(null);
    setGlobalUnpackedItems([]);
    clearFurnaceGroups();
    clearThermalSimulationLayer();

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
    updateCurrentToolingHud();
    renderLoadingSimulationPanel();
    renderThermalSimulationPanel(null, processSimulationMode);
    updateSimulationModeButtons();
    showCapacityFeedback('success', '筛选条件已变更，请重新生成方案');
    updateWorkbenchUiMode();
}

window._clearFurnaceResults = clearFurnaceResults;


function formatPercent(value) {
    if (!isFinite(value)) return '-';
    return value.toFixed(1) + '%';
}

function getCurrentToolingLayerCount(furnace) {
    if (!furnace) return 0;
    if (typeof furnace.shelfCount === 'number' && furnace.shelfCount > 0) return furnace.shelfCount;
    if (Array.isArray(furnace.shelvesUsed) && furnace.shelvesUsed.length > 0) return furnace.shelvesUsed.length + 1;

    const layers = new Set();
    (furnace.packedItems || []).forEach(item => {
        if (typeof item.layer === 'number' && item.layer >= 1) {
            layers.add(item.layer);
        } else if (typeof item.y === 'number') {
            layers.add(Math.round(item.y));
        }
    });

    return layers.size || ((furnace.packedItems || []).length > 0 ? 1 : 0);
}

function setHudText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

let currentToolingHudCollapsed = false;

function syncCurrentToolingHudControls(totalCount = 0) {
    const hud = document.getElementById('current-tooling-hud');
    if (!hud) return;

    hud.classList.toggle('collapsed', currentToolingHudCollapsed);

    const toggleBtn = document.getElementById('cth-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = currentToolingHudCollapsed ? '展开' : '收起';
        toggleBtn.setAttribute('aria-expanded', currentToolingHudCollapsed ? 'false' : 'true');
    }

    const canSwitch = totalCount > 1;
    const prevBtn = document.getElementById('cth-prev');
    const nextBtn = document.getElementById('cth-next');
    if (prevBtn) prevBtn.disabled = !canSwitch;
    if (nextBtn) nextBtn.disabled = !canSwitch;
}

function bindCurrentToolingHudControls() {
    const hud = document.getElementById('current-tooling-hud');
    if (!hud) return;

    // 防止点击 HUD 按钮时被 Three.js OrbitControls 当作拖拽/旋转处理。
    ['pointerdown', 'mousedown', 'click', 'touchstart', 'wheel'].forEach(eventName => {
        hud.addEventListener(eventName, (event) => {
            event.stopPropagation();
        }, { passive: eventName === 'wheel' });
    });

    const prevBtn = document.getElementById('cth-prev');
    if (prevBtn) {
        prevBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            navigateFurnace(-1);
        });
    }

    const nextBtn = document.getElementById('cth-next');
    if (nextBtn) {
        nextBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            navigateFurnace(1);
        });
    }

    const toggleBtn = document.getElementById('cth-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            currentToolingHudCollapsed = !currentToolingHudCollapsed;
            syncCurrentToolingHudControls(globalFurnacesResult?.length || 0);
        });
    }
}

function updateCurrentToolingHud() {
    const hud = document.getElementById('current-tooling-hud');
    if (!hud) return;

    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        hud.style.display = 'none';
        return;
    }

    const idx = Math.max(0, Math.min(currentFurnaceIndex || 0, globalFurnacesResult.length - 1));
    const furnace = globalFurnacesResult[idx];
    if (!furnace) {
        hud.style.display = 'none';
        return;
    }

    const packedItems = furnace.packedItems || [];
    const packedCount = packedItems.length;
    const totalWeight = Number(furnace.totalWeight || 0);
    const maxWeight = Number(furnace.max_weight || furnace.maxWeight || 0);
    const totalVolume = Number((furnace.w || 0) * (furnace.h || 0) * (furnace.d || 0));
    const packedVolume = packedItems.reduce((sum, item) => {
        return sum + Number((item.w || 0) * (item.h || 0) * (item.d || 0));
    }, 0);

    const weightRate = maxWeight > 0 ? (totalWeight / maxWeight) * 100 : NaN;
    const spaceRate = totalVolume > 0 ? (packedVolume / totalVolume) * 100 : NaN;
    const layerCount = getCurrentToolingLayerCount(furnace);

    const hudKicker = hud.querySelector('.cth-kicker');
    if (hudKicker) hudKicker.textContent = workspaceViewState.mode === 'history' ? '历史方案 · 当前工装' : '当前工装';
    const toolingTitle = furnace.instanceId || furnace.typeName || `工装 #${idx + 1}`;
    setHudText('cth-title', workspaceViewState.mode === 'history' ? `${workspaceViewState.historyTitle || '历史方案'} / ${toolingTitle}` : toolingTitle);
    setHudText('cth-index', `${idx + 1}/${globalFurnacesResult.length}`);
    setHudText('cth-packed-count', `${packedCount} 件`);
    setHudText('cth-weight', `${totalWeight.toFixed(1)} kg`);
    setHudText('cth-weight-rate', formatPercent(weightRate));
    setHudText('cth-space-rate', formatPercent(spaceRate));
    setHudText('cth-layers', layerCount > 0 ? `${layerCount} 层` : '-');
    setHudText('cth-max-weight', maxWeight > 0 ? `${maxWeight.toFixed(0)} kg` : '-');

    const unpackedEl = document.getElementById('cth-unpacked');
    if (unpackedEl) {
        const unpackedCount = globalUnpackedItems ? globalUnpackedItems.length : 0;
        if (unpackedCount > 0) {
            unpackedEl.style.display = 'block';
            unpackedEl.textContent = `⚠️ 仍有 ${unpackedCount} 件工件未装入，建议增加工装或调整规则`;
        } else {
            unpackedEl.style.display = 'none';
            unpackedEl.textContent = '';
        }
    }

    syncCurrentToolingHudControls(globalFurnacesResult.length);
    hud.style.display = 'block';
}

// ==================== V8.2: 3D 方案对比模式 ====================
let compareState = {
    active: false,
    mode: 'horizontal',
    title: '',
    historicalRecord: null,
    historicalFurnaces: [],
    currentIndex: 0,
    historyIndex: 0
};

function clampIndex(index, length) {
    if (!length) return 0;
    return Math.max(0, Math.min(index || 0, length - 1));
}

function getFurnaceVolume(furnace) {
    return Number((furnace?.w || 0) * (furnace?.h || 0) * (furnace?.d || 0));
}

function getPackedVolume(furnace) {
    return (furnace?.packedItems || []).reduce((sum, item) => {
        return sum + Number((item.w || 0) * (item.h || 0) * (item.d || 0));
    }, 0);
}

function getFurnaceMetricSummary(furnace, index, total, unpackedCount) {
    if (!furnace) {
        return {
            title: '暂无工装', indexText: '-/-', packedCount: '-', weight: '-', weightRate: '-',
            spaceRate: '-', layers: '-', maxWeight: '-', note: '当前方案没有对应序号的工装。'
        };
    }

    const packedItems = furnace.packedItems || [];
    const totalWeight = Number(furnace.totalWeight || 0);
    const maxWeight = Number(furnace.max_weight || furnace.maxWeight || 0);
    const weightRate = maxWeight > 0 ? (totalWeight / maxWeight) * 100 : NaN;
    const volume = getFurnaceVolume(furnace);
    const packedVolume = getPackedVolume(furnace);
    const spaceRate = volume > 0 ? (packedVolume / volume) * 100 : NaN;
    const layers = getCurrentToolingLayerCount(furnace);

    return {
        title: furnace.instanceId || furnace.typeName || `工装 #${index + 1}`,
        indexText: `${index + 1}/${total || 1}`,
        packedCount: `${packedItems.length} 件`,
        weight: `${totalWeight.toFixed(1)} kg`,
        weightRate: formatPercent(weightRate),
        spaceRate: formatPercent(spaceRate),
        layers: layers > 0 ? `${layers} 层` : '-',
        maxWeight: maxWeight > 0 ? `${maxWeight.toFixed(0)} kg` : '-',
        note: unpackedCount > 0 ? `仍有 ${unpackedCount} 件工件未装入，可对照历史方案判断是否需要增加工装。` : ''
    };
}

function renderCompareHud(elId, role, furnace, index, total, unpackedCount) {
    const el = document.getElementById(elId);
    if (!el) return;

    const m = getFurnaceMetricSummary(furnace, index, total, unpackedCount);
    const roleLabel = role === 'current' ? '当前方案' : '历史方案';

    el.innerHTML = `
        <div class="compare-card-head">
            <div>
                <div class="compare-card-kicker">${roleLabel}</div>
                <div class="compare-card-title">${m.title}</div>
            </div>
            <div class="compare-card-index">${m.indexText}</div>
        </div>
        <div class="compare-chip-row">
            <span><b>${m.packedCount}</b> 已装</span>
            <span><b>${m.weight}</b></span>
            <span><b>${m.layers}</b></span>
            <span>空间 <b>${m.spaceRate}</b></span>
        </div>
    `;
    el.style.display = 'block';
}

function normalizeRuntimeItemFromRecord(item, idx) {
    const position = item.position || item.pos || item;
    const dim = item.dimensions || item.dimension || item;
    const length = Number(dim.length ?? dim.l ?? dim.w ?? item.w ?? item.width ?? 0);
    const width = Number(dim.width ?? dim.depth ?? dim.d ?? item.d ?? item.depth ?? length);
    const height = Number(dim.height ?? dim.h ?? item.h ?? item.height ?? 0);

    return {
        id: item.id || item.itemId || `history-item-${idx}`,
        name: item.name || item.showName || item.materialBatchName || '历史工件',
        shape: item.shape || 'cuboid',
        w: length,
        d: width,
        h: height,
        weight: Number(item.weight || item.weightKg || item.unitWeightKg || 0),
        color: item.color || '#7c3aed',
        x: Number(position.x || 0),
        y: Number(position.y || 0),
        z: Number(position.z || 0),
        material: item.material || item.materialName || '',
        process: item.process || item.processName || '',
        originalDims: item.originalDims || { l: length, w: width, h: height }
    };
}

function normalizeRuntimeFurnacesFromRecord(record) {
    try {
        const runtime = getRuntimeFurnacesFromRecord(record);
        if (Array.isArray(runtime) && runtime.length > 0) return runtime;
    } catch (e) {
        console.warn('[compare] getRuntimeFurnacesFromRecord failed, fallback normalize:', e);
    }

    const source = record?.loadingPlan?.furnaces || record?.furnaces || record?.completedFurnaces || [];
    if (!Array.isArray(source)) return [];

    return source.map((f, idx) => {
        const dim = f.dimensions || f.dimension || f;
        const packedItems = Array.isArray(f.packedItems) ? f.packedItems : (Array.isArray(f.items) ? f.items : []);
        return {
            instanceId: f.instanceId || f.name || f.toolingName || `历史工装 #${idx + 1}`,
            typeName: f.typeName || f.toolingName || f.name || `历史工装 #${idx + 1}`,
            w: Number(dim.width ?? f.w ?? f.width ?? 0),
            h: Number(dim.height ?? f.h ?? f.height ?? 0),
            d: Number(dim.depth ?? f.d ?? f.depth ?? 0),
            max_weight: Number(f.maxWeightKg ?? f.maxLoadKg ?? f.max_weight ?? f.maxWeight ?? 0),
            basketType: f.basketType || 'grid',
            toolingType: f.toolingType || 'standard-basket',
            params: f.params || {},
            shelvesUsed: f.shelvesUsed || f.shelves || [],
            shelfCount: f.shelfCount,
            packedItems: packedItems.map(normalizeRuntimeItemFromRecord),
            totalWeight: Number(f.totalWeightKg ?? f.totalWeight ?? 0)
        };
    }).filter(f => f.w > 0 && f.h > 0 && f.d > 0);
}

function collectRecordsFromAnyValue(value, out, depth = 0) {
    if (depth > 5 || !value) return;

    if (typeof value === 'string') {
        try {
            collectRecordsFromAnyValue(JSON.parse(value), out, depth + 1);
        } catch (_) {}
        return;
    }

    if (Array.isArray(value)) {
        value.forEach(v => collectRecordsFromAnyValue(v, out, depth + 1));
        return;
    }

    if (typeof value !== 'object') return;

    if (
        value.schemaVersion === 'heat-treatment-digital-twin-v1' ||
        (value.loadingPlan && Array.isArray(value.loadingPlan.furnaces)) ||
        (typeof isDigitalTwinRecord === 'function' && isDigitalTwinRecord(value))
    ) {
        out.push(value);
        return;
    }

    if (value.record) collectRecordsFromAnyValue(value.record, out, depth + 1);
    if (value.records) collectRecordsFromAnyValue(value.records, out, depth + 1);
    if (value.items) collectRecordsFromAnyValue(value.items, out, depth + 1);
    if (value.plans) collectRecordsFromAnyValue(value.plans, out, depth + 1);
}

function getPlanRecordTitle(record) {
    return record?.meta?.title || record?.title || record?.name || '历史方案';
}

function getPlanRecordCreatedAt(record) {
    return record?.meta?.createdAt || record?.createdAt || record?.date || record?.timestamp || '';
}

function findPlanLibraryRecords() {
    const records = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            collectRecordsFromAnyValue(value, records);
        }
    } catch (e) {
        console.warn('[compare] scan localStorage failed:', e);
    }

    const seen = new Set();
    return records
        .filter(r => {
            const sig = `${getPlanRecordTitle(r)}|${getPlanRecordCreatedAt(r)}|${JSON.stringify(r.loadingPlan?.furnaces?.[0]?.instanceId || '')}`;
            if (seen.has(sig)) return false;
            seen.add(sig);
            return true;
        })
        .sort((a, b) => String(getPlanRecordCreatedAt(b)).localeCompare(String(getPlanRecordCreatedAt(a))));
}

function findRecordForPlanCard(card) {
    const records = findPlanLibraryRecords();
    if (!records.length) return null;

    const cardTitle = card?.querySelector('.mpc-title')?.textContent?.trim() || '';
    if (cardTitle) {
        const exact = records.find(r => getPlanRecordTitle(r) === cardTitle);
        if (exact) return exact;

        const fuzzy = records.find(r => {
            const t = getPlanRecordTitle(r);
            return t && (cardTitle.includes(t) || t.includes(cardTitle));
        });
        if (fuzzy) return fuzzy;
    }

    const cards = [...document.querySelectorAll('#master-list .master-plan-card')];
    const idx = Math.max(0, cards.indexOf(card));
    return records[idx] || records[0] || null;
}

let workspaceViewState = {
    mode: 'current',
    historyTitle: '',
    backupRecord: null
};

function captureCurrentWorkspaceSnapshot(title = '当前工作台自动快照') {
    try {
        return buildCurrentDigitalTwinRecord({
            title,
            materials: collectMaterialBatchesForRecord(),
            tooling: collectToolingForRecord()
        });
    } catch (e) {
        console.warn('[workspace] capture snapshot failed:', e);
        return null;
    }
}

function markHistoryView(record, title) {
    if (workspaceViewState.mode !== 'history') {
        workspaceViewState.backupRecord = captureCurrentWorkspaceSnapshot('加载历史前的当前方案');
    }
    workspaceViewState.mode = 'history';
    workspaceViewState.historyTitle = title || getPlanRecordTitle(record) || '历史方案';
    document.body.classList.add('history-view-mode');
    updateHistoryEditorReadonly();
}

function clearHistoryViewState() {
    workspaceViewState.mode = 'current';
    workspaceViewState.historyTitle = '';
    workspaceViewState.backupRecord = null;
    document.body.classList.remove('history-view-mode');
    updateHistoryEditorReadonly();
}


function updateHistoryEditorReadonly() {
    const locked = workspaceViewState.mode === 'history';
    document.body.classList.toggle('history-view-mode', locked);

    ['btn-add-furnace', 'btn-import-excel', 'btn-clear-all-furnaces', 'btn-generate-plan'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = locked;
    });

    document.querySelectorAll(
        '#left-panel input, #left-panel select, #left-panel textarea, #left-panel button'
    ).forEach(el => {
        const keepClickable = el.id === 'btn-toggle-left-panel' ||
            el.id === 'panel-expand-btn-left' ||
            el.closest('.left-tab-btn') ||
            el.closest('.fid-close') ||
            el.closest('.mid-close');
        if (!keepClickable) el.disabled = locked;
    });
}

function restoreCurrentWorkspaceFromHistory() {
    const record = workspaceViewState.backupRecord;
    if (!record) {
        alert('没有找到可恢复的当前方案快照');
        return;
    }

    const snapshot = record;
    clearHistoryViewState();

    workbenchRecord.applyDigitalTwinRecordToWorkbench(snapshot, {
        sourceTitle: '当前工作台方案',
        closeLibrary: false,
        showSuccess: true
    });

    updateWorkbenchUiMode();
    refreshPlanLibraryWorkbench();
    updateCurrentToolingHud();
}

function renderCurrentWorkbenchPlanCard() {
    const card = document.getElementById('current-workbench-card');
    if (!card) return;

    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        card.className = 'current-workbench-card empty';
        card.innerHTML = `
            <div class="cwc-head">
                <div>
                    <div class="cwc-kicker">当前工作台方案</div>
                    <div class="cwc-title">暂无当前方案</div>
                </div>
                <span class="cwc-status">未生成</span>
            </div>
            <div class="cwc-metrics cwc-muted-line">生成方案后可保存为历史快照，也可与历史方案对比。</div>
        `;
        return;
    }

    const totalFurnaces = globalFurnacesResult.length;
    const totalItems = globalFurnacesResult.reduce((sum, f) => sum + ((f.packedItems || []).length), 0);
    const totalWeight = globalFurnacesResult.reduce((sum, f) => sum + Number(f.totalWeight || 0), 0);
    const unpacked = globalUnpackedItems ? globalUnpackedItems.length : 0;
    ensureCurrentWorkspaceIdentity();
    const workspaceTitle = getCurrentWorkspaceTitle();
    const updatedText = formatWorkspaceTime(currentWorkspaceIdentity.updatedAt);
    const isHistory = workspaceViewState.mode === 'history';
    const statusText = isHistory ? '历史查看' : (currentWorkspaceIdentity.status === 'saved' ? '已保存' : '当前');

    card.className = 'current-workbench-card' + (isHistory ? ' history-viewing' : '');
    card.innerHTML = `
        <div class="cwc-head">
            <div>
                <div class="cwc-kicker">${isHistory ? '正在查看历史方案' : '当前工作台方案'}</div>
                <div class="cwc-title">${isHistory ? (workspaceViewState.historyTitle || '历史方案') : workspaceTitle}</div>
                <div class="cwc-subtitle">${isHistory ? ('原当前方案：' + workspaceTitle) : (currentWorkspaceIdentity.id + (updatedText ? ' · ' + updatedText : ''))}</div>
            </div>
            <span class="cwc-status">${statusText}</span>
        </div>
        <div class="cwc-metrics">
            <span><b>${totalFurnaces}</b> 工装</span>
            <span><b>${totalItems}</b> 件</span>
            <span><b>${totalWeight.toFixed(1)}</b> kg</span>
            <span><b>${unpacked}</b> 未装</span>
            <span><b>${placementRules.strategy || '-'}</b></span>
        </div>
        ${isHistory ? `
            <button class="cwc-restore-btn" id="btn-restore-current-workspace" type="button">恢复当前方案</button>
            <div class="cwc-history-note">当前左侧工装/工件为历史快照，只读查看；点击恢复可回到加载历史前的工作台。</div>
        ` : `<div class="cwc-history-note">保存后进入历史方案，可用于后续对比。</div>`}
    `;

    const restoreBtn = card.querySelector('#btn-restore-current-workspace');
    if (restoreBtn) restoreBtn.addEventListener('click', restoreCurrentWorkspaceFromHistory);
}

function refreshPlanLibraryWorkbench() {
    renderCurrentWorkbenchPlanCard();
    setTimeout(enhancePlanLibraryCompareButtons, 0);
}

function enhancePlanLibraryCompareButtons() {
    renderCurrentWorkbenchPlanCard();
    const cards = document.querySelectorAll('#master-list .master-plan-card');
    const empty = document.getElementById('master-empty-state');
    if (empty) empty.style.display = cards.length ? 'none' : 'block';
    cards.forEach(card => {
        if (card.querySelector('[data-action="compare-plan"]')) return;

        let actionRow = card.querySelector('.mpc-actions');
        if (!actionRow) {
            actionRow = document.createElement('div');
            actionRow.className = 'mpc-actions';
            card.appendChild(actionRow);
        }

        const existingLoad = [...card.querySelectorAll('button')].find(btn => /加载|查看历史|恢复/.test(btn.textContent || '') && !btn.closest('.mpc-actions'));
        if (existingLoad) {
            existingLoad.classList.add('plan-card-action', 'load');
            existingLoad.textContent = '查看历史';
            existingLoad.title = '载入该历史方案进行查看；可从当前方案卡恢复原工作台';
            actionRow.appendChild(existingLoad);
        }

        const compareBtn = document.createElement('button');
        compareBtn.type = 'button';
        compareBtn.className = 'plan-card-action compare';
        compareBtn.setAttribute('data-action', 'compare-plan');
        compareBtn.textContent = '对比';
        actionRow.appendChild(compareBtn);

        const legacyDelete = card.querySelector('.mpc-delete');
        if (legacyDelete && !actionRow.querySelector('[data-action="delete-plan-proxy"]')) {
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'plan-card-action danger';
            deleteBtn.setAttribute('data-action', 'delete-plan-proxy');
            deleteBtn.textContent = '删除';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                legacyDelete.click();
                setTimeout(enhancePlanLibraryCompareButtons, 0);
            });
            actionRow.appendChild(deleteBtn);
        }
    });
}

function observePlanLibraryForCompareButtons() {
    const list = document.getElementById('master-list');
    if (!list) return;

    const observer = new MutationObserver(() => {
        refreshPlanLibraryWorkbench();
    });

    observer.observe(list, { childList: true, subtree: true });
    refreshPlanLibraryWorkbench();
}

function clearCompareDomLabels() {
    document.querySelectorAll('.compare-side-label').forEach(el => el.remove());
}

let compare3D = {
    current: null,
    history: null,
    animationId: null,
    activeDriver: 'current',
    syncing: false
};

function disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse(child => {
        if (child.geometry && typeof child.geometry.dispose === 'function') {
            child.geometry.dispose();
        }
        if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(mat => {
                if (mat && typeof mat.dispose === 'function') mat.dispose();
            });
        }
    });
}

function destroyCompareViews() {
    if (compare3D.animationId) {
        cancelAnimationFrame(compare3D.animationId);
    }

    [compare3D.current, compare3D.history].forEach(view => {
        if (!view) return;
        disposeObject3D(view.scene);
        if (view.controls && typeof view.controls.dispose === 'function') view.controls.dispose();
        if (view.renderer) {
            view.renderer.dispose();
            if (typeof view.renderer.forceContextLoss === 'function') {
                try { view.renderer.forceContextLoss(); } catch (_) {}
            }
        }
        if (view.container) view.container.innerHTML = '';
    });

    compare3D = {
        current: null,
        history: null,
        animationId: null,
        activeDriver: 'current',
        syncing: false
    };
}

function buildMiniGrid(size = 2600) {
    const grid = new THREE.GridHelper(size, 52, 0xcbd5e1, 0xe2e8f0);
    grid.position.y = -120;
    return grid;
}

function fitMiniCamera(view, furnace) {
    if (!view || !view.camera || !view.controls) return;

    const box = new THREE.Box3().setFromObject(view.group);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z, furnace?.w || 900, furnace?.h || 900, furnace?.d || 900, 1);
    const distance = maxDim * 1.85;
    const target = center.clone();
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) {
        target.set(0, (furnace?.h || 900) / 2 - 120, 0);
    }

    view.controls.target.copy(target);
    view.camera.position.set(target.x + distance * 0.9, target.y + distance * 0.72, target.z + distance * 1.28);
    view.camera.near = Math.max(1, distance / 80);
    view.camera.far = Math.max(10000, distance * 8);
    view.camera.updateProjectionMatrix();
    view.controls.update();

    view.baseTarget = target.clone();
    view.baseDistance = view.camera.position.distanceTo(view.controls.target) || distance;
}

function createCompareMiniView(containerId, furnace, role) {
    const container = document.getElementById(containerId);
    if (!container || !furnace) return null;

    container.innerHTML = '';

    const scene3d = new THREE.Scene();
    scene3d.background = new THREE.Color(0xf8fafc);

    const width = Math.max(280, container.clientWidth || 420);
    const height = Math.max(220, container.clientHeight || 320);
    const cam = new THREE.PerspectiveCamera(45, width / height, 1, 10000);

    const rend = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    rend.setSize(width, height);
    rend.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rend.shadowMap.enabled = false;
    container.appendChild(rend.domElement);

    const ctrl = new OrbitControls(cam, rend.domElement);
    ctrl.enableDamping = true;
    ctrl.dampingFactor = 0.06;
    ctrl.enablePan = true;

    scene3d.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 0.74);
    key.position.set(500, 900, 650);
    scene3d.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.28);
    fill.position.set(-500, 300, -650);
    scene3d.add(fill);
    scene3d.add(buildMiniGrid(Math.max(2200, Math.max(furnace.w || 0, furnace.d || 0) * 2.8)));

    const group = buildFurnaceGroup(furnace, role === 'current' ? 0 : 1, getSelectedMaterialName());
    group.visible = true;
    scene3d.add(group);

    const view = {
        role,
        container,
        scene: scene3d,
        camera: cam,
        renderer: rend,
        controls: ctrl,
        group,
        baseTarget: new THREE.Vector3(),
        baseDistance: 1
    };

    fitMiniCamera(view, furnace);

    ctrl.addEventListener('start', () => {
        compare3D.activeDriver = role;
    });
    ctrl.addEventListener('change', () => {
        if (!compare3D.syncing) compare3D.activeDriver = role;
    });

    return view;
}

function resizeCompareView(view) {
    if (!view || !view.container || !view.renderer || !view.camera) return;
    const width = Math.max(280, view.container.clientWidth || 420);
    const height = Math.max(220, view.container.clientHeight || 320);
    view.camera.aspect = width / height;
    view.camera.updateProjectionMatrix();
    view.renderer.setSize(width, height);
}

function resizeCompareViews() {
    resizeCompareView(compare3D.current);
    resizeCompareView(compare3D.history);
}

function syncMiniCamera(source, target) {
    if (!source || !target || !source.controls || !target.controls) return;

    const direction = new THREE.Vector3().subVectors(source.camera.position, source.controls.target);
    const sourceDistance = Math.max(1, direction.length());
    direction.normalize();

    const ratio = source.baseDistance > 0 ? sourceDistance / source.baseDistance : 1;
    const targetDistance = Math.max(1, target.baseDistance * ratio);

    compare3D.syncing = true;
    target.controls.target.copy(target.baseTarget || target.controls.target);
    target.camera.position.copy(target.controls.target).add(direction.multiplyScalar(targetDistance));
    target.camera.quaternion.copy(source.camera.quaternion);
    target.controls.update();
    compare3D.syncing = false;
}

function animateCompareViews() {
    compare3D.animationId = requestAnimationFrame(animateCompareViews);

    const currentView = compare3D.current;
    const historyView = compare3D.history;
    if (!currentView || !historyView) return;

    currentView.controls.update();
    historyView.controls.update();

    if (compare3D.activeDriver === 'history') {
        syncMiniCamera(historyView, currentView);
    } else {
        syncMiniCamera(currentView, historyView);
    }

    currentView.renderer.render(currentView.scene, currentView.camera);
    historyView.renderer.render(historyView.scene, historyView.camera);
}

function renderCompare3DViews(currentFurnace, historyFurnace) {
    destroyCompareViews();

    compare3D.current = createCompareMiniView('compare-current-canvas', currentFurnace, 'current');
    compare3D.history = createCompareMiniView('compare-history-canvas', historyFurnace, 'history');

    if (!compare3D.current || !compare3D.history) return;

    compare3D.activeDriver = 'current';
    syncMiniCamera(compare3D.current, compare3D.history);
    animateCompareViews();
}

function setCompareLayout(mode) {
    const viewports = document.getElementById('compare-viewports');
    if (!viewports) return;
    viewports.classList.toggle('horizontal', mode !== 'vertical');
    viewports.classList.toggle('vertical', mode === 'vertical');
    setTimeout(resizeCompareViews, 80);
}

function numFromPercentText(text) {
    const n = parseFloat(String(text || '').replace('%', ''));
    return Number.isFinite(n) ? n : NaN;
}

function signedDeltaText(delta, suffix = '') {
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.05) return { text: '持平', cls: 'equal' };
    return { text: `${delta > 0 ? '+' : ''}${delta.toFixed(Math.abs(delta) >= 10 ? 0 : 1)}${suffix}`, cls: delta > 0 ? 'positive' : 'negative' };
}

function updateCompareDiffSummary(currentFurnace, historyFurnace, currentUnpacked, historyUnpacked) {
    const el = document.getElementById('compare-diff-summary');
    if (!el) return;

    const c = getFurnaceMetricSummary(currentFurnace, compareState.currentIndex, globalFurnacesResult?.length || 0, currentUnpacked);
    const h = getFurnaceMetricSummary(historyFurnace, compareState.historyIndex, compareState.historicalFurnaces?.length || 0, historyUnpacked);

    const currentItems = (currentFurnace?.packedItems || []).length;
    const historyItems = (historyFurnace?.packedItems || []).length;
    const currentWeight = Number(currentFurnace?.totalWeight || 0);
    const historyWeight = Number(historyFurnace?.totalWeight || 0);
    const currentLayers = getCurrentToolingLayerCount(currentFurnace);
    const historyLayers = getCurrentToolingLayerCount(historyFurnace);
    const currentSpace = numFromPercentText(c.spaceRate);
    const historySpace = numFromPercentText(h.spaceRate);

    const itemsDelta = signedDeltaText(currentItems - historyItems, '件');
    const weightDelta = signedDeltaText(currentWeight - historyWeight, 'kg');
    const layerDelta = signedDeltaText(currentLayers - historyLayers, '层');
    const spaceDelta = signedDeltaText(currentSpace - historySpace, '%');
    const unpackedDelta = signedDeltaText((currentUnpacked || 0) - (historyUnpacked || 0), '件');

    el.innerHTML = `
        <span>差异</span>
        <b class="${itemsDelta.cls}">已装 ${itemsDelta.text}</b>
        <b class="${weightDelta.cls}">重量 ${weightDelta.text}</b>
        <b class="${layerDelta.cls}">层数 ${layerDelta.text}</b>
        <b class="${spaceDelta.cls}">空间 ${spaceDelta.text}</b>
        <b class="${unpackedDelta.cls}">未装 ${unpackedDelta.text}</b>
    `;
}

function addCompareSideLabels(mode) {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    clearCompareDomLabels();

    const currentLabel = document.createElement('div');
    currentLabel.className = 'compare-side-label compare-current-label';
    currentLabel.textContent = '当前方案';

    const historyLabel = document.createElement('div');
    historyLabel.className = 'compare-side-label compare-history-label';
    historyLabel.textContent = '历史方案';

    if (mode === 'vertical') {
        currentLabel.style.left = '50%';
        currentLabel.style.transform = 'translateX(-50%)';
        currentLabel.style.top = '92px';
        historyLabel.style.left = '50%';
        historyLabel.style.transform = 'translateX(-50%)';
        historyLabel.style.bottom = '126px';
        historyLabel.style.top = 'auto';
    } else {
        currentLabel.style.left = '28%';
        currentLabel.style.transform = 'translateX(-50%)';
        historyLabel.style.right = '28%';
        historyLabel.style.transform = 'translateX(50%)';
    }

    container.appendChild(currentLabel);
    container.appendChild(historyLabel);
}

function renderCompareMode() {
    if (!compareState.active) return;

    const currentFurnaces = globalFurnacesResult || [];
    const historyFurnaces = compareState.historicalFurnaces || [];
    if (!currentFurnaces.length || !historyFurnaces.length) return;

    compareState.currentIndex = clampIndex(compareState.currentIndex, currentFurnaces.length);
    compareState.historyIndex = clampIndex(compareState.historyIndex, historyFurnaces.length);

    const currentFurnace = currentFurnaces[compareState.currentIndex];
    const historyFurnace = historyFurnaces[compareState.historyIndex];

    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';

    const currentHud = document.getElementById('current-tooling-hud');
    if (currentHud) currentHud.style.display = 'none';

    const modal = document.getElementById('compare-modal');
    if (modal) modal.style.display = 'flex';

    const title = document.getElementById('compare-title');
    if (title) title.textContent = `当前方案 vs ${compareState.title || '历史方案'}`;

    document.querySelectorAll('[data-compare-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-compare-mode') === compareState.mode);
    });
    setCompareLayout(compareState.mode);

    const currentUnpacked = globalUnpackedItems ? globalUnpackedItems.length : 0;
    const historyUnpacked = compareState.historicalRecord?.loadingPlan?.unpackedItems?.length || compareState.historicalRecord?.unpackedItems?.length || 0;

    renderCompareHud('compare-current-hud', 'current', currentFurnace, compareState.currentIndex, currentFurnaces.length, currentUnpacked);
    renderCompareHud('compare-history-hud', 'history', historyFurnace, compareState.historyIndex, historyFurnaces.length, historyUnpacked);
    updateCompareDiffSummary(currentFurnace, historyFurnace, currentUnpacked, historyUnpacked);

    renderCompare3DViews(currentFurnace, historyFurnace);
}

function enterCompareMode(record, title) {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        alert('请先生成当前工作台方案，再与历史方案对比');
        return;
    }

    const historyFurnaces = normalizeRuntimeFurnacesFromRecord(record);
    if (!historyFurnaces || historyFurnaces.length === 0) {
        alert('该历史方案没有可用于 3D 对比的装炉结果，请先加载或重新保存为数字孪生记录');
        return;
    }

    compareState = {
        active: true,
        mode: compareState.mode || 'horizontal',
        title: title || getPlanRecordTitle(record),
        historicalRecord: record,
        historicalFurnaces: historyFurnaces,
        currentIndex: clampIndex(currentFurnaceIndex, globalFurnacesResult.length),
        historyIndex: clampIndex(currentFurnaceIndex, historyFurnaces.length)
    };

    document.body.classList.add('compare-mode');
    renderCompareMode();
}

function exitCompareMode(restoreScene = true) {
    if (!compareState.active && restoreScene === false) return;

    compareState.active = false;
    document.body.classList.remove('compare-mode');

    destroyCompareViews();

    const modal = document.getElementById('compare-modal');
    if (modal) modal.style.display = 'none';
    const currentHud = document.getElementById('compare-current-hud');
    const historyHud = document.getElementById('compare-history-hud');
    if (currentHud) currentHud.style.display = 'none';
    if (historyHud) historyHud.style.display = 'none';
    clearCompareDomLabels();

    if (!restoreScene) return;

    if (globalFurnacesResult && globalFurnacesResult.length > 0) {
        const idx = clampIndex(currentFurnaceIndex, globalFurnacesResult.length);
        clearFurnaceGroups();
    clearThermalSimulationLayer();
        renderSingleFurnace(idx, getSelectedMaterialName());
        updateFurnaceNav();
        updateLeftPanelActiveForIndex(idx);
        renderAISummaryBar(onCenterFurnaceClick);
        updateCurrentToolingHud();
        renderLoadingSimulationPanel();
        updateSimulationModeButtons();
        renderFurnaceThumbnails(globalFurnacesResult, idx, handleThumbFurnaceClick);
    }
}

function stepCompare(delta) {
    if (!compareState.active) return;
    const currentLen = globalFurnacesResult?.length || 0;
    const historyLen = compareState.historicalFurnaces?.length || 0;
    const maxLen = Math.max(currentLen, historyLen);
    if (!maxLen) return;

    const next = (compareState.currentIndex + delta + maxLen) % maxLen;
    compareState.currentIndex = clampIndex(next, currentLen);
    compareState.historyIndex = clampIndex(next, historyLen);
    setCurrentFurnaceIndex(compareState.currentIndex);
    renderCompareMode();
    renderFurnaceThumbnails(globalFurnacesResult, compareState.currentIndex, handleThumbFurnaceClick);
}

function bindCompareModeEvents() {
    const masterList = document.getElementById('master-list');
    if (masterList) {
        masterList.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="compare-plan"]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const card = btn.closest('.master-plan-card');
            const record = findRecordForPlanCard(card);
            if (!record) {
                alert('没有找到该历史方案的数字孪生记录，建议重新保存当前方案后再对比');
                return;
            }
            enterCompareMode(record, card?.querySelector('.mpc-title')?.textContent?.trim() || getPlanRecordTitle(record));
        });
    }

    document.querySelectorAll('[data-compare-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            compareState.mode = btn.getAttribute('data-compare-mode') || 'horizontal';
            renderCompareMode();
        });
    });

    const prev = document.getElementById('compare-prev');
    if (prev) prev.addEventListener('click', () => stepCompare(-1));

    const next = document.getElementById('compare-next');
    if (next) next.addEventListener('click', () => stepCompare(1));

    const exit = document.getElementById('compare-exit');
    if (exit) exit.addEventListener('click', () => exitCompareMode(true));

    window.addEventListener('resize', resizeCompareViews);
}

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
        'thermal-mode-row',
        'btn-mode-thermal',
        'btn-mode-radiation',
        'btn-play-thermal',
        'btn-pause-thermal',
        'btn-render-thermal',
        'btn-reset-thermal',
        'thermal-speed-select',
        'thermal-scrub-row',
        'btn-save-plan-library'
    ];

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = (id === 'thermal-scrub-row' || id === 'thermal-mode-row') ? 'flex' : 'inline-block';
            el.disabled = false;
            el.style.opacity = '1';
        }
    });
}

function hidePlanActionButtons() {
    const ids = [
        'btn-export-pdf',
        'btn-animate',
        'thermal-mode-row',
        'btn-mode-thermal',
        'btn-mode-radiation',
        'btn-play-thermal',
        'btn-pause-thermal',
        'btn-render-thermal',
        'btn-reset-thermal',
        'thermal-speed-select',
        'thermal-scrub-row',
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
    document.body.classList.toggle('history-view-mode', workspaceViewState.mode === 'history');

    updateEmptyStateCopy({
        hasFurnaces,
        hasMaterials,
        hasPlan
    });

    syncLeftPanelActionButton();
}

function updateEmptyStateCopy({ hasFurnaces, hasMaterials, hasPlan }) {
    const msg = document.querySelector('#empty-state .msg');
    if (!msg || hasPlan) return;

    if (!hasFurnaces && !hasMaterials) {
        msg.innerHTML = `
            <b style="color:#1E293B;">开始创建装炉方案</b><br>
            ① 左侧添加炉膛 / 工装<br>
            ② 右侧添加或导入物料<br>
            ③ 点击右上角 <b style="color:#2563EB;">生成方案</b>
        `;
        return;
    }

    if (hasFurnaces && !hasMaterials) {
        msg.innerHTML = `
            <b style="color:#1E293B;">炉膛 / 工装已准备</b><br>
            请在右侧添加或导入物料<br>
            完成后点击右上角 <b style="color:#2563EB;">生成方案</b>
        `;
        return;
    }

    if (!hasFurnaces && hasMaterials) {
        msg.innerHTML = `
            <b style="color:#1E293B;">物料已准备</b><br>
            请在左侧添加炉膛 / 工装<br>
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



function getThermalDurationFromUi() {
    const select = document.getElementById('thermal-speed-select');
    const v = select ? parseInt(select.value, 10) : 9000;
    return Number.isFinite(v) && v > 0 ? v : 9000;
}

function updateProcessSimulationModeButtons() {
    document.querySelectorAll('.process-sim-mode-btn').forEach(btn => {
        const mode = btn.getAttribute('data-process-sim-mode');
        btn.classList.toggle('active', mode === processSimulationMode);
    });
}

function syncThermalControlState(metrics = null) {
    const runtime = typeof getVacuumQuenchThermalRuntime === 'function'
        ? getVacuumQuenchThermalRuntime()
        : { isPlaying: false, paused: false, progress: 0, activeMode: processSimulationMode };

    const playBtn = document.getElementById('btn-play-thermal');
    const pauseBtn = document.getElementById('btn-pause-thermal');
    const renderBtn = document.getElementById('btn-render-thermal');
    const range = document.getElementById('thermal-progress-range');
    const value = document.getElementById('thermal-progress-value');

    if (playBtn) {
        playBtn.disabled = processSimulationMode !== 'thermal';
        playBtn.style.opacity = processSimulationMode === 'thermal' ? '1' : '0.42';
        playBtn.textContent = runtime.isPlaying ? '重新播放' : (runtime.paused ? '继续播放' : '播放升温热场');
    }

    if (pauseBtn) {
        const canPause = processSimulationMode === 'thermal' && runtime.visible;
        pauseBtn.disabled = !canPause;
        pauseBtn.style.opacity = canPause ? '1' : '0.42';
        pauseBtn.textContent = runtime.isPlaying ? '暂停' : '继续';
    }

    if (renderBtn) {
        renderBtn.textContent = processSimulationMode === 'radiation' ? '显示辐射暴露' : '显示升温热场';
    }

    const progress = metrics?.progress != null
        ? metrics.progress
        : Math.round((runtime.progress || 0) * 100);

    if (range && document.activeElement !== range) {
        range.disabled = processSimulationMode !== 'thermal';
        range.value = String(Math.max(0, Math.min(100, progress)));
    }
    if (value) value.textContent = processSimulationMode === 'radiation' ? '—' : `${Math.max(0, Math.min(100, progress))}%`;
    updateProcessSimulationModeButtons();
}

function renderCurrentThermalSimulation(progress = 0.18, switchTab = true) {
    processSimulationMode = 'thermal';
    document.body.classList.remove('radiation-pick-mode');
    const metrics = renderVacuumQuenchThermalSimulation(progress);
    renderThermalSimulationPanel(metrics, 'thermal');
    syncThermalControlState(metrics);
    if (switchTab) activateRightPanelTab('thermal');
    return metrics;
}

function renderCurrentRadiationSimulation(switchTab = true) {
    processSimulationMode = 'radiation';
    document.body.classList.add('radiation-pick-mode');
    stopVacuumQuenchThermalSimulation();
    const metrics = renderRadiationExposureSimulation();
    renderThermalSimulationPanel(metrics, 'radiation');
    syncThermalControlState(metrics);
    if (switchTab) activateRightPanelTab('thermal');
    return metrics;
}

function renderCurrentProcessSimulation() {
    if (processSimulationMode === 'radiation') {
        return renderCurrentRadiationSimulation(true);
    }
    const runtime = getVacuumQuenchThermalRuntime();
    const p = runtime?.activeMode === 'thermal' ? (runtime.progress || 0.18) : 0.18;
    return renderCurrentThermalSimulation(p, true);
}

function switchProcessSimulationMode(mode) {
    processSimulationMode = mode === 'radiation' ? 'radiation' : 'thermal';
    if (processSimulationMode === 'radiation') {
        renderCurrentRadiationSimulation(true);
    } else {
        const runtime = getVacuumQuenchThermalRuntime();
        renderCurrentThermalSimulation(runtime?.progress || 0.18, true);
    }
}

function playCurrentThermalSimulation() {
    processSimulationMode = 'thermal';
    document.body.classList.remove('radiation-pick-mode');
    activateRightPanelTab('thermal');
    const runtime = getVacuumQuenchThermalRuntime();
    const startProgress = runtime.paused && runtime.activeMode === 'thermal' ? (runtime.progress || 0) : 0.03;

    const metrics = playVacuumQuenchThermalSimulation({
        durationMs: getThermalDurationFromUi(),
        startProgress,
        onUpdate: (nextMetrics) => {
            renderThermalSimulationPanel(nextMetrics, 'thermal');
            syncThermalControlState(nextMetrics);
        },
        onFinish: (finalMetrics) => {
            renderThermalSimulationPanel(finalMetrics, 'thermal');
            syncThermalControlState(finalMetrics);
        }
    });

    if (!metrics) renderThermalSimulationPanel(null, 'thermal');
    syncThermalControlState(metrics);
}

function pauseResumeCurrentThermalSimulation() {
    processSimulationMode = 'thermal';
    document.body.classList.remove('radiation-pick-mode');
    activateRightPanelTab('thermal');
    const runtime = getVacuumQuenchThermalRuntime();

    if (runtime.isPlaying) {
        const metrics = pauseVacuumQuenchThermalSimulation();
        if (metrics) renderThermalSimulationPanel(metrics, 'thermal');
        syncThermalControlState(metrics);
        return;
    }

    const metrics = resumeVacuumQuenchThermalSimulation({
        durationMs: getThermalDurationFromUi(),
        onUpdate: (nextMetrics) => {
            renderThermalSimulationPanel(nextMetrics, 'thermal');
            syncThermalControlState(nextMetrics);
        },
        onFinish: (finalMetrics) => {
            renderThermalSimulationPanel(finalMetrics, 'thermal');
            syncThermalControlState(finalMetrics);
        }
    });

    if (metrics) renderThermalSimulationPanel(metrics, 'thermal');
    syncThermalControlState(metrics);
}

function resetCurrentThermalSimulation() {
    document.body.classList.remove('radiation-pick-mode');
    stopVacuumQuenchThermalSimulation();
    clearThermalSimulationLayer();
    renderThermalSimulationPanel(null, processSimulationMode);
    syncThermalControlState(null);
}

function scrubCurrentThermalSimulation(progressPercent) {
    processSimulationMode = 'thermal';
    document.body.classList.remove('radiation-pick-mode');
    const p = Math.max(0, Math.min(100, progressPercent || 0)) / 100;
    const metrics = setVacuumQuenchThermalProgress(p);
    renderThermalSimulationPanel(metrics, 'thermal');
    syncThermalControlState(metrics);
    activateRightPanelTab('thermal');
}

function restartThermalWithCurrentSpeedIfPlaying() {
    const runtime = getVacuumQuenchThermalRuntime();
    if (!runtime.visible || runtime.activeMode !== 'thermal') return;
    if (runtime.isPlaying) {
        playVacuumQuenchThermalSimulation({
            durationMs: getThermalDurationFromUi(),
            startProgress: runtime.progress || 0,
            onUpdate: (nextMetrics) => {
                renderThermalSimulationPanel(nextMetrics, 'thermal');
                syncThermalControlState(nextMetrics);
            },
            onFinish: (finalMetrics) => {
                renderThermalSimulationPanel(finalMetrics, 'thermal');
                syncThermalControlState(finalMetrics);
            }
        });
    }
}


function isRadiationModeActive() {
    const runtime = typeof getRadiationExposureRuntime === 'function' ? getRadiationExposureRuntime() : null;
    const activeModeBtn = document.querySelector('.process-sim-mode-btn.active');
    const activeMode = activeModeBtn ? activeModeBtn.getAttribute('data-process-sim-mode') : '';
    return processSimulationMode === 'radiation' ||
        !!runtime?.visible ||
        document.body.classList.contains('radiation-pick-mode') ||
        activeMode === 'radiation';
}

function ensureRadiationOverviewVisible() {
    processSimulationMode = 'radiation';
    document.body.classList.add('radiation-pick-mode');
    const runtime = typeof getRadiationExposureRuntime === 'function' ? getRadiationExposureRuntime() : null;
    if (!runtime?.visible) {
        return renderCurrentRadiationSimulation(false);
    }
    return runtime.metrics || null;
}

let radiationPickPointerDown = null;
let radiationSectionPlaneDragging = false;

// function renderSelectedRadiationMetrics(metrics) {
//     if (!metrics) return;

//     // 关键修复：必须先切到右侧热场 Tab，再渲染选中态数据。
//     // activateRightPanelTab('thermal') 会触发 tab click，原逻辑会重绘一次默认面板；
//     // 如果先 renderThermalSimulationPanel(metrics)，随后再 activateRightPanelTab，
//     // 选中/批次诊断会被默认面板覆盖。
//     processSimulationMode = 'radiation';
//     document.body.classList.add('radiation-pick-mode');
//     activateRightPanelTab('thermal');

//     renderThermalSimulationPanel(metrics, 'radiation');
//     syncThermalControlState(metrics);
// }
function renderSelectedRadiationMetrics(metrics) {
    if (!metrics) return;

    processSimulationMode = 'radiation';
    document.body.classList.add('radiation-pick-mode');
    activateRightPanelTab('thermal');

    renderThermalSimulationPanel(metrics, 'radiation');
    syncThermalControlState(metrics);
}


function selectRadiationBatchFromMaterialCard(card) {
    if (!card || !isRadiationModeActive()) return;

    ensureRadiationOverviewVisible();

    const cardName = card.querySelector('.m-name')?.textContent?.trim() || '';
    const itemCode = card.getAttribute('data-item-code') || '';
    const showName = card.getAttribute('data-show-name') || '';
    if (!cardName && !itemCode && !showName) return;

    // 左侧卡片代表“物料批次/类型”，不是某一个 3D 实例。
    // 因此这里进入批次辐射诊断；需要看单件路径时再点击 3D 工件或“定位最低暴露件”。
    processSimulationMode = 'radiation';
    document.body.classList.add('radiation-pick-mode');
    const metrics = selectRadiationExposureBatch({
        name: cardName,
        itemCode,
        showName
    });
    renderSelectedRadiationMetrics(metrics || getRadiationExposureRuntime()?.metrics || null);
}

function bindRadiationMaterialCardSelection() {
    // 用 document 级事件委托，而不是只绑定当前 material-cards-container。
    // 原因：左侧物料卡片会被清空、重新生成、导入、筛选，容器/卡片生命周期不稳定。
    if (document.body.dataset.radiationMaterialPickBound === '1') return;
    document.body.dataset.radiationMaterialPickBound = '1';

    document.addEventListener('click', (event) => {
        const card = event.target.closest('#material-cards-container .material-card');
        if (!card || !isRadiationModeActive()) return;

        // 让原有 selectMaterialCard / showMaterialDetail 先执行完，避免和左侧详情面板抢状态。
        setTimeout(() => selectRadiationBatchFromMaterialCard(card), 0);
    }, true);
}

function bindRadiationDiagnosisActions() {
    // 同样使用 document 事件委托，避免 thermal-simulation-panel 重绘后按钮丢失监听。
    if (document.body.dataset.radiationDiagnosisBound === '1') return;
    document.body.dataset.radiationDiagnosisBound = '1';

    document.addEventListener('click', (event) => {
        const locateBtn = event.target.closest('[data-action="radiation-locate-worst"]');
        const sectionBtn = event.target.closest('[data-action="radiation-section-view"]');
        const sectionExitBtn = event.target.closest('[data-action="radiation-section-exit"]');
        const sectionDirBtn = event.target.closest('[data-action="radiation-section-direction"]');
        const sectionResetBtn = event.target.closest('[data-action="radiation-section-reset"]');

        if (!locateBtn && !sectionBtn && !sectionExitBtn && !sectionDirBtn && !sectionResetBtn) return;

        event.preventDefault();
        event.stopPropagation();

        processSimulationMode = 'radiation';
        document.body.classList.add('radiation-pick-mode');
        ensureRadiationOverviewVisible();

        let metrics = null;
        if (locateBtn) {
            metrics = selectLowestRadiationExposureItemInCurrentBatch();
        } else if (sectionBtn) {
            metrics = enterRadiationSectionView();
        } else if (sectionExitBtn) {
            metrics = exitRadiationSectionView();
        } else if (sectionDirBtn) {
            metrics = setRadiationSectionDirection(sectionDirBtn.getAttribute('data-section-dir') || 'z+');
        } else if (sectionResetBtn) {
            metrics = setRadiationSectionOffset(0);
        }

        renderSelectedRadiationMetrics(metrics || getRadiationExposureRuntime()?.metrics || null);
    }, true);

    document.addEventListener('input', (event) => {
        const offsetInput = event.target.closest('[data-action="radiation-section-offset"]');
        if (!offsetInput) return;

        event.preventDefault();
        event.stopPropagation();

        processSimulationMode = 'radiation';
        document.body.classList.add('radiation-pick-mode');
        ensureRadiationOverviewVisible();

        const metrics = setRadiationSectionOffset(parseFloat(offsetInput.value || '0'));
        renderSelectedRadiationMetrics(metrics || getRadiationExposureRuntime()?.metrics || null);
    }, true);
}

function isRadiationCanvasEventTarget(event) {
    const container = document.getElementById('canvas-container');
    if (!container || !event.target || !container.contains(event.target)) return false;
    // HUD、底部 dock、空态等 UI 不触发 3D 拾取。
    if (event.target.closest('#current-tooling-hud, #empty-state, #furnace-thumb-bar, #three-dock, .view-dock, .current-tooling-hud')) {
        return false;
    }
    return true;
}

function bindRadiationItemSelection() {
    const container = document.getElementById('canvas-container');
    if (!container || container.dataset.radiationPickBound === '1') return;
    container.dataset.radiationPickBound = '1';

    container.addEventListener('pointerdown', (event) => {
        if (!isRadiationModeActive() || !isRadiationCanvasEventTarget(event)) return;

        // 如果点中蓝色 clipping plane，进入沿法线拖动模式，不再触发普通 3D 工件拾取。
        if (tryStartRadiationSectionDragAtClientPoint(event.clientX, event.clientY)) {
            radiationSectionPlaneDragging = true;
            radiationPickPointerDown = null;
            event.preventDefault();
            event.stopPropagation();
            if (event.stopImmediatePropagation) event.stopImmediatePropagation();
            return;
        }

        radiationPickPointerDown = {
            x: event.clientX,
            y: event.clientY,
            t: performance.now()
        };
    }, true);

    container.addEventListener('pointermove', (event) => {
        if (!radiationSectionPlaneDragging) return;
        const metrics = dragRadiationSectionPlaneToClientPoint(event.clientX, event.clientY);
        renderSelectedRadiationMetrics(metrics || getRadiationExposureRuntime()?.metrics || null);
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }, true);

    container.addEventListener('pointerup', (event) => {
        if (radiationSectionPlaneDragging) {
            radiationSectionPlaneDragging = false;
            const metrics = endRadiationSectionDrag();
            renderSelectedRadiationMetrics(metrics || getRadiationExposureRuntime()?.metrics || null);
            event.preventDefault();
            event.stopPropagation();
            if (event.stopImmediatePropagation) event.stopImmediatePropagation();
            return;
        }

        if (!isRadiationModeActive() || !isRadiationCanvasEventTarget(event)) return;
        if (!radiationPickPointerDown) return;

        const dx = Math.abs(event.clientX - radiationPickPointerDown.x);
        const dy = Math.abs(event.clientY - radiationPickPointerDown.y);
        const dt = performance.now() - radiationPickPointerDown.t;
        radiationPickPointerDown = null;

        // OrbitControls 拖拽旋转时不触发选择。
        if (dx > 6 || dy > 6 || dt > 700) return;

        processSimulationMode = 'radiation';
        document.body.classList.add('radiation-pick-mode');
        ensureRadiationOverviewVisible();

        const metrics = selectRadiationExposureItemAtClientPoint(event.clientX, event.clientY);

        // 关键：3D 单件点击不能 fallback 到 runtime.metrics。
        if (metrics && metrics.selectedItem) {
            renderSelectedRadiationMetrics(metrics);
        }
    }, true);

    window.addEventListener('pointerup', () => {
        if (!radiationSectionPlaneDragging) return;
        radiationSectionPlaneDragging = false;
        const metrics = endRadiationSectionDrag();
        renderSelectedRadiationMetrics(metrics || getRadiationExposureRuntime()?.metrics || null);
    }, true);
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
    renderThermalSimulationPanel(null, processSimulationMode);
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

    if (compareState.active) {
        stepCompare(direction);
        return;
    }

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
    updateCurrentToolingHud();
    renderLoadingSimulationPanel();
    renderThermalSimulationPanel(null, processSimulationMode);
    updateSimulationModeButtons();

    renderFurnaceThumbnails(
        globalFurnacesResult,
        newIndex,
        handleThumbFurnaceClick
    );
}

function handleThumbFurnaceClick(clickedIdx) {
    if (compareState.active) {
        compareState.currentIndex = clampIndex(clickedIdx, globalFurnacesResult?.length || 0);
        compareState.historyIndex = clampIndex(clickedIdx, compareState.historicalFurnaces?.length || 0);
        setCurrentFurnaceIndex(compareState.currentIndex);
        renderCompareMode();
        renderFurnaceThumbnails(globalFurnacesResult, compareState.currentIndex, handleThumbFurnaceClick);
        return;
    }

    setCurrentFurnaceIndex(clickedIdx);

    const filterName = getSelectedMaterialName();

    renderSingleFurnace(clickedIdx, filterName);
    focusLayer(null);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(clickedIdx);
    renderAISummaryBar(onCenterFurnaceClick);
    updateCurrentToolingHud();
    renderLoadingSimulationPanel();
    renderThermalSimulationPanel(null, processSimulationMode);
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
    if (compareState.active) {
        compareState.currentIndex = clampIndex(idx, globalFurnacesResult?.length || 0);
        compareState.historyIndex = clampIndex(idx, compareState.historicalFurnaces?.length || 0);
        setCurrentFurnaceIndex(compareState.currentIndex);
        renderCompareMode();
        return;
    }

    setCurrentFurnaceIndex(idx);

    const filterName = getSelectedMaterialName();

    renderSingleFurnace(idx, filterName);
    focusLayer(null);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(idx);
    renderAISummaryBar(onCenterFurnaceClick);
    updateCurrentToolingHud();

    renderFurnaceThumbnails(
        globalFurnacesResult,
        idx,
        handleThumbFurnaceClick
    );
    renderLoadingSimulationPanel();
    renderThermalSimulationPanel(null, processSimulationMode);
    updateSimulationModeButtons();
}

/**
 * 显示方案库视图
 */
function showMasterView() {
    document.body.classList.add('library-mode');

    const masterView = document.getElementById("master-view");
    if (masterView) masterView.classList.add("active");

    const furnaceNav = document.getElementById("furnace-nav");
    if (furnaceNav) furnaceNav.style.display = "none";

    const canvasContainer = document.getElementById("canvas-container");
    if (canvasContainer) canvasContainer.style.display = "none";

    const animControlBar = document.getElementById("anim-control-bar");
    if (animControlBar) animControlBar.classList.remove("visible");

    hideExplodeBOMButtons();

    planLibrary.renderPlanLibraryList();
    refreshPlanLibraryWorkbench();
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
    document.body.classList.remove('library-mode');

    document.getElementById("master-view").classList.remove("active");
    document.getElementById("canvas-container").style.display = "block";

    if (globalFurnacesResult && globalFurnacesResult.length > 0) {
        document.getElementById("furnace-nav").style.display = "flex";
        updateExplodeBOMButtons();
    }

     updateWorkbenchUiMode();
}


function addDefaultMaterial() {
    const color = generateUniqueColor(usedColors);
    createMaterialCard("新工件批次", "cuboid", 50, 150, 150, 60, 10, color);
    updateTopSummary();
    updateWorkbenchUiMode();
}


function getActiveLeftPanelTab() {
    const activeBtn = document.querySelector('.left-tab-btn.active');
    return activeBtn ? activeBtn.getAttribute('data-tab') : 'furnace';
}

function syncLeftPanelActionButton() {
    const tab = getActiveLeftPanelTab();
    const addBtn = document.getElementById('btn-add-furnace');
    const importBtn = document.getElementById('btn-import-excel');
    const clearBtn = document.getElementById('btn-clear-all-furnaces');

    document.body.classList.toggle('left-tab-furnace-active', tab === 'furnace');
    document.body.classList.toggle('left-tab-tooling-active', tab === 'tooling');
    document.body.classList.toggle('left-tab-material-active', tab === 'material');

    if (!addBtn || !clearBtn) return;

    addBtn.disabled = false;
    clearBtn.style.display = 'inline-flex';

    if (tab === 'material') {
        addBtn.textContent = '增加';
        addBtn.title = '新增待热处理工件';
        if (importBtn) {
            importBtn.textContent = '导入';
            importBtn.title = '从 Excel 导入工件';
            importBtn.style.display = 'inline-flex';
        }
        clearBtn.textContent = '清空';
        clearBtn.title = '清空所有待装工件，保留工装';
        return;
    }

    if (tab === 'tooling') {
        addBtn.textContent = '待链接';
        addBtn.title = '生产车间后续用于链接真实工厂设备';
        addBtn.disabled = true;
        if (importBtn) importBtn.style.display = 'none';
        clearBtn.style.display = 'none';
        return;
    }

    addBtn.textContent = '增加工装';
    addBtn.title = '新增标准料框、料盘、网篮或环形工装';
    if (importBtn) importBtn.style.display = 'none';
    clearBtn.textContent = '清空';
    clearBtn.title = '清空所有工装、工件和装炉结果';
}

function handleLeftPanelPrimaryAction() {
    const tab = getActiveLeftPanelTab();

    if (tab === 'material') {
        addDefaultMaterial();
        return;
    }

    if (tab === 'furnace') {
        toolingModal.openToolingAddModal();
    }
}

function handleLeftPanelClearAction() {
    const tab = getActiveLeftPanelTab();

    if (tab === 'material') {
        clearAllMaterials();
        return;
    }

    if (tab === 'furnace') {
        clearAllFurnaces();
    }
}

/**
 * 初始化应用程序，设置 Three.js 场景、创建默认炉膛卡片和物料卡片，并绑定所有事件监听器。
 * @returns {void}
 */
function init() {
    initThree();
    bindRadiationItemSelection();
    bindRadiationMaterialCardSelection();
    bindRadiationDiagnosisActions();
    updateTopSummary();
    hideExplodeBOMButtons();
    initLeftPanelTabs();
    initRightPanelTabs();

    bindWorkbenchUiModeAutoRefresh();
    updateWorkbenchUiMode();
    bindLoadingSimulationStepClicks();
    bindCompareModeEvents();
    bindCurrentToolingHudControls();
    observePlanLibraryForCompareButtons();
    syncPanelCollapsedBodyClasses();

    // ==================== EVENT LISTENERS ====================

    const btnMaster = document.getElementById("btn-master");
    if (btnMaster) btnMaster.addEventListener("click", showMasterView);
    const btnMasterBack = document.getElementById("btn-master-back");
    if (btnMasterBack) btnMasterBack.addEventListener("click", hideMasterView);
    const btnMasterImportJson = document.getElementById("btn-master-import-json");
    if (btnMasterImportJson) btnMasterImportJson.addEventListener("click", openJsonImportModal);
    const btnRules = document.getElementById("btn-rules");
    if (btnRules) btnRules.addEventListener("click", openRulesModal);
    const btnRulesCancel = document.getElementById("btn-rules-cancel");
    if (btnRulesCancel) btnRulesCancel.addEventListener("click", () => {
        document.getElementById("rules-modal-overlay")?.style && (document.getElementById("rules-modal-overlay").style.display = "none");
    });
    const rulesOverlay = document.getElementById("rules-modal-overlay");
    if (rulesOverlay) rulesOverlay.addEventListener("click", (e) => {
        if (e.target === rulesOverlay)
            rulesOverlay.style.display = "none";
    });
    const btnRulesSave = document.getElementById("btn-rules-save");
    if (btnRulesSave) btnRulesSave.addEventListener("click", saveRulesModal);
    const btnGeneratePlan = document.getElementById("btn-generate-plan");
    if (btnGeneratePlan) btnGeneratePlan.addEventListener("click", showGenerationOptions);
    const btnAnimate = document.getElementById("btn-animate");
    if (btnAnimate) btnAnimate.addEventListener("click", playCurrentSimulation);
    const btnPlayThermal = document.getElementById("btn-play-thermal");
    if (btnPlayThermal) btnPlayThermal.addEventListener("click", playCurrentThermalSimulation);
    const btnPauseThermal = document.getElementById("btn-pause-thermal");
    if (btnPauseThermal) btnPauseThermal.addEventListener("click", pauseResumeCurrentThermalSimulation);
    const btnRenderThermal = document.getElementById("btn-render-thermal");
    if (btnRenderThermal) btnRenderThermal.addEventListener("click", renderCurrentProcessSimulation);
    const btnModeThermal = document.getElementById('btn-mode-thermal');
    if (btnModeThermal) btnModeThermal.addEventListener('click', () => switchProcessSimulationMode('thermal'));
    const btnModeRadiation = document.getElementById('btn-mode-radiation');
    if (btnModeRadiation) btnModeRadiation.addEventListener('click', () => switchProcessSimulationMode('radiation'));
    const btnResetThermal = document.getElementById("btn-reset-thermal");
    if (btnResetThermal) btnResetThermal.addEventListener("click", resetCurrentThermalSimulation);
    const thermalSpeedSelect = document.getElementById('thermal-speed-select');
    if (thermalSpeedSelect) thermalSpeedSelect.addEventListener('change', restartThermalWithCurrentSpeedIfPlaying);
    const thermalProgressRange = document.getElementById('thermal-progress-range');
    if (thermalProgressRange) thermalProgressRange.addEventListener('input', (event) => scrubCurrentThermalSimulation(parseInt(event.target.value, 10) || 0));
    const btnExportPdf = document.getElementById("btn-export-pdf");
    if (btnExportPdf) btnExportPdf.addEventListener("click", showPdfSelectModal);
    // JSON 导出并入 PDF 导出弹窗，顶部不再单独提供入口
    // const btnExportJson = document.getElementById('btn-export-json');
    // if (btnExportJson) {
    //     btnExportJson.addEventListener('click', exportCurrentPlanJson);
    // }
    const btnSavePlanLibrary = document.getElementById('btn-save-plan-library');
    if (btnSavePlanLibrary) {
        btnSavePlanLibrary.addEventListener('click', () => {
            // 不能直接把 planLibrary.saveCurrentPlanToLibrary 作为 callback 传入，
            // 否则函数内部如果依赖 controller 上下文，this 会变成按钮元素。
            // 保存后立即切到方案库并刷新列表，确保用户能看到刚保存的方案。
            planLibrary.saveCurrentPlanToLibrary();

            setTimeout(() => {
                const masterView = document.getElementById('master-view');
                if (masterView) masterView.classList.add('active');
                activateRightPanelTab('library');
                if (planLibrary && typeof planLibrary.renderPlanLibraryList === 'function') {
                    planLibrary.renderPlanLibraryList();
                }
                refreshPlanLibraryWorkbench();
            }, 0);
        });
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

    const btnAddFurnace = document.getElementById("btn-add-furnace");
    if (btnAddFurnace) btnAddFurnace.addEventListener("click", handleLeftPanelPrimaryAction);
    document.querySelectorAll(".sort-btn").forEach(btn => {
        btn.addEventListener("click", () => sortFurnaceCards(btn.getAttribute("data-field")));
    });
    const fdpToggleBtn = document.getElementById("fdp-toggle-btn");
    if (fdpToggleBtn) fdpToggleBtn.addEventListener("click", () => {
        const detailPanel = document.getElementById("furnace-detail-panel");
        if (!detailPanel) return;
        const collapsed = !detailPanel.classList.contains("collapsed");
        setFdpCollapsed(collapsed);
        detailPanel.classList.toggle("collapsed", collapsed);
        const icon = document.getElementById("fdp-toggle-icon");
        if (icon) icon.textContent = collapsed ? "▼" : "▲";
    });
    const mdpToggleBtn = document.getElementById("mdp-toggle-btn");
    if (mdpToggleBtn) mdpToggleBtn.addEventListener("click", () => {
        const materialDetailPanel = document.getElementById("material-detail-panel");
        if (!materialDetailPanel) return;
        const collapsed = !materialDetailPanel.classList.contains("collapsed");
        setMdpCollapsed(collapsed);
        materialDetailPanel.classList.toggle("collapsed", collapsed);
        const icon = document.getElementById("mdp-toggle-icon");
        if (icon) icon.textContent = collapsed ? "▼" : "▲";
    });
    const furnaceCardsContainer = document.getElementById("furnace-cards-container");
    if (furnaceCardsContainer) furnaceCardsContainer.addEventListener("click", (e) => {
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
                updateCurrentToolingHud();
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
    const materialCardsContainer = document.getElementById("material-cards-container");
    if (materialCardsContainer) materialCardsContainer.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action=\"delete-material\"]");
        if (!btn) return;
        e.stopPropagation();
        deleteMaterialCard(parseInt(btn.getAttribute("data-mid")));
    });
    const btnAddItem = document.getElementById("btn-add-item");
    if (btnAddItem) btnAddItem.addEventListener("click", addDefaultMaterial);
    const navPrev = document.getElementById("nav-prev");
    if (navPrev) navPrev.addEventListener("click", () => navigateFurnace(-1));
    const navNext = document.getElementById("nav-next");
    if (navNext) navNext.addEventListener("click", () => navigateFurnace(1));
    const spacingEL = document.getElementById("global-spacing");
    if (spacingEL) {
        spacingEL.addEventListener("change", () => {
            setGlobalFurnacesResult(null);
            setGlobalUnpackedItems([]);
            setCurrentFurnaceIndex(0);
            clearFurnaceGroups();
    clearThermalSimulationLayer();
            hidePlanActionButtons();
            document.getElementById("furnace-nav").style.display = "none";
            document.getElementById("empty-state").style.display = "block";
            hideExplodeBOMButtons();
            if (itemsGroup) {
                while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
            }
        });
    }
    const btnAnimPause = document.getElementById("btn-anim-pause");
    if (btnAnimPause) btnAnimPause.addEventListener("click", () => {
        if (!isAnimating) return;
        const paused = !animPaused;
        setAnimPaused(paused);
        const pauseBtn = document.getElementById("btn-anim-pause");
        if (pauseBtn) {
            pauseBtn.textContent = paused ? "▶ 继续" : "⏸ 暂停";
            pauseBtn.style.background = paused ? "#10b981" : "#f59e0b";
            pauseBtn.style.color = paused ? "#fff" : "#000";
        }
    });
    const btnAnimStop = document.getElementById("btn-anim-stop");
    if (btnAnimStop) btnAnimStop.addEventListener("click", () => {
        if (!isAnimating) return;
        setAnimStopped(true);
        setAnimPaused(false);
    });
    const btnImportExcel = document.getElementById("btn-import-excel");
    if (btnImportExcel) btnImportExcel.addEventListener("click", () => {
        document.getElementById("excel-file-input")?.click();
    });
    const excelFileInput = document.getElementById("excel-file-input");
    if (excelFileInput) excelFileInput.addEventListener("change", (e) => {
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
    const btnImportCancel = document.getElementById("btn-import-cancel");
    if (btnImportCancel) btnImportCancel.addEventListener("click", () => {
        document.getElementById("import-preview-overlay")?.style && (document.getElementById("import-preview-overlay").style.display = "none");
    });
    const btnImportReplace = document.getElementById("btn-import-replace");
    if (btnImportReplace) btnImportReplace.addEventListener("click", () => {
        applyImportData(true);
        scheduleWorkbenchUiModeUpdate();
    });

    const btnImportAppend = document.getElementById("btn-import-append");
    if (btnImportAppend) btnImportAppend.addEventListener("click", () => {
        applyImportData(false);
        scheduleWorkbenchUiModeUpdate();
    });
    const btnPdfCancel = document.getElementById("btn-pdf-cancel");
    if (btnPdfCancel) btnPdfCancel.addEventListener("click", () => {
        document.getElementById("pdf-select-overlay")?.style && (document.getElementById("pdf-select-overlay").style.display = "none");
    });
    const pdfSelectOverlay = document.getElementById("pdf-select-overlay");
    if (pdfSelectOverlay) pdfSelectOverlay.addEventListener("click", (e) => {
        if (e.target === document.getElementById("pdf-select-overlay"))
            document.getElementById("pdf-select-overlay")?.style && (document.getElementById("pdf-select-overlay").style.display = "none");
    });
    const btnPdfConfirm = document.getElementById("btn-pdf-confirm");
    if (btnPdfConfirm) btnPdfConfirm.addEventListener("click", () => {
        const selectedIds = getSelectedPdfFurnaceIds();
        if (selectedIds.length === 0) {
            alert("请至少选择一个炉膛方案");
            return;
        }

        const shouldExportJson = !!document.getElementById('pdf-opt-json')?.checked;

        document.getElementById("pdf-select-overlay")?.style && (document.getElementById("pdf-select-overlay").style.display = "none");

        generateSixPagePDF(selectedIds);

        if (shouldExportJson) {
            exportCurrentPlanJson();
        }
    });
    const btnJiParse = document.getElementById("btn-ji-parse");
    if (btnJiParse) btnJiParse.addEventListener("click", () => {
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
    const btnJiImport = document.getElementById("btn-ji-import");
    if (btnJiImport) btnJiImport.addEventListener("click", () => {
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

            document.getElementById("json-import-overlay")?.style && (document.getElementById("json-import-overlay").style.display = "none");
            return;
        }

        // 旧格式：暂不进入旧历史方案库，避免与新版方案库混用
        alert('当前方案库仅支持新版“装炉数字孪生 JSON”。旧格式历史方案暂不支持直接导入工作台。');

        document.getElementById("json-import-overlay")?.style && (document.getElementById("json-import-overlay").style.display = "none");
    });
    const btnJiCancel = document.getElementById("btn-ji-cancel");
    if (btnJiCancel) btnJiCancel.addEventListener("click", () => {
        document.getElementById("json-import-overlay")?.style && (document.getElementById("json-import-overlay").style.display = "none");
    });
    const jsonImportOverlay = document.getElementById("json-import-overlay");
    if (jsonImportOverlay) jsonImportOverlay.addEventListener("click", (e) => {
        if (e.target === document.getElementById("json-import-overlay"))
            document.getElementById("json-import-overlay")?.style && (document.getElementById("json-import-overlay").style.display = "none");
    });
    const jiDropZone = document.getElementById("ji-drop-zone");
    if (jiDropZone) {
        jiDropZone.addEventListener("click", () => document.getElementById("json-file-input")?.click());
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
    }
    const jsonFileInput = document.getElementById("json-file-input");
    if (jsonFileInput) jsonFileInput.addEventListener("change", (e) => {
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
    syncLeftPanelActionButton();
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
            if (pane) pane.classList.add('active');
            syncLeftPanelActionButton();
        });
    });
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
                if (planLibrary && typeof planLibrary.renderPlanLibraryList === 'function') {
                    planLibrary.renderPlanLibraryList();
                }
                refreshPlanLibraryWorkbench();
            }

            if (tab === 'thermal') {
                renderThermalSimulationPanel(null, processSimulationMode);
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
        alert("请先在左侧添加料框配置，在右侧添加待处理物料");
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
// ==================== 工装添加弹窗逻辑 ====================

/**
 * 右按钮 — 清空所有待摆放物料（保留料框）
 */
function clearAllMaterials() {
    if (!confirm('确定要清空所有待摆放物料吗？\n这将清除方案统计和 3D 工件，但料框将保留。')) return;

    // 1. 移除所有物料卡片
    document.querySelectorAll('.material-card').forEach(c => c.remove());

    // 2. 重置物料状态
    setSelectedMaterialCardId(null);
    setMaterialCounter(0);
    clearUsedColors();

    // 3. 清空装炉结果
    setGlobalFurnacesResult(null);
    setGlobalUnpackedItems([]);
    clearFurnaceGroups();
    clearThermalSimulationLayer();

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

    // 7. 重置物料详情面板
    document.getElementById('mdp-placeholder').style.display = 'block';
    document.getElementById('mdp-body').style.display = 'none';
    document.getElementById('mdp-title').textContent = '📋 工件详情';

    // 8. 如果还有料框，渲染空料框
    const hasFurnaces = document.querySelectorAll('.furnace-card').length > 0;
    if (hasFurnaces) {
        toolingModal.renderEmptyToolingOnly();
    }

    // 重置筛选状态
    clearMaterialFilters();
    clearProcessFilters();
    clearHardnessFilters();

    // 刷新筛选条（此时物料卡片已清空，筛选条应显示“全部 (0)”）
    renderFilterBars(clearFurnaceResults);

    // 9. 更新顶部摘要
    setCurrentFurnaceIndex(0);
    updateTopSummary();
    updateWorkbenchUiMode();
}

/**
 * 左按钮 — 清空所有料盘和物料（完全重置）
 */
function clearAllFurnaces() {
    if (!confirm('确定要清空所有料盘吗？\n这将清除所有料框、物料、方案统计和 3D 场景。')) return;

    // 1. 移除所有炉膛卡片
    document.querySelectorAll('.furnace-card').forEach(c => c.remove());

    // 2. 移除所有物料卡片
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
    clearThermalSimulationLayer();

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
 * 左右面板改为“离屏抽屉”：折叠时不再压缩面板宽度，避免按钮/内容漏出。
 */
function collapseLeftPanel() {
    const panel = document.getElementById('left-panel');
    const btn = document.getElementById('btn-toggle-left-panel');
    if (panel) panel.classList.remove('collapsed');
    document.body.classList.add('left-panel-collapsed');
    if (btn) btn.textContent = '◀';
    updateWorkbenchUiMode();
}

function expandLeftPanel() {
    const panel = document.getElementById('left-panel');
    const btn = document.getElementById('btn-toggle-left-panel');
    if (panel) panel.classList.remove('collapsed');
    document.body.classList.remove('left-panel-collapsed');
    if (btn) btn.textContent = '◀';
    updateWorkbenchUiMode();
}

function toggleLeftPanel() {
    if (document.body.classList.contains('left-panel-collapsed')) {
        expandLeftPanel();
    } else {
        collapseLeftPanel();
    }
}

function collapseRightPanel() {
    const panel = document.getElementById('right-panel');
    const btn = document.getElementById('btn-toggle-right-panel');
    if (panel) panel.classList.remove('collapsed');
    document.body.classList.add('right-panel-collapsed');
    if (btn) btn.textContent = '▶';
    updateWorkbenchUiMode();
}

function expandRightPanel() {
    const panel = document.getElementById('right-panel');
    const btn = document.getElementById('btn-toggle-right-panel');
    if (panel) panel.classList.remove('collapsed');
    document.body.classList.remove('right-panel-collapsed');
    if (btn) btn.textContent = '▶';
    updateWorkbenchUiMode();
}

function toggleRightPanel() {
    if (document.body.classList.contains('right-panel-collapsed')) {
        expandRightPanel();
    } else {
        collapseRightPanel();
    }
}

function syncPanelCollapsedBodyClasses() {
    // 新方案以 body class 作为唯一状态源，面板自身不再缩窄为 36px。
    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');
    if (leftPanel) leftPanel.classList.remove('collapsed');
    if (rightPanel) rightPanel.classList.remove('collapsed');
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
    if (btnClearFurnaces) btnClearFurnaces.addEventListener('click', handleLeftPanelClearAction);

    const btnClearMaterials = document.getElementById('btn-clear-all-materials');
    if (btnClearMaterials) btnClearMaterials.addEventListener('click', clearAllMaterials);

    // 面板折叠按钮
    const btnToggleLeft = document.getElementById('btn-toggle-left-panel');
    if (btnToggleLeft) btnToggleLeft.addEventListener('click', toggleLeftPanel);

    const btnToggleRight = document.getElementById('btn-toggle-right-panel');
    if (btnToggleRight) btnToggleRight.addEventListener('click', toggleRightPanel);

    // 离屏抽屉的独立展开按钮，不放在面板内部，避免折叠后按钮被裁切或内容漏出
    const edgeLeft = document.getElementById('left-edge-handle');
    if (edgeLeft) edgeLeft.addEventListener('click', expandLeftPanel);

    const edgeRight = document.getElementById('right-edge-handle');
    if (edgeRight) edgeRight.addEventListener('click', expandRightPanel);

    // 兼容旧的面板内部展开按钮，如果 HTML 里还保留则也可以使用
    const expandLeft = document.getElementById('panel-expand-btn-left');
    if (expandLeft) expandLeft.addEventListener('click', expandLeftPanel);

    const expandRight = document.getElementById('panel-expand-btn-right');
    if (expandRight) expandRight.addEventListener('click', expandRightPanel);

    // ==================== 3D Dock 工具栏事件 ====================
    const dockTopView = document.getElementById('dock-top-view');
    const dockFrontView = document.getElementById('dock-front-view');
    const dockSideView = document.getElementById('dock-side-view');
    const dockRotate90 = document.getElementById('dock-rotate-90');
    const dockExplode = document.getElementById('dock-explode');
    // const dockGravity = document.getElementById('dock-gravity');
    const dockThermal = document.getElementById('dock-thermal');

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

        const offset = camera.position.clone().sub(controls.target);
        if (offset.lengthSq() < 0.0001) {
            setTightFitCamera(new THREE.Vector3(1, 0, 0));
            return;
        }

        const dir = offset.clone().normalize();

        // 俯视状态下保持俯视，只旋转画面方向，不跳回平视。
        if (Math.abs(dir.y) > 0.92) {
            camera.up.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
            camera.lookAt(controls.target);
            controls.update();
            return;
        }

        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        dir.normalize();
        setTightFitCamera(dir, 0.18);
    }

    if (dockThermal) {
        dockThermal.addEventListener('click', () => {
            renderCurrentThermalSimulation(0.18, true);
            dockThermal.classList.add('active');
        });
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
            dockRotate90,
            dockThermal
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

