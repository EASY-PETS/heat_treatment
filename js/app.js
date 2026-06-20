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
import { createWorkbenchRecordController } from './workbench-record.js';
import { createPlanLibraryController } from './plan-library.js';
import { analyzeFurnaces } from './plan-analysis.js';
import { renderPlanAnalysisPanel, renderCandidatePlanCards, renderLoadingSimulationPanel, renderThermalSimulationPanel } from './ui.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
    scene,
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
    currentMaterialFilters, currentProcessFilters, currentHardnessFilters,
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
    toggleExplodedView, setExplodeVertical, setExplodeHorizontal, resetExplode, showLayeredBOM,
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
    setThermalHeatmapView,
    setThermalHeatmapDisplayMode,
    setThermalHeatmapVerticalAxis,
    setThermalHeatmapSectionOffset,
    resetThermalHeatmapSectionOffset,
    renderRadiationExposureSimulation,
    renderAirflowCoolingSimulation,
    getAirflowCoolingRuntime,
    setAirflowCoolingDirection,
    setAirflowCoolingDirections,
    setAirflowCoolingGasType,
    renderAtmosphereCoverageSimulation,
    getAtmosphereCoverageRuntime,
    setAtmosphereMediumType,
    setAtmosphereInletDirections,
    toggleAtmosphereInletDirection,
    resetAtmosphereInletDirections,
    playAtmosphereCoverageAnimation,
    pauseAtmosphereCoverageAnimation,
    resetAtmosphereCoverageAnimation,
    renderQuenchMediumSimulation,
    getQuenchMediumRuntime,
    playQuenchMediumSimulation,
    pauseQuenchMediumSimulation,
    resetQuenchMediumSimulation,
    setQuenchMediumType,
    setQuenchFurnaceVisibilityMode,
    setProcessSceneBackgroundTheme,
    getProcessSceneBackgroundTheme,
    toggleAirflowCoolingDirection,
    playAirflowCoolingAnimation,
    pauseAirflowCoolingAnimation,
    resetAirflowCoolingAnimation,
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
    setPlacementEditMode,
    selectPlacementEditItemAtClientPoint,
    selectPlacementEditItem,
    clearPlacementEditSelection,
    refreshPlacementEditSelection,
    updatePlacementEditItemVisual,
    focusPlacementEditTopView,
    getPlacementEditLayerState,
    setPlacementEditActiveLayer,
    stepPlacementEditActiveLayer,
    setPlacementEditShowAllLayers,
    showAILoadingLoading, hideAILoadingLoading,
    setItemColorMode, getItemColorMode
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

// V0.7.1 compile fix: keep all static imports together first, then initialize controllers.
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

let candidatePlans = [];
let currentCandidatePlanIndex = 0;
let simulationViewMode = 'cumulative';
// 工艺仿真工作台状态：mode 记录最近选择，active 表示当前 3D 是否正在显示仿真层。
let processSimulationMode = 'idle';
let processSimulationActive = false;


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

function normalizePlanStrategyLabel(strategyLabel = '') {
    const raw = String(strategyLabel || '').trim();
    if (!raw) return STRATEGY_LABELS[placementRules.strategy] || placementRules.strategy || '均衡方案';
    return raw.replace(/^当前策略[:：]\s*/, '');
}

function setCurrentWorkspaceIdentityFromPlan(strategyLabel = '', strategyKey = '') {
    const existed = ensureCurrentWorkspaceIdentity();
    const now = new Date().toISOString();
    const normalizedStrategyLabel = normalizePlanStrategyLabel(strategyLabel);
    currentWorkspaceIdentity = {
        ...existed,
        title: buildAutoWorkspaceTitle(normalizedStrategyLabel),
        source: 'generated',
        status: 'unsaved',
        strategyLabel: normalizedStrategyLabel,
        strategyKey: strategyKey || placementRules.strategy || '',
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
        strategyLabel: '',
        strategyKey: '',
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
    balanced: '重心稳定',
    spaceUtil: '空间利用率优先',
    thermalBalance: '热场均衡装载',
    surfaceUniform: '表面均匀性优先'
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
        { key: 'balanced', label: '重心稳定' },
        { key: 'spaceUtil', label: '空间利用率优先' },
        { key: 'thermalBalance', label: '热场均衡装载' },
        { key: 'surfaceUniform', label: '表面均匀性优先' }
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

    // V0.7.13：装炉规则弹窗选择的策略必须真正成为当前主方案。
    // 旧逻辑会把所有候选策略按综合评分排序，导致用户选择“热场均衡/表面均匀”后，
    // 仍可能被评分更高的“重心稳定/空间优先”覆盖，看起来像策略没有启动。
    // 新逻辑：当前选择策略固定排第一；其它策略仅作为右侧候选对比。
    const selectedStrategy = currentStrategy;
    const selectedPlan = plans.find(p => p.strategy === selectedStrategy) || plans[0];
    const otherPlans = plans.filter(p => p !== selectedPlan);

    otherPlans.sort((a, b) => {
        const aExecutable = a.analysis.unpackedCount === 0 ? 1 : 0;
        const bExecutable = b.analysis.unpackedCount === 0 ? 1 : 0;

        if (aExecutable !== bExecutable) {
            return bExecutable - aExecutable;
        }

        return b.analysis.compositeScore - a.analysis.compositeScore;
    });

    return selectedPlan ? [selectedPlan, ...otherPlans] : otherPlans;
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
    setCurrentWorkspaceIdentityFromPlan(plan.label, plan.strategy);

    renderPlanAnalysisPanel(plan.analysis);
    capturePlanCompareV05Baseline(plan.label, plan.strategy);
    renderHeatProcessRiskCard();
    renderToolingRecommendationBasisCard();
    renderPlanCompareV05Card();
    renderCandidatePlanCards(candidatePlans, index, applyCandidatePlan);
    renderLoadingSimulationPanel();
    processSimulationActive = false;
    processSimulationMode = 'idle';
    renderThermalSimulationPanel(null, 'idle');
    syncThermalControlState(null);
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
    renderHeatMergeDesignPanel();
    updateWorkbenchUiMode();
}


function buildPackingItemFromHeatMergeItem(item, index = 0) {
    if (!item) return null;
    const dims = inferMockShape(item);
    const shape = item.shape || dims.shape || 'cuboid';
    return {
        name: item.name || item.showName || `合炉物料-${index + 1}`,
        shape,
        count: Number(item.count) || 0,
        dim1: Number(item.dim1 || item.L || dims.dim1 || 80) || 80,
        dim2: Number(item.dim2 || item.W || dims.dim2 || (shape === 'cylinder' ? (item.dim1 || item.D || dims.dim1 || 80) : 80)) || 80,
        dim3: Number(item.dim3 || item.H || dims.dim3 || 30) || 30,
        weight: Number(item.weight || item.totalWeight || item.totalWeightKg || 0) || 0,
        color: item.color || '#2E86AB',
        material: item.material || item.materialRaw || '',
        process: item.process || '',
        hardness: item.hardness || item.hardnessRaw || '',
        customer: item.customer || '',
        itemCode: item.itemCode || '',
        showName: item.showName || item.name || '',
        orderDate: item.orderDate || item.date || '',
        deliveryDate: item.deliveryDate || item.dueDate || '',
        remark: item.remark || '',
        source: item.source || '',
        sourceRecordId: item.sourceRecordId || item.recordId || '',
        taskId: item.taskId || '',
        sourceStatus: item.sourceStatus || item.status || '',
        sourceClientId: item.sourceClientId || ''
    };
}

function collectPackingItemsForCurrentGeneration() {
    const groupId = heatMergeState?.appliedGroupId || heatMergeState?.adoptedToolingPlan?.groupId || null;
    const group = groupId ? getHeatMergeGroupById(groupId) : null;

    // V0.7.11：如果已经在合炉设计里采用了某个工艺组，生成方案必须使用该组的源数据，
    // 不再依赖 material-card 的 display 状态。否则在“交付优先/成本优先”等策略下，
    // 卡片筛选与策略分组 key 不一致时会出现 0 物料 / 0 炉次。
    if (group && Array.isArray(group.items) && group.items.length > 0) {
        return group.items
            .filter(isHeatMergeItemEligible)
            .map((item, index) => buildPackingItemFromHeatMergeItem(item, index))
            .filter(item => item && Number(item.count) > 0);
    }

    const items = [];
    document.querySelectorAll('.material-card').forEach(card => {
        // 未锁定合炉组时，才尊重工件详情里的可见筛选结果。
        if (card.style.display === 'none') return;
        const d = getMaterialDataFromCard(card);
        const h = parseHardnessRange(d.hardness);
        const validationProbe = {
            material: normalizeMaterialName(d.material),
            process: normalizeHeatText(d.process),
            hardness: h ? h.label : '',
            count: Number(d.count) || 0,
            weight: Number(d.totalWeight) || 0
        };
        if (!isHeatMergeItemEligible(validationProbe)) return;
        items.push({
            name: d.name,
            shape: d.shape,
            count: d.count,
            dim1: d.dim1,
            dim2: d.dim2,
            dim3: d.dim3,
            weight: d.totalWeight,
            color: d.color,
            material: d.material || '',
            process: d.process || '',
            hardness: d.hardness || '',
            customer: d.customer || '',
            itemCode: d.itemCode || '',
            showName: d.showName || '',
            orderDate: d.orderDate || '',
            deliveryDate: d.deliveryDate || '',
            remark: d.remark || '',
            source: d.source || '',
            sourceRecordId: d.sourceRecordId || '',
            taskId: d.taskId || '',
            sourceStatus: d.sourceStatus || '',
            sourceClientId: d.sourceClientId || ''
        });
    });
    return items;
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

        // V0.7.35：料盘启用搁板时默认带四角支撑杆，参数同时传给算法、3D 和施工单。
        if (d.toolingType === 'material-tray' || d.basketType === 'tray') {
            toolingParams.trayCornerPosts = {
                enabled: true,
                diameter: Number(toolingParams.trayCornerPosts?.diameter || 16),
                offset: Number(toolingParams.trayCornerPosts?.offset || 22),
                safetyGap: Number(toolingParams.trayCornerPosts?.safetyGap || 8),
                ...(toolingParams.trayCornerPosts || {})
            };
        }

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
    let itemsInput = collectPackingItemsForCurrentGeneration();

    if (heatMergeState?.appliedGroupId && itemsInput.length === 0) {
        const group = getHeatMergeGroupById(heatMergeState.appliedGroupId);
        console.warn('[heat-merge] locked group has no generation items:', heatMergeState.appliedGroupId, group);
    }

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
    setCurrentWorkspaceIdentityFromPlan(bestPlan?.label || '', bestPlan?.strategy || '');

    renderPlanAnalysisPanel(analysis);
    capturePlanCompareV05Baseline(bestPlan?.label || '', bestPlan?.strategy || '');
    renderHeatProcessRiskCard();
    renderToolingRecommendationBasisCard();
    renderPlanCompareV05Card();
    renderCandidatePlanCards(candidatePlans, currentCandidatePlanIndex, applyCandidatePlan);
    renderLoadingSimulationPanel();
    processSimulationActive = false;
    processSimulationMode = 'idle';
    renderThermalSimulationPanel(null, 'idle');
    syncThermalControlState(null);
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
            cadImage: d.cadImage || '',
            source: d.source || '',
            sourceRecordId: d.sourceRecordId || '',
            taskId: d.taskId || '',
            sourceStatus: d.sourceStatus || '',
            sourceClientId: d.sourceClientId || ''
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
        // 查看历史方案属于“方案库”内的只读预览，不自动跳转到“方案分析”。
        setTimeout(() => activateRightPanelTab('library'), 0);
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

    const hpr = document.getElementById('heat-process-risk-card');
    if (hpr) hpr.remove();
    const trb = document.getElementById('tooling-recommendation-basis-card');
    if (trb) trb.remove();
    const pcv05 = document.getElementById('plan-compare-v05-card');
    if (pcv05) pcv05.remove();

    renderAISummaryBar(null);
    updateCurrentToolingHud();
    renderLoadingSimulationPanel();
    processSimulationActive = false;
    processSimulationMode = 'idle';
    renderThermalSimulationPanel(null, 'idle');
    syncThermalControlState(null);
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

    // V0.7.18：编辑入口迁移到底部 Dock；HUD 内按钮保持隐藏，只同步 Dock 状态。
    if (typeof syncPlacementEditEntryButtons === 'function') {
        syncPlacementEditEntryButtons();
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
    backupRecord: null,
    backupHadPlan: false,
    backupHadInputs: false
};

function hasCurrentGeneratedPlan() {
    return !!(globalFurnacesResult && globalFurnacesResult.length > 0);
}

function hasCurrentInputResources() {
    return document.querySelectorAll('.furnace-card').length > 0 ||
        document.querySelectorAll('.material-card').length > 0;
}

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
        workspaceViewState.backupHadPlan = hasCurrentGeneratedPlan();
        workspaceViewState.backupHadInputs = hasCurrentInputResources();
        workspaceViewState.backupRecord = captureCurrentWorkspaceSnapshot(
            workspaceViewState.backupHadPlan ? '加载历史前的当前方案' : '加载历史前的资源配置'
        );
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
    workspaceViewState.backupHadPlan = false;
    workspaceViewState.backupHadInputs = false;
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

function resetWorkspaceToBlankDraft() {
    // 无确认的内部重置：用于从历史只读态回到可编辑空白工作台。
    clearHistoryViewState();
    exitCompareMode(false);
    resetCurrentWorkspaceIdentity();

    document.querySelectorAll('.furnace-card').forEach(c => c.remove());
    document.querySelectorAll('.material-card').forEach(c => c.remove());

    setSelectedFurnaceCardId(null);
    setSelectedMaterialCardId(null);
    setFurnaceCounter(0);
    setMaterialCounter(0);
    clearUsedColors();

    setGlobalFurnacesResult(null);
    setGlobalUnpackedItems([]);
    clearFurnaceGroups();
    clearThermalSimulationLayer();

    if (itemsGroup) {
        while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
    }

    hidePlanActionButtons();
    const nav = document.getElementById('furnace-nav');
    if (nav) nav.style.display = 'none';
    const thumbBar = document.getElementById('furnace-thumb-bar');
    if (thumbBar) thumbBar.style.display = 'none';
    const empty = document.getElementById('empty-state');
    if (empty) empty.style.display = 'block';
    renderAISummaryBar(null);
    hideExplodeBOMButtons();

    const fdpPlaceholder = document.getElementById('fdp-placeholder');
    const fdpBody = document.getElementById('fdp-body');
    const fdpTitle = document.getElementById('fdp-title');
    const mdpPlaceholder = document.getElementById('mdp-placeholder');
    const mdpBody = document.getElementById('mdp-body');
    const mdpTitle = document.getElementById('mdp-title');
    if (fdpPlaceholder) fdpPlaceholder.style.display = 'block';
    if (fdpBody) fdpBody.style.display = 'none';
    if (fdpTitle) fdpTitle.textContent = '📋 工装参数';
    if (mdpPlaceholder) mdpPlaceholder.style.display = 'block';
    if (mdpBody) mdpBody.style.display = 'none';
    if (mdpTitle) mdpTitle.textContent = '📋 工件详情';

    clearMaterialFilters();
    clearProcessFilters();
    clearHardnessFilters();
    renderFilterBars(clearFurnaceResults);

    setCurrentFurnaceIndex(0);
    updateTopSummary();
    updateWorkbenchUiMode();
    refreshPlanLibraryWorkbench();
    updateCurrentToolingHud();
}

function restoreCurrentWorkspaceFromHistory() {
    const record = workspaceViewState.backupRecord;
    const hadPlan = !!workspaceViewState.backupHadPlan;
    const hadInputs = !!workspaceViewState.backupHadInputs;

    if (!record) {
        if (!hadPlan && !hadInputs) {
            resetWorkspaceToBlankDraft();
            return;
        }
        alert('没有找到可恢复的当前方案快照');
        return;
    }

    const snapshot = record;
    clearHistoryViewState();

    workbenchRecord.applyDigitalTwinRecordToWorkbench(snapshot, {
        sourceTitle: hadPlan ? '当前工作台方案' : '资源配置',
        closeLibrary: false,
        showSuccess: true
    });

    if (!hadPlan) {
        // 加载历史前没有“当前方案”，只恢复工装/工件输入，不保留历史方案的装炉结果。
        clearFurnaceResults();
    }

    updateWorkbenchUiMode();
    refreshPlanLibraryWorkbench();
    updateCurrentToolingHud();
}

function startNewWorkspaceFromHistory() {
    const record = workspaceViewState.backupRecord;
    const hadInputs = !!workspaceViewState.backupHadInputs;
    const hadPlan = !!workspaceViewState.backupHadPlan;

    if (record && (hadInputs || hadPlan)) {
        clearHistoryViewState();
        workbenchRecord.applyDigitalTwinRecordToWorkbench(record, {
            sourceTitle: '资源配置',
            closeLibrary: false,
            showSuccess: false
        });
        // “新生成”语义：回到可编辑输入态，清除旧方案结果，用户重新点击生成。
        clearFurnaceResults();
        updateWorkbenchUiMode();
        refreshPlanLibraryWorkbench();
        updateCurrentToolingHud();
        return;
    }

    resetWorkspaceToBlankDraft();
}

function renderCurrentWorkbenchPlanCard() {
    const card = document.getElementById('current-workbench-card');
    if (!card) return;
    const cardBaseClass = card.closest('#right-tab-analysis')
        ? 'current-workbench-card analysis-workbench-card'
        : 'current-workbench-card';

    const isHistory = workspaceViewState.mode === 'history';

    if (isHistory && !workspaceViewState.backupHadPlan) {
        const historyTitle = workspaceViewState.historyTitle || '历史方案';
        const inputNote = workspaceViewState.backupHadInputs
            ? '当前工作台原本没有已生成方案。点击“新生成方案”会恢复原工装/工件输入，并回到可编辑状态。'
            : '当前工作台原本为空。点击“新生成方案”会退出历史查看，并回到可编辑空白状态。';
        card.className = cardBaseClass + ' empty history-viewing empty-history-viewing';
        card.innerHTML = `
            <div class="cwc-head">
                <div>
                    <div class="cwc-kicker">当前工作台方案</div>
                    <div class="cwc-title">暂无当前方案</div>
                    <div class="cwc-subtitle">正在只读查看：${historyTitle}</div>
                </div>
                <span class="cwc-status">历史查看</span>
            </div>
            <div class="cwc-metrics cwc-muted-line">${inputNote}</div>
            <button class="cwc-restore-btn cwc-new-workspace-btn" id="btn-start-new-workspace-from-history" type="button">新生成方案</button>
            <div class="cwc-history-note">左侧资源当前为历史快照只读状态；新生成后会解除锁定。</div>
        `;
        const newBtn = card.querySelector('#btn-start-new-workspace-from-history');
        if (newBtn) newBtn.addEventListener('click', startNewWorkspaceFromHistory);
        return;
    }

    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        card.className = cardBaseClass + ' empty';
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
    const statusText = isHistory ? '历史查看' : (currentWorkspaceIdentity.status === 'saved' ? '已保存' : '当前');

    card.className = cardBaseClass + (isHistory ? ' history-viewing' : '');
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
            <span><b>${currentWorkspaceIdentity.strategyLabel || STRATEGY_LABELS[placementRules.strategy] || placementRules.strategy || '-'}</b></span>
        </div>
        ${isHistory ? `
            <div class="cwc-action-row">
                <button class="cwc-restore-btn" id="btn-restore-current-workspace" type="button">恢复当前方案</button>
                <button class="cwc-restore-btn cwc-new-workspace-btn" id="btn-start-new-workspace-from-history" type="button">新生成方案</button>
            </div>
            <div class="cwc-history-note">当前左侧工装/工件为历史快照，只读查看；可恢复原工作台，也可回到输入态重新生成。</div>
        ` : `<div class="cwc-history-note">保存后进入历史方案，可用于后续对比。</div>`}
    `;

    const restoreBtn = card.querySelector('#btn-restore-current-workspace');
    if (restoreBtn) restoreBtn.addEventListener('click', restoreCurrentWorkspaceFromHistory);
    const newBtn = card.querySelector('#btn-start-new-workspace-from-history');
    if (newBtn) newBtn.addEventListener('click', startNewWorkspaceFromHistory);
}

function renderLibraryHistoryBanner() {
    const banner = document.getElementById('library-history-banner');
    if (!banner) return;

    if (workspaceViewState.mode !== 'history') {
        banner.style.display = 'none';
        banner.innerHTML = '';
        return;
    }

    const title = workspaceViewState.historyTitle || '历史方案';
    const hadPlan = !!workspaceViewState.backupHadPlan;
    banner.style.display = 'flex';
    banner.innerHTML = `
        <div class="lhb-copy">
            <strong>正在只读查看历史方案</strong>
            <span>${title}</span>
        </div>
        <div class="lhb-actions">
            ${hadPlan ? '<button type="button" class="lhb-btn restore" id="btn-library-restore-current">恢复当前方案</button>' : ''}
            <button type="button" class="lhb-btn new" id="btn-library-start-new">新生成方案</button>
        </div>
    `;

    const restoreBtn = banner.querySelector('#btn-library-restore-current');
    if (restoreBtn) restoreBtn.addEventListener('click', restoreCurrentWorkspaceFromHistory);
    const newBtn = banner.querySelector('#btn-library-start-new');
    if (newBtn) newBtn.addEventListener('click', startNewWorkspaceFromHistory);
}

function compactPlanLibraryCards() {
    const cards = document.querySelectorAll('#master-list .master-plan-card');
    cards.forEach(card => {
        card.classList.add('master-plan-card-compact');

        if (!card.dataset.compactNormalized) {
            const title = card.querySelector('.mpc-title');
            const tag = card.querySelector('.mpc-tag');
            const meta = card.querySelector('.mpc-meta');

            if (title && !card.querySelector('.mpc-head-row')) {
                const head = document.createElement('div');
                head.className = 'mpc-head-row';
                card.insertBefore(head, card.firstChild);
                head.appendChild(title);
                if (tag) head.appendChild(tag);
            }

            if (meta) {
                const raw = (meta.textContent || '').replace(/\s+/g, ' ').trim();
                meta.textContent = raw;
                meta.title = raw;
            }

            card.dataset.compactNormalized = '1';
        }
    });
}

function refreshPlanLibraryWorkbench() {
    renderCurrentWorkbenchPlanCard();
    renderLibraryHistoryBanner();
    setTimeout(enhancePlanLibraryCompareButtons, 0);
}

function enhancePlanLibraryCompareButtons() {
    renderCurrentWorkbenchPlanCard();
    renderLibraryHistoryBanner();
    compactPlanLibraryCards();
    const cards = document.querySelectorAll('#master-list .master-plan-card');
    const empty = document.getElementById('master-empty-state');
    if (empty) empty.style.display = cards.length ? 'none' : 'block';
    cards.forEach(card => {
        card.querySelectorAll('[data-action="compare-plan"]').forEach(btn => btn.remove());

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

        // V0.7.5：历史方案 3D 对比入口暂时隐藏，避免和方案分析页摘要对比造成认知负担。
        card.querySelectorAll('[data-action="compare-plan"]').forEach(btn => btn.remove());

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
    compactPlanLibraryCards();
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
        'btn-mode-airflow',
        'btn-mode-atmosphere',
        'btn-mode-quench',
        'btn-play-thermal',
        'btn-pause-thermal',
        'btn-render-thermal',
        'btn-reset-thermal',
        'thermal-speed-select',
        'process-scene-theme-select',
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
    optimizeThermalToolbarLayout();
    syncThermalControlState(null);
}

function hidePlanActionButtons() {
    const ids = [
        'btn-export-pdf',
        'btn-animate',
        'thermal-mode-row',
        'btn-mode-thermal',
        'btn-mode-radiation',
        'btn-mode-airflow',
        'btn-mode-atmosphere',
        'btn-mode-quench',
        'btn-play-thermal',
        'btn-pause-thermal',
        'btn-render-thermal',
        'btn-reset-thermal',
        'thermal-speed-select',
        'process-scene-theme-select',
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

    const runnableProcess = hasPlan;
    document.querySelectorAll('.process-sim-mode-btn').forEach(btn => {
        btn.disabled = !runnableProcess;
        btn.classList.toggle('disabled', !runnableProcess);
        btn.title = runnableProcess ? '' : '请先生成装炉方案，再进入工艺仿真';
    });

    const thermalTabBtn = document.querySelector('.right-tab-btn[data-tab="thermal"]');
    if (thermalTabBtn) {
        thermalTabBtn.textContent = '工艺仿真';
        thermalTabBtn.disabled = !runnableProcess;
        thermalTabBtn.classList.toggle('disabled', !runnableProcess);
        thermalTabBtn.title = runnableProcess ? '查看工艺仿真' : '生成方案后才能进入工艺仿真';
    }

    const dockThermalBtn = document.getElementById('dock-thermal');
    if (dockThermalBtn) {
        dockThermalBtn.disabled = !runnableProcess;
        dockThermalBtn.classList.toggle('disabled', !runnableProcess);
        dockThermalBtn.title = runnableProcess ? '进入工艺仿真' : '生成方案后才能进入工艺仿真';
        const dockLabel = dockThermalBtn.querySelector('.dock-label');
        if (dockLabel) dockLabel.textContent = '工艺';
    }
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



function ensureProcessSpeedSelectOptions() {
    let select = document.getElementById('thermal-speed-select');

    // UX V2.8：兼容旧版 furnace.html 里没有速度下拉框的情况，直接在当前模式操作条中补齐。
    if (!select) {
        const actionBar = document.querySelector('.thermal-action-bar');
        if (!actionBar) return null;
        select = document.createElement('select');
        select.className = 'thermal-speed-select process-speed-select';
        select.id = 'thermal-speed-select';
        select.title = '动画速度';
        select.style.display = 'none';
        const resetBtn = document.getElementById('btn-reset-thermal');
        if (resetBtn && resetBtn.parentElement === actionBar) {
            resetBtn.insertAdjacentElement('afterend', select);
        } else {
            actionBar.appendChild(select);
        }
        select.addEventListener('change', applyCurrentProcessSpeedChange);
    }

    const current = getProcessPlayerSpeedKey();
    const desired = [
        { value: 'slow', label: '速度：慢' },
        { value: 'normal', label: '速度：正常' },
        { value: 'fast', label: '速度：快' }
    ];

    const hasModernOptions = [...select.options].some(opt => ['slow', 'normal', 'fast'].includes(String(opt.value)));
    if (!hasModernOptions || select.options.length !== desired.length) {
        select.innerHTML = desired.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
    }

    select.value = ['slow', 'normal', 'fast'].includes(current) ? current : 'normal';
    select.setAttribute('data-speed-normalized', '1');
    select.setAttribute('aria-label', '动画速度');
    return select;
}


function ensureProcessSceneThemeSelect() {
    let select = document.getElementById('process-scene-theme-select');
    if (!select) {
        const actionBar = document.querySelector('.thermal-action-bar');
        if (!actionBar) return null;
        select = document.createElement('select');
        select.className = 'process-scene-theme-select thermal-speed-select';
        select.id = 'process-scene-theme-select';
        select.title = '工艺仿真背景主题';
        select.style.display = 'none';
        actionBar.appendChild(select);
    }

    const current = typeof getProcessSceneBackgroundTheme === 'function'
        ? getProcessSceneBackgroundTheme()
        : 'auto';
    const options = [
        { value: 'auto', label: '背景：自动推荐' },
        { value: 'blue', label: '背景：工业蓝灰' },
        { value: 'light', label: '背景：浅灰' },
        { value: 'dark', label: '背景：默认黑色' }
    ];
    const hasOptions = [...select.options].some(opt => ['auto', 'blue', 'light', 'dark'].includes(String(opt.value)));
    if (!hasOptions || select.options.length !== options.length) {
        select.innerHTML = options.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
    }
    select.value = ['auto', 'blue', 'light', 'dark'].includes(current) ? current : 'auto';
    select.setAttribute('aria-label', '工艺仿真背景主题');
    return select;
}

function applyProcessSceneThemeChange(event) {
    const theme = event?.target?.value || document.getElementById('process-scene-theme-select')?.value || 'auto';
    if (typeof setProcessSceneBackgroundTheme === 'function') {
        const metrics = setProcessSceneBackgroundTheme(theme);
        if (metrics && processSimulationMode && processSimulationMode !== 'idle') {
            syncThermalControlState(metrics);
        } else {
            syncThermalControlState(null);
        }
    }
}

function getProcessPlayerSpeedKey() {
    // UX V2.7：速度控件统一为 slow / normal / fast；兼容旧毫秒值。
    const select = document.getElementById('thermal-speed-select');
    const rawValue = select && select.value ? String(select.value) : 'normal';
    if (['slow', 'normal', 'fast'].includes(rawValue)) return rawValue;

    const legacyValue = parseInt(rawValue, 10);
    if (Number.isFinite(legacyValue)) {
        if (legacyValue >= 11000) return 'slow';
        if (legacyValue <= 5500) return 'fast';
        return 'normal';
    }
    return 'normal';
}

function getProcessAnimationDurationMs(mode = processSimulationMode) {
    const key = getProcessPlayerSpeedKey();
    const table = {
        thermal: { slow: 12000, normal: 9000, fast: 5200 },
        airflow: { slow: 5600, normal: 3600, fast: 1800 },
        atmosphere: { slow: 12000, normal: 8500, fast: 5200 },
        quench: { slow: 12000, normal: 8500, fast: 5200 }
    };
    return (table[mode] || table.thermal)[key] || (table[mode] || table.thermal).normal;
}

function getThermalDurationFromUi() {
    return getProcessAnimationDurationMs('thermal');
}

function isProcessSimulationActive() {
    return !!processSimulationActive;
}

function hasRunnableProcessSimulation() {
    return Array.isArray(globalFurnacesResult)
        && globalFurnacesResult.length > 0
        && !!globalFurnacesResult[Math.max(0, Math.min(currentFurnaceIndex || 0, globalFurnacesResult.length - 1))];
}

function guardProcessSimulationEntry() {
    if (hasRunnableProcessSimulation()) return true;

    processSimulationActive = false;
    processSimulationMode = 'idle';
    document.body.classList.remove('radiation-pick-mode', 'thermal-heatmap-mode', 'airflow-cooling-mode', 'atmosphere-coverage-mode', 'quench-medium-mode');
    try { clearThermalSimulationLayer(); } catch (_) {}
    renderThermalSimulationPanel(null, 'idle');
    syncThermalControlState(null);
    updateProcessSimulationModeButtons();
    return false;
}

function updateProcessSimulationModeButtons() {
    const runnable = hasRunnableProcessSimulation();
    document.querySelectorAll('.process-sim-mode-btn').forEach(btn => {
        const mode = btn.getAttribute('data-process-sim-mode');
        const isActive = runnable && isProcessSimulationActive() && mode === processSimulationMode;
        btn.classList.toggle('active', isActive);
        btn.classList.toggle('disabled', !runnable);
        btn.disabled = !runnable;
        btn.setAttribute('aria-disabled', runnable ? 'false' : 'true');
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        btn.title = runnable ? '' : '请先生成装炉方案，再进入工艺仿真';
    });
}

function focusCurrentFurnaceForProcessSimulation() {
    // 进入任意工艺仿真后自动把当前工装拉回视野中心，避免用户还停留在上一次旋转/缩放位置。
    window.setTimeout(() => {
        try {
            if (typeof setTightFitCamera === 'function') {
                setTightFitCamera(undefined, 0.28);
            }
        } catch (err) {
            console.warn('[process simulation] focus camera failed:', err);
        }
    }, 80);
}


function getProcessModeLabel(mode = processSimulationMode) {
    if (mode === 'radiation') return '辐射暴露';
    if (mode === 'airflow') return '气流冷却';
    if (mode === 'atmosphere') return '气氛覆盖';
    if (mode === 'quench') return '淬火介质';
    if (mode === 'thermal') return '升温热场';
    return '工艺仿真';
}

function getCurrentProcessRuntimeSnapshot(metrics = null) {
    const mode = processSimulationMode;
    if (!isProcessSimulationActive() || !mode || mode === 'idle') {
        return { visible: false, mode: 'idle', progress: 0, isPlaying: false, paused: false, metrics: null };
    }
    if (mode === 'airflow') {
        const runtime = typeof getAirflowCoolingRuntime === 'function' ? getAirflowCoolingRuntime() : null;
        const cycleMs = Math.max(800, Number(runtime?.cycleMs || getProcessAnimationDurationMs('airflow') || 3600));
        const gasLabel = runtime?.gasMeta?.label || metrics?.gasLabel || '冷却气体';
        return {
            visible: !!runtime?.visible,
            mode,
            // V2.4：气流是循环流线动画，不再把 phase 伪装成“完成进度”。
            progress: 0,
            hasLinearProgress: false,
            isPlaying: !!runtime?.isPlaying,
            paused: !!runtime?.paused,
            stage: runtime?.isPlaying ? '循环流动中' : (runtime?.paused ? '循环已暂停' : '气流诊断视图'),
            detail: `${gasLabel} · 循环周期 ${(cycleMs / 1000).toFixed(1)}s`,
            metrics: metrics || runtime?.metrics || null
        };
    }
    if (mode === 'atmosphere') {
        const runtime = typeof getAtmosphereCoverageRuntime === 'function' ? getAtmosphereCoverageRuntime() : null;
        const runtimeMetrics = metrics || runtime?.metrics || null;
        return {
            visible: !!runtime?.visible,
            mode,
            progress: Math.round(Number(runtimeMetrics?.progress ?? ((runtime?.progress || 0) * 100)) || 0),
            isPlaying: !!runtime?.animationPlaying,
            paused: !!runtime?.visible && !runtime?.animationPlaying && (runtime?.progress || 0) > 0 && (runtime?.progress || 0) < 1,
            stage: runtimeMetrics?.atmosphereStageLabel || '气氛扩散',
            detail: runtime?.mediumMeta?.label || runtimeMetrics?.mediumLabel || '气氛介质',
            metrics: runtimeMetrics
        };
    }
    if (mode === 'quench') {
        const runtime = typeof getQuenchMediumRuntime === 'function' ? getQuenchMediumRuntime() : null;
        const runtimeMetrics = metrics || runtime?.metrics || null;
        return {
            visible: !!runtime?.visible,
            mode,
            progress: Math.round(Number(runtimeMetrics?.progress ?? ((runtime?.progress || 0) * 100)) || 0),
            isPlaying: !!runtime?.isPlaying,
            paused: !!runtime?.paused,
            stage: runtimeMetrics?.quenchStageLabel || '淬火介质',
            detail: runtimeMetrics?.mediumLabel || runtime?.mediumMeta?.label || '淬火介质',
            metrics: runtimeMetrics
        };
    }
    if (mode === 'thermal') {
        const runtime = typeof getVacuumQuenchThermalRuntime === 'function' ? getVacuumQuenchThermalRuntime() : null;
        return {
            visible: !!runtime?.visible,
            mode,
            progress: Math.round((runtime?.progress || 0) * 100),
            isPlaying: !!runtime?.isPlaying,
            paused: !!runtime?.paused,
            stage: metrics?.currentStage || runtime?.metrics?.currentStage || '升温热场',
            detail: `${metrics?.currentTemp ?? runtime?.metrics?.currentTemp ?? '-'} / ${metrics?.targetTemp ?? runtime?.metrics?.targetTemp ?? '-'} ℃`,
            metrics: metrics || runtime?.metrics || null
        };
    }
    return {
        visible: true,
        mode,
        progress: 100,
        isPlaying: false,
        paused: false,
        stage: '静态诊断视图',
        detail: '点击工件或右侧诊断项查看原因',
        metrics
    };
}

function ensureProcessPlayerHud() {
    let hud = document.getElementById('process-player-hud');
    if (hud) return hud;

    const container = document.getElementById('canvas-container') || document.getElementById('canvas-area');
    if (!container) return null;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    hud = document.createElement('div');
    hud.id = 'process-player-hud';
    hud.className = 'process-player-hud';
    hud.style.cssText = [
        'position:absolute',
        'left:50%',
        'bottom:78px',
        'transform:translateX(-50%)',
        'z-index:80',
        'display:none',
        'min-width:560px',
        'max-width:min(760px, calc(100% - 48px))',
        'padding:10px 12px',
        'border-radius:18px',
        'background:rgba(248,250,252,0.92)',
        'box-shadow:0 18px 42px rgba(15,23,42,0.18)',
        'backdrop-filter:blur(14px)',
        'border:1px solid rgba(148,163,184,0.28)',
        'pointer-events:auto',
        'font-family:inherit'
    ].join(';');
    hud.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
            <div style="min-width:148px;max-width:210px;">
                <div id="process-player-mode" style="font-size:12px;font-weight:800;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">工艺仿真</div>
                <div id="process-player-stage" style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">请选择仿真模式</div>
            </div>
            <button id="process-player-play" type="button" title="播放/继续" style="height:34px;min-width:72px;border:0;border-radius:12px;background:#2563eb;color:white;font-weight:800;cursor:pointer;">播放</button>
            <button id="process-player-pause" type="button" title="暂停/继续" style="height:34px;min-width:64px;border:0;border-radius:12px;background:#e2e8f0;color:#334155;font-weight:800;cursor:pointer;">暂停</button>
            <button id="process-player-reset" type="button" title="重置当前动画" style="height:34px;min-width:64px;border:0;border-radius:12px;background:#f1f5f9;color:#475569;font-weight:800;cursor:pointer;">重置</button>
            <select id="process-player-speed" title="播放速度" style="height:34px;border:1px solid #cbd5e1;border-radius:12px;background:white;color:#334155;font-weight:700;padding:0 8px;">
                <option value="slow">慢速</option>
                <option value="normal" selected>正常</option>
                <option value="fast">快速</option>
            </select>
            <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:160px;">
                <input id="process-player-progress" type="range" min="0" max="100" value="0" style="width:100%;accent-color:#f97316;" />
                <span id="process-player-value" style="font-size:12px;font-weight:800;color:#f97316;width:42px;text-align:right;">0%</span>
            </div>
        </div>
    `;
    ['pointerdown', 'mousedown', 'click', 'touchstart', 'wheel'].forEach(eventName => {
        hud.addEventListener(eventName, (event) => event.stopPropagation(), { passive: eventName === 'wheel' });
    });
    container.appendChild(hud);
    bindProcessPlayerHud();
    return hud;
}

let processPlayerHudTicker = null;

function scheduleProcessPlayerHudTicker() {
    if (processPlayerHudTicker) return;
    const tick = () => {
        processPlayerHudTicker = null;
        if (!isProcessSimulationActive()) {
            syncProcessPlayerHud(null);
            return;
        }
        syncProcessPlayerHud(null);
        processPlayerHudTicker = requestAnimationFrame(tick);
    };
    processPlayerHudTicker = requestAnimationFrame(tick);
}

function stopProcessPlayerHudTicker() {
    if (processPlayerHudTicker) {
        cancelAnimationFrame(processPlayerHudTicker);
        processPlayerHudTicker = null;
    }
}

function syncProcessPlayerHud(metrics = null) {
    // UX V2.3：移除 3D 区域动态播放器 HUD，避免额外 RAF/DOM 刷新和 Three.js 渲染循环相互叠加。
    const hud = document.getElementById('process-player-hud');
    if (hud) hud.style.display = 'none';
    stopProcessPlayerHudTicker();
}

function renderActiveProcessPanel(metrics = null) {
    if (processSimulationMode === 'airflow') {
        renderThermalSimulationPanel(metrics || getAirflowCoolingRuntime()?.metrics || null, 'airflow');
    } else if (processSimulationMode === 'atmosphere') {
        renderThermalSimulationPanel(metrics || getAtmosphereCoverageRuntime()?.metrics || null, 'atmosphere');
    } else if (processSimulationMode === 'quench') {
        renderThermalSimulationPanel(metrics || getQuenchMediumRuntime()?.metrics || null, 'quench');
    } else if (processSimulationMode === 'thermal') {
        renderThermalSimulationPanel(metrics || getVacuumQuenchThermalRuntime()?.metrics || null, 'thermal');
    }
}

function applyCurrentProcessSpeedChange() {
    if (!isProcessSimulationActive() || processSimulationMode === 'idle' || processSimulationMode === 'radiation') {
        syncThermalControlState(null);
        return;
    }

    const snap = getCurrentProcessRuntimeSnapshot();
    if (processSimulationMode === 'thermal') {
        if (snap.isPlaying) {
            restartThermalWithCurrentSpeedIfPlaying();
        }
        syncThermalControlState(snap.metrics);
        return;
    }

    if (processSimulationMode === 'airflow') {
        if (snap.isPlaying) {
            playAirflowCoolingAnimation({ cycleMs: getProcessAnimationDurationMs('airflow') });
        } else {
            const runtime = getAirflowCoolingRuntime && getAirflowCoolingRuntime();
            const metrics = runtime?.metrics || null;
            syncThermalControlState(metrics);
        }
        return;
    }

    if (processSimulationMode === 'atmosphere') {
        const runtime = getAtmosphereCoverageRuntime && getAtmosphereCoverageRuntime();
        if (snap.isPlaying) {
            playAtmosphereCoverageAnimation({
                durationMs: getProcessAnimationDurationMs('atmosphere'),
                startProgress: Math.max(0, Math.min(0.999, runtime?.progress || 0)),
                onUpdate: (nextMetrics) => {
                    syncAtmosphereAnimationProgressUi(nextMetrics);
                    syncThermalControlState(nextMetrics);
                },
                onFinish: (finalMetrics) => {
                    renderThermalSimulationPanel(finalMetrics, 'atmosphere');
                    syncThermalControlState(finalMetrics);
                }
            });
        } else {
            syncThermalControlState(runtime?.metrics || null);
        }
        return;
    }

    if (processSimulationMode === 'quench') {
        const runtime = getQuenchMediumRuntime && getQuenchMediumRuntime();
        if (snap.isPlaying) {
            playQuenchMediumSimulation({
                durationMs: getProcessAnimationDurationMs('quench'),
                startProgress: Math.max(0, Math.min(0.999, runtime?.progress || 0)),
                onUpdate: (nextMetrics) => {
                    syncQuenchAnimationProgressUi(nextMetrics);
                    syncThermalControlState(nextMetrics);
                },
                onFinish: (finalMetrics) => {
                    renderThermalSimulationPanel(finalMetrics, 'quench');
                    syncThermalControlState(finalMetrics);
                }
            });
        } else {
            syncThermalControlState(runtime?.metrics || null);
        }
    }
}

function playCurrentProcessAnimation() {
    if (!guardProcessSimulationEntry()) return;
    if (!isProcessSimulationActive() || processSimulationMode === 'idle') {
        switchProcessSimulationMode('thermal');
    }
    if (processSimulationMode === 'radiation') return;

    if (processSimulationMode === 'airflow') {
        const metrics = playAirflowCoolingAnimation({ cycleMs: getProcessAnimationDurationMs('airflow') });
        renderThermalSimulationPanel(metrics || getAirflowCoolingRuntime()?.metrics || null, 'airflow');
        syncThermalControlState(metrics);
        return;
    }

    if (processSimulationMode === 'atmosphere') {
        const runtime = getAtmosphereCoverageRuntime();
        const startProgress = runtime?.visible ? Math.max(0, Math.min(1, runtime.progress || 0)) : 0;
        const metrics = playAtmosphereCoverageAnimation({
            durationMs: getProcessAnimationDurationMs('atmosphere'),
            startProgress: startProgress >= 1 ? 0 : startProgress,
            onUpdate: (nextMetrics) => {
                syncAtmosphereAnimationProgressUi(nextMetrics);
                syncThermalControlState(nextMetrics);
            },
            onFinish: (finalMetrics) => {
                renderThermalSimulationPanel(finalMetrics, 'atmosphere');
                syncThermalControlState(finalMetrics);
            }
        });
        renderThermalSimulationPanel(metrics || getAtmosphereCoverageRuntime()?.metrics || null, 'atmosphere');
        syncThermalControlState(metrics);
        return;
    }

    if (processSimulationMode === 'quench') {
        const runtime = getQuenchMediumRuntime();
        const startProgress = runtime?.visible ? Math.max(0, Math.min(1, runtime.progress || 0)) : 0;
        const metrics = playQuenchMediumSimulation({
            durationMs: getProcessAnimationDurationMs('quench'),
            startProgress: startProgress >= 1 ? 0 : startProgress,
            onUpdate: (nextMetrics) => {
                    syncQuenchAnimationProgressUi(nextMetrics);
                    syncThermalControlState(nextMetrics);
                },
            onFinish: (finalMetrics) => {
                renderThermalSimulationPanel(finalMetrics, 'quench');
                syncThermalControlState(finalMetrics);
            }
        });
        renderThermalSimulationPanel(metrics || getQuenchMediumRuntime()?.metrics || null, 'quench');
        syncThermalControlState(metrics);
        return;
    }

    playCurrentThermalSimulation();
}

function pauseResumeCurrentProcessAnimation() {
    if (!guardProcessSimulationEntry()) return;
    if (!isProcessSimulationActive() || processSimulationMode === 'idle' || processSimulationMode === 'radiation') return;

    if (processSimulationMode === 'airflow') {
        const runtime = getAirflowCoolingRuntime();
        const metrics = runtime?.isPlaying
            ? pauseAirflowCoolingAnimation()
            : playAirflowCoolingAnimation({ cycleMs: getProcessAnimationDurationMs('airflow') });
        renderThermalSimulationPanel(metrics || getAirflowCoolingRuntime()?.metrics || null, 'airflow');
        syncThermalControlState(metrics);
        return;
    }

    if (processSimulationMode === 'atmosphere') {
        const runtime = getAtmosphereCoverageRuntime();
        const metrics = runtime?.animationPlaying
            ? pauseAtmosphereCoverageAnimation()
            : playAtmosphereCoverageAnimation({
                durationMs: getProcessAnimationDurationMs('atmosphere'),
                startProgress: Math.max(0, Math.min(0.999, runtime?.progress || 0)),
                onUpdate: (nextMetrics) => {
                    syncAtmosphereAnimationProgressUi(nextMetrics);
                    syncThermalControlState(nextMetrics);
                },
                onFinish: (finalMetrics) => {
                    renderThermalSimulationPanel(finalMetrics, 'atmosphere');
                    syncThermalControlState(finalMetrics);
                }
            });
        renderThermalSimulationPanel(metrics || getAtmosphereCoverageRuntime()?.metrics || null, 'atmosphere');
        syncThermalControlState(metrics);
        return;
    }

    if (processSimulationMode === 'quench') {
        const runtime = getQuenchMediumRuntime();
        const metrics = runtime?.isPlaying
            ? pauseQuenchMediumSimulation()
            : playQuenchMediumSimulation({
                durationMs: getProcessAnimationDurationMs('quench'),
                startProgress: Math.max(0, Math.min(0.999, runtime?.progress || 0)),
                onUpdate: (nextMetrics) => {
                    syncQuenchAnimationProgressUi(nextMetrics);
                    syncThermalControlState(nextMetrics);
                },
                onFinish: (finalMetrics) => {
                    renderThermalSimulationPanel(finalMetrics, 'quench');
                    syncThermalControlState(finalMetrics);
                }
            });
        renderThermalSimulationPanel(metrics || getQuenchMediumRuntime()?.metrics || null, 'quench');
        syncThermalControlState(metrics);
        return;
    }

    pauseResumeCurrentThermalSimulation();
}

function resetCurrentProcessAnimation() {
    if (!hasRunnableProcessSimulation()) {
        resetCurrentThermalSimulation();
        return;
    }
    if (!isProcessSimulationActive() || processSimulationMode === 'idle') return;
    let metrics = null;
    if (processSimulationMode === 'thermal') {
        stopVacuumQuenchThermalSimulation();
        metrics = setVacuumQuenchThermalProgress(0);
        renderThermalSimulationPanel(metrics, 'thermal');
    } else if (processSimulationMode === 'airflow') {
        metrics = resetAirflowCoolingAnimation();
        renderThermalSimulationPanel(metrics || getAirflowCoolingRuntime()?.metrics || null, 'airflow');
    } else if (processSimulationMode === 'atmosphere') {
        metrics = resetAtmosphereCoverageAnimation();
        renderThermalSimulationPanel(metrics || getAtmosphereCoverageRuntime()?.metrics || null, 'atmosphere');
    } else if (processSimulationMode === 'quench') {
        metrics = resetQuenchMediumSimulation();
        renderThermalSimulationPanel(metrics || getQuenchMediumRuntime()?.metrics || null, 'quench');
    }
    syncThermalControlState(metrics);
}

function scrubCurrentProcessAnimation(progressPercent) {
    if (!guardProcessSimulationEntry()) return;
    const pct = Math.max(0, Math.min(100, Number(progressPercent || 0)));
    if (!isProcessSimulationActive() || processSimulationMode === 'idle' || processSimulationMode === 'radiation') return;
    if (processSimulationMode === 'thermal') {
        scrubCurrentThermalSimulation(pct);
        return;
    }
    if (processSimulationMode === 'airflow') {
        // V2.4：气流是循环流线，不支持“拖到某个完成度”。速度控制只改变循环周期。
        syncThermalControlState(null);
        return;
    }
    if (processSimulationMode === 'quench') {
        // 淬火介质也有入油/沸腾/对流阶段进度；这里先轻量同步状态。
        syncThermalControlState({ progress: pct });
        return;
    }
    // 气氛覆盖仍保留真实阶段进度展示；拖拽只更新顶部轻量状态，不重建复杂场景。
    syncThermalControlState({ progress: pct });
}

function bindProcessPlayerHud() {
    const hud = document.getElementById('process-player-hud');
    if (!hud || hud.dataset.bound === '1') return;
    hud.dataset.bound = '1';
    hud.querySelector('#process-player-play')?.addEventListener('click', playCurrentProcessAnimation);
    hud.querySelector('#process-player-pause')?.addEventListener('click', pauseResumeCurrentProcessAnimation);
    hud.querySelector('#process-player-reset')?.addEventListener('click', resetCurrentProcessAnimation);
    hud.querySelector('#process-player-speed')?.addEventListener('change', applyCurrentProcessSpeedChange);
    hud.querySelector('#process-player-progress')?.addEventListener('input', (event) => {
        scrubCurrentProcessAnimation(parseInt(event.target.value, 10) || 0);
    });
}

function syncThermalControlState(metrics = null) {
    const playBtn = document.getElementById('btn-play-thermal');
    const pauseBtn = document.getElementById('btn-pause-thermal');
    const renderBtn = document.getElementById('btn-render-thermal');
    const resetBtn = document.getElementById('btn-reset-thermal');
    const speedSelect = ensureProcessSpeedSelectOptions();
    const range = document.getElementById('thermal-progress-range');
    const value = document.getElementById('thermal-progress-value');
    const scrubRow = document.getElementById('thermal-scrub-row');
    const actionBar = document.querySelector('.thermal-action-bar');
    const runnable = hasRunnableProcessSimulation();
    optimizeThermalToolbarLayout();

    if (!runnable) {
        if (actionBar) actionBar.style.display = 'none';
        [playBtn, pauseBtn, renderBtn, resetBtn, speedSelect].forEach(el => {
            if (!el) return;
            el.disabled = true;
            el.style.opacity = '0.45';
        });
        if (scrubRow) scrubRow.style.display = 'none';
        if (range) range.disabled = true;
        if (value) value.textContent = '';
        updateProcessSimulationModeButtons();
        syncProcessToolbarStatus(metrics);
        updateDockToolVisibilityForProcess();
        syncProcessPlayerHud(metrics);
        return;
    }

    [playBtn, pauseBtn, renderBtn, resetBtn, speedSelect].forEach(el => {
        if (!el) return;
        el.style.opacity = '1';
    });

    const active = isProcessSimulationActive();
    const snap = getCurrentProcessRuntimeSnapshot(metrics);
    const currentModeLabel = getProcessModeLabel(processSimulationMode);
    const animated = active && ['thermal', 'airflow', 'atmosphere', 'quench'].includes(processSimulationMode);
    const isAirflowMode = active && processSimulationMode === 'airflow';
    const showsLinearProgress = active && ['thermal', 'atmosphere', 'quench'].includes(processSimulationMode);
    const progress = Math.max(0, Math.min(100, Number(snap.progress || metrics?.progress || 0)));

    if (actionBar) {
        actionBar.style.display = active ? 'grid' : 'none';
        // UX V2.9：统一为两列操作按钮；速度控件单独占满一行，保证热场/气流/气氛都可见。
        actionBar.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        actionBar.style.gap = '6px';
    }

    if (playBtn) {
        playBtn.style.display = animated ? 'inline-block' : 'none';
        playBtn.disabled = !animated;
        if (isAirflowMode) {
            playBtn.textContent = snap.isPlaying ? '重启流线' : (snap.paused ? '继续流线' : '播放气流');
        } else if (processSimulationMode === 'atmosphere') {
            playBtn.textContent = snap.isPlaying ? '重播扩散' : (snap.paused ? '继续扩散' : '播放扩散');
        } else if (processSimulationMode === 'quench') {
            playBtn.textContent = snap.isPlaying ? '重播淬火' : (snap.paused ? '继续淬火' : '播放淬火');
        } else {
            playBtn.textContent = snap.isPlaying ? '重播热场' : (snap.paused ? '继续播放' : '播放热场');
        }
        playBtn.title = `${currentModeLabel} · 主操作`;
    }

    if (pauseBtn) {
        pauseBtn.style.display = animated ? 'inline-block' : 'none';
        pauseBtn.disabled = !animated;
        pauseBtn.textContent = snap.isPlaying ? (isAirflowMode ? '暂停循环' : '暂停') : (snap.paused ? '继续' : '暂停');
        pauseBtn.title = `${currentModeLabel} · 暂停/继续`;
    }

    if (speedSelect) {
        speedSelect.style.display = animated ? 'block' : 'none';
        speedSelect.style.visibility = animated ? 'visible' : 'hidden';
        speedSelect.disabled = !animated;
        speedSelect.title = isAirflowMode ? '气流循环速度' : `${currentModeLabel} · 播放速度`;
        speedSelect.style.gridColumn = '1 / -1';
        speedSelect.style.width = '100%';
        speedSelect.style.minWidth = '0';
        speedSelect.style.height = '34px';
    }

    if (scrubRow) {
        scrubRow.style.display = animated ? 'flex' : 'none';
        scrubRow.classList.toggle('airflow-loop-status-row', !!isAirflowMode);
    }

    if (renderBtn) {
        renderBtn.style.display = active ? 'inline-block' : 'none';
        renderBtn.textContent = active ? '重新计算' : '进入仿真';
        renderBtn.title = active ? `重新计算${currentModeLabel}诊断视图` : '进入工艺仿真';
    }

    if (resetBtn) {
        resetBtn.style.display = active ? 'inline-block' : 'none';
        resetBtn.textContent = '退出仿真';
        resetBtn.title = '退出当前工艺仿真并清空 3D 仿真层';
    }

    if (range && document.activeElement !== range) {
        range.disabled = !showsLinearProgress;
        range.style.display = showsLinearProgress ? '' : 'none';
        if (showsLinearProgress) range.value = String(Math.round(progress));
    }
    if (value) {
        if (!animated) {
            value.textContent = '';
        } else if (isAirflowMode) {
            value.textContent = snap.isPlaying ? '循环流动中' : (snap.paused ? '循环已暂停' : '气流诊断视图');
        } else {
            value.textContent = `${Math.round(progress)}%`;
        }
        value.style.width = isAirflowMode ? '100%' : '42px';
        value.style.textAlign = isAirflowMode ? 'left' : 'right';
        value.style.color = isAirflowMode ? '#0284c7' : '#f97316';
    }

    updateProcessSimulationModeButtons();
    syncProcessToolbarStatus(metrics);
    updateDockToolVisibilityForProcess();
    syncProcessPlayerHud(metrics);
}

function renderCurrentThermalSimulation(progress = 0, switchTab = true) {
    if (!guardProcessSimulationEntry()) return null;
    processSimulationMode = 'thermal';
    processSimulationActive = true;
    document.body.classList.remove('radiation-pick-mode');
    document.body.classList.add('thermal-heatmap-mode');
    document.body.classList.remove('airflow-cooling-mode');
    document.body.classList.remove('atmosphere-coverage-mode');
    document.body.classList.remove('quench-medium-mode');
    const metrics = renderVacuumQuenchThermalSimulation(progress);
    renderThermalSimulationPanel(metrics, 'thermal');
    syncThermalControlState(metrics);
    if (switchTab) activateRightPanelTab('thermal');
    if (switchTab) focusCurrentFurnaceForProcessSimulation();
    return metrics;
}
function renderCurrentRadiationSimulation(switchTab = true) {
    if (!guardProcessSimulationEntry()) return null;
    processSimulationMode = 'radiation';
    processSimulationActive = true;
    document.body.classList.add('radiation-pick-mode');
    document.body.classList.remove('thermal-heatmap-mode');
    document.body.classList.remove('airflow-cooling-mode');
    document.body.classList.remove('atmosphere-coverage-mode');
    document.body.classList.remove('quench-medium-mode');
    stopVacuumQuenchThermalSimulation();
    const metrics = renderRadiationExposureSimulation();
    renderThermalSimulationPanel(metrics, 'radiation');
    syncThermalControlState(metrics);
    if (switchTab) activateRightPanelTab('thermal');
    if (switchTab) focusCurrentFurnaceForProcessSimulation();
    return metrics;
}
function renderCurrentAirflowSimulation(switchTab = true, directionKey = null) {
    if (!guardProcessSimulationEntry()) return null;
    processSimulationMode = 'airflow';
    processSimulationActive = true;
    document.body.classList.remove('radiation-pick-mode');
    document.body.classList.remove('thermal-heatmap-mode');
    document.body.classList.add('airflow-cooling-mode');
    document.body.classList.remove('atmosphere-coverage-mode');
    document.body.classList.remove('quench-medium-mode');
    stopVacuumQuenchThermalSimulation();
    const runtime = typeof getAirflowCoolingRuntime === 'function' ? getAirflowCoolingRuntime() : null;
    const directionKeys = directionKey ? [directionKey] : (runtime?.directionKeys || [runtime?.directionKey || 'z+']);
    const metrics = renderAirflowCoolingSimulation({ directionKeys });
    renderThermalSimulationPanel(metrics, 'airflow');
    syncThermalControlState(metrics);
    if (switchTab) activateRightPanelTab('thermal');
    if (switchTab) focusCurrentFurnaceForProcessSimulation();
    return metrics;
}

function renderCurrentAtmosphereSimulation(switchTab = true, mediumType = null) {
    if (!guardProcessSimulationEntry()) return null;
    processSimulationMode = 'atmosphere';
    processSimulationActive = true;
    document.body.classList.remove('radiation-pick-mode');
    document.body.classList.remove('thermal-heatmap-mode');
    document.body.classList.remove('airflow-cooling-mode');
    document.body.classList.add('atmosphere-coverage-mode');
    document.body.classList.remove('quench-medium-mode');
    stopVacuumQuenchThermalSimulation();
    const runtime = typeof getAtmosphereCoverageRuntime === 'function' ? getAtmosphereCoverageRuntime() : null;
    const finalMediumType = mediumType || runtime?.mediumType || 'nitriding';
    const metrics = renderAtmosphereCoverageSimulation({ mediumType: finalMediumType });
    renderThermalSimulationPanel(metrics, 'atmosphere');
    syncThermalControlState(metrics);
    if (switchTab) activateRightPanelTab('thermal');
    if (switchTab) focusCurrentFurnaceForProcessSimulation();
    return metrics;
}

function renderCurrentQuenchSimulation(switchTab = true, mediumType = null) {
    if (!guardProcessSimulationEntry()) return null;
    processSimulationMode = 'quench';
    processSimulationActive = true;
    document.body.classList.remove('radiation-pick-mode');
    document.body.classList.remove('thermal-heatmap-mode');
    document.body.classList.remove('airflow-cooling-mode');
    document.body.classList.remove('atmosphere-coverage-mode');
    document.body.classList.add('quench-medium-mode');
    stopVacuumQuenchThermalSimulation();
    const runtime = typeof getQuenchMediumRuntime === 'function' ? getQuenchMediumRuntime() : null;
    const finalMediumType = mediumType || runtime?.mediumType || 'oil';
    const metrics = renderQuenchMediumSimulation({ mediumType: finalMediumType });
    renderThermalSimulationPanel(metrics, 'quench');
    syncThermalControlState(metrics);
    if (switchTab) activateRightPanelTab('thermal');
    if (switchTab) focusCurrentFurnaceForProcessSimulation();
    return metrics;
}
function renderCurrentProcessSimulation() {
    if (!guardProcessSimulationEntry()) return null;
    if (!processSimulationMode || processSimulationMode === 'idle') {
        processSimulationMode = 'thermal';
    }
    if (processSimulationMode === 'radiation') {
        return renderCurrentRadiationSimulation(true);
    }
    if (processSimulationMode === 'airflow') {
        return renderCurrentAirflowSimulation(true);
    }
    if (processSimulationMode === 'atmosphere') {
        return renderCurrentAtmosphereSimulation(true);
    }
    if (processSimulationMode === 'quench') {
        return renderCurrentQuenchSimulation(true);
    }
    const runtime = getVacuumQuenchThermalRuntime();
    const p = runtime?.activeMode === 'thermal' ? (runtime.progress || 0) : 0;
    return renderCurrentThermalSimulation(p, true);
}

function switchProcessSimulationMode(mode) {
    if (!guardProcessSimulationEntry()) return;
    const nextMode = mode === 'radiation'
        ? 'radiation'
        : (mode === 'airflow' ? 'airflow' : (mode === 'atmosphere' ? 'atmosphere' : (mode === 'quench' ? 'quench' : 'thermal')));

    // 同一模式二次点击 = 退出仿真；不同模式点击 = 切换仿真。
    if (isProcessSimulationActive() && processSimulationMode === nextMode) {
        resetCurrentThermalSimulation();
        return;
    }

    processSimulationMode = nextMode;
    processSimulationActive = true;

    if (processSimulationMode === 'radiation') {
        renderCurrentRadiationSimulation(true);
    } else if (processSimulationMode === 'airflow') {
        renderCurrentAirflowSimulation(true);
    } else if (processSimulationMode === 'atmosphere') {
        renderCurrentAtmosphereSimulation(true);
    } else if (processSimulationMode === 'quench') {
        renderCurrentQuenchSimulation(true);
    } else {
        const runtime = getVacuumQuenchThermalRuntime();
        renderCurrentThermalSimulation(runtime?.progress || 0, true);
    }
}

function playCurrentThermalSimulation() {
    if (!guardProcessSimulationEntry()) return;
    processSimulationMode = 'thermal';
    processSimulationActive = true;
    document.body.classList.remove('radiation-pick-mode');
    document.body.classList.add('thermal-heatmap-mode');
    document.body.classList.remove('airflow-cooling-mode');
    document.body.classList.remove('atmosphere-coverage-mode');
    document.body.classList.remove('quench-medium-mode');
    activateRightPanelTab('thermal');
    const runtime = getVacuumQuenchThermalRuntime();
    const startProgress = runtime.paused && runtime.activeMode === 'thermal' ? (runtime.progress || 0) : 0;

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
    if (!guardProcessSimulationEntry()) return;
    processSimulationMode = 'thermal';
    processSimulationActive = true;
    document.body.classList.remove('radiation-pick-mode');
    document.body.classList.add('thermal-heatmap-mode');
    document.body.classList.remove('airflow-cooling-mode');
    document.body.classList.remove('atmosphere-coverage-mode');
    document.body.classList.remove('quench-medium-mode');
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
    processSimulationActive = false;
    processSimulationMode = 'idle';
    document.body.classList.remove('radiation-pick-mode');
    document.body.classList.remove('thermal-heatmap-mode');
    document.body.classList.remove('airflow-cooling-mode');
    document.body.classList.remove('atmosphere-coverage-mode');
    document.body.classList.remove('quench-medium-mode');
    stopVacuumQuenchThermalSimulation();
    if (typeof pauseAirflowCoolingAnimation === 'function') pauseAirflowCoolingAnimation();
    if (typeof pauseAtmosphereCoverageAnimation === 'function') pauseAtmosphereCoverageAnimation();
    if (typeof pauseQuenchMediumSimulation === 'function') pauseQuenchMediumSimulation();
    clearThermalSimulationLayer();
    renderThermalSimulationPanel(null, 'idle');
    syncThermalControlState(null);
    stopProcessPlayerHudTicker();
}

function scrubCurrentThermalSimulation(progressPercent) {
    if (!guardProcessSimulationEntry()) return;
    processSimulationMode = 'thermal';
    processSimulationActive = true;
    document.body.classList.remove('radiation-pick-mode');
    document.body.classList.remove('airflow-cooling-mode');
    document.body.classList.remove('atmosphere-coverage-mode');
    document.body.classList.remove('quench-medium-mode');
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
    processSimulationActive = true;
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
    processSimulationActive = true;
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
        processSimulationActive = true;
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
        processSimulationActive = true;
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
        processSimulationActive = true;
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



function ensureToolbarSectionLabel(beforeEl, id, title, desc) {
    if (!beforeEl || !beforeEl.parentElement) return null;
    let label = document.getElementById(id);
    if (!label) {
        label = document.createElement('div');
        label.id = id;
        label.className = 'process-toolbar-section-label';
        beforeEl.parentElement.insertBefore(label, beforeEl);
    }
    label.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span style="font-size:11px;font-weight:900;color:#0f172a;letter-spacing:.02em;">${title}</span>
            <span style="font-size:10px;font-weight:700;color:#94a3b8;white-space:nowrap;">${desc || ''}</span>
        </div>
    `;
    label.style.cssText = [
        'display:block',
        'padding:8px 10px 4px',
        'margin-top:2px',
        'border-top:1px solid rgba(226,232,240,.8)'
    ].join(';');
    return label;
}

function getProcessToolbarCopy(metrics = null) {
    if (!hasRunnableProcessSimulation()) {
        return {
            title: '当前操作',
            detail: '生成方案后启用',
            status: '请先生成装炉方案，再进入工艺仿真。'
        };
    }
    if (!isProcessSimulationActive() || processSimulationMode === 'idle') {
        return {
            title: '当前操作',
            detail: '等待选择模式',
            status: '先选择上方工艺阶段/仿真模式，再使用播放、重置和参数配置。'
        };
    }
    const snap = getCurrentProcessRuntimeSnapshot(metrics);
    const modeLabel = getProcessModeLabel(processSimulationMode);
    if (processSimulationMode === 'radiation') {
        return {
            title: `当前操作 · ${modeLabel}`,
            detail: '静态诊断',
            status: '辐射暴露是静态诊断：可点击 3D 工件或左侧物料卡查看单件/批次遮挡原因。'
        };
    }
    if (processSimulationMode === 'airflow') {
        return {
            title: `当前操作 · ${modeLabel}`,
            detail: snap.isPlaying ? '循环流动中' : (snap.paused ? '循环已暂停' : '流线诊断'),
            status: `${snap.stage || '气流诊断视图'} · ${snap.detail || '气流是循环相位，不代表冷却完成度。'}`
        };
    }
    if (processSimulationMode === 'quench') {
        return {
            title: `当前操作 · ${modeLabel}`,
            detail: `${Math.round(snap.progress || 0)}%`,
            status: `${snap.stage || '淬火介质'} · ${snap.detail || '淬火介质'} · 进度条表示入油/沸腾/对流冷却阶段。`
        };
    }
    if (processSimulationMode === 'atmosphere') {
        return {
            title: `当前操作 · ${modeLabel}`,
            detail: `${Math.round(snap.progress || 0)}%`,
            status: `${snap.stage || '气氛扩散'} · ${snap.detail || '气氛介质'} · 使用进度条表示充入/扩散/反应阶段。`
        };
    }
    return {
        title: `当前操作 · ${modeLabel}`,
        detail: `${Math.round(snap.progress || 0)}%`,
        status: `${snap.stage || '升温热场'} · ${snap.detail || ''} · 进度条表示升温/均热过程。`
    };
}

function syncProcessToolbarStatus(metrics = null) {
    const titleEl = document.getElementById('process-operation-section-title');
    const statusEl = document.getElementById('process-control-hint');
    const copy = getProcessToolbarCopy(metrics);
    if (titleEl) {
        titleEl.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-size:11px;font-weight:900;color:#0f172a;letter-spacing:.02em;">${copy.title}</span>
                <span style="font-size:10px;font-weight:800;color:#f97316;white-space:nowrap;">${copy.detail || ''}</span>
            </div>
        `;
    }
    if (statusEl) {
        statusEl.textContent = copy.status;
        statusEl.style.display = hasRunnableProcessSimulation() ? 'block' : 'none';
    }
}

function optimizeThermalToolbarLayout() {
    const modeRow = document.querySelector('.thermal-mode-row');
    if (modeRow) {
        ensureToolbarSectionLabel(modeRow, 'process-mode-section-title', '1 · 工艺阶段模式', '炉内阶段 + 淬火阶段');
        modeRow.style.display = 'grid';
        modeRow.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        modeRow.style.gap = '6px';
        modeRow.style.padding = '6px 10px 8px';
        modeRow.style.background = 'rgba(248,250,252,.72)';
        modeRow.style.borderRadius = '12px';
        modeRow.style.margin = '0 0 6px';
        modeRow.querySelectorAll('.process-sim-mode-btn').forEach(btn => {
            btn.style.minHeight = '34px';
            btn.style.borderRadius = '12px';
            btn.style.fontWeight = '850';
            btn.style.letterSpacing = '.01em';
        });
    }

    const actionBar = document.querySelector('.thermal-action-bar');
    if (actionBar) {
        ensureToolbarSectionLabel(actionBar, 'process-operation-section-title', '2 · 当前模式操作', '选择模式后启用');
        actionBar.style.display = 'grid';
        // UX V2.9：操作条改为两列按钮 + 独立速度行，避免第 5 列被右侧窄面板裁掉。
        actionBar.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        actionBar.style.gap = '6px';
        actionBar.style.padding = '8px 10px';
        actionBar.style.background = 'rgba(255,255,255,.82)';
        actionBar.style.border = '1px solid rgba(226,232,240,.95)';
        actionBar.style.borderRadius = '14px';
        actionBar.style.margin = '0 0 8px';
        actionBar.querySelectorAll('button, select').forEach(el => {
            el.style.width = '100%';
            el.style.minWidth = '0';
            el.style.height = '34px';
            el.style.borderRadius = '11px';
            el.style.fontWeight = '850';
        });
    }

    const playBtn = document.getElementById('btn-play-thermal');
    const pauseBtn = document.getElementById('btn-pause-thermal');
    const renderBtn = document.getElementById('btn-render-thermal');
    const resetBtn = document.getElementById('btn-reset-thermal');
    if (playBtn) {
        playBtn.style.background = '#2563eb';
        playBtn.style.color = '#fff';
        playBtn.style.border = '0';
        playBtn.style.boxShadow = '0 8px 18px rgba(37,99,235,.18)';
    }
    [pauseBtn, renderBtn].forEach(btn => {
        if (!btn) return;
        btn.style.background = '#f8fafc';
        btn.style.color = '#334155';
        btn.style.border = '1px solid #dbeafe';
        btn.style.boxShadow = 'none';
    });
    if (resetBtn) {
        resetBtn.style.background = '#fff7ed';
        resetBtn.style.color = '#c2410c';
        resetBtn.style.border = '1px solid #fed7aa';
        resetBtn.style.boxShadow = 'none';
    }

    const speedSelect = ensureProcessSpeedSelectOptions();
    if (speedSelect) {
        const speedVisible = isProcessSimulationActive() && ['thermal', 'airflow', 'atmosphere', 'quench'].includes(processSimulationMode);
        speedSelect.style.background = '#fff';
        speedSelect.style.border = '1px solid #cbd5e1';
        speedSelect.style.color = '#334155';
        speedSelect.style.display = speedVisible ? 'block' : 'none';
        speedSelect.style.visibility = speedVisible ? 'visible' : 'hidden';
        speedSelect.style.gridColumn = '1 / -1';
        speedSelect.style.width = '100%';
        speedSelect.style.minWidth = '0';
        speedSelect.style.padding = '0 10px';
    }

    const themeSelect = ensureProcessSceneThemeSelect();
    if (themeSelect) {
        const themeVisible = isProcessSimulationActive() && processSimulationMode !== 'idle';
        themeSelect.style.background = '#fff';
        themeSelect.style.border = '1px solid #cbd5e1';
        themeSelect.style.color = '#334155';
        themeSelect.style.display = themeVisible ? 'block' : 'none';
        themeSelect.style.visibility = themeVisible ? 'visible' : 'hidden';
        themeSelect.style.gridColumn = '1 / -1';
        themeSelect.style.width = '100%';
        themeSelect.style.minWidth = '0';
        themeSelect.style.padding = '0 10px';
    }

    const scrubRow = document.getElementById('thermal-scrub-row');
    if (scrubRow) {
        scrubRow.style.padding = '6px 10px 8px';
        scrubRow.style.margin = '0 0 8px';
        scrubRow.style.background = 'rgba(248,250,252,.86)';
        scrubRow.style.border = '1px solid rgba(226,232,240,.9)';
        scrubRow.style.borderRadius = '12px';
        scrubRow.style.gap = '8px';
    }
    if (scrubRow && !document.getElementById('process-control-hint')) {
        const hint = document.createElement('div');
        hint.id = 'process-control-hint';
        hint.className = 'process-control-hint';
        hint.style.cssText = 'font-size:10px;line-height:1.45;color:#64748b;padding:0 10px 8px;margin-top:-4px;';
        scrubRow.insertAdjacentElement('afterend', hint);
    }
    syncProcessToolbarStatus();
}

function updateDockToolVisibilityForProcess() {
    const inProcess = isProcessSimulationActive() && processSimulationMode !== 'idle';
    ['dock-explode', 'dock-explode-vertical', 'dock-explode-horizontal', 'dock-gravity', 'dock-thermal'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = inProcess ? 'none' : '';
        el.title = inProcess ? '工艺仿真中隐藏该工具；退出仿真后恢复' : (el.title || '');
    });
}

function setupDockViewSettingsMenu() {
    const dockBar = document.getElementById('dock-bar');
    const gridBtn = document.getElementById('dock-toggle-grid');
    const axesBtn = document.getElementById('dock-toggle-axes');
    const rulerBtn = document.getElementById('dock-toggle-rulers');
    if (!dockBar || !gridBtn || !axesBtn || !rulerBtn || document.getElementById('dock-view-settings')) return;

    const viewBtn = document.createElement('button');
    viewBtn.className = 'dock-btn';
    viewBtn.id = 'dock-view-settings';
    viewBtn.type = 'button';
    viewBtn.title = '视图设置：网格、尺寸标注、方向轴';
    viewBtn.innerHTML = '<span class="dock-icon">⚙️</span><span class="dock-label">视图</span>';
    rulerBtn.insertAdjacentElement('afterend', viewBtn);

    [gridBtn, axesBtn, rulerBtn].forEach(btn => {
        btn.style.display = 'none';
        btn.setAttribute('aria-hidden', 'true');
    });

    const pop = document.createElement('div');
    pop.id = 'dock-view-settings-popover';
    pop.style.cssText = [
        'position:fixed',
        'z-index:120',
        'display:none',
        'min-width:180px',
        'padding:8px',
        'border-radius:14px',
        'background:rgba(255,255,255,.96)',
        'box-shadow:0 18px 44px rgba(15,23,42,.18)',
        'border:1px solid rgba(226,232,240,.95)',
        'backdrop-filter:blur(10px)'
    ].join(';');
    document.body.appendChild(pop);

    function renderMenu() {
        const items = [
            { id: 'dock-toggle-grid', label: '地面网格', active: !!displaySettings.showGrid },
            { id: 'dock-toggle-rulers', label: '尺寸标注', active: !!displaySettings.showRulers },
            { id: 'dock-toggle-axes', label: '方向轴', active: !!displaySettings.showAxes }
        ];
        const colorMode = typeof getItemColorMode === 'function' ? getItemColorMode() : 'materialCustomer';
        const colorModeOptions = [
            { value: 'materialCustomer', label: '材质主色 + 客户标识' },
            { value: 'material', label: '按材质着色' },
            { value: 'customer', label: '按客户着色' },
            { value: 'process', label: '按工艺着色' }
        ];
        pop.innerHTML = items.map(item => `
            <button type="button" data-dock-proxy="${item.id}" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border:0;border-radius:10px;background:${item.active ? '#eff6ff' : 'transparent'};color:#0f172a;font-size:12px;font-weight:800;cursor:pointer;margin-bottom:2px;">
                <span>${item.label}</span><span style="color:${item.active ? '#2563eb' : '#94a3b8'};">${item.active ? '✓' : '—'}</span>
            </button>
        `).join('') + `
            <div style="height:1px;background:#e2e8f0;margin:8px 2px;"></div>
            <label style="display:block;font-size:10px;font-weight:900;color:#64748b;padding:0 4px 6px;">颜色模式</label>
            <div class="dock-color-mode-grid">
                ${colorModeOptions.map(opt => `<button type="button" data-color-mode="${opt.value}" class="dock-color-mode-btn ${opt.value === colorMode ? 'active' : ''}">${opt.label}</button>`).join('')}
            </div>
            <div style="font-size:10px;color:#94a3b8;line-height:1.35;padding:7px 6px 2px;">可按材质、客户、工艺切换；默认用客户小标识区分同材质相似工件。</div>
        `;
    }

    function positionMenu() {
        const rect = viewBtn.getBoundingClientRect();
        pop.style.left = `${Math.max(12, rect.left - 58)}px`;
        pop.style.top = `${Math.max(12, rect.top - 168)}px`;
    }

    viewBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const willOpen = pop.style.display === 'none';
        if (willOpen) {
            renderMenu();
            positionMenu();
            pop.style.display = 'block';
            viewBtn.classList.add('active');
        } else {
            pop.style.display = 'none';
            viewBtn.classList.remove('active');
        }
    });

    pop.addEventListener('click', (event) => {
        const colorBtn = event.target.closest('[data-color-mode]');
        if (colorBtn) {
            event.preventDefault();
            event.stopPropagation();
            const mode = colorBtn.getAttribute('data-color-mode') || 'materialCustomer';
            if (typeof setItemColorMode === 'function') setItemColorMode(mode);
            if (globalFurnacesResult && globalFurnacesResult.length > 0) {
                renderSingleFurnace(currentFurnaceIndex || 0, getSelectedMaterialName());
                renderFurnaceThumbnails(globalFurnacesResult, currentFurnaceIndex || 0, handleThumbFurnaceClick);
                updateCurrentToolingHud();
            }
            renderMenu();
            return;
        }

        const proxy = event.target.closest('[data-dock-proxy]');
        if (!proxy) return;
        event.preventDefault();
        event.stopPropagation();
        const target = document.getElementById(proxy.getAttribute('data-dock-proxy'));
        if (target) target.click();
        renderMenu();
    });

    pop.addEventListener('change', (event) => {
        const select = event.target.closest('#item-color-mode-select');
        if (!select) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof setItemColorMode === 'function') setItemColorMode(select.value || 'materialCustomer');
        if (globalFurnacesResult && globalFurnacesResult.length > 0) {
            renderSingleFurnace(currentFurnaceIndex || 0, getSelectedMaterialName());
            renderFurnaceThumbnails(globalFurnacesResult, currentFurnaceIndex || 0, handleThumbFurnaceClick);
            updateCurrentToolingHud();
        }
        renderMenu();
    });

    document.addEventListener('click', () => {
        pop.style.display = 'none';
        viewBtn.classList.remove('active');
    });
}

function ensureProcessModeButtons() {
    const row = document.querySelector('.thermal-mode-row');
    if (!row) return;
    const desired = [
        { id: 'btn-mode-atmosphere', mode: 'atmosphere', text: '气氛覆盖', after: 'btn-mode-airflow' },
        { id: 'btn-mode-quench', mode: 'quench', text: '淬火介质', after: 'btn-mode-atmosphere' }
    ];
    desired.forEach(cfg => {
        if (document.getElementById(cfg.id)) return;
        const btn = document.createElement('button');
        btn.className = 'process-sim-mode-btn';
        btn.id = cfg.id;
        btn.setAttribute('data-process-sim-mode', cfg.mode);
        btn.type = 'button';
        btn.textContent = cfg.text;
        const afterBtn = document.getElementById(cfg.after);
        if (afterBtn && afterBtn.parentElement === row) afterBtn.insertAdjacentElement('afterend', btn);
        else row.appendChild(btn);
    });
    optimizeThermalToolbarLayout();
}


function bindThermalHeatmapActions() {
    if (document.body.dataset.thermalHeatmapBound === '1') return;
    document.body.dataset.thermalHeatmapBound = '1';

    function activateThermalHeatmapMode() {
        processSimulationMode = 'thermal';
        processSimulationActive = true;
        document.body.classList.remove('radiation-pick-mode');
        document.body.classList.add('thermal-heatmap-mode');
        document.body.classList.remove('airflow-cooling-mode');
        document.body.classList.remove('atmosphere-coverage-mode');
        document.body.classList.remove('quench-medium-mode');
        activateRightPanelTab('thermal');
    }

    function refreshThermalPanel(metrics) {
        renderThermalSimulationPanel(metrics || getVacuumQuenchThermalRuntime()?.metrics || null, 'thermal');
        syncThermalControlState(metrics || null);
    }

    document.addEventListener('click', (event) => {
        const viewBtn = event.target.closest('[data-action="thermal-heatmap-view"]');
        const axisBtn = event.target.closest('[data-action="thermal-heatmap-axis"]');
        const resetBtn = event.target.closest('[data-action="thermal-heatmap-reset-offset"]');
        const displayBtn = event.target.closest('[data-action="thermal-heatmap-display-mode"]');
        if (!viewBtn && !axisBtn && !resetBtn && !displayBtn) return;

        event.preventDefault();
        event.stopPropagation();
        activateThermalHeatmapMode();

        let metrics = null;
        if (viewBtn) {
            const viewKey = viewBtn.getAttribute('data-thermal-view') || 'middle';
            metrics = setThermalHeatmapView(viewKey);
        } else if (axisBtn) {
            const axis = axisBtn.getAttribute('data-thermal-axis') || 'z';
            metrics = setThermalHeatmapVerticalAxis(axis);
        } else if (resetBtn) {
            metrics = resetThermalHeatmapSectionOffset();
        } else if (displayBtn) {
            const mode = displayBtn.getAttribute('data-thermal-display-mode') || 'balanced';
            metrics = setThermalHeatmapDisplayMode(mode);
        }
        refreshThermalPanel(metrics);
    }, true);

    document.addEventListener('input', (event) => {
        const offsetInput = event.target.closest('[data-action="thermal-heatmap-offset"]');
        if (!offsetInput) return;

        activateThermalHeatmapMode();
        const offset = Number(offsetInput.value || 0);
        const metrics = setThermalHeatmapSectionOffset(offset);
        refreshThermalPanel(metrics);
    }, true);
}

function bindAirflowCoolingActions() {
    if (document.body.dataset.airflowCoolingBound === '1') return;
    document.body.dataset.airflowCoolingBound = '1';

    function activateAirflowMode() {
        processSimulationMode = 'airflow';
        processSimulationActive = true;
        document.body.classList.remove('radiation-pick-mode');
        document.body.classList.remove('thermal-heatmap-mode');
        document.body.classList.add('airflow-cooling-mode');
        document.body.classList.remove('atmosphere-coverage-mode');
        activateRightPanelTab('thermal');
    }

    document.addEventListener('click', (event) => {
        const toggleBtn = event.target.closest('[data-action="airflow-toggle-direction"]');
        const singleDirBtn = event.target.closest('[data-action="airflow-direction"]');
        const playBtn = event.target.closest('[data-action="airflow-animation-play"]');
        const pauseBtn = event.target.closest('[data-action="airflow-animation-pause"]');
        const resetBtn = event.target.closest('[data-action="airflow-animation-reset"]');
        const presetBtn = event.target.closest('[data-action="airflow-preset"]');

        if (!toggleBtn && !singleDirBtn && !playBtn && !pauseBtn && !resetBtn && !presetBtn) return;

        event.preventDefault();
        event.stopPropagation();
        activateAirflowMode();

        let metrics = null;
        if (toggleBtn) {
            const directionKey = toggleBtn.getAttribute('data-airflow-dir') || 'z+';
            metrics = toggleAirflowCoolingDirection(directionKey);
        } else if (singleDirBtn) {
            const directionKey = singleDirBtn.getAttribute('data-airflow-dir') || 'z+';
            metrics = setAirflowCoolingDirection(directionKey);
        } else if (presetBtn) {
            const preset = presetBtn.getAttribute('data-airflow-preset') || 'z+';
            const directionKeys = preset.split(',').map(v => v.trim()).filter(Boolean);
            metrics = setAirflowCoolingDirections(directionKeys.length ? directionKeys : ['z+']);
        } else if (playBtn) {
            metrics = playAirflowCoolingAnimation();
        } else if (pauseBtn) {
            metrics = pauseAirflowCoolingAnimation();
        } else if (resetBtn) {
            metrics = resetAirflowCoolingAnimation();
        }

        renderThermalSimulationPanel(metrics || getAirflowCoolingRuntime()?.metrics || null, 'airflow');
        syncThermalControlState(metrics || null);
    }, true);

    document.addEventListener('change', (event) => {
        const gasSelect = event.target.closest('[data-action="airflow-gas-type"]');
        if (!gasSelect) return;

        event.preventDefault();
        event.stopPropagation();
        activateAirflowMode();

        const metrics = setAirflowCoolingGasType(gasSelect.value || 'n2');
        renderThermalSimulationPanel(metrics || getAirflowCoolingRuntime()?.metrics || null, 'airflow');
        syncThermalControlState(metrics || null);
    }, true);
}



function syncAtmosphereAnimationProgressUi(metrics) {
    if (!metrics || processSimulationMode !== 'atmosphere') return;
    const panel = document.getElementById('thermal-simulation-panel');
    if (!panel) return;

    const progress = Math.max(0, Math.min(100, Number(metrics.progress || 0)));
    const progressText = `${Math.round(progress)}%`;

    panel.querySelectorAll('.atmosphere-progress-text, .atmosphere-progress-value').forEach(el => {
        el.textContent = progressText;
    });

    panel.querySelectorAll('.atmosphere-progress-range').forEach(input => {
        input.value = String(Math.round(progress));
    });

    panel.querySelectorAll('.atmosphere-stage-label').forEach(el => {
        el.textContent = metrics.atmosphereStageLabel || '气氛扩散';
    });

    panel.querySelectorAll('.atmosphere-stage-desc').forEach(el => {
        el.textContent = metrics.atmosphereStageDesc || '气氛浓度场正在随时间扩散。';
    });

    panel.querySelectorAll('[data-action="atmosphere-pause"]').forEach(btn => {
        btn.textContent = metrics.animationPlaying ? '暂停扩散' : '暂停';
    });
}


function syncQuenchAnimationProgressUi(metrics) {
    if (!metrics || processSimulationMode !== 'quench') return;
    const panel = document.getElementById('thermal-simulation-panel');
    if (!panel) return;
    const progress = Math.max(0, Math.min(100, Number(metrics.progress || 0)));
    panel.querySelectorAll('.quench-progress-text').forEach(el => { el.textContent = `${Math.round(progress)}%`; });
    panel.querySelectorAll('.quench-progress-range').forEach(input => { input.value = String(Math.round(progress)); });
    panel.querySelectorAll('.quench-stage-label').forEach(el => { el.textContent = metrics.quenchStageLabel || '淬火介质'; });
    panel.querySelectorAll('.quench-stage-desc').forEach(el => { el.textContent = metrics.quenchStageDesc || '淬火介质仿真正在推进。'; });
}

function bindAtmosphereCoverageActions() {
    if (document.body.dataset.atmosphereCoverageBound === '1') return;
    document.body.dataset.atmosphereCoverageBound = '1';

    function activateAtmosphereMode() {
        processSimulationMode = 'atmosphere';
        processSimulationActive = true;
        document.body.classList.remove('radiation-pick-mode');
        document.body.classList.remove('thermal-heatmap-mode');
        document.body.classList.remove('airflow-cooling-mode');
        document.body.classList.add('atmosphere-coverage-mode');
        document.body.classList.remove('quench-medium-mode');
        activateRightPanelTab('thermal');
    }

    document.addEventListener('click', (event) => {
        const presetBtn = event.target.closest('[data-action="atmosphere-medium-preset"]');
        const inletBtn = event.target.closest('[data-action="atmosphere-inlet-direction"]');
        const inletPresetBtn = event.target.closest('[data-action="atmosphere-inlet-preset"]');
        const inletResetBtn = event.target.closest('[data-action="atmosphere-inlet-reset"]');
        const playBtn = event.target.closest('[data-action="atmosphere-play"]');
        const pauseBtn = event.target.closest('[data-action="atmosphere-pause"]');
        const resetBtn = event.target.closest('[data-action="atmosphere-reset"]');
        if (!presetBtn && !inletBtn && !inletPresetBtn && !inletResetBtn && !playBtn && !pauseBtn && !resetBtn) return;

        event.preventDefault();
        event.stopPropagation();
        activateAtmosphereMode();

        let metrics = null;
        if (presetBtn) {
            const mediumType = presetBtn.getAttribute('data-atmosphere-medium') || 'nitriding';
            metrics = setAtmosphereMediumType(mediumType);
        } else if (inletBtn) {
            const directionKey = inletBtn.getAttribute('data-atmosphere-inlet') || 'z-';
            metrics = toggleAtmosphereInletDirection(directionKey);
        } else if (inletPresetBtn) {
            const directions = (inletPresetBtn.getAttribute('data-atmosphere-inlets') || '').split(',').map(v => v.trim()).filter(Boolean);
            metrics = setAtmosphereInletDirections(directions);
        } else if (inletResetBtn) {
            metrics = resetAtmosphereInletDirections();
        } else if (playBtn) {
            metrics = playAtmosphereCoverageAnimation({
                onUpdate: (nextMetrics) => {
                    syncAtmosphereAnimationProgressUi(nextMetrics);
                    syncThermalControlState(nextMetrics);
                },
                onFinish: (finalMetrics) => {
                    renderThermalSimulationPanel(finalMetrics, 'atmosphere');
                    syncThermalControlState(finalMetrics);
                }
            });
        } else if (pauseBtn) {
            metrics = pauseAtmosphereCoverageAnimation();
        } else if (resetBtn) {
            metrics = resetAtmosphereCoverageAnimation();
        }

        const finalMetrics = metrics || getAtmosphereCoverageRuntime()?.metrics || null;
        renderThermalSimulationPanel(finalMetrics, 'atmosphere');
        syncAtmosphereAnimationProgressUi(finalMetrics);
        syncThermalControlState(finalMetrics || null);
    }, true);

    document.addEventListener('change', (event) => {
        const mediumSelect = event.target.closest('[data-action="atmosphere-medium-type"]');
        if (!mediumSelect) return;

        event.preventDefault();
        event.stopPropagation();
        activateAtmosphereMode();
        const metrics = setAtmosphereMediumType(mediumSelect.value || 'nitriding');
        renderThermalSimulationPanel(metrics || getAtmosphereCoverageRuntime()?.metrics || null, 'atmosphere');
        syncThermalControlState(metrics || null);
    }, true);
}


function bindQuenchMediumActions() {
    if (document.body.dataset.quenchMediumBound === '1') return;
    document.body.dataset.quenchMediumBound = '1';

    function activateQuenchMode() {
        processSimulationMode = 'quench';
        processSimulationActive = true;
        document.body.classList.remove('radiation-pick-mode');
        document.body.classList.remove('thermal-heatmap-mode');
        document.body.classList.remove('airflow-cooling-mode');
        document.body.classList.remove('atmosphere-coverage-mode');
        document.body.classList.add('quench-medium-mode');
        activateRightPanelTab('thermal');
    }

    document.addEventListener('click', (event) => {
        const presetBtn = event.target.closest('[data-action="quench-medium-preset"]');
        if (!presetBtn) return;
        event.preventDefault();
        event.stopPropagation();
        activateQuenchMode();
        const mediumType = presetBtn.getAttribute('data-quench-medium') || 'oil';
        const metrics = setQuenchMediumType(mediumType);
        renderThermalSimulationPanel(metrics || getQuenchMediumRuntime()?.metrics || null, 'quench');
        syncThermalControlState(metrics || null);
    }, true);

    document.addEventListener('change', (event) => {
        const mediumSelect = event.target.closest('[data-action="quench-medium-type"]');
        const visibilitySelect = event.target.closest('[data-action="quench-furnace-visibility"]');
        if (!mediumSelect && !visibilitySelect) return;
        event.preventDefault();
        event.stopPropagation();
        activateQuenchMode();
        let metrics = null;
        if (mediumSelect) {
            metrics = setQuenchMediumType(mediumSelect.value || 'oil');
        } else if (visibilitySelect && typeof setQuenchFurnaceVisibilityMode === 'function') {
            metrics = setQuenchFurnaceVisibilityMode(visibilitySelect.value || 'auto');
        }
        renderThermalSimulationPanel(metrics || getQuenchMediumRuntime()?.metrics || null, 'quench');
        syncThermalControlState(metrics || null);
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



// ==================== Heat Merge Design V0.6 Excel Data Pool ====================
// V0.6：真实生产任务从“工件详情”导入，合炉设计只读取工件详情数据池；Mock 仅保留为演示样例。
const HEAT_MERGE_MOCK_ITEMS = [
    { name:'模具', itemCode:'00057790', customer:'瑞丰养殖', L:null, W:null, H:328, D:52, count:6, weight:131.5, material:'mov', hardness:'60-62,', process:'真空淬火', date:'2023.05.10', remark:'' },
    { name:'模具', itemCode:'00057791', customer:'科星检测', L:160, W:155, H:37, D:null, count:1, weight:7, material:'mov', hardness:'58—62,', process:'真空淬火', date:'2023.05.10', remark:'' },
    { name:'模具', itemCode:'00057863', customer:'金安安保', L:395, W:329, H:17, D:null, count:10, weight:157, material:'Cr12', hardness:'50-52,', process:'真空淬火', date:'2023.05.10', remark:'' },
    { name:'模具', itemCode:'00057863', customer:'速冷冷链', L:220, W:85, H:30, D:null, count:18, weight:250.3, material:'mov', hardness:'56-58,', process:'真空淬火', date:'2023.05.10', remark:'' },
    { name:'模具', itemCode:'00057863', customer:'程景测绘', L:424, W:164, H:40, D:null, count:4, weight:80.5, material:'Cr12', hardness:'57-60,', process:'真空淬火', date:'2023.05.10', remark:'' },
    { name:'模具', itemCode:'00057873', customer:'捷锐安防', L:120, W:105, H:24, D:null, count:8, weight:19.3, material:'Cr12', hardness:'60-62,', process:'真空淬火', date:'2023.05.10', remark:'' },
    { name:'模具', itemCode:'00057883', customer:'禾绿生鲜', L:360, W:125, H:65, D:null, count:2, weight:42.6, material:'H13', hardness:'45-48,', process:'真空淬火', date:'2023.05.10', remark:'' },
    { name:'模具', itemCode:'00057952', customer:'尚风广告', L:null, W:null, H:157, D:22, count:38, weight:9.5, material:'mov', hardness:'56-58,', process:'真空淬火', date:'2023.05.10', remark:'' },
    { name:'模具', itemCode:'00057953', customer:'科星检测', L:null, W:null, H:55, D:260, count:38, weight:103.5, material:'mov', hardness:'56-58,', process:'真空淬火', date:'2023.05.10', remark:'' },
    { name:'模具', itemCode:'00057954', customer:'金安安保', L:260, W:156, H:155, D:null, count:15, weight:119.2, material:'Cr12', hardness:'56-58,', process:'真空淬火', date:'2023.05.11', remark:'' },
    { name:'产品', itemCode:'00057786', customer:'恒盛实业', L:24, W:10, H:10, D:null, count:1, weight:13.7, material:'40Cr', hardness:'40-45,', process:'氰化', date:'2023.05.10', remark:'24×10×10=产品' },
    { name:'产品', itemCode:'00057787', customer:'鑫源集团', L:null, W:null, H:54, D:30, count:1, weight:37, material:'45#', hardness:'50-55,', process:'氰化', date:'2023.05.10', remark:'54×30=产品' },
    { name:'产品', itemCode:'00057788', customer:'天弘工贸', L:null, W:null, H:null, D:null, count:1, weight:25.6, material:'20Cr', hardness:'56-60/S:0.2-0.4,', process:'渗碳淬火', date:'2023.05.10', remark:'产品' },
    { name:'蜗杆', itemCode:'00057790', customer:'隆达商贸', L:null, W:null, H:null, D:null, count:2, weight:777, material:'无', hardness:',', process:'氰化', date:'2023.05.10', remark:'' },
    { name:'齿轮', itemCode:'00057790', customer:'广联科技', L:null, W:null, H:135, D:30, count:328, weight:420, material:'20CrMnTi', hardness:'59-62,', process:'碳氮共渗', date:'2023.05.10', remark:'大头135*30 小Q10*74' },
    { name:'0045460针杆轴套', itemCode:'00057791', customer:'泰合建设', L:null, W:null, H:15, D:28, count:1, weight:280.53, material:'20Cr', hardness:'55-60,', process:'渗碳抛丸', date:'2023.05.10', remark:'大15＊28＝盒' },
    { name:'打环器连接杆', itemCode:'00057791', customer:'汇通物流', L:90, W:18, H:13, D:null, count:13, weight:106.24, material:'20Cr', hardness:'55-60,', process:'渗碳抛丸', date:'2023.05.10', remark:'90＊18＊13=13盒' },
    { name:'刀杆偏心轮', itemCode:'00057791', customer:'德信服务', L:null, W:null, H:25, D:23, count:12, weight:320.71, material:'20Cr', hardness:'55-60,', process:'渗碳抛丸', date:'2023.05.10', remark:'23*25=12盒' },
    { name:'模具', itemCode:'00057799', customer:'盛达机械', L:null, W:null, H:85, D:215, count:54, weight:218.5, material:'45#', hardness:'最硬,', process:'渗碳淬火', date:'2023.05.10', remark:'小85＊220 小85＊205 小85＊215 小85＊235 小65＊210 小65＊180' },
    { name:'齿轮', itemCode:'00057811', customer:'万佳百货', L:null, W:null, H:47, D:160, count:1, weight:90, material:'20CrmnTⅰ', hardness:'HRC58-62,HRC28-41', process:'渗碳抛丸', date:'2023.05.10', remark:'小头47×160 小头35×120' }
];

const HEAT_MERGE_CURVES = {
    'VAC-MOV-56-58': {
        title: 'VAC-MOV-56-58',
        scope: 'MOV · 真空淬火 · 56-58HRC',
        historyCount: 18,
        recentUse: '2023.05.10',
        equipment: '真空炉 / 标准料框',
        typicalWeight: '280-390kg',
        hold: '150min',
        stages: [
            ['预热', '650℃', '30min'],
            ['升温', '1030℃', '按炉型曲线'],
            ['保温', '1030℃', '150min'],
            ['气淬', 'N₂', '按设备程序'],
            ['回火', '540℃', '120min']
        ],
        suggestion: '同材质、同工艺、同硬度区间，可作为“明显可合炉”的演示组。'
    },
    'CARB-SHOT-20CR-55-60': {
        title: 'CARB-SHOT-20CR-55-60',
        scope: '20Cr · 渗碳抛丸 · 55-60HRC',
        historyCount: 32,
        recentUse: '2023.05.10',
        equipment: '多用炉 / 渗碳线',
        typicalWeight: '350-480kg',
        hold: '180min',
        stages: [
            ['预热', '850℃', '30min'],
            ['渗碳', '930℃', '180min'],
            ['扩散', '880℃', '60min'],
            ['油淬', '80℃', '≤30s'],
            ['回火', '180℃', '120min']
        ],
        suggestion: '当前组总重 707kg，高于典型重量范围，建议工艺员确认是否保温补偿 10-15min。'
    },
    'VAC-MOV-58-62-MIX': {
        title: 'VAC-MOV-58-62-MIX',
        scope: 'MOV · 真空淬火 · 58-62 / 60-62HRC',
        historyCount: 9,
        recentUse: '2023.05.10',
        equipment: '真空炉 / 标准料框',
        typicalWeight: '80-180kg',
        hold: '170min',
        stages: [
            ['预热', '650℃', '30min'],
            ['升温', '1040℃', '按炉型曲线'],
            ['保温', '1040℃', '170min'],
            ['气淬', 'N₂', '按设备程序'],
            ['回火', '520℃', '120min']
        ],
        suggestion: '硬度区间有重叠但不完全一致，建议按高硬度要求由工艺员确认。'
    },
    'PENDING-MANUAL': {
        title: 'PENDING-MANUAL',
        scope: '待人工确认',
        historyCount: 0,
        recentUse: '-',
        equipment: '-',
        typicalWeight: '-',
        hold: '-',
        stages: [['缺少曲线', '-', '-']],
        suggestion: '缺少关键字段或不是本次 V0.5 的合炉演示组，暂不自动推荐曲线。'
    }
};

let heatMergeState = {
    strategy: 'quality',
    selectedGroupId: null,
    appliedGroupId: null,
    lastGroups: [],
    dataSource: 'materials',
    /** V0.7：AI 工装推荐 / 预装炉设计 */
    lastToolingRecommendations: [],
    selectedToolingPlanId: null,
    adoptedToolingPlan: null,
    /** V0.7.5：默认只按当前策略推荐一张卡；用户主动点击后才比较三种策略 */
    compareToolingStrategies: false,
    /** V0.7.12：人工拼炉 Beta。自动分组保持保守；跨材质拼炉必须由用户确认生成。 */
    manualMergeGroups: [],
    manualMergeDraftGroupIds: []
};

// ==================== Plan Compare V0.5 ====================
// 只做可解释的方案对比摘要：AI 原始方案、人工调整后当前方案、历史相似方案。
// 不直接预测最终硬度，也不改写客户工艺曲线。
let planCompareV05Baseline = null;


function hmEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function normalizeHeatText(value) {
    return String(value ?? '').trim().replace(/，/g, ',').replace(/—|–/g, '-');
}

function normalizeMaterialName(value) {
    let v = normalizeHeatText(value).replace(/\s+/g, '');
    if (!v || v === '无' || v === '-') return '';
    v = v.replace(/[Tt][ⅰⅠ]/g, 'Ti');
    const upper = v.toUpperCase();
    if (upper === 'MOV') return 'MOV';
    if (upper === '20CRMNTI') return '20CrMnTi';
    if (upper === '20CR') return '20Cr';
    if (upper === '40CR') return '40Cr';
    if (upper === 'CR12') return 'Cr12';
    if (upper === 'H13') return 'H13';
    if (v === '45#') return '45#';
    return v;
}

function parseHardnessRange(value) {
    const raw = normalizeHeatText(value).replace(/\s+/g, '');
    const match = raw.match(/(?:HRC)?(\d{2})(?:-|~|到)(\d{2})/i);
    if (!match) return null;
    const min = parseInt(match[1], 10);
    const max = parseInt(match[2], 10);
    if (!isFinite(min) || !isFinite(max)) return null;
    return { min, max, label: `${min}-${max}` };
}

function extractCaseDepth(value) {
    const raw = normalizeHeatText(value).replace(/\s+/g, '');
    const match = raw.match(/S[:：]?([0-9.]+)-([0-9.]+)/i);
    return match ? `${match[1]}-${match[2]}mm` : '';
}

function getHeatMergeItemValidation(item) {
    const missing = [];
    if (!item.material) missing.push('材质');
    if (!normalizeHeatText(item.process)) missing.push('工艺');
    if (!item.hardness) missing.push('硬度');
    if (!Number(item.count)) missing.push('数量');
    if (!Number(item.weight)) missing.push('重量');
    if (missing.includes('材质') || missing.includes('工艺') || missing.includes('硬度')) {
        return { level: 'invalid', missing, text: `缺少${missing.join('、')}` };
    }
    if (missing.length) {
        return { level: 'review', missing, text: `需确认${missing.join('、')}` };
    }
    return { level: 'valid', missing: [], text: '可参与合炉分组' };
}

function isHeatMergeItemEligible(item) {
    return getHeatMergeItemValidation(item).level === 'valid';
}

function applyHeatMergeValidationToMaterialCards() {
    document.querySelectorAll('.material-card').forEach(card => {
        const d = getMaterialDataFromCard(card);
        const h = parseHardnessRange(d.hardness);
        const item = {
            material: normalizeMaterialName(d.material),
            process: normalizeHeatText(d.process),
            hardness: h ? h.label : '',
            count: Number(d.count) || 0,
            weight: Number(d.totalWeight) || 0
        };
        const status = getHeatMergeItemValidation(item);
        card.classList.toggle('heat-item-invalid', status.level === 'invalid');
        card.classList.toggle('heat-item-review', status.level === 'review');
        card.classList.toggle('heat-item-excluded', status.level !== 'valid');
        card.setAttribute('data-heat-validation', status.level);
        card.setAttribute('data-heat-validation-message', status.text);

        let badge = card.querySelector('.heat-validation-badge');
        if (status.level === 'valid') {
            if (badge) badge.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'heat-validation-badge';
            const info = card.querySelector('.m-info') || card;
            info.appendChild(badge);
        }
        badge.className = `heat-validation-badge ${status.level}`;
        badge.innerHTML = `<b>${status.level === 'invalid' ? '异常' : '待确认'}</b><span>${hmEscape(status.text)} · 不参与合炉/生成</span>`;
    });
}

function normalizeHeatMergeKeyPart(value) {
    return normalizeHeatText(value || '')
        .replace(/\s+/g, '')
        .replace(/[^一-龥A-Za-z0-9#.-]/g, '') || 'NA';
}

function getHeatMergeDynamicGroupId(item) {
    const material = normalizeMaterialName(item.material);
    const process = normalizeHeatText(item.process);
    const hardness = item.hardness || '';
    const caseDepth = item.caseDepth || '无渗层';
    return [material, process, hardness, caseDepth].map(normalizeHeatMergeKeyPart).join('|');
}

function getHeatMergeCurveKeyFromItem(item) {
    const material = normalizeMaterialName(item.material);
    const process = normalizeHeatText(item.process);
    const hardness = item.hardness || '';
    if (material === 'MOV' && process === '真空淬火' && hardness === '56-58') return 'VAC-MOV-56-58';
    if (material === '20Cr' && process === '渗碳抛丸' && hardness === '55-60') return 'CARB-SHOT-20CR-55-60';
    if (material === 'MOV' && process === '真空淬火' && (hardness === '58-62' || hardness === '60-62')) return 'VAC-MOV-58-62-MIX';
    const mat = normalizeHeatMergeKeyPart(material).toUpperCase();
    const proc = normalizeHeatMergeKeyPart(process);
    const hard = normalizeHeatMergeKeyPart(hardness);
    const depth = normalizeHeatMergeKeyPart(item.caseDepth || 'NOCASE');
    return `AUTO-${mat}-${proc}-${hard}-${depth}`;
}

function getHeatMergeDataSourceInfo() {
    const total = document.querySelectorAll('.material-card').length;
    const isMock = heatMergeState.dataSource === 'mock' && total > 0;
    if (isMock) {
        return {
            key: 'mock',
            label: '示例数据',
            curveLabel: '内置示例曲线',
            curveStatus: '示例曲线',
            historyLabel: '示例历史',
            note: '当前物料来自测试用例二，仅用于演示合炉、工装推荐和装炉流程。'
        };
    }
    const isFeishu = heatMergeState.dataSource === 'feishu' && total > 0;
    return {
        key: total ? (heatMergeState.dataSource || 'materials') : 'empty',
        label: total ? (isFeishu ? '飞书生产任务' : '真实/手动任务') : '暂无数据',
        curveLabel: '未接入真实曲线库',
        curveStatus: '待曲线确认',
        historyLabel: '暂无真实历史炉次',
        note: total
            ? '当前只做规则分组和工装预估；真实曲线库、历史炉次库尚未接入。'
            : '请先在工件详情导入生产任务 Excel。'
    };
}

function getHeatMergeCurveStatusText(group) {
    if (!group) return '-';
    const source = getHeatMergeDataSourceInfo();
    if (source.key === 'mock') {
        return HEAT_MERGE_CURVES[group.curveKey] ? `示例曲线：${group.curveKey}` : '示例曲线：待人工确认';
    }
    return '曲线状态：未接入真实曲线库';
}

function getHeatMergeCurveForGroup(group) {
    if (!group) return HEAT_MERGE_CURVES['PENDING-MANUAL'];
    const source = getHeatMergeDataSourceInfo();

    // V0.7.5：只有“载入示例数据”时才展示内置 Demo 曲线和示例历史炉次。
    // 真实 Excel / 手动录入数据即使字段命中 MOV/20Cr 的演示组合，也不能假装已经匹配到真实历史曲线。
    if (source.key === 'mock') {
        const known = HEAT_MERGE_CURVES[group.curveKey];
        if (known) return { ...known, curveSource: 'mock' };
    }

    return {
        title: group.curveKey && source.key === 'mock' ? group.curveKey : 'WAITING-RECIPE-LIBRARY',
        scope: `${group.line || '真实生产任务'} · ${source.curveLabel}`,
        historyCount: source.key === 'mock' ? '示例' : '未接入',
        recentUse: '-',
        equipment: '按工件详情 / 生产车间配置确认',
        typicalWeight: '-',
        hold: '-',
        curveSource: source.key,
        stages: [['规则分组', '已完成', '按材质 / 工艺 / 硬度 / 渗层成组'], ['曲线匹配', '待接入', '客户历史升温/保温曲线库']],
        suggestion: source.key === 'mock'
            ? '当前为内置示例曲线，仅用于演示流程，不代表客户真实历史炉次。'
            : '当前为规则分组结果：可以辅助判断合炉兼容性，但尚未读取真实工艺曲线和历史炉次，需工艺员确认。'
    };
}

function getHeatMergeGroupTitle(index, group) {
    if (group?.title && !/^自动工艺组/.test(group.title)) return group.title;
    const letter = String.fromCharCode(65 + Math.min(25, index));
    return `工艺组 ${letter}`;
}

function inferMockShape(item) {
    if (item.D && item.H) {
        return { shape: 'cylinder', dim1: Number(item.D) || 30, dim2: Number(item.D) || 30, dim3: Number(item.H) || 30 };
    }
    if (item.L && item.W && item.H) {
        return { shape: 'cuboid', dim1: Number(item.L) || 60, dim2: Number(item.W) || 60, dim3: Number(item.H) || 30 };
    }
    // 没有尺寸的数据仍保留为可分组数据，3D 展示用保守默认尺寸。
    return { shape: 'cuboid', dim1: 80, dim2: 80, dim3: 30 };
}


function getHeatMergeActiveFilterInfo() {
    return {
        material: [...(currentMaterialFilters || [])],
        process: [...(currentProcessFilters || [])],
        hardness: [...(currentHardnessFilters || [])],
        get active() {
            return this.material.length > 0 || this.process.length > 0 || this.hardness.length > 0;
        }
    };
}

function getHeatMergeActiveFilterLabel() {
    const f = getHeatMergeActiveFilterInfo();
    if (!f.active) return '';
    const parts = [];
    if (f.material.length) parts.push(`材质 ${f.material.join('/')}`);
    if (f.process.length) parts.push(`工艺 ${f.process.join('/')}`);
    if (f.hardness.length) parts.push(`硬度 ${f.hardness.join('/')}`);
    return parts.join(' · ');
}

function materialCardPassesHeatMergeFilters(card) {
    const f = getHeatMergeActiveFilterInfo();
    if (!f.active) return true;
    const material = card.getAttribute('data-material') || '';
    const process = card.getAttribute('data-process') || '';
    const hardness = card.getAttribute('data-hardness') || '';
    const materialPass = f.material.length === 0 || f.material.includes(material);
    const processPass = f.process.length === 0 || f.process.includes(process);
    const hardnessPass = f.hardness.length === 0 || f.hardness.includes(hardness);
    return materialPass && processPass && hardnessPass;
}

function getHeatMergeItemsFromCards(options = {}) {
    const respectFilters = options.respectFilters !== false;
    return [...document.querySelectorAll('.material-card')]
        .filter(card => !respectFilters || materialCardPassesHeatMergeFilters(card))
        .map(card => {
            const d = getMaterialDataFromCard(card);
            const h = parseHardnessRange(d.hardness);
            return {
                source: d.source || 'card',
                cardId: card.id,
                sourceRecordId: d.sourceRecordId || '',
                taskId: d.taskId || '',
                sourceStatus: d.sourceStatus || '',
                sourceClientId: d.sourceClientId || '',
                name: d.showName || d.name,
                itemCode: d.itemCode || '',
                customer: d.customer || '',
                count: Number(d.count) || 0,
                weight: Number(d.totalWeight) || 0,
                shape: d.shape || 'cuboid',
                dim1: Number(d.dim1) || 0,
                dim2: Number(d.dim2) || 0,
                dim3: Number(d.dim3) || 0,
                material: normalizeMaterialName(d.material),
                materialRaw: d.material || '',
                process: normalizeHeatText(d.process),
                hardnessRaw: d.hardness || '',
                hardness: h ? h.label : '',
                hardnessRange: h,
                caseDepth: extractCaseDepth(d.hardness),
                orderDate: d.orderDate || '',
                deliveryDate: d.deliveryDate || '',
                dueDate: d.deliveryDate || d.orderDate || '',
                remark: d.remark || ''
            };
        });
}
function getHeatMergeMockPreviewItems() {
    return HEAT_MERGE_MOCK_ITEMS.map((item, index) => {
        const h = parseHardnessRange(item.hardness);
        return {
            source: 'mock',
            mockIndex: index,
            name: item.name,
            itemCode: item.itemCode,
            customer: item.customer,
            count: Number(item.count) || 0,
            weight: Number(item.weight) || 0,
            shape: inferMockShape(item).shape,
            dim1: inferMockShape(item).dim1,
            dim2: inferMockShape(item).dim2,
            dim3: inferMockShape(item).dim3,
            material: normalizeMaterialName(item.material),
            materialRaw: item.material || '',
            process: normalizeHeatText(item.process),
            hardnessRaw: item.hardness || '',
            hardness: h ? h.label : '',
            hardnessRange: h,
            caseDepth: extractCaseDepth(item.hardness),
            orderDate: item.date ? String(item.date).replace(/\./g, '-') : '',
            deliveryDate: '',
            dueDate: item.date ? String(item.date).replace(/\./g, '-') : '',
            remark: item.remark || ''
        };
    });
}

function getHeatMergeSourceItems() {
    // V0.7.16：合炉分组只使用已通过数据校验的物料。
    // 缺材质/工艺/硬度/数量/重量的任务仍显示在工件详情中，但不参与合炉计算和生成方案。
    return getHeatMergeItemsFromCards().filter(isHeatMergeItemEligible);
}


function getHeatMergeStrategyProfile(strategy = heatMergeState.strategy || 'quality') {
    const profiles = {
        quality: {
            id: 'quality',
            label: '质量优先',
            groupMode: '严格同工艺/同硬度',
            note: '严格合炉，控制单炉装载密度',
            status: '可合炉',
            statusClass: 'ok',
            targetWeightLoad: 0.68,
            targetSpaceLoad: 0.32
        },
        delivery: {
            id: 'delivery',
            label: '交付优先',
            groupMode: '交期优先排炉',
            note: '优先处理临近交期，允许小批量先加工',
            status: '优先排炉',
            statusClass: 'warn',
            targetWeightLoad: 0.82,
            targetSpaceLoad: 0.45
        },
        cost: {
            id: 'cost',
            label: '成本优先',
            groupMode: '兼容拼炉/减少炉次',
            note: '提高装载率，减少炉次；必要时建议等待拼炉',
            status: '拼炉候选',
            statusClass: 'warn',
            targetWeightLoad: 0.92,
            targetSpaceLoad: 0.58
        }
    };
    return profiles[strategy] || profiles.quality;
}

function parseHeatDateValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const normalized = raw.replace(/[.\/]/g, '-');
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
}

function getHeatMergeDueBucket(item) {
    const d = parseHeatDateValue(item.deliveryDate || item.dueDate || item.orderDate);
    if (!d) return '未设交期';
    const now = new Date();
    const days = Math.ceil((d.getTime() - now.getTime()) / 86400000);
    if (days <= 3) return '急单';
    if (days <= 7) return '近期待交';
    return '正常交付';
}

function getHeatMergeStrategyGroupId(item, strategy = heatMergeState.strategy || 'quality') {
    const material = normalizeMaterialName(item.material);
    const process = normalizeHeatText(item.process);
    const hardness = item.hardness || '';
    const caseDepth = item.caseDepth || '无渗层';
    if (!material || !process || !hardness) return 'G-INVALID';

    // 示例数据保留典型 Demo 组，真实数据仍会显示“待接入曲线库”。
    // 质量优先：最严格，按材质 + 工艺 + 硬度 + 渗层精确分组。
    if (strategy === 'quality') {
        if (material === 'MOV' && process === '真空淬火' && hardness === '56-58') return 'G-MOV-VAC-56-58';
        if (material === '20Cr' && process === '渗碳抛丸' && hardness === '55-60') return 'G-20CR-CARB-SHOT-55-60';
        return `DYN-${getHeatMergeDynamicGroupId(item)}`;
    }

    // 交付优先：以交期桶 + 材质/工艺为主，允许硬度相近的同工艺件先排炉。
    if (strategy === 'delivery') {
        const dueBucket = getHeatMergeDueBucket(item);
        return `DYN-${[material, process, dueBucket, caseDepth].map(normalizeHeatMergeKeyPart).join('|')}`;
    }

    // 成本优先：以减少炉次为主，按材质/工艺/渗层拼炉，硬度改为“兼容待确认”。
    if (strategy === 'cost') {
        return `DYN-${[material, process, '兼容拼炉', caseDepth].map(normalizeHeatMergeKeyPart).join('|')}`;
    }

    return `DYN-${getHeatMergeDynamicGroupId(item)}`;
}

function classifyHeatMergeItem(item, strategy = heatMergeState.strategy || 'quality') {
    return getHeatMergeStrategyGroupId(item, strategy);
}

function getHeatMergeGroupPreset(groupId) {
    const presets = {
        'G-MOV-VAC-56-58': {
            id: 'G-MOV-VAC-56-58',
            title: '工艺组 A',
            status: '可合炉',
            statusClass: 'ok',
            score: 92,
            curveKey: 'VAC-MOV-56-58',
            line: 'MOV · 真空淬火 · 56-58HRC',
            reason: ['材质一致', '工艺一致', '硬度一致', '无渗层冲突'],
            risk: '典型可合炉演示组，可直接进入装炉方案。'
        },
        'G-20CR-CARB-SHOT-55-60': {
            id: 'G-20CR-CARB-SHOT-55-60',
            title: '工艺组 B',
            status: '可合炉 · 需确认',
            statusClass: 'warn',
            score: 88,
            curveKey: 'CARB-SHOT-20CR-55-60',
            line: '20Cr · 渗碳抛丸 · 55-60HRC',
            reason: ['材质一致', '工艺一致', '硬度一致', '历史曲线可匹配'],
            risk: '总重量偏高，建议查看历史相似炉次并确认保温补偿。'
        },
        'G-MOV-VAC-58-62-MIX': {
            id: 'G-MOV-VAC-58-62-MIX',
            title: '工艺组 C',
            status: '谨慎合炉',
            statusClass: 'warn',
            score: 78,
            curveKey: 'VAC-MOV-58-62-MIX',
            line: 'MOV · 真空淬火 · 58-62 / 60-62HRC',
            reason: ['材质一致', '工艺一致', '硬度范围有重叠'],
            risk: '硬度区间不完全一致，建议按高硬度要求确认曲线。'
        },
        'G-OTHER': {
            id: 'G-OTHER',
            title: '其它单批 / 未合炉物料',
            status: '暂不推荐合炉',
            statusClass: 'muted',
            score: 60,
            curveKey: 'PENDING-MANUAL',
            line: '非本次演示主工艺组',
            reason: ['可能是单批加工', '或材质 / 工艺 / 硬度组合不满足自动合炉'],
            risk: '建议保持独立加工或交由工艺员人工分组。'
        },
        'G-INVALID': {
            id: 'G-INVALID',
            title: '数据异常',
            status: '无法判断',
            statusClass: 'danger',
            score: 0,
            curveKey: 'PENDING-MANUAL',
            line: '缺少材质 / 硬度 / 工艺',
            reason: ['关键字段缺失', '无法匹配历史曲线'],
            risk: '需要先补全工艺字段，再进入合炉判断。'
        }
    };
    if (presets[groupId]) return presets[groupId];
    if (String(groupId || '').startsWith('DYN-')) {
        const keyText = String(groupId).replace(/^DYN-/, '');
        const parts = keyText.split('|');
        const material = parts[0] || '未知材质';
        const process = parts[1] || '未知工艺';
        const hardnessOrMode = parts[2] || '待确认';
        const caseDepth = parts[3] && parts[3] !== '无渗层' && parts[3] !== 'NOCASE' ? ` · 渗层 ${parts[3]}` : '';
        const hardText = /^\d/.test(hardnessOrMode) ? `${hardnessOrMode}HRC` : hardnessOrMode;
        return {
            id: groupId,
            title: '规则工艺组',
            status: '待曲线确认',
            statusClass: 'muted',
            score: 72,
            curveKey: `AUTO-${normalizeHeatMergeKeyPart(material).toUpperCase()}-${normalizeHeatMergeKeyPart(process)}-${normalizeHeatMergeKeyPart(hardnessOrMode)}-${normalizeHeatMergeKeyPart(parts[3] || 'NOCASE')}`,
            line: `${material} · ${process} · ${hardText}${caseDepth}`,
            reason: ['规则成组', '待匹配客户曲线库'],
            risk: '已按当前策略成组，曲线和保温时间仍需工艺员确认。'
        };
    }
    return presets['G-OTHER'];
}

function applyHeatMergeStrategyToGroup(group, strategy) {
    const profile = getHeatMergeStrategyProfile(strategy);
    group.strategy = strategy;
    group.strategyLabel = profile.label;

    if (group.id === 'G-INVALID') {
        group.statusClass = 'danger';
        group.status = '异常';
        group.score = 0;
        group.shortHint = '补全字段';
        return group;
    }

    const multi = group.items.length > 1;
    const hasReview = group.validation.review > 0 || group.validation.invalid > 0;
    const weight = Number(group.weight || 0);

    if (strategy === 'quality') {
        group.status = hasReview ? '需确认' : '可合炉';
        group.statusClass = hasReview ? 'warn' : 'ok';
        group.score = group.score || (multi ? 90 : 76);
        group.shortHint = '严格同工艺';
        group.risk = '质量优先：严格按材质/工艺/硬度成组，推荐时控制单框密度。';
    } else if (strategy === 'delivery') {
        group.status = '优先排炉';
        group.statusClass = 'warn';
        group.score = Math.max(group.score || 0, multi ? 84 : 72);
        group.shortHint = '交期优先';
        group.risk = '交付优先：优先把临近交期物料排炉，小批量也允许先加工。';
    } else if (strategy === 'cost') {
        group.status = weight < 250 ? '建议等拼炉' : '拼炉候选';
        group.statusClass = weight < 250 ? 'muted' : 'warn';
        group.score = Math.max(group.score || 0, weight < 250 ? 66 : 86);
        group.shortHint = weight < 250 ? '待积攒' : '少炉次';
        group.risk = '成本优先：允许兼容拼炉，优先减少炉次并提高装载率。';
    }

    if (String(group.id).startsWith('DYN-')) {
        group.title = '规则工艺组';
        group.reason = [profile.groupMode, profile.note];
    }
    return group;
}


function getHeatMergeManualGroupLabel(items = []) {
    const materials = [...new Set(items.map(i => normalizeMaterialName(i.material)).filter(Boolean))];
    const processes = [...new Set(items.map(i => normalizeHeatText(i.process)).filter(Boolean))];
    const materialText = materials.length <= 3 ? materials.join(' + ') : `${materials.slice(0, 3).join(' + ')} 等${materials.length}种`;
    const processText = processes.length === 1 ? processes[0] : (processes.length ? '多工艺待确认' : '工艺待确认');
    return `${materialText || '跨材质'} · ${processText}`;
}

function normalizeHeatManualMergeGroup(group, index = 0) {
    const items = Array.isArray(group?.items) ? group.items : [];
    const quantity = items.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
    const weight = items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
    const validation = items.reduce((acc, item) => {
        const v = getHeatMergeItemValidation(item);
        const key = v.level === 'invalid' ? 'invalid' : (v.level === 'review' ? 'review' : 'valid');
        acc[key] += 1;
        return acc;
    }, { valid: 0, review: 0, invalid: 0 });
    const line = group.line || getHeatMergeManualGroupLabel(items);
    return {
        ...group,
        id: group.id || `MANUAL-${index + 1}`,
        title: group.title || `人工拼炉组 ${index + 1}`,
        line,
        status: '人工拼炉',
        statusClass: 'warn',
        score: Math.max(60, Math.min(82, Number(group.score || 72))),
        curveKey: 'MANUAL-MERGE-REVIEW',
        reason: ['用户确认拼炉', '跨材质/曲线待确认'],
        risk: '人工拼炉：包含跨材质或跨工艺风险，需工艺员确认后再执行。',
        shortHint: '需确认',
        items,
        quantity,
        weight,
        validation,
        manualMerge: true,
        strategy: 'cost',
        strategyLabel: '成本优先'
    };
}

function getHeatManualMergeDraftGroups(baseGroups = []) {
    const ids = new Set(heatMergeState.manualMergeDraftGroupIds || []);
    return baseGroups.filter(g => ids.has(g.id) && !g.manualMerge && g.id !== 'G-INVALID');
}

function renderHeatManualMergeDraftBar(baseGroups = []) {
    if ((heatMergeState.strategy || 'quality') !== 'cost') return '';
    const draftGroups = getHeatManualMergeDraftGroups(baseGroups);
    if (!draftGroups.length) return '';
    const totalItems = draftGroups.reduce((sum, g) => sum + (g.quantity || 0), 0);
    const totalWeight = draftGroups.reduce((sum, g) => sum + (Number(g.weight) || 0), 0);
    const materials = [...new Set(draftGroups.flatMap(g => (g.items || []).map(i => normalizeMaterialName(i.material)).filter(Boolean)))];
    const materialText = materials.length <= 3 ? materials.join(' + ') : `${materials.slice(0, 3).join(' + ')} 等${materials.length}种`;
    return `
        <div class="hm-manual-draft-bar">
            <div>
                <strong>人工拼炉 Beta</strong>
                <span>已选 ${draftGroups.length} 组 · ${totalItems} 件 · ${totalWeight.toFixed(1)}kg · ${hmEscape(materialText || '跨材质')}</span>
            </div>
            <div class="hm-manual-draft-actions">
                <button type="button" class="hm-mini-btn" data-action="heat-manual-clear-draft">清空</button>
                <button type="button" class="hm-mini-btn primary" data-action="heat-manual-create-group" ${draftGroups.length >= 2 ? '' : 'disabled'}>生成拼炉组</button>
            </div>
        </div>
    `;
}

function toggleHeatManualMergeDraftGroup(groupId) {
    if (!groupId || groupId === 'G-INVALID') return;
    if ((heatMergeState.strategy || 'quality') !== 'cost') {
        heatMergeState.strategy = 'cost';
        document.querySelectorAll('.hm-strategy-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-merge-strategy') === 'cost');
        });
    }
    const ids = new Set(heatMergeState.manualMergeDraftGroupIds || []);
    if (ids.has(groupId)) ids.delete(groupId);
    else ids.add(groupId);
    heatMergeState.manualMergeDraftGroupIds = [...ids];
    heatMergeState.selectedToolingPlanId = null;
    heatMergeState.adoptedToolingPlan = null;
    heatMergeState.lastToolingRecommendations = [];
    renderHeatMergeDesignPanel();
    const count = heatMergeState.manualMergeDraftGroupIds.length;
    showCapacityFeedback('success', count ? `已加入人工拼炉候选：${count} 个工艺组` : '已清空人工拼炉候选');
}

function clearHeatManualMergeDraft() {
    heatMergeState.manualMergeDraftGroupIds = [];
    renderHeatMergeDesignPanel();
    showCapacityFeedback('success', '已清空人工拼炉候选');
}

function createHeatManualMergeGroupFromDraft() {
    const baseGroups = (heatMergeState.lastGroups || []).filter(g => !g.manualMerge);
    const draftGroups = getHeatManualMergeDraftGroups(baseGroups);
    if (draftGroups.length < 2) {
        alert('请至少选择 2 个工艺组，再生成跨材质人工拼炉组。');
        return;
    }
    const items = draftGroups.flatMap(g => (g.items || [])
        .filter(isHeatMergeItemEligible)
        .map(item => ({ ...item, manualMergeSourceGroupId: g.id, manualMergeSourceGroupTitle: g.title })));
    const group = normalizeHeatManualMergeGroup({
        id: `MANUAL-${Date.now()}`,
        title: `人工拼炉组 ${(heatMergeState.manualMergeGroups || []).length + 1}`,
        sourceGroupIds: draftGroups.map(g => g.id),
        sourceGroupTitles: draftGroups.map(g => g.title),
        items,
        createdAt: new Date().toISOString()
    }, (heatMergeState.manualMergeGroups || []).length);
    heatMergeState.manualMergeGroups = [group, ...(heatMergeState.manualMergeGroups || [])];
    heatMergeState.manualMergeDraftGroupIds = [];
    heatMergeState.selectedGroupId = group.id;
    heatMergeState.appliedGroupId = null;
    heatMergeState.selectedToolingPlanId = null;
    heatMergeState.adoptedToolingPlan = null;
    heatMergeState.lastToolingRecommendations = [];
    renderHeatMergeDesignPanel();
    showCapacityFeedback('success', `已生成 ${group.title}：${group.quantity} 件 / ${group.weight.toFixed(1)}kg，需工艺员确认后执行`);
}

function removeHeatManualMergeGroup(groupId) {
    heatMergeState.manualMergeGroups = (heatMergeState.manualMergeGroups || []).filter(g => g.id !== groupId);
    heatMergeState.manualMergeDraftGroupIds = (heatMergeState.manualMergeDraftGroupIds || []).filter(id => id !== groupId);
    if (heatMergeState.selectedGroupId === groupId) heatMergeState.selectedGroupId = null;
    if (heatMergeState.appliedGroupId === groupId) heatMergeState.appliedGroupId = null;
    if (heatMergeState.adoptedToolingPlan?.groupId === groupId) heatMergeState.adoptedToolingPlan = null;
    renderHeatMergeDesignPanel();
    showCapacityFeedback('success', '已移除人工拼炉组');
}

function buildHeatMergeGroups() {
    const items = getHeatMergeSourceItems();
    const strategy = heatMergeState.strategy || 'quality';
    const map = new Map();

    items.forEach(item => {
        const groupId = classifyHeatMergeItem(item, strategy);
        if (!map.has(groupId)) {
            const preset = getHeatMergeGroupPreset(groupId);
            map.set(groupId, { ...preset, items: [], quantity: 0, weight: 0, validation: { valid: 0, review: 0, invalid: 0 } });
        }
        const group = map.get(groupId);
        const validation = getHeatMergeItemValidation(item);
        group.items.push(item);
        group.quantity += Number(item.count) || 0;
        group.weight += Number(item.weight) || 0;
        group.validation[validation.level === 'invalid' ? 'invalid' : (validation.level === 'review' ? 'review' : 'valid')] += 1;
    });

    const preferredOrder = [
        'G-MOV-VAC-56-58',
        'G-20CR-CARB-SHOT-55-60',
        'G-MOV-VAC-58-62-MIX',
        'G-OTHER',
        'G-INVALID'
    ];

    const groups = [...map.values()].map(group => applyHeatMergeStrategyToGroup(group, strategy)).sort((a, b) => {
        if (a.id === 'G-INVALID' || b.id === 'G-INVALID') return a.id === 'G-INVALID' ? 1 : -1;
        const ia = preferredOrder.indexOf(a.id);
        const ib = preferredOrder.indexOf(b.id);
        if ((ia >= 0) || (ib >= 0)) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        if (strategy === 'delivery') {
            const urgencyRank = v => /急单/.test(v.line || '') ? 0 : (/近期/.test(v.line || '') ? 1 : 2);
            const rankDelta = urgencyRank(a) - urgencyRank(b);
            if (rankDelta !== 0) return rankDelta;
        }
        if (b.score !== a.score) return b.score - a.score;
        return b.weight - a.weight;
    });

    groups.forEach((group, index) => {
        if (group.title === '自动工艺组' || group.title === '规则工艺组') group.title = `规则工艺组 ${index + 1}`;
    });

    const manualGroups = (heatMergeState.manualMergeGroups || [])
        .map((group, index) => normalizeHeatManualMergeGroup(group, index))
        .filter(group => Array.isArray(group.items) && group.items.length > 0);

    // V0.7.14：人工拼炉组生成后，隐藏其来源规则组。
    // 否则同一批物料会同时出现在“人工拼炉组”和原规则组里，用户会误以为有重复任务。
    const manualSourceGroupIds = new Set(
        manualGroups.flatMap(group => Array.isArray(group.sourceGroupIds) ? group.sourceGroupIds : [])
    );
    const visibleRuleGroups = manualSourceGroupIds.size
        ? groups.filter(group => !manualSourceGroupIds.has(group.id))
        : groups;

    const finalGroups = (heatMergeState.strategy === 'cost') ? [...manualGroups, ...visibleRuleGroups] : visibleRuleGroups;

    heatMergeState.lastGroups = finalGroups;
    return finalGroups;
}

function getHeatMergeGroupById(groupId) {
    const groups = heatMergeState.lastGroups?.length ? heatMergeState.lastGroups : buildHeatMergeGroups();
    return groups.find(g => g.id === groupId) || null;
}

function getHeatMergeTaskStats(options = {}) {
    const respectFilters = options.respectFilters !== false;
    const items = getHeatMergeItemsFromCards({ respectFilters });
    let valid = 0, review = 0, invalid = 0;
    items.forEach(item => {
        const st = getHeatMergeItemValidation(item);
        if (st.level === 'valid') valid += 1;
        else if (st.level === 'review') review += 1;
        else invalid += 1;
    });
    return {
        total: items.length,
        qty: items.reduce((sum, item) => sum + (Number(item.count) || 0), 0),
        weight: items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0),
        valid,
        review,
        invalid,
        excluded: review + invalid,
        filtered: !!getHeatMergeActiveFilterLabel()
    };
}

function renderHeatMergeSummary(groups) {
    const el = document.getElementById('heat-merge-summary');
    if (!el) return;
    const activeGroup = heatMergeState.appliedGroupId
        ? (getHeatMergeGroupById(heatMergeState.appliedGroupId) || getHeatMergeGroupPreset(heatMergeState.appliedGroupId))
        : (heatMergeState.selectedGroupId ? (getHeatMergeGroupById(heatMergeState.selectedGroupId) || getHeatMergeGroupPreset(heatMergeState.selectedGroupId)) : null);
    const source = getHeatMergeDataSourceInfo();
    const stats = getHeatMergeTaskStats();
    const filterLabel = getHeatMergeActiveFilterLabel();
    const strategyProfile = getHeatMergeStrategyProfile(heatMergeState.strategy || 'quality');
    const dataLine = stats.total
        ? `${stats.total}条 · ${stats.qty}件 · ${stats.weight.toFixed(1)}kg · ${stats.valid}有效${stats.excluded ? ` · ${stats.excluded}已排除` : ''}`
        : '暂无可合炉任务';
    const activeLine = activeGroup
        ? `${heatMergeState.appliedGroupId ? '已采用' : '当前选中'}：${activeGroup.line || activeGroup.title}`
        : (filterLabel ? `当前筛选：${filterLabel}` : '选择工艺组后推荐工装');

    el.innerHTML = `
        <div class="hm-status-line v0719">
            <div class="hm-status-main">
                <strong>${hmEscape(dataLine)}</strong>
                <span>${hmEscape(strategyProfile.label)} · ${hmEscape(strategyProfile.groupMode)} · ${hmEscape(source.curveLabel)}</span>
            </div>
            <div class="hm-status-active">${hmEscape(activeLine)}</div>
        </div>
    `;
}
function getHeatMergeGroupDisplayTitle(group, index = 0) {
    const source = getHeatMergeDataSourceInfo();
    if (group?.manualMerge) return group.title || `人工拼炉组 ${index + 1}`;
    if (source.key === 'mock') return group?.title || getHeatMergeGroupTitle(index, group);
    if (group?.id === 'G-INVALID') return '异常数据组';
    return `规则工艺组 ${index + 1}`;
}

function getHeatMergeGroupDisplayRisk(group) {
    const source = getHeatMergeDataSourceInfo();
    if (group?.manualMerge) return '跨材质 · 需确认';
    if (source.key === 'mock') return group?.status || '';
    if (group?.id === 'G-INVALID') return '字段缺失';
    if (group?.statusClass === 'warn') return '需工艺确认';
    return '可进入工装推荐';
}

function getHeatMergeDisplayReasons(group) {
    const source = getHeatMergeDataSourceInfo();
    if (source.key === 'mock') return group?.reason || [];
    if (group?.id === 'G-INVALID') return ['字段缺失'];
    return ['规则成组'];
}

function renderHeatMergeGroups() {
    const container = document.getElementById('heat-merge-groups');
    if (!container) return;

    const groups = buildHeatMergeGroups();
    renderHeatMergeSummary(groups);

    if (!groups.length) {
        const allItems = getHeatMergeItemsFromCards();
        const excluded = allItems.filter(item => !isHeatMergeItemEligible(item)).length;
        container.innerHTML = `
            <div class="hm-empty hm-empty-v0719">
                ${excluded ? `当前筛选下 ${excluded} 条物料未通过校验，已从合炉计算中排除。请回到工件详情补全字段。` : '暂无可合炉物料。请先到“工件详情”导入 Excel。'}
            </div>
        `;
        return;
    }

    const draftBarHtml = renderHeatManualMergeDraftBar(groups.filter(g => !g.manualMerge));
    container.innerHTML = draftBarHtml + groups.map((group, index) => {
        const active = heatMergeState.selectedGroupId === group.id || heatMergeState.appliedGroupId === group.id;
        const displayTitle = getHeatMergeGroupDisplayTitle(group, index);
        const displayRisk = getHeatMergeGroupDisplayRisk(group);
        const canGenerate = group.id !== 'G-INVALID';
        const curveStatus = group.manualMerge ? '人工确认' : (group.id === 'G-INVALID' ? '字段缺失' : '曲线待确认');
        const manualAddText = (heatMergeState.manualMergeDraftGroupIds || []).includes(group.id) ? '已加入' : '拼炉';
        const statusText = group.manualMerge ? '人工确认' : (group.status || displayRisk || '待确认');
        const lineText = group.line || displayRisk || '规则成组';
        return `
            <article class="hm-group-card v0719 ${group.statusClass} ${group.manualMerge ? 'manual-merge-card' : ''} ${active ? 'active' : ''}" data-merge-group-id="${hmEscape(group.id)}">
                <div class="hm-card-topline">
                    <div class="hm-card-title-wrap">
                        <div class="hm-card-title">${hmEscape(displayTitle)}</div>
                        <div class="hm-card-line">${hmEscape(lineText)}</div>
                    </div>
                    <span class="hm-status-pill ${group.manualMerge ? 'manual' : group.statusClass}">${hmEscape(statusText)}</span>
                </div>
                <div class="hm-card-meta hm-card-meta-compact">
                    <span>${group.items.length}批</span>
                    <span>${group.quantity}件</span>
                    <span>${group.weight.toFixed(1)}kg</span>
                    <strong>${group.score ? group.score + '分' : '待补全'}</strong>
                </div>
                <div class="hm-card-footline">
                    <span>${hmEscape(curveStatus)}</span>
                    <span>${hmEscape(displayRisk)}</span>
                </div>
                <div class="hm-card-actions compact ${group.manualMerge ? 'manual-actions' : 'single-action'}">
                    ${(heatMergeState.strategy === 'cost' && !group.manualMerge && group.id !== 'G-INVALID') ? `
                        <button class="hm-mini-btn ghost" data-action="heat-merge-add-manual" data-merge-group-id="${hmEscape(group.id)}" type="button">${hmEscape(manualAddText)}</button>
                    ` : ''}
                    ${group.manualMerge ? `
                        <button class="hm-mini-btn ghost" data-action="heat-merge-remove-manual" data-merge-group-id="${hmEscape(group.id)}" type="button">移除</button>
                    ` : ''}
                    <button class="hm-mini-btn primary" data-action="heat-merge-recommend-tooling" data-merge-group-id="${hmEscape(group.id)}" type="button" ${canGenerate ? '' : 'disabled'}>推荐工装</button>
                </div>
            </article>
        `;
    }).join('');
}

// ==================== Heat Merge V0.7.5 Tooling Recommendation ====================
// V0.7.5：默认按当前策略生成单张推荐卡，可主动比较三种策略；保持规则估算与真实曲线库状态分离。
function getToolingLabel(toolingType) {
    return furnaceTooling?.[toolingType]?.label || {
        'standard-basket': '标准料框',
        'mesh-basket': '网篮',
        'material-tray': '料盘',
        'ring-tooling': '环形工装'
    }[toolingType] || '工装';
}

function getDefaultToolingRecommendationTemplates() {
    return [
        { id: 'tpl-standard-600', source: 'default', name: '标准料框 600×600×900', toolingType: 'standard-basket', basketType: 'grid', width: 600, height: 600, depth: 900, maxWeight: 500, maxLayers: 5, hasShelf: true, shelfThickness: 20 },
        { id: 'tpl-standard-900', source: 'default', name: '大号标准料框 900×900×1200', toolingType: 'standard-basket', basketType: 'grid', width: 900, height: 900, depth: 1200, maxWeight: 1000, maxLayers: 5, hasShelf: true, shelfThickness: 20 },
        { id: 'tpl-mesh-600', source: 'default', name: '密网篮 600×500×600', toolingType: 'mesh-basket', basketType: 'honeycomb', width: 600, height: 500, depth: 600, maxWeight: 300, maxLayers: 1, hasShelf: false, shelfThickness: 0 },
        { id: 'tpl-tray-800', source: 'default', name: '平面料盘 800×160×800', toolingType: 'material-tray', basketType: 'tray', width: 800, height: 160, depth: 800, maxWeight: 250, maxLayers: 1, hasShelf: false, shelfThickness: 0 },
        { id: 'tpl-ring-800', source: 'default', name: '环形工装 Ø800×900', toolingType: 'ring-tooling', basketType: 'ringnode', width: 800, height: 900, depth: 800, maxWeight: 700, maxLayers: 3, hasShelf: true, shelfThickness: 5 }
    ];
}

function getAvailableToolingTemplatesForRecommendation() {
    const cards = [...document.querySelectorAll('.furnace-card')];
    const fromCards = cards.map((card, idx) => {
        const d = getFurnaceDataFromCard(card);
        const cfg = furnaceTooling?.[d.toolingType] || furnaceTooling?.['standard-basket'] || {};
        const ex = d.extras || {};
        const hasShelf = typeof ex.hasShelf === 'boolean' ? ex.hasShelf : !!cfg.hasShelf;
        const shelfThickness = Number(ex.shelfThickness ?? cfg.params?.shelfThickness ?? (hasShelf ? 20 : 0)) || 0;
        const maxLayers = hasShelf || d.toolingType === 'ring-tooling'
            ? (Number(d.maxLayers) || Number(cfg.maxLayers) || 1)
            : 1;
        return {
            id: `card-${d.fid || idx}`,
            source: 'current',
            name: d.name || `${getToolingLabel(d.toolingType)}模板`,
            toolingType: d.toolingType || 'standard-basket',
            basketType: d.basketType || cfg.basketType || 'grid',
            width: Number(d.width) || 600,
            height: Number(d.height) || 600,
            depth: Number(d.depth) || 900,
            maxWeight: Number(d.maxWeight) || 500,
            maxLayers,
            hasShelf,
            shelfThickness,
            availableCount: Number(d.count) || 1
        };
    });

    const usable = fromCards.filter(t => t.width > 0 && t.height > 0 && t.depth > 0 && t.maxWeight > 0);
    // V0.7.5：推荐阶段同时参考“当前本次工装”和“系统样板工装”。
    // 原来只要页面已有 600 标准料框，就不会再考虑 900 大料框，容易出现“14 个小框单层”的误导结果。
    // 真实企业工装库接入后，可把这里替换为“当前可用库存 + 企业工装模板”。
    const merged = [...usable, ...getDefaultToolingRecommendationTemplates()];
    const seen = new Set();
    return merged.filter(t => {
        const sig = [t.toolingType, t.basketType, t.width, t.height, t.depth, t.maxWeight, t.maxLayers, t.hasShelf, t.shelfThickness].join('|');
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
    });
}

function isProcessCompatibleWithTooling(process, toolingType) {
    const allowed = furnaceTooling?.[toolingType]?.allowedProcesses || [];
    if (!allowed.length) return true;
    const p = normalizeHeatText(process);
    return allowed.some(rule => p.includes(rule) || String(rule).includes(p));
}

function getHeatMergeGroupStats(group) {
    const items = Array.isArray(group?.items) ? group.items : [];
    let maxFootprint = 0;
    let maxLong = 0;
    let maxWide = 0;
    let maxHeight = 0;
    let tallestRaw = 0;
    let totalVolume = 0;
    let totalFootprintArea = 0;
    let cylinderCount = 0;
    items.forEach(item => {
        const d1 = Number(item.dim1) || 80;
        const d2 = Number(item.dim2) || d1;
        const d3 = Number(item.dim3) || 30;
        const count = Math.max(1, Number(item.count) || 1);
        const dims = [d1, d2, d3].sort((a, b) => b - a);
        const flatLong = Math.max(1, dims[0]);
        const flatWide = Math.max(1, dims[1]);
        const flatHeight = Math.max(1, dims[2]);
        maxFootprint = Math.max(maxFootprint, flatLong, flatWide);
        maxLong = Math.max(maxLong, flatLong);
        maxWide = Math.max(maxWide, flatWide);
        maxHeight = Math.max(maxHeight, flatHeight);
        tallestRaw = Math.max(tallestRaw, d1, d2, d3);
        totalVolume += count * Math.max(1, d1) * Math.max(1, d2) * Math.max(1, d3);
        totalFootprintArea += count * flatLong * flatWide;
        if (item.shape === 'cylinder') cylinderCount += 1;
    });
    const quantity = Number(group?.quantity) || items.reduce((s, item) => s + (Number(item.count) || 0), 0);
    return {
        itemBatches: items.length,
        quantity,
        weight: Number(group?.weight) || items.reduce((s, item) => s + (Number(item.weight) || 0), 0),
        process: normalizeHeatText(items[0]?.process || group?.line || ''),
        maxFootprint,
        maxLong,
        maxWide,
        maxHeight,
        tallestRaw,
        totalVolume,
        totalFootprintArea,
        avgFootprintArea: quantity > 0 ? totalFootprintArea / Math.max(1, quantity) : 0,
        cylinderRate: items.length ? cylinderCount / items.length : 0
    };
}


function getTemplateShelfMeta(template) {
    const cfg = furnaceTooling?.[template.toolingType] || {};
    const hasShelf = typeof template.hasShelf === 'boolean' ? template.hasShelf : !!cfg.hasShelf;
    const shelfThickness = Number(template.shelfThickness ?? cfg.params?.shelfThickness ?? (hasShelf ? 20 : 0)) || 0;
    const maxLayers = hasShelf || template.toolingType === 'ring-tooling'
        ? Math.max(1, Number(template.maxLayers) || Number(cfg.maxLayers) || 1)
        : 1;
    return { hasShelf, shelfThickness, maxLayers };
}

function estimateLayerCapabilityForGroup(group, template, strategy = 'quality') {
    const stats = getHeatMergeGroupStats(group);
    const meta = getTemplateShelfMeta(template);
    const spacing = 8;
    const verticalGap = strategy === 'quality' ? 18 : (strategy === 'delivery' ? 10 : 8);
    const edgeGap = 20;
    const usableW = Math.max(1, Number(template.width || 0) - edgeGap * 2);
    const usableD = Math.max(1, Number(template.depth || 0) - edgeGap * 2);
    const usableH = Math.max(1, Number(template.height || 0) - edgeGap * 2);
    const largestFitsPlan = (
        Math.max(stats.maxLong || 0, stats.maxWide || 0) <= Math.max(usableW, usableD) &&
        Math.min(stats.maxLong || 0, stats.maxWide || 0) <= Math.min(usableW, usableD)
    );
    const largestFitsHeight = (stats.maxHeight || 0) + verticalGap <= usableH;

    let usableLayers = 1;
    let layerHeight = usableH;
    if (largestFitsHeight && meta.maxLayers > 1) {
        for (let layers = meta.maxLayers; layers >= 1; layers--) {
            const nextLayerHeight = (usableH - Math.max(0, layers - 1) * meta.shelfThickness) / layers;
            if (nextLayerHeight >= (stats.maxHeight || 0) + verticalGap) {
                usableLayers = layers;
                layerHeight = nextLayerHeight;
                break;
            }
        }
    }

    const areaFill = strategy === 'quality' ? 0.46 : (strategy === 'delivery' ? 0.58 : 0.66);
    const avgArea = Math.max(1, stats.avgFootprintArea || Math.max(1, (stats.maxLong || 80) * (stats.maxWide || 80)));
    const byArea = Math.max(1, Math.floor((usableW * usableD * areaFill) / avgArea));
    const gridW = Math.max(1, Math.floor((usableW + spacing) / Math.max(1, (stats.maxLong || 80) + spacing)));
    const gridD = Math.max(1, Math.floor((usableD + spacing) / Math.max(1, (stats.maxWide || 80) + spacing)));
    const byGrid = Math.max(1, gridW * gridD);
    // 混合尺寸下用面积容量为主，最大件网格为上限参考，避免单个超大件误判成很多件。
    const perLayerCapacity = Math.max(1, Math.min(byArea, Math.max(byGrid, 1) * 3));
    const perToolCapacity = perLayerCapacity * usableLayers;
    const countByLayer = stats.quantity > 0 ? Math.ceil(stats.quantity / Math.max(1, perToolCapacity)) : 1;
    const needsShelf = meta.hasShelf && usableLayers > 1;
    const heightRisk = !largestFitsHeight
        ? '最大工件高度超过工装可用高度'
        : (!largestFitsPlan ? '最大工件平面尺寸可能放不下' : (needsShelf ? '建议使用搁板分层' : '单层可放置'));

    return {
        hasShelf: meta.hasShelf,
        shelfThickness: meta.shelfThickness,
        maxLayers: meta.maxLayers,
        usableLayers,
        layerHeight,
        perLayerCapacity,
        perToolCapacity,
        countByLayer,
        needsShelf,
        fitsLargestPiece: largestFitsPlan && largestFitsHeight,
        largestFitsPlan,
        largestFitsHeight,
        heightRisk
    };
}

function scoreToolingTemplateForGroup(template, group, strategy) {
    const stats = getHeatMergeGroupStats(group);
    const layerPlan = estimateLayerCapabilityForGroup(group, template, strategy);
    const process = stats.process;
    const shortSide = Math.min(template.width, template.depth);
    const longSide = Math.max(template.width, template.depth);
    const fitsLargest = layerPlan.largestFitsPlan && stats.maxFootprint <= Math.max(shortSide, longSide);
    const processOk = isProcessCompatibleWithTooling(process, template.toolingType);
    const type = template.toolingType;
    let score = 50;

    if (fitsLargest) score += 16; else score -= 48;
    if (layerPlan.largestFitsHeight) score += 16; else score -= 64;
    if (layerPlan.needsShelf) score += 10;
    if (!layerPlan.hasShelf && stats.quantity > layerPlan.perLayerCapacity) score -= 10;
    if (processOk) score += 18; else score -= 24;
    if (template.maxWeight >= Math.max(80, stats.weight * 0.35)) score += 8;
    if (type === 'standard-basket') score += 8;
    if (/渗碳|碳氮/.test(process) && (type === 'standard-basket' || type === 'mesh-basket')) score += 10;
    if (/真空/.test(process) && type === 'standard-basket') score += 10;
    if (/氮化/.test(process) && type === 'material-tray') score += 18;
    if (stats.cylinderRate > 0.6 && stats.quantity > 30 && type === 'ring-tooling') score += 12;

    if (strategy === 'quality') {
        if (furnaceTooling?.[type]?.exposurePriority === 'high') score += 8;
        if (layerPlan.needsShelf) score += 8;
        if (layerPlan.usableLayers <= 4) score += 4;
        if (type === 'mesh-basket' && stats.quantity > 80) score -= 8;
    }
    if (strategy === 'cost') {
        score += Math.min(18, (template.maxWeight || 0) / 80);
        score += Math.min(12, (template.width * template.depth) / 90000);
        if (layerPlan.perToolCapacity > 1) score += Math.min(12, layerPlan.perToolCapacity / 8);
    }
    if (strategy === 'delivery') {
        score += Math.min(20, (template.maxWeight || 0) / 60);
        if (template.source === 'current') score += 4;
        if (layerPlan.countByLayer <= 2) score += 8;
    }

    return score;
}

function chooseToolingTemplateForGroup(group, strategy) {
    const templates = getAvailableToolingTemplatesForRecommendation();
    const scored = templates.map(template => ({
        ...template,
        _score: scoreToolingTemplateForGroup(template, group, strategy)
    })).sort((a, b) => b._score - a._score);

    const best = scored[0] || getDefaultToolingRecommendationTemplates()[0];
    return best;
}

function estimateToolingCountForGroup(group, template, strategy) {
    const stats = getHeatMergeGroupStats(group);
    const layerPlan = estimateLayerCapabilityForGroup(group, template, strategy);
    const targetWeightLoad = strategy === 'quality' ? 0.72 : (strategy === 'delivery' ? 0.86 : 0.94);
    const byWeight = template.maxWeight > 0
        ? Math.ceil(stats.weight / Math.max(1, template.maxWeight * targetWeightLoad))
        : 1;
    const byLayerCapacity = layerPlan.countByLayer || 1;

    // V0.7.5：推荐“几个框”时，优先使用少框多层/搁板能力。
    // 总体积只作为风险提示，不再作为强制增加工装数量的主约束，避免薄片/圆件被误判为需要十几个单层料框。
    let count = Math.max(1, byWeight, byLayerCapacity);

    // 质量优先不等于无限摊开；如果支持搁板且层高安全，允许先用少框多层，再由真实装炉算法验证。
    if (strategy === 'quality' && layerPlan.needsShelf && layerPlan.fitsLargestPiece) {
        count = Math.max(1, byWeight, Math.ceil((layerPlan.countByLayer || 1) * 0.9));
    }

    // 对不支持搁板的浅盘/网篮保守一些，避免只靠总体积忽略堆叠风险。
    if (!layerPlan.hasShelf && stats.quantity > layerPlan.perLayerCapacity) {
        count = Math.max(count, Math.ceil(stats.quantity / Math.max(1, layerPlan.perLayerCapacity)));
    }

    return Math.max(1, count);
}

function getHeatToolingRecommendationStrategies() {
    return [
        { id: 'quality', title: '质量优先', subtitle: '降低单框密度，减少遮挡', badge: '风险低', target: '更均匀', desc: '适合硬度一致性、渗层一致性要求较高的订单。' },
        { id: 'cost', title: '成本优先', subtitle: '提高装载率，减少炉次', badge: '效率高', target: '少炉次', desc: '适合普通订单，允许工艺员确认保温补偿。' },
        { id: 'delivery', title: '交付优先', subtitle: '优先把当前组尽快做完', badge: '快交付', target: '少等待', desc: '适合急单，优先使用更大承载工装。' }
    ];
}


function getPackingStrategyForHeatMergeStrategy(strategy) {
    if (strategy === 'cost') return 'spaceUtil';
    if (strategy === 'quality') return 'thermalBalance';
    if (strategy === 'delivery') return 'balanced';
    return placementRules.strategy || 'balanced';
}

function buildPackingItemsFromHeatMergeGroup(group) {
    return (group?.items || []).filter(item => getHeatMergeItemValidation(item).level !== 'invalid').map((item, index) => ({
        name: item.name || `工件${index + 1}`,
        shape: item.shape || 'cuboid',
        count: Number(item.count) || 1,
        dim1: Number(item.dim1) || 80,
        dim2: Number(item.dim2) || 80,
        dim3: Number(item.dim3) || 30,
        weight: Number(item.weight) || 0,
        color: item.color || '#2563eb',
        material: item.material || '',
        process: item.process || '',
        hardness: item.hardness || item.hardnessRaw || '',
        customer: item.customer || '',
        itemCode: item.itemCode || '',
        showName: item.name || '',
        orderDate: item.orderDate || '',
        deliveryDate: item.deliveryDate || '',
        remark: item.remark || ''
    }));
}

function summarizeTrialPackingResult(result) {
    const completed = result?.completedFurnaces || [];
    const unpacked = result?.unpackedItems || [];
    const packedItems = completed.flatMap(f => f.packedItems || []);
    const totalWeight = completed.reduce((sum, f) => sum + Number(f.totalWeight || 0), 0);
    const maxWeight = completed.reduce((sum, f) => sum + Number(f.max_weight || f.maxWeight || 0), 0);
    const totalVolume = completed.reduce((sum, f) => sum + Number((f.w || 0) * (f.h || 0) * (f.d || 0)), 0);
    const packedVolume = completed.reduce((sum, f) => sum + getPackedVolume(f), 0);
    const maxLayers = completed.reduce((max, f) => Math.max(max, getCurrentToolingLayerCount(f)), 0);
    return {
        completedFurnaceCount: completed.length,
        packedCount: packedItems.length,
        unpackedCount: unpacked.length,
        totalWeight,
        weightRate: maxWeight > 0 ? (totalWeight / maxWeight) * 100 : 0,
        spaceRate: totalVolume > 0 ? (packedVolume / totalVolume) * 100 : 0,
        maxLayers,
        allPacked: unpacked.length === 0 && packedItems.length > 0
    };
}

function simulateHeatToolingTrial(group, template, count, strategy) {
    const furnacePoolInput = [{
        name: template.name || getToolingLabel(template.toolingType),
        count: Math.max(1, Number(count) || 1),
        width: Number(template.width) || 600,
        height: Number(template.height) || 600,
        depth: Number(template.depth) || 900,
        maxWeight: Number(template.maxWeight) || 500,
        actualSpacing: 5,
        basketType: template.basketType || furnaceTooling?.[template.toolingType]?.basketType || 'grid',
        toolingType: template.toolingType || 'standard-basket',
        maxLayers: Number(template.maxLayers) || furnaceTooling?.[template.toolingType]?.maxLayers || 3,
        allowedProcesses: '',
        placementMode: 'free',
        params: {}
    }];
    const itemsInput = buildPackingItemsFromHeatMergeGroup(group);
    try {
        const result = executePacking(
            clonePlain(furnacePoolInput),
            clonePlain(itemsInput),
            5,
            getPackingStrategyForHeatMergeStrategy(strategy)
        );
        return { count, result, ...summarizeTrialPackingResult(result) };
    } catch (err) {
        console.warn('[heat tooling trial] packing failed:', err);
        return { count, result: null, allPacked: false, unpackedCount: itemsInput.length, packedCount: 0, totalWeight: 0, weightRate: 0, spaceRate: 0, maxLayers: 0, error: String(err?.message || err) };
    }
}

function findVerifiedHeatToolingTrial(group, template, strategy, estimatedCount) {
    const profile = getHeatMergeStrategyProfile(strategy);
    const minCount = 1;
    const maxCount = Math.min(16, Math.max(1, Number(estimatedCount) || 1) + 6);
    const trials = [];
    for (let count = minCount; count <= maxCount; count += 1) {
        const trial = simulateHeatToolingTrial(group, template, count, strategy);
        trials.push(trial);
        if (trial.allPacked) {
            if (strategy === 'cost') break;
            if (strategy === 'delivery') break;
            if (strategy === 'quality' && trial.weightRate <= profile.targetWeightLoad * 100 && trial.spaceRate <= profile.targetSpaceLoad * 100) break;
        }
    }
    const allPackedTrials = trials.filter(t => t.allPacked);
    if (!allPackedTrials.length) {
        return trials.sort((a, b) => (a.unpackedCount - b.unpackedCount) || (a.count - b.count))[0] || trials[0];
    }
    if (strategy === 'quality') {
        const target = allPackedTrials.find(t => t.weightRate <= profile.targetWeightLoad * 100 && t.spaceRate <= profile.targetSpaceLoad * 100);
        return target || allPackedTrials[0];
    }
    // 成本和交付优先都先保证“能装完”，再选最少框，避免推荐数量和真实生成结果矛盾。
    return allPackedTrials[0];
}

function buildHeatToolingRecommendations(group, options = {}) {
    if (!group || group.id === 'G-INVALID') return [];
    const allStrategies = getHeatToolingRecommendationStrategies();
    const currentStrategyId = heatMergeState.strategy || 'quality';
    const compareAll = options.compareAll === true || heatMergeState.compareToolingStrategies === true;
    const strategies = compareAll
        ? allStrategies
        : [allStrategies.find(s => s.id === currentStrategyId) || allStrategies[0]];
    const stats = getHeatMergeGroupStats(group);
    const recommendations = strategies.map(strategy => {
        const template = chooseToolingTemplateForGroup(group, strategy.id);
        const layerPlan = estimateLayerCapabilityForGroup(group, template, strategy.id);
        const estimatedCount = estimateToolingCountForGroup(group, template, strategy.id);
        const trial = findVerifiedHeatToolingTrial(group, template, strategy.id, estimatedCount);
        const count = Math.max(1, Number(trial?.count || estimatedCount || 1));
        const weightRate = Number(trial?.weightRate || 0);
        const spaceRate = Number(trial?.spaceRate || 0);
        const heightRisk = !layerPlan.fitsLargestPiece;
        const riskLevel = heightRisk || !trial?.allPacked ? 'warn' : (strategy.id === 'quality' ? 'ok' : (weightRate > 86 || spaceRate > 42 ? 'warn' : 'mid'));
        const reasons = [];
        if (isProcessCompatibleWithTooling(stats.process, template.toolingType)) reasons.push('工艺匹配当前工装类型');
        else reasons.push('工艺适配性需人工确认');
        reasons.push(`试装验证：${trial?.allPacked ? `${count} 个${getToolingLabel(template.toolingType)}可装完` : `${count} 个仍有 ${trial?.unpackedCount || 0} 件未装`}`);
        if (estimatedCount !== count) reasons.push(`已用装炉算法校正估算数量：${estimatedCount} → ${count}`);
        reasons.push(`最大工件平放高度 ${Math.round(stats.maxHeight || 0)}mm，建议层高 ${Math.round(layerPlan.layerHeight || 0)}mm`);
        if (layerPlan.needsShelf) reasons.push(`支持搁板分层：预计 ${layerPlan.usableLayers} 层，搁板厚 ${layerPlan.shelfThickness}mm`);
        else reasons.push(layerPlan.hasShelf ? '当前尺寸下建议单层/少层放置' : '该工装不依赖搁板，按单层容量估算');
        reasons.push(`策略目标：${strategy.id === 'quality' ? '低密度/低遮挡' : (strategy.id === 'cost' ? '少炉次/高装载率' : '先排炉/少等待')}`);
        if (heightRisk) reasons.push(layerPlan.heightRisk);
        if (weightRate > 86) reasons.push('接近承重上限，建议仿真后确认');
        if (spaceRate > 42) reasons.push('空间密度偏高，建议关注遮挡');
        if (template.source === 'current') reasons.push('来自当前已配置工装模板');
        else reasons.push('来自系统样板工装，后续可替换为企业工装库');

        return {
            id: `HTR-${group.id}-${strategy.id}`,
            groupId: group.id,
            strategy: strategy.id,
            title: `${strategy.title}方案`,
            subtitle: strategy.subtitle,
            badge: heightRisk ? '需校验' : strategy.badge,
            target: strategy.target,
            desc: strategy.desc,
            riskLevel,
            weightRate,
            spaceRate,
            count,
            template,
            layerPlan,
            trial,
            maxItemHeight: stats.maxHeight,
            toolings: [{
                name: `AI推荐-${getToolingLabel(template.toolingType)}`,
                toolingType: template.toolingType,
                basketType: template.basketType || furnaceTooling?.[template.toolingType]?.basketType || 'grid',
                width: template.width,
                height: template.height,
                depth: template.depth,
                maxWeight: template.maxWeight,
                count
            }],
            reasons,
            note: !trial?.allPacked
                ? '试装未完全装入，请增加工装或调整物料组。'
                : (heightRisk
                    ? '最大件高度或平面尺寸存在风险，生成方案后仍需校验未装件。'
                    : (riskLevel === 'ok'
                        ? '已通过装炉算法试装，可继续生成方案并做仿真确认。'
                        : '已通过试装验证，但建议生成后运行仿真并由工艺员确认。'))
        };
    });

    // V0.7.5：默认只保留当前策略的一张推荐卡；只有点击“比较三种策略”时才显示三张。
    heatMergeState.lastToolingRecommendations = recommendations;
    return recommendations;
}

function getHeatToolingPlanById(planId) {
    return (heatMergeState.lastToolingRecommendations || []).find(p => p.id === planId) || null;
}

function renderHeatToolingRecommendationsPanel(force = false) {
    const pane = document.getElementById('left-tab-merge');
    if (!pane) return;
    let panel = document.getElementById('heat-tooling-recommendations');
    if (!panel) {
        panel = document.createElement('section');
        panel.id = 'heat-tooling-recommendations';
        panel.className = 'heat-tooling-recommendations htr-compact-v0715';
        const groups = document.getElementById('heat-merge-groups');
        if (groups) groups.insertAdjacentElement('afterend', panel);
        else pane.appendChild(panel);
    }
    panel.classList.add('htr-compact-v0715');

    const groupId = heatMergeState.selectedGroupId || heatMergeState.appliedGroupId;
    const group = groupId ? (getHeatMergeGroupById(groupId) || getHeatMergeGroupPreset(groupId)) : null;
    if (!group || group.id === 'G-INVALID') {
        panel.innerHTML = `
            <div class="htr-empty htr-empty-compact">
                <strong>工装推荐</strong>
                <span>先选择一个工艺组，再点击「推荐工装」。</span>
            </div>
        `;
        heatMergeState.lastToolingRecommendations = [];
        return;
    }

    const recommendations = buildHeatToolingRecommendations(group, { compareAll: false });
    const activeStrategy = getHeatToolingRecommendationStrategies().find(s => s.id === (heatMergeState.strategy || 'quality')) || getHeatToolingRecommendationStrategies()[0];
    const adoptedId = heatMergeState.adoptedToolingPlan?.id || '';
    const isAdoptedGroup = !!(heatMergeState.adoptedToolingPlan && heatMergeState.adoptedToolingPlan.groupId === group.id);
    const groupLabel = group.manualMerge ? '人工拼炉组' : '规则工艺组';

    const cardsHtml = recommendations.map(plan => {
        const tpl = plan.template;
        const active = heatMergeState.selectedToolingPlanId === plan.id || adoptedId === plan.id;
        const trialText = plan.trial?.allPacked ? '试装通过' : `未装 ${plan.trial?.unpackedCount || 0} 件`;
        const shelfText = plan.layerPlan?.needsShelf
            ? `搁板 ${plan.layerPlan?.usableLayers || 1}层 / ${plan.layerPlan?.shelfThickness || 0}mm`
            : (plan.layerPlan?.hasShelf ? '少层放置' : '无搁板');
        const heightText = `${Math.round(plan.maxItemHeight || 0)}mm件 / ${Math.round(plan.layerPlan?.layerHeight || 0)}mm层`;
        const statePill = active ? '<span class="htr-adopted-pill">已采用</span>' : `<span class="htr-badge ${plan.riskLevel}">${hmEscape(plan.badge)}</span>`;
        return `
            <article class="htr-plan-card htr-card-compact ${plan.riskLevel} ${active ? 'active adopted' : ''}" data-tooling-plan-id="${hmEscape(plan.id)}">
                <div class="htr-card-head compact-head">
                    <div>
                        <div class="htr-title">${hmEscape(plan.title)}</div>
                        <div class="htr-subtitle">${hmEscape(plan.subtitle)}</div>
                    </div>
                    ${statePill}
                </div>
                <div class="htr-main-line htr-main-line-compact">
                    <strong>${hmEscape(getToolingLabel(tpl.toolingType))} × ${plan.count}</strong>
                    <span>${tpl.width}×${tpl.height}×${tpl.depth} · ${tpl.maxWeight}kg/框</span>
                </div>
                <div class="htr-quick-metrics">
                    <span>重量 <b>${plan.weightRate.toFixed(1)}%</b></span>
                    <span>空间 <b>${plan.spaceRate.toFixed(1)}%</b></span>
                    <span>层数 <b>${plan.layerPlan?.usableLayers || 1}</b></span>
                    <span>${hmEscape(heightText)}</span>
                </div>
                <div class="htr-chip-row">
                    <span>${hmEscape(trialText)}</span>
                    <span>${hmEscape(shelfText)}</span>
                    <span>${hmEscape(activeStrategy.title)}</span>
                </div>
                <div class="htr-actions htr-actions-compact">
                    ${active ? `
                        <button class="hm-mini-btn adopted" type="button" disabled>已采用</button>
                    ` : `
                        <button class="hm-mini-btn" type="button" data-action="heat-tooling-adopt" data-tooling-plan-id="${hmEscape(plan.id)}">采用</button>
                        <button class="hm-mini-btn primary" type="button" data-action="heat-tooling-adopt-generate" data-tooling-plan-id="${hmEscape(plan.id)}">采用并生成</button>
                    `}
                </div>
            </article>
        `;
    }).join('');

    panel.innerHTML = `
        <div class="htr-head htr-head-compact">
            <div>
                <div class="htr-kicker">工装推荐</div>
                <div class="htr-head-title">${hmEscape(groupLabel)} · ${hmEscape(group.line)}</div>
                <div class="htr-head-subtitle compact-only">${hmEscape(activeStrategy.title)} · ${group.manualMerge ? '人工拼炉需工艺确认' : '按当前策略试装推荐'}</div>
            </div>
        </div>
        <div class="htr-plan-grid single-strategy htr-plan-grid-compact">${cardsHtml}</div>
        ${isAdoptedGroup ? '<div class="htr-adopted-note">已采用当前工装方案，可直接点击底部「生成方案」。</div>' : ''}
    `;

    if (force) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function adoptHeatToolingRecommendation(planId, options = {}) {
    const plan = getHeatToolingPlanById(planId);
    if (!plan) {
        alert('未找到工装推荐方案，请重新推荐。');
        return;
    }

    const existingCount = document.querySelectorAll('.furnace-card').length;
    if (existingCount && !options.skipConfirm) {
        const ok = confirm('采用 AI 工装推荐会替换当前工装配置，是否继续？');
        if (!ok) return;
    }

    document.querySelectorAll('.furnace-card, .furnace-inline-detail').forEach(el => el.remove());
    setSelectedFurnaceCardId(null);
    setFurnaceCounter(0);

    plan.toolings.forEach(tool => {
        createFurnaceCard(
            tool.name,
            Number(tool.depth) || 900,
            Number(tool.width) || 600,
            Number(tool.height) || 600,
            Number(tool.maxWeight) || 500,
            Number(tool.count) || 1,
            0,
            5,
            tool.basketType || 'grid',
            tool.toolingType || 'standard-basket'
        );
    });

    heatMergeState.selectedToolingPlanId = plan.id;
    heatMergeState.adoptedToolingPlan = clonePlain(plan);
    if (plan.groupId) {
        heatMergeState.selectedGroupId = plan.groupId;
        applyHeatMergeGroupToMaterialCards(plan.groupId, { silent: true });
    }

    clearFurnaceResults();
    updateTopSummary();
    renderHeatMergeDesignPanel();
    renderCurrentToolingPlanCard();
    showCapacityFeedback('success', `已采用 ${plan.title}：${getToolingLabel(plan.template.toolingType)} × ${plan.count}，预计 ${plan.layerPlan?.usableLayers || 1} 层${plan.layerPlan?.needsShelf ? '（使用搁板）' : ''}`);

    if (options.generate) {
        setTimeout(() => showGenerationOptions(), 80);
    } else {
        document.querySelector('.left-tab-btn[data-tab="furnace"]')?.click();
    }
}

function renderToolingRecommendationBasisCard() {
    const panel = document.getElementById('plan-analysis-panel');
    if (!panel) return;
    const old = document.getElementById('tooling-recommendation-basis-card');
    if (old) old.remove();
    const plan = heatMergeState.adoptedToolingPlan;
    if (!plan || !globalFurnacesResult || globalFurnacesResult.length === 0) return;

    const group = plan.groupId ? (getHeatMergeGroupById(plan.groupId) || getHeatMergeGroupPreset(plan.groupId)) : null;
    const tool = plan.toolings?.[0] || {};
    const reasons = (plan.reasons || []).slice(0, 3).map(r => `<span>✓ ${hmEscape(r)}</span>`).join('');
    const shelfText = plan.layerPlan?.needsShelf ? `搁板 ${plan.layerPlan?.shelfThickness || 0}mm` : '无需搁板';
    const card = document.createElement('section');
    card.id = 'tooling-recommendation-basis-card';
    card.className = 'tooling-recommendation-basis-card analysis-compact-card';
    card.innerHTML = `
        <div class="compact-analysis-head">
            <div>
                <div class="compact-kicker">工装推荐 V0.7.9</div>
                <div class="compact-title">${hmEscape(plan.title)} · ${hmEscape(getToolingLabel(tool.toolingType))} × ${Number(tool.count) || plan.count || 1}</div>
            </div>
            <span class="compact-pill ${plan.riskLevel || 'mid'}">${hmEscape(plan.badge || '已采用')}</span>
        </div>
        <div class="compact-chip-row">
            <span>重量 ${Number(plan.weightRate || 0).toFixed(1)}%</span>
            <span>空间 ${Number(plan.spaceRate || 0).toFixed(1)}%</span>
            <span>${plan.layerPlan?.usableLayers || 1} 层</span>
            <span>${Math.round(plan.layerPlan?.layerHeight || 0)} / ${Math.round(plan.maxItemHeight || 0)}mm</span>
            <span>${hmEscape(shelfText)}</span>
        </div>
        <div class="compact-reasons">${reasons}</div>
    `;

    const anchor = document.getElementById('heat-process-risk-card');
    if (anchor?.parentNode === panel) anchor.insertAdjacentElement('afterend', card);
    else panel.insertAdjacentElement('afterbegin', card);
}


function renderCurrentToolingPlanCard() {
    const card = document.getElementById('furnace-current-tooling-card');
    if (!card) return;
    const plan = heatMergeState.adoptedToolingPlan;
    const furnaceCount = document.querySelectorAll('.furnace-card').length;

    if (!plan) {
        card.innerHTML = `
            <div class="fcp-empty">
                <strong>${furnaceCount ? '当前为手动工装组合' : '暂无本次工装组合'}</strong>
                <span>${furnaceCount ? `已配置 ${furnaceCount} 类工装。可继续手动调整，或回到「合炉设计」重新推荐。` : '请先在「合炉设计」中选择合炉组并点击「推荐工装」，也可以手动添加工装。'}</span>
            </div>
        `;
        return;
    }

    const group = plan.groupId ? (getHeatMergeGroupById(plan.groupId) || getHeatMergeGroupPreset(plan.groupId)) : null;
    const tool = plan.toolings?.[0] || {};
    const reasons = (plan.reasons || []).slice(0, 3).map(r => `<span>✓ ${hmEscape(r)}</span>`).join('');
    card.innerHTML = `
        <div class="fcp-head">
            <div>
                <div class="fcp-kicker">本次工装组合 · 来源：AI 推荐</div>
                <div class="fcp-title">${hmEscape(plan.title)} · ${hmEscape(getToolingLabel(tool.toolingType))} × ${Number(tool.count) || plan.count || 1}</div>
                <div class="fcp-subtitle">${hmEscape(group?.title || '未绑定合炉组')} · ${hmEscape(group?.line || '')}</div>
            </div>
            <span class="fcp-pill ${plan.riskLevel || 'mid'}">${hmEscape(plan.badge || '已采用')}</span>
        </div>
        <div class="fcp-metrics fcp-metrics-v072">
            <div><span>重量利用</span><strong>${Number(plan.weightRate || 0).toFixed(1)}%</strong></div>
            <div><span>空间估算</span><strong>${Number(plan.spaceRate || 0).toFixed(1)}%</strong></div>
            <div><span>预计层数</span><strong>${plan.layerPlan?.usableLayers || 1} 层</strong></div>
            <div><span>搁板</span><strong>${plan.layerPlan?.needsShelf ? ('需要 · ' + (plan.layerPlan?.shelfThickness || 0) + 'mm') : '不需要'}</strong></div>
            <div><span>工装尺寸</span><strong>${tool.width || '-'}×${tool.height || '-'}×${tool.depth || '-'}</strong></div>
        </div>
        <div class="fcp-reasons">${reasons}</div>
        <div class="fcp-actions">
            <button class="hm-mini-btn" type="button" id="btn-furnace-recommend-again-inline">重新推荐</button>
        </div>
    `;
}

function clearCurrentToolingUse(confirmFirst = true) {
    const count = document.querySelectorAll('.furnace-card').length;
    if (!count) return;
    if (confirmFirst && !confirm('清空本次使用的工装组合？不会删除工件详情里的生产任务数据。')) return;
    document.querySelectorAll('.furnace-card, .furnace-inline-detail').forEach(el => el.remove());
    setSelectedFurnaceCardId(null);
    setFurnaceCounter(0);
    heatMergeState.selectedToolingPlanId = null;
    heatMergeState.adoptedToolingPlan = null;
    heatMergeState.compareToolingStrategies = false;
    clearFurnaceResults();
    updateTopSummary();
    renderCurrentToolingPlanCard();
    showCapacityFeedback('success', '已清空本次工装使用，生产任务数据已保留');
}

function restoreDefaultToolingCombination(confirmFirst = true) {
    const count = document.querySelectorAll('.furnace-card').length;
    if (count && confirmFirst && !confirm('恢复样板工装会替换当前工装组合，是否继续？')) return;
    document.querySelectorAll('.furnace-card, .furnace-inline-detail').forEach(el => el.remove());
    setSelectedFurnaceCardId(null);
    setFurnaceCounter(0);
    createFurnaceCard('标准料框', 900, 600, 600, 500, 1, 0, 5, 'grid', 'standard-basket');
    heatMergeState.selectedToolingPlanId = null;
    heatMergeState.adoptedToolingPlan = null;
    heatMergeState.compareToolingStrategies = false;
    clearFurnaceResults();
    updateTopSummary();
    renderCurrentToolingPlanCard();
    showCapacityFeedback('success', '已恢复样板工装：标准料框 × 1');
}

function showMaterialTaskCheckSummary() {
    const items = getHeatMergeItemsFromCards();
    if (!items.length) {
        alert('暂无生产任务。请先导入 Excel。');
        return;
    }
    let valid = 0, review = 0, invalid = 0;
    const problems = [];
    items.forEach(item => {
        const st = getHeatMergeItemValidation(item);
        if (st.level === 'valid') valid += 1;
        else if (st.level === 'review') review += 1;
        else invalid += 1;
        if (st.level !== 'valid') problems.push(`${item.customer || item.itemCode || item.name || '工件'}：${st.text}`);
    });
    const detail = problems.length ? `

需处理示例：
${problems.slice(0, 8).join('\n')}${problems.length > 8 ? '\n...' : ''}` : '';
    alert(`生产任务数据校验

全部：${items.length} 条
有效：${valid} 条
待确认：${review} 条
异常：${invalid} 条

待确认/异常不会参与合炉计算或生成方案。${detail}`);
}

function renderMaterialTaskDataStatus() {
    const grid = document.getElementById('material-task-status-grid');
    const note = document.getElementById('material-task-status-note');
    const sourceText = document.getElementById('heat-merge-source-text');
    const items = getHeatMergeItemsFromCards();
    const total = items.length;
    const totalQty = items.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
    const totalWeight = items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
    const filterLabel = getHeatMergeActiveFilterLabel();
    let valid = 0, review = 0, invalid = 0;
    const problems = [];
    items.forEach(item => {
        const st = getHeatMergeItemValidation(item);
        if (st.level === 'valid') valid += 1;
        else if (st.level === 'review') review += 1;
        else invalid += 1;
        if (st.level !== 'valid' && problems.length < 3) {
            problems.push(`${item.customer || item.itemCode || item.name || '工件'}：${st.text}`);
        }
    });
    if (grid) {
        const cells = grid.querySelectorAll('strong');
        const vals = [total, valid, review, invalid];
        cells.forEach((cell, idx) => { cell.textContent = vals[idx] ?? 0; });
    }
    if (note) {
        if (!total) note.textContent = '暂无生产任务。请点击“导入 Excel”。';
        else if (problems.length) note.textContent = `已导入 ${total} 条。已排除：${problems.join('；')}`;
        else note.textContent = `已导入 ${total} 条生产任务，字段完整，可进入合炉设计自动分组。`;
    }
    if (total && heatMergeState.dataSource !== 'mock' && heatMergeState.dataSource !== 'excel') {
        heatMergeState.dataSource = 'materials';
    }
    if (sourceText) {
        const source = getHeatMergeDataSourceInfo();
        sourceText.textContent = total
            ? `${source.label}${filterLabel ? '（当前筛选）' : ''}：${total} 条 / ${totalQty} 件 / ${totalWeight.toFixed(1)}kg / ${valid} 有效 / ${review + invalid} 已排除 · ${source.curveLabel}`
            : (filterLabel ? `当前筛选无物料：${filterLabel}` : '暂无物料，请先在工件详情导入生产任务。');
    }
    applyHeatMergeValidationToMaterialCards();
    syncMaterialTaskUiV075();
}


function syncMaterialTaskUiV075() {
    const total = document.querySelectorAll('.material-card').length;
    const sampleBtn = document.getElementById('btn-material-load-sample-inline');
    const checkBtn = document.getElementById('btn-material-check-inline');
    document.body.classList.toggle('material-has-tasks', total > 0);

    // V0.7.17：导入后已经自动校验，并且异常已直接标在工件卡片上；
    // “数据校验”弹窗按钮不再作为主流程入口，避免重复解释与遮挡操作。
    if (checkBtn) {
        checkBtn.hidden = true;
        checkBtn.style.display = 'none';
        checkBtn.title = '已改为自动校验：异常会直接显示在工件卡片上。';
    }

    // V0.7.8：正式流程只保留 Excel 导入。示例入口不再默认展示，避免用户误认为这是生产入口。
    if (sampleBtn) {
        sampleBtn.hidden = true;
        sampleBtn.style.display = 'none';
        sampleBtn.title = '示例数据入口已隐藏；测试时可使用专门测试 Excel。';
    }

    const actions = document.querySelector('.mts-actions');
    if (actions && !document.getElementById('btn-material-filter-toggle')) {
        const toggle = document.createElement('button');
        toggle.className = 'hm-mini-btn ghost';
        toggle.id = 'btn-material-filter-toggle';
        toggle.type = 'button';
        toggle.textContent = '筛选物料';
        toggle.addEventListener('click', () => {
            if (document.querySelectorAll('.material-card').length === 0) return;
            const strip = document.querySelector('.material-filter-strip');
            if (!strip) return;
            const open = strip.classList.toggle('filter-open');
            document.body.classList.toggle('material-filter-open', open);
            toggle.textContent = open ? '收起筛选' : '筛选物料';
        });
        actions.appendChild(toggle);
    }

    const toggle = document.getElementById('btn-material-filter-toggle');
    if (toggle) {
        toggle.hidden = total === 0;
        toggle.style.display = total > 0 ? '' : 'none';
        if (total === 0) toggle.textContent = '筛选物料';
    }

    const strip = document.querySelector('.material-filter-strip');
    if (strip) {
        if (total === 0) {
            strip.classList.remove('filter-open');
            document.body.classList.remove('material-filter-open');
        } else if (!strip.classList.contains('filter-open')) {
            document.body.classList.remove('material-filter-open');
        }
    }
}


let heatMergeFilterSyncTimer = null;
function scheduleHeatMergeAfterMaterialFilterChange() {
    if (heatMergeFilterSyncTimer) clearTimeout(heatMergeFilterSyncTimer);
    heatMergeFilterSyncTimer = setTimeout(() => {
        heatMergeFilterSyncTimer = null;
        renderMaterialTaskDataStatus();
        if (getActiveLeftPanelTab && getActiveLeftPanelTab() === 'merge') {
            heatMergeState.selectedGroupId = null;
            heatMergeState.appliedGroupId = null;
            heatMergeState.selectedToolingPlanId = null;
            heatMergeState.adoptedToolingPlan = null;
            heatMergeState.lastToolingRecommendations = [];
            heatMergeState.manualMergeDraftGroupIds = [];
            if (heatMergeState.strategy !== 'cost') heatMergeState.manualMergeGroups = [];
            renderHeatMergeDesignPanel();
        }
    }, 0);
}

function renderHeatMergeDesignPanel() {
    renderMaterialTaskDataStatus();
    renderHeatMergeGroups();
    renderHeatToolingRecommendationsPanel();
    renderCurrentToolingPlanCard();
}

function loadHeatMergeMockData(force = false) {
    const existing = document.querySelectorAll('.material-card').length;
    if (existing > 0 && !force) {
        const ok = confirm('载入测试用例二会替换当前工件列表，是否继续？');
        if (!ok) return;
    }

    document.querySelectorAll('.material-card, .material-inline-detail').forEach(c => c.remove());
    setSelectedMaterialCardId(null);
    setMaterialCounter(0);
    clearUsedColors();
    clearMaterialFilters();
    clearProcessFilters();
    clearHardnessFilters();

    HEAT_MERGE_MOCK_ITEMS.forEach(item => {
        const dims = inferMockShape(item);
        const color = generateUniqueColor(usedColors);
        createMaterialCard(
            item.name,
            dims.shape,
            item.count,
            dims.dim1,
            dims.dim2,
            dims.dim3,
            item.weight,
            color,
            {
                material: item.material,
                process: item.process,
                hardness: item.hardness,
                customer: item.customer,
                itemCode: item.itemCode,
                orderDate: item.date ? item.date.replace(/\./g, '-') : '',
                remark: item.remark || '',
                showName: `${item.customer}-${item.name}`
            }
        );
    });

    heatMergeState.selectedGroupId = null;
    heatMergeState.appliedGroupId = null;
    heatMergeState.selectedToolingPlanId = null;
    heatMergeState.adoptedToolingPlan = null;
    heatMergeState.lastToolingRecommendations = [];
    heatMergeState.compareToolingStrategies = false;
    heatMergeState.dataSource = 'mock';
    renderFilterBars(clearFurnaceResults);
    applyHeatMergeGroupToMaterialCards(null, { silent: true });
    renderHeatMergeDesignPanel();
    updateTopSummary();
    updateWorkbenchUiMode();
    showCapacityFeedback('success', '已载入“测试用例二”示例物料。真实使用时请在工件详情导入生产任务 Excel');
}

function filterHeatMergeMaterialCards(groupId = null) {
    const cards = [...document.querySelectorAll('.material-card')];
    cards.forEach(card => {
        const d = getMaterialDataFromCard(card);
        const h = parseHardnessRange(d.hardness);
        const item = {
            material: normalizeMaterialName(d.material),
            process: normalizeHeatText(d.process),
            hardness: h ? h.label : '',
            hardnessRange: h
        };
        const cardGroupId = classifyHeatMergeItem(item);
        const visible = !groupId || cardGroupId === groupId;
        card.style.display = visible ? '' : 'none';
        card.toggleAttribute('data-heat-merge-hidden', !visible);
    });
    document.querySelector('.left-tab-btn[data-tab="material"]')?.click();
    document.body.classList.add('material-filter-open');
    document.querySelector('.material-filter-strip')?.classList.add('filter-open');
    const toggle = document.getElementById('btn-material-filter-toggle');
    if (toggle) toggle.textContent = '收起筛选';
    const msg = groupId === 'G-INVALID' ? '已跳到工件详情并筛选异常物料，请补全字段后重新分组' : '已跳到工件详情并显示全部物料';
    showCapacityFeedback('success', msg);
}

function getHeatMergeCardMatchKeyFromData(d) {
    return [
        String(d.itemCode || '').trim(),
        String(d.customer || '').trim(),
        String(d.showName || d.name || '').trim(),
        String(d.material || '').trim(),
        String(d.process || '').trim(),
        String(d.hardness || '').trim(),
        String(d.count || '').trim(),
        String(d.totalWeight || '').trim()
    ].join('|');
}

function getHeatMergeItemMatchKey(item) {
    return [
        String(item.itemCode || '').trim(),
        String(item.customer || '').trim(),
        String(item.showName || item.name || '').trim(),
        String(item.materialRaw || item.material || '').trim(),
        String(item.process || '').trim(),
        String(item.hardnessRaw || item.hardness || '').trim(),
        String(item.count || '').trim(),
        String(item.weight || item.totalWeight || item.totalWeightKg || '').trim()
    ].join('|');
}

function applyHeatMergeGroupToMaterialCards(groupId, options = {}) {
    const cards = [...document.querySelectorAll('.material-card')];
    const group = groupId ? getHeatMergeGroupById(groupId) : null;
    const groupKeys = new Set((group?.items || []).map(getHeatMergeItemMatchKey));

    cards.forEach(card => {
        let visible = !groupId;
        const d = getMaterialDataFromCard(card);

        if (groupId && groupKeys.size > 0) {
            visible = groupKeys.has(getHeatMergeCardMatchKeyFromData(d));
        } else if (groupId) {
            // 兜底：仅在找不到 group.items 时退回旧规则。
            const h = parseHardnessRange(d.hardness);
            const item = {
                material: normalizeMaterialName(d.material),
                process: normalizeHeatText(d.process),
                hardness: h ? h.label : '',
                hardnessRange: h,
                customer: d.customer || '',
                deliveryDate: d.deliveryDate || '',
                caseDepth: extractCaseDepth(d.hardness)
            };
            const cardGroupId = classifyHeatMergeItem(item, heatMergeState.strategy || 'quality');
            visible = cardGroupId === groupId;
        }

        card.style.display = visible ? '' : 'none';
        card.toggleAttribute('data-heat-merge-hidden', !visible);
    });

    const previousAppliedToolingGroupId = heatMergeState.adoptedToolingPlan?.groupId || null;
    heatMergeState.appliedGroupId = groupId || null;
    if (previousAppliedToolingGroupId && previousAppliedToolingGroupId !== heatMergeState.appliedGroupId) {
        heatMergeState.selectedToolingPlanId = null;
        heatMergeState.adoptedToolingPlan = null;
    }
    if (!options.silent) {
        clearFurnaceResults();
        renderHeatMergeDesignPanel();
        const appliedGroup = groupId ? (getHeatMergeGroupById(groupId) || getHeatMergeGroupPreset(groupId)) : null;
        showCapacityFeedback('success', appliedGroup ? `已锁定 ${appliedGroup.title}：生成方案将只使用该合炉组物料` : '已恢复全部物料参与装炉方案');
    }
}

function showHeatCurveModal(groupId) {
    const group = getHeatMergeGroupById(groupId) || getHeatMergeGroupPreset(groupId);
    const curve = getHeatMergeCurveForGroup(group);
    const existing = document.getElementById('heat-curve-modal-overlay');
    if (existing) existing.remove();

    const stageRows = curve.stages.map(stage => `
        <div class="hcm-stage-row">
            <span>${hmEscape(stage[0])}</span>
            <strong>${hmEscape(stage[1])}</strong>
            <em>${hmEscape(stage[2])}</em>
        </div>
    `).join('');

    const overlay = document.createElement('div');
    overlay.id = 'heat-curve-modal-overlay';
    overlay.className = 'heat-curve-modal-overlay';
    overlay.innerHTML = `
        <div class="heat-curve-modal">
            <div class="hcm-head">
                <div>
                    <div class="hcm-kicker">工艺曲线状态</div>
                    <div class="hcm-title">${hmEscape(curve.title)}</div>
                </div>
                <button class="hcm-close" type="button" aria-label="关闭">×</button>
            </div>
            <div class="hcm-scope">${hmEscape(curve.scope)}</div>
            <div class="hcm-grid">
                <div><span>历史炉次状态</span><strong>${curve.historyCount || '-'}</strong></div>
                <div><span>最近使用</span><strong>${hmEscape(curve.recentUse)}</strong></div>
                <div><span>适用设备</span><strong>${hmEscape(curve.equipment)}</strong></div>
                <div><span>典型重量</span><strong>${hmEscape(curve.typicalWeight)}</strong></div>
                <div><span>典型保温</span><strong>${hmEscape(curve.hold)}</strong></div>
            </div>
            <div class="hcm-curve-box">
                <div class="hcm-axis-label">温度 / 时间</div>
                <div class="hcm-line-art">
                    <span class="hcm-temp t930">930/1040℃</span>
                    <span class="hcm-temp t850">850℃</span>
                    <span class="hcm-temp t180">180℃</span>
                    <svg viewBox="0 0 420 160" preserveAspectRatio="none" aria-hidden="true">
                        <polyline points="20,135 95,112 150,52 260,52 300,82 340,82 362,135 400,128" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
                    </svg>
                </div>
            </div>
            <div class="hcm-stage-list">${stageRows}</div>
            <div class="hcm-suggestion">${hmEscape(curve.suggestion)}</div>
            <div class="hcm-actions">
                <button class="hm-mini-btn" data-action="heat-curve-close" type="button">关闭</button>
                <button class="hm-mini-btn primary" data-action="heat-curve-adopt" data-merge-group-id="${hmEscape(group.id)}" type="button">采用并锁定</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => {
        if (event.target === overlay || event.target.closest('.hcm-close') || event.target.closest('[data-action="heat-curve-close"]')) {
            overlay.remove();
            return;
        }
        const adopt = event.target.closest('[data-action="heat-curve-adopt"]');
        if (adopt) {
            const gid = adopt.getAttribute('data-merge-group-id');
            heatMergeState.selectedGroupId = gid;
            applyHeatMergeGroupToMaterialCards(gid);
            overlay.remove();
        }
    });
}

function renderHeatProcessRiskCard() {
    const panel = document.getElementById('plan-analysis-panel');
    if (!panel) return;
    const old = document.getElementById('heat-process-risk-card');
    if (old) old.remove();

    const groupId = heatMergeState.appliedGroupId;
    if (!groupId) return;

    const group = getHeatMergeGroupById(groupId) || getHeatMergeGroupPreset(groupId);
    const curve = getHeatMergeCurveForGroup(group);
    const source = getHeatMergeDataSourceInfo();
    const displayTitle = source.key === 'mock' ? group.title : '规则工艺组';
    const displayRisk = getHeatMergeGroupDisplayRisk(group);
    const card = document.createElement('section');
    card.id = 'heat-process-risk-card';
    card.className = 'heat-process-risk-card analysis-compact-card';
    const sourceLabel = source.key === 'mock' ? '示例曲线' : '待接入曲线库';
    card.innerHTML = `
        <div class="compact-analysis-head">
            <div>
                <div class="compact-kicker">工艺匹配 V0.7.9</div>
                <div class="compact-title">${hmEscape(displayTitle)} · ${hmEscape(group.line)}</div>
            </div>
            <span class="compact-pill ${group.statusClass}">${hmEscape(group.status)}</span>
        </div>
        <div class="compact-chip-row">
            <span>${hmEscape(sourceLabel)}</span>
            <span>本组 ${group.weight ? group.weight.toFixed(1) + 'kg' : '-'}</span>
            <span>${hmEscape(curve.title)}</span>
        </div>
        <div class="compact-note">${hmEscape(displayRisk)}</div>
    `;
    panel.insertAdjacentElement('afterbegin', card);
}


function capturePlanCompareV05Baseline(label = '', strategy = '') {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        planCompareV05Baseline = null;
        window._planCompareV05Baseline = null;
        return;
    }

    planCompareV05Baseline = {
        createdAt: new Date().toISOString(),
        label: label || currentWorkspaceIdentity?.strategyLabel || 'AI 原始方案',
        strategy: strategy || currentWorkspaceIdentity?.strategyKey || placementRules.strategy || '',
        furnaces: clonePlain(globalFurnacesResult || []),
        unpackedItems: clonePlain(globalUnpackedItems || []),
        heatGroupId: heatMergeState.appliedGroupId || null
    };
    window._planCompareV05Baseline = planCompareV05Baseline;
}

function ensurePlanCompareV05Baseline() {
    if (planCompareV05Baseline?.furnaces?.length) return planCompareV05Baseline;
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return null;
    capturePlanCompareV05Baseline(currentWorkspaceIdentity?.strategyLabel || 'AI 原始方案', currentWorkspaceIdentity?.strategyKey || '');
    return planCompareV05Baseline;
}

function parsePlanComparePercent(text) {
    const n = parseFloat(String(text || '').replace('%', ''));
    return Number.isFinite(n) ? n : 0;
}

function parsePlanCompareWeightRange(text) {
    const nums = String(text || '').match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
    if (nums.length >= 2) return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
    if (nums.length === 1) return { min: nums[0], max: nums[0] };
    return null;
}

function getPlanCompareTotals(furnaces = [], unpackedItems = [], role = 'current') {
    const safeFurnaces = Array.isArray(furnaces) ? furnaces : [];
    const packedItems = safeFurnaces.flatMap(f => Array.isArray(f?.packedItems) ? f.packedItems : []);
    const totalWeight = safeFurnaces.reduce((sum, f) => sum + Number(f?.totalWeight || 0), 0);
    const maxWeight = safeFurnaces.reduce((sum, f) => sum + Number(f?.max_weight || f?.maxWeight || 0), 0);
    const packedVolume = safeFurnaces.reduce((sum, f) => sum + getPackedVolume(f), 0);
    const totalVolume = safeFurnaces.reduce((sum, f) => sum + getFurnaceVolume(f), 0);
    const maxLayers = safeFurnaces.reduce((max, f) => Math.max(max, getCurrentToolingLayerCount(f)), 0);
    const editedCount = packedItems.filter(item => item?.manualMoved || item?.finalEdited || item?.locked || item?.lastEditedAt).length;
    const avgSpace = totalVolume > 0 ? (packedVolume / totalVolume) * 100 : NaN;
    const weightRate = maxWeight > 0 ? (totalWeight / maxWeight) * 100 : NaN;
    const unpackedCount = Array.isArray(unpackedItems) ? unpackedItems.length : Number(unpackedItems || 0) || 0;

    return {
        role,
        furnaceCount: safeFurnaces.length,
        itemCount: packedItems.length,
        totalWeight,
        maxWeight,
        weightRate,
        avgSpace,
        maxLayers,
        editedCount,
        unpackedCount,
        packedItems
    };
}

function getActivePlanCompareHeatContext() {
    const groupId = heatMergeState.appliedGroupId || planCompareV05Baseline?.heatGroupId || null;
    const group = groupId ? (getHeatMergeGroupById(groupId) || getHeatMergeGroupPreset(groupId)) : null;
    const curve = group ? getHeatMergeCurveForGroup(group) : null;
    return { groupId, group, curve };
}

function getPlanCompareRisk(summary, context, role) {
    const issues = [];
    const space = Number(summary.avgSpace);
    const weightRate = Number(summary.weightRate);
    const totalWeight = Number(summary.totalWeight);
    const range = parsePlanCompareWeightRange(context?.curve?.typicalWeight);

    if (summary.unpackedCount > 0) issues.push(`仍有 ${summary.unpackedCount} 件未装`);
    if (Number.isFinite(space) && space >= 42) issues.push('装载密度偏高');
    if (Number.isFinite(weightRate) && weightRate >= 90) issues.push('接近承重上限');
    if (range?.max && totalWeight > range.max * 1.12) issues.push('高于历史典型重量');
    if (role === 'current' && summary.editedCount > 0) issues.push(`人工调整 ${summary.editedCount} 件`);

    if (!issues.length) {
        return { level: 'ok', label: '风险低', text: '当前摘要指标稳定，可进入仿真或打印确认。' };
    }

    const severe = issues.some(v => /未装|承重|高于历史/.test(v));
    return {
        level: severe ? 'warn' : 'mid',
        label: severe ? '需确认' : '可优化',
        text: issues.join('；')
    };
}

function formatPlanCompareMetricNumber(value, digits = 1) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-';
}

function formatPlanComparePercent(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '-';
}

function buildPlanCompareColumnHtml(title, subtitle, summary, risk, roleClass) {
    return `
        <div class="pcv05-col ${roleClass}">
            <div class="pcv05-col-head">
                <div>
                    <div class="pcv05-col-title">${hmEscape(title)}</div>
                    <div class="pcv05-col-subtitle">${hmEscape(subtitle)}</div>
                </div>
                <span class="pcv05-risk ${risk.level}">${hmEscape(risk.label)}</span>
            </div>
            <div class="pcv05-metrics">
                <div><span>工装</span><strong>${summary.furnaceCount || 0}</strong></div>
                <div><span>已装</span><strong>${summary.itemCount || 0}</strong></div>
                <div><span>重量</span><strong>${formatPlanCompareMetricNumber(summary.totalWeight)}kg</strong></div>
                <div><span>空间</span><strong>${formatPlanComparePercent(summary.avgSpace)}</strong></div>
                <div><span>层数</span><strong>${summary.maxLayers || '-'}</strong></div>
                <div><span>未装</span><strong>${summary.unpackedCount || 0}</strong></div>
            </div>
            <div class="pcv05-note">${hmEscape(risk.text)}</div>
        </div>
    `;
}

function buildHistoricalPlanCompareColumn(context) {
    const group = context?.group;
    const curve = context?.curve;
    if (!group || !curve) {
        return `
            <div class="pcv05-col history empty">
                <div class="pcv05-col-head">
                    <div>
                        <div class="pcv05-col-title">历史相似方案</div>
                        <div class="pcv05-col-subtitle">暂无合炉组 / 曲线</div>
                    </div>
                    <span class="pcv05-risk muted">待匹配</span>
                </div>
                <div class="pcv05-note">先在“合炉设计”中锁定一个工艺组，再生成方案，可显示历史曲线和典型重量。</div>
            </div>
        `;
    }

    const range = parsePlanCompareWeightRange(curve.typicalWeight);
    const typicalMid = range ? (range.min + range.max) / 2 : NaN;
    const mockSummary = {
        furnaceCount: '-',
        itemCount: group.quantity || group.items?.reduce((s, it) => s + Number(it.count || 0), 0) || '-',
        totalWeight: typicalMid,
        avgSpace: NaN,
        maxLayers: '-',
        unpackedCount: 0
    };
    const risk = {
        level: group.statusClass === 'danger' ? 'danger' : (group.statusClass === 'warn' ? 'warn' : 'ok'),
        label: group.status || '历史参考',
        text: `${curve.historyCount || 0} 个相似炉次 · 典型重量 ${curve.typicalWeight || '-'} · 典型保温 ${curve.hold || '-'}。${curve.suggestion || ''}`
    };

    return buildPlanCompareColumnHtml('历史相似方案', curve.title || group.title, mockSummary, risk, 'history');
}

function updatePlanCompareV05Delta(card, baseSummary, currentSummary, context) {
    const deltaEl = card.querySelector('.pcv05-delta-row');
    if (!deltaEl) return;

    const itemDelta = currentSummary.itemCount - baseSummary.itemCount;
    const weightDelta = currentSummary.totalWeight - baseSummary.totalWeight;
    const spaceDelta = Number(currentSummary.avgSpace) - Number(baseSummary.avgSpace);
    const editDelta = currentSummary.editedCount || 0;
    const range = parsePlanCompareWeightRange(context?.curve?.typicalWeight);
    const historyText = range?.max && currentSummary.totalWeight > range.max
        ? `本次重量高于历史上限 ${formatPlanCompareMetricNumber(currentSummary.totalWeight - range.max)}kg`
        : '本次重量未明显超出历史典型范围';

    deltaEl.innerHTML = `
        <span>对比摘要</span>
        <b>${itemDelta === 0 ? '已装件数持平' : `已装 ${itemDelta > 0 ? '+' : ''}${itemDelta} 件`}</b>
        <b>重量 ${Math.abs(weightDelta) < 0.05 ? '持平' : `${weightDelta > 0 ? '+' : ''}${weightDelta.toFixed(1)}kg`}</b>
        <b>空间 ${Number.isFinite(spaceDelta) ? (Math.abs(spaceDelta) < 0.05 ? '持平' : `${spaceDelta > 0 ? '+' : ''}${spaceDelta.toFixed(1)}%`) : '-'}</b>
        <b>人工调整 ${editDelta} 件</b>
        <b>${historyText}</b>
    `;
}

function renderPlanCompareV05Card() {
    // V0.7.5：方案对比 V0.5 暂时隐藏。
    // 原因：当前对比仍是摘要级规则展示，设计和使用链路尚未成熟；
    // 先避免在方案分析页占用过多空间，后续做成熟后再恢复。
    const old = document.getElementById('plan-compare-v05-card');
    if (old) old.remove();
}



function initHeatMergeDesign() {
    const loadBtn = document.getElementById('btn-load-merge-mock');
    if (loadBtn) loadBtn.addEventListener('click', () => loadHeatMergeMockData(false));
    const loadSampleInlineBtn = document.getElementById('btn-material-load-sample-inline');
    if (loadSampleInlineBtn) loadSampleInlineBtn.addEventListener('click', () => loadHeatMergeMockData(false));

    const refreshBtn = document.getElementById('btn-refresh-merge-groups');
    if (refreshBtn) refreshBtn.addEventListener('click', () => renderHeatMergeDesignPanel());

    const syncBtn = document.getElementById('btn-sync-merge-from-materials');
    if (syncBtn) syncBtn.addEventListener('click', () => {
        heatMergeState.dataSource = 'materials';
        heatMergeState.compareToolingStrategies = false;
        heatMergeState.selectedToolingPlanId = null;
        heatMergeState.lastToolingRecommendations = [];
        renderHeatMergeDesignPanel();
        const firstGroup = document.querySelector('#heat-merge-groups .hm-group-card');
        if (firstGroup) {
            firstGroup.classList.add('hm-regroup-flash');
            firstGroup.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            setTimeout(() => firstGroup.classList.remove('hm-regroup-flash'), 900);
        }
        const oldText = syncBtn.textContent;
        syncBtn.textContent = '已重新分组';
        syncBtn.disabled = true;
        setTimeout(() => {
            syncBtn.textContent = oldText || '重新分组';
            syncBtn.disabled = false;
        }, 900);
        const filterLabel = getHeatMergeActiveFilterLabel();
        showCapacityFeedback('success', filterLabel ? `已按当前筛选重新分组：${filterLabel}` : '已根据全部工件详情重新分组');
    });

    const inlineImportBtn = document.getElementById('btn-material-import-inline');
    if (inlineImportBtn) inlineImportBtn.addEventListener('click', () => {
        heatMergeState.dataSource = 'excel';
        document.getElementById('excel-file-input')?.click();
    });
    const excelInputForMerge = document.getElementById('excel-file-input');
    if (excelInputForMerge && excelInputForMerge.dataset.heatMergeSourceBound !== '1') {
        excelInputForMerge.dataset.heatMergeSourceBound = '1';
        excelInputForMerge.addEventListener('change', () => {
            heatMergeState.dataSource = 'excel';
            heatMergeState.selectedGroupId = null;
            heatMergeState.appliedGroupId = null;
            heatMergeState.compareToolingStrategies = false;
            heatMergeState.manualMergeGroups = [];
            heatMergeState.manualMergeDraftGroupIds = [];
        });
    }
    const inlineClearBtn = document.getElementById('btn-material-clear-inline');
    if (inlineClearBtn) inlineClearBtn.addEventListener('click', () => clearAllMaterials());
    const inlineCheckBtn = document.getElementById('btn-material-check-inline');
    if (inlineCheckBtn) inlineCheckBtn.addEventListener('click', showMaterialTaskCheckSummary);

    // V0.7.8：材质/工艺/硬度筛选改变后，同步刷新合炉设计的数据来源和分组结果。
    if (document.body.dataset.heatMergeFilterSyncBound !== '1') {
        document.body.dataset.heatMergeFilterSyncBound = '1';
        document.addEventListener('click', (event) => {
            if (event.target.closest('.material-filter-strip .filter-tag')) {
                scheduleHeatMergeAfterMaterialFilterChange();
            }
        }, true);
    }

    const showAllBtn = document.getElementById('btn-show-all-merge-materials');
    if (showAllBtn) showAllBtn.addEventListener('click', () => filterHeatMergeMaterialCards(null));
    const showInvalidBtn = document.getElementById('btn-show-invalid-merge-materials');
    if (showInvalidBtn) showInvalidBtn.addEventListener('click', () => filterHeatMergeMaterialCards('G-INVALID'));

    const analysisPanel = document.getElementById('plan-analysis-panel');
    if (analysisPanel && analysisPanel.dataset.planCompareV05Bound !== '1') {
        analysisPanel.dataset.planCompareV05Bound = '1';
        analysisPanel.addEventListener('click', event => {
            const btn = event.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            if (action === 'pcv05-refresh') {
                renderPlanCompareV05Card();
                return;
            }
            if (action === 'pcv05-run-sim') {
                activateRightPanelTab('thermal');
                renderThermalSimulationPanel(null, 'idle');
            }
        });
    }

    document.querySelectorAll('.hm-strategy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.hm-strategy-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            heatMergeState.strategy = btn.getAttribute('data-merge-strategy') || 'quality';
            heatMergeState.compareToolingStrategies = false;
            heatMergeState.selectedGroupId = null;
            heatMergeState.appliedGroupId = null;
            heatMergeState.selectedToolingPlanId = null;
            heatMergeState.adoptedToolingPlan = null;
            heatMergeState.lastToolingRecommendations = [];
            renderHeatMergeDesignPanel();
            const profile = getHeatMergeStrategyProfile(heatMergeState.strategy);
            showCapacityFeedback('success', `已切换为${profile.label}：${profile.groupMode}`);
        });
    });

    const groups = document.getElementById('heat-merge-groups');
    if (groups) {
        groups.addEventListener('click', event => {
            const card = event.target.closest('.hm-group-card');
            const btn = event.target.closest('[data-action]');
            const action = btn?.getAttribute('data-action') || '';

            if (action === 'heat-manual-create-group') {
                createHeatManualMergeGroupFromDraft();
                return;
            }
            if (action === 'heat-manual-clear-draft') {
                clearHeatManualMergeDraft();
                return;
            }

            const groupId = btn?.getAttribute('data-merge-group-id') || card?.getAttribute('data-merge-group-id');
            if (!groupId) return;

            if (action === 'heat-merge-add-manual') {
                toggleHeatManualMergeDraftGroup(groupId);
                return;
            }
            if (action === 'heat-merge-remove-manual') {
                removeHeatManualMergeGroup(groupId);
                return;
            }

            heatMergeState.selectedGroupId = groupId;

            if (!btn) {
                renderHeatMergeDesignPanel();
                return;
            }

            if (action === 'heat-merge-view-curve') {
                renderHeatMergeDesignPanel();
                showHeatCurveModal(groupId);
                return;
            }

            if (action === 'heat-merge-apply-group') {
                applyHeatMergeGroupToMaterialCards(groupId);
                return;
            }

            if (action === 'heat-merge-recommend-tooling') {
                heatMergeState.compareToolingStrategies = false;
                renderHeatMergeDesignPanel();
                renderHeatToolingRecommendationsPanel(true);
                return;
            }

            if (action === 'heat-merge-generate-group') {
                applyHeatMergeGroupToMaterialCards(groupId, { silent: true });
                renderHeatMergeDesignPanel();
                showGenerationOptions();
            }
        });
    }



    const mergePane = document.getElementById('left-tab-merge');
    if (mergePane && mergePane.dataset.toolingRecommendationBound !== '1') {
        mergePane.dataset.toolingRecommendationBound = '1';
        mergePane.addEventListener('click', event => {
            const btn = event.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            if (action === 'heat-tooling-refresh') {
                renderHeatToolingRecommendationsPanel(true);
                return;
            }
            if (action === 'heat-tooling-compare-toggle') {
                heatMergeState.compareToolingStrategies = !heatMergeState.compareToolingStrategies;
                renderHeatToolingRecommendationsPanel(true);
                return;
            }
            if (action === 'heat-tooling-adopt' || action === 'heat-tooling-adopt-generate') {
                const planId = btn.getAttribute('data-tooling-plan-id');
                adoptHeatToolingRecommendation(planId, { generate: action === 'heat-tooling-adopt-generate' });
            }
        });
    }

    const furnaceAddInline = document.getElementById('btn-furnace-add-inline');
    if (furnaceAddInline) furnaceAddInline.addEventListener('click', () => toolingModal.openToolingAddModal());
    const furnaceClearInline = document.getElementById('btn-furnace-clear-use-inline');
    if (furnaceClearInline) furnaceClearInline.addEventListener('click', () => clearCurrentToolingUse(true));
    const furnaceRestoreInline = document.getElementById('btn-furnace-restore-default-inline');
    if (furnaceRestoreInline) furnaceRestoreInline.addEventListener('click', () => restoreDefaultToolingCombination(true));
    const furnacePlanCard = document.getElementById('furnace-current-tooling-card');
    if (furnacePlanCard && furnacePlanCard.dataset.v071Bound !== '1') {
        furnacePlanCard.dataset.v071Bound = '1';
        furnacePlanCard.addEventListener('click', event => {
            const btn = event.target.closest('button');
            if (!btn) return;
            if (btn.id === 'btn-furnace-recommend-again-inline') {
                document.querySelector('.left-tab-btn[data-tab="merge"]')?.click();
                setTimeout(() => renderHeatToolingRecommendationsPanel(true), 40);
            }
            if (btn.id === 'btn-furnace-generate-inline') {
                showGenerationOptions();
            }
        });
    }

    const materialContainer = document.getElementById('material-cards-container');
    if (materialContainer && window.MutationObserver) {
        const observer = new MutationObserver(() => {
            renderMaterialTaskDataStatus();
            if (getActiveLeftPanelTab() === 'merge') renderHeatMergeDesignPanel();
        });
        observer.observe(materialContainer, { childList: true });
    }

    renderHeatMergeDesignPanel();
    renderPlanCompareV05Card();
}



// ==================== V0.8.0.1 SAFE FIX: Feishu task sync frontend ====================
// 说明：上一版误基于旧 app/css 打包，导致界面样式回退。本段只在最新 app.js 上追加飞书同步能力。
const FEISHU_SYNC_DEFAULT_CLIENT_ID = 'client_suoli';

function getFeishuApiBase() {
    const override = (window.FEISHU_API_BASE || localStorage.getItem('feishuApiBase') || '').trim();
    if (override) return override.replace(/\/$/, '');

    // 如果前端由 node server.js 提供，则走同源；如果用 VS Code Live Server 5500，则默认请求本地 3000 后端。
    const port = window.location && window.location.port;
    if (port === '3000') return '';
    return 'http://localhost:3000';
}

function getFeishuClientId() {
    return (localStorage.getItem('feishuClientId') || window.FEISHU_CLIENT_ID || FEISHU_SYNC_DEFAULT_CLIENT_ID).trim();
}

function getFeishuUiText(zh, en) {
    return localStorage.getItem('heat_furnace_ui_language_v0731') === 'en' ? en : zh;
}

function normalizeFeishuTaskToImportRow(task) {
    const shape = task.shape === 'cylinder' || task.shape === '圆柱体' || task.shape === '圆柱' ? 'cylinder' : 'cuboid';
    const count = Math.max(1, Number(task.count || task.quantity || 0) || 1);
    const totalWeight = Number(task.totalWeight ?? task.weight ?? 0) || 0;

    let dim1 = Number(task.dim1 ?? task.length ?? task.diameter ?? task.width ?? 0) || 0;
    let dim2 = Number(task.dim2 ?? task.width ?? task.diameter ?? dim1 ?? 0) || 0;
    let dim3 = Number(task.dim3 ?? task.height ?? 0) || 0;

    if (shape === 'cylinder') {
        const diameter = Number(task.diameter ?? task.dim1 ?? task.dim2 ?? 0) || dim1 || dim2;
        dim1 = diameter;
        dim2 = diameter;
        dim3 = Number(task.height ?? task.dim3 ?? 0) || dim3;
    }

    const showName = task.showName || task.productName || task.name || task.taskId || '飞书任务';
    const customer = task.customer || task.customerName || '';
    const itemCode = task.itemCode || task.materialCode || task.taskId || '';
    const name = task.name || (customer ? `${showName}_${customer}` : showName);

    const valid = count > 0 && totalWeight > 0 && dim1 > 0 && dim3 > 0 && (shape === 'cylinder' || dim2 > 0);

    return {
        source: 'feishu',
        sourceRecordId: task.recordId || task.sourceRecordId || '',
        recordId: task.recordId || task.sourceRecordId || '',
        taskId: task.taskId || '',
        sourceStatus: task.status || '',
        status: task.status || '',
        sourceClientId: task.sourceClientId || '',
        name,
        showName,
        customer,
        itemCode,
        shape,
        dim1,
        dim2,
        dim3,
        count,
        weight: totalWeight,
        totalWeight,
        unitWeight: Number(task.unitWeight || (count ? totalWeight / count : 0)) || 0,
        material: task.material || '',
        process: task.process || '',
        hardness: task.hardness || '',
        orderDate: task.orderDate || '',
        deliveryDate: task.deliveryDate || '',
        remark: task.remark || '',
        valid,
        rawTask: task
    };
}

function ensureFeishuSyncButton() {
    if (document.getElementById('btn-import-feishu')) return;

    const materialPane = document.getElementById('left-tab-material');
    if (!materialPane) return;

    const inlineImportBtn = document.getElementById('btn-material-import-inline');
    const headerImportBtn = document.getElementById('btn-import-excel');

    const makeFeishuButton = () => {
        const btn = document.createElement('button');
        btn.className = inlineImportBtn ? 'hm-mini-btn feishu-sync-btn' : 'hm-mini-btn feishu-sync-btn primary';
        btn.id = 'btn-import-feishu';
        btn.type = 'button';
        btn.title = getFeishuUiText('从飞书多维表格同步待排产任务', 'Sync pending tasks from Feishu Bitable');
        btn.textContent = getFeishuUiText('飞书同步', 'Feishu Sync');
        return btn;
    };

    // 优先插入到工件页已有的内联导入按钮旁边。
    if (inlineImportBtn && inlineImportBtn.parentElement) {
        inlineImportBtn.insertAdjacentElement('afterend', makeFeishuButton());
        return;
    }

    // 如果当前版本没有内联工具条，则在“工件详情”说明下创建一个轻量工具条，避免使用已经被新版 CSS 隐藏的旧 header 按钮。
    let row = document.getElementById('material-feishu-sync-row');
    if (!row) {
        row = document.createElement('div');
        row.id = 'material-feishu-sync-row';
        row.className = 'material-feishu-sync-row';

        const intro = materialPane.querySelector('.left-tab-intro');
        if (intro) intro.insertAdjacentElement('afterend', row);
        else materialPane.insertAdjacentElement('afterbegin', row);
    }

    if (!document.getElementById('btn-material-import-inline-feishu-safe')) {
        const importBtn = document.createElement('button');
        importBtn.className = 'hm-mini-btn';
        importBtn.id = 'btn-material-import-inline-feishu-safe';
        importBtn.type = 'button';
        importBtn.textContent = getFeishuUiText('导入 Excel', 'Import Excel');
        importBtn.title = getFeishuUiText('从 Excel 导入工件', 'Import workpieces from Excel');
        importBtn.addEventListener('click', () => {
            heatMergeState.dataSource = 'excel';
            document.getElementById('excel-file-input')?.click();
        });
        row.appendChild(importBtn);
    }

    row.appendChild(makeFeishuButton());

    if (headerImportBtn) {
        headerImportBtn.style.display = 'none';
    }
}

function resetHeatMergeStateAfterFeishuSync() {
    heatMergeState.dataSource = 'feishu';
    heatMergeState.selectedGroupId = null;
    heatMergeState.appliedGroupId = null;
    heatMergeState.compareToolingStrategies = false;
    heatMergeState.manualMergeGroups = [];
    heatMergeState.manualMergeDraftGroupIds = [];
    heatMergeState.selectedToolingPlanId = null;
    heatMergeState.lastToolingRecommendations = [];
}

async function syncFeishuTasksToPreview() {
    const btn = document.getElementById('btn-import-feishu');
    const oldText = btn ? btn.textContent : '';
    const apiBase = getFeishuApiBase();
    const clientId = getFeishuClientId();

    try {
        if (btn) {
            btn.disabled = true;
            btn.classList.add('is-loading');
            btn.textContent = getFeishuUiText('同步中...', 'Syncing...');
        }

        const resp = await fetch(`${apiBase}/api/feishu/tasks`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'x-client-id': clientId
            }
        });

        let payload = null;
        try {
            payload = await resp.json();
        } catch (jsonErr) {
            throw new Error(getFeishuUiText('后端没有返回有效 JSON，请确认 node server.js 正在运行。', 'Backend did not return valid JSON. Please confirm node server.js is running.'));
        }

        if (!resp.ok || payload.ok === false || payload.error) {
            throw new Error(payload.error || payload.message || `HTTP ${resp.status}`);
        }

        const tasks = Array.isArray(payload.tasks) ? payload.tasks : (Array.isArray(payload) ? payload : []);
        const rows = tasks
            .filter(task => task && Object.keys(task).length > 0)
            .map(normalizeFeishuTaskToImportRow);
        rows.forEach(row => {
            if (!row.sourceClientId) row.sourceClientId = payload.clientId || clientId || getFeishuClientId();
            row.sourceStatus = row.sourceStatus || row.status || '';
        });

        if (!rows.length) {
            showCapacityFeedback('error', getFeishuUiText('飞书生产任务表暂无可同步任务，请确认状态为“待排产”且字段已填写。', 'No Feishu tasks can be synced. Please check status and required fields.'));
            return;
        }

        resetHeatMergeStateAfterFeishuSync();
        const validCount = rows.filter(row => row.valid).length;
        showImportPreview(rows);
        const skippedText = payload.emptyRecords || payload.skippedByStatus
            ? getFeishuUiText(`（已跳过空记录 ${payload.emptyRecords || 0} 条、非待排产 ${payload.skippedByStatus || 0} 条）`, ` (skipped empty ${payload.emptyRecords || 0}, non-pending ${payload.skippedByStatus || 0})`)
            : '';
        showCapacityFeedback('success', getFeishuUiText(
            `已从飞书读取 ${rows.length} 条待排产任务，其中 ${validCount} 条可导入。${skippedText} 请在预览弹窗中选择“替换导入”或“追加导入”。`,
            `Loaded ${rows.length} pending tasks from Feishu. ${validCount} can be imported.${skippedText} Choose Replace or Append in the preview dialog.`
        ));
    } catch (err) {
        console.error('[Feishu Sync] failed:', err);
        showCapacityFeedback('error', getFeishuUiText(`飞书同步失败：${err.message}`, `Feishu sync failed: ${err.message}`));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('is-loading');
            btn.textContent = oldText || getFeishuUiText('飞书同步', 'Feishu Sync');
        }
    }
}

function bindFeishuSyncButton() {
    ensureFeishuSyncButton();
    const btn = document.getElementById('btn-import-feishu');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', syncFeishuTasksToPreview);
}


// ==================== V0.8.2: Feishu equipment/tooling resource sync ====================
let lastFeishuFurnaceResources = [];
let lastFeishuToolingResources = [];

function normalizeFeishuResourceText(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text || fallback;
}

function toPositiveNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeFeishuToolingForCard(item) {
    const toolingType = item.toolingType || 'standard-basket';
    const basketType = item.basketType || {
        'standard-basket': 'grid',
        'mesh-basket': 'honeycomb',
        'material-tray': 'tray',
        'ring-tooling': 'ringnode'
    }[toolingType] || 'grid';

    return {
        recordId: item.recordId || item.record_id || '',
        name: normalizeFeishuResourceText(item.name, item.toolingNo || '飞书工装'),
        toolingNo: normalizeFeishuResourceText(item.toolingNo, ''),
        workshop: normalizeFeishuResourceText(item.workshop, ''),
        status: normalizeFeishuResourceText(item.status, ''),
        supportedProcesses: normalizeFeishuResourceText(item.supportedProcesses, ''),
        toolingType,
        basketType,
        width: toPositiveNumber(item.width, 900),
        height: toPositiveNumber(item.height, toolingType === 'material-tray' ? 160 : 600),
        depth: toPositiveNumber(item.depth, toolingType === 'ring-tooling' ? toPositiveNumber(item.width, 800) : 900),
        maxWeight: toPositiveNumber(item.maxWeight, 500),
        count: Math.max(1, Math.round(toPositiveNumber(item.count || item.availableCount, 1))),
        maxLayers: Math.max(1, Math.round(toPositiveNumber(item.maxLayers, item.hasShelf ? 5 : 1))),
        shelfThickness: toPositiveNumber(item.shelfThickness, item.hasShelf ? 20 : 0),
        hasShelf: !!item.hasShelf,
        remark: normalizeFeishuResourceText(item.remark, '')
    };
}

function ensureFeishuResourceSyncControls() {
    const furnacePane = document.getElementById('left-tab-furnace');
    if (furnacePane && !document.getElementById('feishu-tooling-sync-row')) {
        const intro = furnacePane.querySelector('.left-tab-intro');
        const row = document.createElement('div');
        row.id = 'feishu-tooling-sync-row';
        row.className = 'feishu-resource-sync-row';
        row.innerHTML = `
            <button class="hm-mini-btn primary feishu-resource-btn" id="btn-sync-feishu-tooling" type="button">${getFeishuUiText('同步飞书工装', 'Sync Feishu Tooling')}</button>
            <span class="feishu-resource-hint" id="feishu-tooling-sync-status">${getFeishuUiText('从工装表读取可用工装，替换当前装载工装。', 'Load available tooling from Feishu and replace local tooling.')}</span>
        `;
        (intro || furnacePane.firstElementChild)?.insertAdjacentElement('afterend', row);
    }

    const workshopPane = document.getElementById('left-tab-tooling');
    if (workshopPane && !document.getElementById('feishu-furnace-sync-row')) {
        const intro = workshopPane.querySelector('.left-tab-intro');
        const row = document.createElement('div');
        row.id = 'feishu-furnace-sync-row';
        row.className = 'feishu-resource-sync-row';
        row.innerHTML = `
            <button class="hm-mini-btn primary feishu-resource-btn" id="btn-sync-feishu-furnaces" type="button">${getFeishuUiText('同步飞书设备', 'Sync Feishu Equipment')}</button>
            <span class="feishu-resource-hint" id="feishu-furnace-sync-status">${getFeishuUiText('从设备炉膛表读取车间与设备资源。', 'Load workshop and equipment resources from Feishu.')}</span>
        `;
        (intro || workshopPane.firstElementChild)?.insertAdjacentElement('afterend', row);
    }
}

function renderFeishuFurnaceResourcePanel(resources = []) {
    const workshopPane = document.getElementById('left-tab-tooling');
    if (!workshopPane) return;
    let panel = document.getElementById('feishu-furnace-resource-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'feishu-furnace-resource-panel';
        panel.className = 'feishu-resource-panel';
        const placeholder = workshopPane.querySelector('.workshop-placeholder');
        if (placeholder) placeholder.insertAdjacentElement('afterend', panel);
        else workshopPane.appendChild(panel);
    }

    if (!resources.length) {
        panel.innerHTML = `
            <div class="feishu-resource-empty">${getFeishuUiText('暂无可用设备记录。请确认设备炉膛表已填写且状态不是停用。', 'No available equipment records. Check the equipment table and status.')}</div>
        `;
        return;
    }

    const workshopMap = new Map();
    resources.forEach(item => {
        const key = item.workshop || getFeishuUiText('未分配车间', 'Unassigned Workshop');
        if (!workshopMap.has(key)) workshopMap.set(key, []);
        workshopMap.get(key).push(item);
    });

    panel.innerHTML = `
        <div class="feishu-resource-panel-title">${getFeishuUiText('飞书设备资源', 'Feishu Equipment Resources')}</div>
        ${Array.from(workshopMap.entries()).map(([workshop, list]) => `
            <section class="feishu-workshop-group">
                <div class="feishu-workshop-title">${hmEscape(workshop)} · ${list.length}${getFeishuUiText(' 台设备', ' device(s)')}</div>
                <div class="feishu-resource-card-list">
                    ${list.map(item => `
                        <article class="feishu-resource-card">
                            <div class="frc-head">
                                <strong>${hmEscape(item.name || item.deviceNo || '设备')}</strong>
                                <span>${hmEscape(item.status || getFeishuUiText('可用', 'Available'))}</span>
                            </div>
                            <div class="frc-meta">${hmEscape(item.deviceType || getFeishuUiText('设备', 'Equipment'))} · ${Number(item.width)||0}×${Number(item.height)||0}×${Number(item.depth)||0}mm · ${Number(item.maxWeight)||0}kg</div>
                            <div class="frc-foot">${hmEscape(item.supportedProcesses || item.remark || getFeishuUiText('未填写支持工艺', 'No process specified'))}</div>
                        </article>
                    `).join('')}
                </div>
            </section>
        `).join('')}
    `;
}

function applyFeishuToolingResourcesToCards(resources = [], options = {}) {
    const normalized = resources.map(normalizeFeishuToolingForCard).filter(item => item.width && item.height && item.depth);
    if (!normalized.length) {
        showCapacityFeedback('warning', getFeishuUiText('飞书工装表没有可导入的可用工装。', 'No available tooling can be imported from Feishu.'));
        return 0;
    }

    const existingCount = document.querySelectorAll('.furnace-card').length;
    if (existingCount && !options.force) {
        const ok = confirm(getFeishuUiText(
            `同步飞书工装会替换当前 ${existingCount} 个装载工装，是否继续？`,
            `Syncing Feishu tooling will replace ${existingCount} current tooling card(s). Continue?`
        ));
        if (!ok) return 0;
    }

    document.querySelectorAll('.furnace-card, .furnace-inline-detail').forEach(el => el.remove());
    setSelectedFurnaceCardId(null);
    setFurnaceCounter(0);

    normalized.forEach(item => {
        const result = createFurnaceCard(
            item.name,
            item.depth,
            item.width,
            item.height,
            item.maxWeight,
            item.count,
            0,
            5,
            item.basketType,
            item.toolingType
        );
        const card = document.getElementById(result.cardId);
        if (!card) return;
        card.classList.add('feishu-source-card');
        card.setAttribute('data-source', 'feishu');
        card.setAttribute('data-source-record-id', item.recordId || '');
        card.setAttribute('data-tooling-no', item.toolingNo || '');
        card.setAttribute('data-workshop', item.workshop || '');
        card.setAttribute('data-status', item.status || '');
        card.setAttribute('data-max-layers', String(item.maxLayers || 1));
        card.setAttribute('data-allowed-processes', item.supportedProcesses || '');
        const extras = {
            source: 'feishu',
            recordId: item.recordId,
            toolingNo: item.toolingNo,
            workshop: item.workshop,
            status: item.status,
            supportedProcesses: item.supportedProcesses,
            hasShelf: item.hasShelf,
            maxLayers: item.maxLayers,
            shelfThickness: item.shelfThickness,
            remark: item.remark
        };
        if (item.toolingType === 'material-tray') {
            extras.trayCornerPosts = { enabled: true, diameter: 16, offset: 22, safetyGap: 8 };
        }
        card.setAttribute('data-extras', JSON.stringify(extras));
        const statusEl = card.querySelector('.f-card-status');
        if (statusEl) {
            const badge = document.createElement('span');
            badge.className = 'feishu-source-badge';
            badge.textContent = item.workshop ? `飞书 · ${item.workshop}` : '飞书';
            statusEl.appendChild(document.createTextNode(' · '));
            statusEl.appendChild(badge);
        }
    });

    updateTopSummary();
    updateWorkbenchUiMode();
    renderCurrentToolingPlanCard();
    if (typeof renderHeatMergeDesignPanel === 'function') renderHeatMergeDesignPanel();
    return normalized.length;
}

async function fetchFeishuJson(endpoint, clientId) {
    const apiBase = getFeishuApiBase();
    const resp = await fetch(`${apiBase}${endpoint}`, {
        headers: {
            'Accept': 'application/json',
            'x-client-id': clientId || getFeishuClientId()
        }
    });
    const payload = await resp.json().catch(() => null);
    if (!resp.ok || !payload || payload.ok === false || payload.error) {
        throw new Error(payload?.error || payload?.detail?.msg || payload?.detail || `HTTP ${resp.status}`);
    }
    return payload;
}

async function syncFeishuFurnaceResources() {
    const btn = document.getElementById('btn-sync-feishu-furnaces');
    const status = document.getElementById('feishu-furnace-sync-status');
    const oldText = btn?.textContent || '';
    try {
        if (btn) { btn.disabled = true; btn.textContent = getFeishuUiText('同步中...', 'Syncing...'); }
        if (status) status.textContent = getFeishuUiText('正在读取飞书设备炉膛表...', 'Reading Feishu equipment table...');
        const payload = await fetchFeishuJson('/api/feishu/furnaces', getFeishuClientId());
        lastFeishuFurnaceResources = Array.isArray(payload.furnaces) ? payload.furnaces : [];
        renderFeishuFurnaceResourcePanel(lastFeishuFurnaceResources);
        const skippedText = payload.emptyRecords || payload.skippedInactive
            ? getFeishuUiText(`（跳过空记录 ${payload.emptyRecords || 0}，停用 ${payload.skippedInactive || 0}）`, ` (skipped empty ${payload.emptyRecords || 0}, inactive ${payload.skippedInactive || 0})`)
            : '';
        if (status) status.textContent = getFeishuUiText(`已同步 ${lastFeishuFurnaceResources.length} 台设备${skippedText}`, `Synced ${lastFeishuFurnaceResources.length} equipment records${skippedText}`);
        showCapacityFeedback('success', getFeishuUiText(`已从飞书同步 ${lastFeishuFurnaceResources.length} 台设备。`, `Synced ${lastFeishuFurnaceResources.length} equipment records from Feishu.`));
    } catch (err) {
        console.error('[Feishu Furnace Sync] failed:', err);
        if (status) status.textContent = getFeishuUiText('飞书设备同步失败', 'Feishu equipment sync failed');
        showCapacityFeedback('error', getFeishuUiText(`飞书设备同步失败：${err.message}`, `Feishu equipment sync failed: ${err.message}`));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText || getFeishuUiText('同步飞书设备', 'Sync Feishu Equipment'); }
    }
}

async function syncFeishuToolingResources() {
    const btn = document.getElementById('btn-sync-feishu-tooling');
    const status = document.getElementById('feishu-tooling-sync-status');
    const oldText = btn?.textContent || '';
    try {
        if (btn) { btn.disabled = true; btn.textContent = getFeishuUiText('同步中...', 'Syncing...'); }
        if (status) status.textContent = getFeishuUiText('正在读取飞书工装表...', 'Reading Feishu tooling table...');
        const payload = await fetchFeishuJson('/api/feishu/tooling', getFeishuClientId());
        lastFeishuToolingResources = Array.isArray(payload.tooling) ? payload.tooling : [];
        const count = applyFeishuToolingResourcesToCards(lastFeishuToolingResources);
        const skippedText = payload.emptyRecords || payload.skippedInactive
            ? getFeishuUiText(`（跳过空记录 ${payload.emptyRecords || 0}，停用 ${payload.skippedInactive || 0}）`, ` (skipped empty ${payload.emptyRecords || 0}, inactive ${payload.skippedInactive || 0})`)
            : '';
        if (status) status.textContent = getFeishuUiText(`已同步 ${count} 个可用工装${skippedText}`, `Synced ${count} available tooling records${skippedText}`);
        showCapacityFeedback('success', getFeishuUiText(`已从飞书同步 ${count} 个工装，可继续合炉设计或生成方案。`, `Synced ${count} tooling records from Feishu. You can continue planning.`));
    } catch (err) {
        console.error('[Feishu Tooling Sync] failed:', err);
        if (status) status.textContent = getFeishuUiText('飞书工装同步失败', 'Feishu tooling sync failed');
        showCapacityFeedback('error', getFeishuUiText(`飞书工装同步失败：${err.message}`, `Feishu tooling sync failed: ${err.message}`));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText || getFeishuUiText('同步飞书工装', 'Sync Feishu Tooling'); }
    }
}

function bindFeishuResourceSyncButtons() {
    ensureFeishuResourceSyncControls();
    const fBtn = document.getElementById('btn-sync-feishu-furnaces');
    if (fBtn && fBtn.dataset.bound !== '1') {
        fBtn.dataset.bound = '1';
        fBtn.addEventListener('click', syncFeishuFurnaceResources);
    }
    const tBtn = document.getElementById('btn-sync-feishu-tooling');
    if (tBtn && tBtn.dataset.bound !== '1') {
        tBtn.dataset.bound = '1';
        tBtn.addEventListener('click', syncFeishuToolingResources);
    }
}



// ==================== V0.8.1.1: Feishu writeback stability helpers ====================
const FEISHU_WRITEBACK_REGISTRY_KEY = 'heat_furnace_feishu_writeback_registry_v0811';
let feishuPlanWritebackInFlight = false;

function fnv1aHash(text) {
    let hash = 0x811c9dc5;
    const str = String(text || '');
    for (let i = 0; i < str.length; i += 1) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function readFeishuWritebackRegistry() {
    try {
        const raw = localStorage.getItem(FEISHU_WRITEBACK_REGISTRY_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.warn('[Feishu Plan Writeback] read registry failed:', err);
        return {};
    }
}

function writeFeishuWritebackRegistry(registry) {
    try {
        const entries = Object.entries(registry || {}).slice(-200);
        localStorage.setItem(FEISHU_WRITEBACK_REGISTRY_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (err) {
        console.warn('[Feishu Plan Writeback] write registry failed:', err);
    }
}

function buildFeishuWritebackKey(payload) {
    if (!payload) return '';
    const base = {
        sourceRecordIds: [...(payload.sourceRecordIds || [])].map(String).sort(),
        taskIds: [...(payload.taskIds || [])].map(String).sort(),
        furnaceCount: Number(payload.furnaceCount || 0),
        totalWeightKg: Number(payload.totalWeightKg || 0).toFixed(2),
        weightUtilization: Number(payload.weightUtilization || 0).toFixed(4),
        spaceUtilization: Number(payload.spaceUtilization || 0).toFixed(2),
        toolingNames: [...(payload.toolingNames || [])].map(String).sort(),
        strategy: String(payload.strategy || '')
    };
    return `fw_${fnv1aHash(JSON.stringify(base))}`;
}

function hasFeishuWritebackRecord(writebackKey) {
    if (!writebackKey) return null;
    const registry = readFeishuWritebackRegistry();
    return registry[writebackKey] || null;
}

function rememberFeishuWritebackRecord(writebackKey, result, payload) {
    if (!writebackKey) return;
    const registry = readFeishuWritebackRegistry();
    registry[writebackKey] = {
        at: new Date().toISOString(),
        planName: payload?.planName || '',
        planRecordId: result?.createdPlan?.record_id || result?.createdPlan?.id || result?.existingPlan?.record_id || '',
        updatedTaskCount: result?.updatedTaskCount || 0,
        duplicateSkipped: !!result?.duplicateSkipped
    };
    writeFeishuWritebackRegistry(registry);
}

// ==================== V0.8.1: Feishu plan writeback ====================
function collectFeishuSourceInfoFromCurrentPlan() {
    const recordIds = new Set();
    const taskIds = new Set();
    const customers = new Set();
    const processes = new Set();
    const materials = new Set();

    const takeItem = (item) => {
        if (!item) return;
        const source = String(item.source || item.dataSource || '').toLowerCase();
        const recordId = item.sourceRecordId || item.recordId || item.feishuRecordId || '';
        const taskId = item.taskId || item.taskNo || item.orderNo || '';
        const isFeishuItem = source === 'feishu' || !!recordId;
        if (!isFeishuItem) return;
        if (recordId) recordIds.add(String(recordId));
        if (taskId) taskIds.add(String(taskId));
        if (item.customer) customers.add(String(item.customer));
        if (item.process) processes.add(String(item.process));
        if (item.material) materials.add(String(item.material));
    };

    (globalFurnacesResult || []).forEach(furnace => {
        (furnace?.packedItems || []).forEach(takeItem);
    });
    (globalUnpackedItems || []).forEach(takeItem);

    // 兜底：如果算法结果中没有保留 source 字段，则从当前工件卡片读取绑定关系。
    if (recordIds.size === 0) {
        document.querySelectorAll('.material-card').forEach(card => {
            try {
                takeItem(getMaterialDataFromCard(card));
            } catch (err) {
                // ignore legacy cards
            }
        });
    }

    return {
        sourceRecordIds: Array.from(recordIds),
        taskIds: Array.from(taskIds),
        customers: Array.from(customers),
        processes: Array.from(processes),
        materials: Array.from(materials)
    };
}

function buildCurrentPlanFeishuPayload() {
    const furnaces = Array.isArray(globalFurnacesResult) ? globalFurnacesResult : [];
    if (!furnaces.length) return null;

    const sourceInfo = collectFeishuSourceInfoFromCurrentPlan();
    if (!sourceInfo.sourceRecordIds.length) return null;

    const totals = getPlanCompareTotals(furnaces, globalUnpackedItems || [], 'current');
    const planName = buildAutoWorkspaceTitle(STRATEGY_LABELS[placementRules.strategy] || placementRules.strategy || 'balanced');
    const toolingNames = Array.from(new Set(furnaces.map(f => f?.typeName || f?.name || f?.instanceId || '').filter(Boolean)));
    const customer = sourceInfo.customers.length === 1 ? sourceInfo.customers[0] : sourceInfo.customers.join(', ');
    const processGroup = sourceInfo.processes.length === 1 ? sourceInfo.processes[0] : sourceInfo.processes.join(', ');

    let planJson = '';
    try {
        planJson = JSON.stringify({
            version: '0.8.1.1',
            source: 'ai-furnace-loading-agent',
            createdAt: new Date().toISOString(),
            planName,
            sourceRecordIds: sourceInfo.sourceRecordIds,
            taskIds: sourceInfo.taskIds,
            placementRules,
            furnaces,
            unpackedItems: globalUnpackedItems || [],
            aggregationStats: aggregationStats || null
        });
    } catch (err) {
        planJson = '';
    }

    const payload = {
        planName,
        furnaceCount: totals.furnaceCount,
        totalWeightKg: Number(totals.totalWeight || 0),
        weightUtilization: Number.isFinite(totals.weightRate) ? totals.weightRate : 0,
        spaceUtilization: Number.isFinite(totals.avgSpace) ? totals.avgSpace : 0,
        customer,
        processGroup,
        strategy: STRATEGY_LABELS[placementRules.strategy] || placementRules.strategy || '',
        toolingNames,
        sourceRecordIds: sourceInfo.sourceRecordIds,
        taskIds: sourceInfo.taskIds,
        planJson,
        updateTaskStatus: true,
        taskStatus: '已生成方案',
        remark: `由 AI热处理装炉智能体写回；工件 ${totals.itemCount} 件，未装 ${totals.unpackedCount} 件。`
    };
    payload.writebackKey = buildFeishuWritebackKey(payload);
    return payload;
}

async function syncCurrentPlanToFeishuAfterLibrarySave(triggerButton = null) {
    const payload = buildCurrentPlanFeishuPayload();
    if (!payload) {
        // 本地手动/Excel 方案不强制写回飞书。
        return null;
    }

    if (feishuPlanWritebackInFlight) {
        showCapacityFeedback('warning', getFeishuUiText(
            '飞书写回正在进行中，请勿重复点击保存。',
            'Feishu writeback is already in progress. Please do not click Save repeatedly.'
        ));
        return null;
    }

    const writebackKey = payload.writebackKey || buildFeishuWritebackKey(payload);
    payload.writebackKey = writebackKey;
    const existed = hasFeishuWritebackRecord(writebackKey);
    if (existed) {
        showCapacityFeedback('warning', getFeishuUiText(
            `本地方案已保存；检测到该飞书方案已写回过，已跳过重复写回${existed.planRecordId ? `（${existed.planRecordId}）` : ''}。`,
            `Plan saved locally; this Feishu plan was already written back, so duplicate writeback was skipped${existed.planRecordId ? ` (${existed.planRecordId})` : ''}.`
        ));
        return { ok: true, localDuplicateSkipped: true, existing: existed };
    }

    const apiBase = getFeishuApiBase();
    const clientId = getFeishuClientId();
    const oldText = triggerButton ? triggerButton.textContent : '';
    feishuPlanWritebackInFlight = true;

    try {
        if (triggerButton) {
            triggerButton.disabled = true;
            triggerButton.classList.add('is-loading');
            triggerButton.textContent = getFeishuUiText('保存并写回飞书...', 'Saving & syncing Feishu...');
        }

        const resp = await fetch(`${apiBase}/api/feishu/plans`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json; charset=utf-8',
                'x-client-id': clientId
            },
            body: JSON.stringify(payload)
        });

        const result = await resp.json().catch(() => null);
        if (!resp.ok || !result || result.ok === false) {
            throw new Error(result?.error || result?.detail?.msg || result?.detail || `HTTP ${resp.status}`);
        }

        rememberFeishuWritebackRecord(writebackKey, result, payload);

        const planRecordId = result?.createdPlan?.record_id || result?.createdPlan?.id || result?.existingPlan?.record_id || '';
        const duplicateText = result.duplicateSkipped
            ? getFeishuUiText('；服务端检测为重复方案，未新增方案记录', '; server detected a duplicate plan and did not create another record')
            : '';
        const failText = result.failedTaskCount
            ? getFeishuUiText(`，${result.failedTaskCount} 条任务状态更新失败`, `, ${result.failedTaskCount} task updates failed`)
            : '';
        showCapacityFeedback(result.failedTaskCount ? 'warning' : 'success', getFeishuUiText(
            `方案已保存到本地方案库，并写回飞书${planRecordId ? `（${planRecordId}）` : ''}${duplicateText}；已更新 ${result.updatedTaskCount || 0} 条任务状态${failText}。`,
            `Plan saved locally and synced to Feishu${planRecordId ? ` (${planRecordId})` : ''}${duplicateText}; updated ${result.updatedTaskCount || 0} task statuses${failText}.`
        ));
        return result;
    } catch (err) {
        console.error('[Feishu Plan Writeback] failed:', err);
        showCapacityFeedback('error', getFeishuUiText(
            `本地方案已保存，但写回飞书失败：${err.message}`,
            `Plan saved locally, but Feishu writeback failed: ${err.message}`
        ));
        return null;
    } finally {
        feishuPlanWritebackInFlight = false;
        if (triggerButton) {
            triggerButton.disabled = false;
            triggerButton.classList.remove('is-loading');
            triggerButton.textContent = oldText || getFeishuUiText('保存到方案库', 'Save to Library');
        }
    }
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
    document.body.classList.toggle('left-tab-merge-active', tab === 'merge');

    // V0.7.1 UI cleanup: the old panel-header action buttons are now redundant.
    // Each page has its own local actions:
    // - 装载工装：添加工装 / 清空本次使用 / 恢复样板工装
    // - 工件详情：导入 Excel / 清空任务 / 筛选物料
    // - 合炉设计：自动合炉分组 / 查看全部物料 / 查看异常物料
    // Keep these legacy buttons hidden to avoid duplicated or misleading actions.
    [addBtn, importBtn, clearBtn].forEach(btn => {
        if (!btn) return;
        btn.style.display = 'none';
        btn.disabled = false;
    });
}

function handleLeftPanelPrimaryAction() {
    const tab = getActiveLeftPanelTab();

    if (tab === 'merge') {
        heatMergeState.dataSource = 'materials';
        renderHeatMergeDesignPanel();
        const filterLabel = getHeatMergeActiveFilterLabel();
        showCapacityFeedback('success', filterLabel ? `已按当前筛选重新生成合炉分组：${filterLabel}` : '已从工件详情重新生成合炉分组');
        return;
    }

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

    if (tab === 'merge') {
        applyHeatMergeGroupToMaterialCards(null);
        return;
    }

    if (tab === 'material') {
        clearAllMaterials();
        return;
    }

    if (tab === 'furnace') {
        clearCurrentToolingUse(true);
    }
}


// ==================== V0.7.31: Language + Theme Controls ====================
const UI_LANGUAGE_KEY = 'heat_furnace_ui_language_v0731';
const UI_THEME_KEY = 'heat_furnace_ui_theme_v0731';
let uiI18nApplying = false;
let uiI18nObserver = null;

const UI_I18N_EN = {
    'AI热处理装炉智能体': 'AI Furnace Loading Agent',
    'AI Furnace Loading Agent': 'AI Furnace Loading Agent',
    '资源配置': 'Resources',
    '方案工作台': 'Plan Workbench',
    '装载工装': 'Tooling',
    '生产车间': 'Workshop',
    '工件详情': 'Workpieces',
    '合炉设计': 'Batch Merge',
    '方案库': 'Library',
    '方案分析': 'Analysis',
    '装炉仿真': 'Loading Sim',
    '工艺仿真': 'Process Sim',
    '摆放编辑': 'Placement Edit',
    '保存': 'Save',
    '退出编辑': 'Exit Edit',
    '装炉规则': 'Rules',
    '导入 Excel': 'Import Excel',
    '导入Excel': 'Import Excel',
    '从飞书同步': 'Sync from Feishu',
    '飞书同步': 'Feishu Sync',
    '同步飞书设备': 'Sync Feishu Equipment',
    '同步飞书工装': 'Sync Feishu Tooling',
    '同步中...': 'Syncing...',
    '清空任务': 'Clear Tasks',
    '收起筛选': 'Collapse Filters',
    '筛选物料': 'Filter Items',
    '生成方案': 'Generate Plan',
    '生成中…': 'Generating…',
    '生成中...': 'Generating...',
    '查看施工清单': 'View Work Sheet',
    '查看施工单': 'View Work Sheet',
    '查看历史': 'View History',
    '删除': 'Delete',
    '新增方案': 'New Plan',
    '新生成方案': 'New Plan',
    '添加工装': 'Add Tooling',
    '清空本次使用': 'Clear Current Use',
    '恢复样板工装': 'Restore Templates',
    '暂无本次工装组合': 'No tooling selected',
    '暂无炉膛或工装，请点击上方“增加”创建料框': 'No tooling yet. Click Add above to create tooling.',
    '当前仅装载已锁定合炉组': 'Only the locked merge group is loaded',
    '历史方案只读查看中': 'Viewing historical plan',
    '历史方案 · 当前工装': 'History · Current Tooling',
    '当前工装': 'Current Tooling',
    '已装工件': 'Loaded Items',
    '装载重量': 'Load Weight',
    '重量利用率': 'Weight Utilization',
    '空间利用率': 'Space Utilization',
    '层数': 'Layers',
    '承重上限': 'Max Load',
    '展开': 'Expand',
    '收起': 'Collapse',
    '上一层': 'Prev Layer',
    '下一层': 'Next Layer',
    '仅本层': 'This Layer',
    '全层': 'All Layers',
    '全层参考': 'All Layers',
    '编辑层显示': 'Layer Display',
    '当前编辑：': 'Editing: ',
    '只显示当前层，避免上下层互相遮挡。': 'Only show the current layer to avoid overlap.',
    '模具': 'Item',
    '移动步长': 'Step',
    '位置微调': 'Move',
    '方向与状态': 'Orientation',
    '前': 'Forward',
    '后': 'Back',
    '左': 'Left',
    '右': 'Right',
    '水平': 'Rotate',
    '立放': 'Upright',
    '锁定': 'Lock',
    '还原': 'Restore',
    '微视': 'Top',
    '俯视': 'Top',
    '正视': 'Front',
    '侧视': 'Side',
    '居中': 'Center',
    '纵爆': 'V-Explode',
    '横爆': 'H-Explode',
    '视图': 'View',
    '方向轴': 'Axes',
    '尺寸标注': 'Rulers',
    '网格': 'Grid',
    '材质主色 + 客户标识': 'Material + Customer Marker',
    '按材质着色': 'By Material',
    '按客户着色': 'By Customer',
    '按工艺着色': 'By Process',
    '升温热场': 'Heating Field',
    '辐射暴露': 'Radiation Exposure',
    '气流冷却': 'Airflow Cooling',
    '气氛覆盖': 'Atmosphere Coverage',
    '淬火介质': 'Quench Medium',
    '重新计算': 'Recalculate',
    '退出仿真': 'Exit Simulation',
    '背景：自动推荐': 'Background: Auto',
    '静态诊断': 'Static Diagnosis',
    '质量优先': 'Quality First',
    '交付优先': 'Delivery First',
    '成本优先': 'Cost First',
    '自动合炉分组': 'Auto Merge Groups',
    '推荐工装': 'Recommend Tooling',
    '可合炉': 'Mergeable',
    '不可合炉': 'Not Mergeable',
    '可执行': 'Executable',
    '不参与计算': 'Excluded',
    '异常': 'Exception',
    '全部': 'All',
    '材质': 'Material',
    '工艺': 'Process',
    '硬度': 'Hardness',
    '已按全局安全间距 5mm 校验': 'Checked with global 5mm safety clearance',
    '方向键移动 · R旋转 · S保存 · Esc退出': 'Arrow keys move · R rotate · S save · Esc exit',
    '点选 3D 工件后，使用方向键或右侧按钮微调；相机已锁定，保留滚轮缩放。': 'Select a 3D item, then use arrow keys or buttons to adjust. Camera is locked; wheel zoom remains available.',
    '相机已锁定：屏幕向上 = Z- 前移；屏幕向右 = X+ 右移': 'Camera locked: screen up = Z- forward; screen right = X+ right.',
    '垂直旋转会校验当前层可用高度；超高会自动阻止。': 'Upright rotation checks available layer height and blocks over-height placement.',
    '浅': 'Light',
    '暗': 'Dark',
    '热场仿真': 'Thermal Sim',
    '暂无本次工装组合': 'No tooling selected',
    '请先在「合炉设计」中选择合炉组并点击「推荐工装」，也可以手动添加工装。': 'Select a merge group in Batch Merge and click Recommend Tooling, or add tooling manually.',
    '暂无炉膛或工装，请点击上方“增加”创建料框': 'No furnace/tooling yet. Click Add above to create tooling.',
    '开始创建装炉方案': 'Start creating a loading plan',
    '左侧“装载工装”增加料框/网篮/环形工装': 'Add baskets, mesh baskets, or ring tooling on the left.',
    '左侧“工件详情”添加或导入工件': 'Add or import workpieces on the left.',
    '点击右下角“生成方案”': 'Click Generate Plan at the lower right.',
    '保存、加载、删除历史装炉方案': 'Save, load, and delete historical loading plans.',
    '保存后的方案快照会显示在这里': 'Saved plan snapshots will appear here.',
    '历史方案': 'History',
    '暂无历史方案': 'No history yet',
    '导入JSON到工作台': 'Import JSON to Workbench',
    '暂无': 'None',
    '数量': 'Qty',
    '标准料框': 'Standard Basket',
    '网篮': 'Mesh Basket',
    '料盘': 'Tray',
    '环形工装': 'Ring Tooling',
    '点击选择': 'Click to select',
    '数量可直接修改': 'Quantity can be edited directly',
    '返回编辑': 'Back to Edit',
    '退出': 'Exit'
};

const UI_I18N_PATTERNS = [
    [/^共\s*(\d+)\s*个方案$/, 'Total $1 plans'],
    [/^第\s*(\d+)\s*\/\s*(\d+)\s*层$/, 'Layer $1 / $2'],
    [/^第\s*(\d+)\s*层\s*\/\s*共\s*(\d+)\s*层$/, 'Layer $1 / $2'],
    [/^当前编辑：\s*第\s*(\d+)\s*层\s*\/\s*共\s*(\d+)\s*层$/, 'Editing: Layer $1 / $2'],
    [/^已装工件\s*(\d+)\s*件$/, 'Loaded $1 items'],
    [/^装载重量\s*([\d.]+)\s*kg$/, 'Load $1 kg'],
    [/^承重上限\s*([\d.]+)\s*kg$/, 'Max Load $1 kg'],
    [/^空间利用率\s*([\d.]+)%$/, 'Space $1%'],
    [/^重量利用率\s*([\d.]+)%$/, 'Weight $1%'],
    [/^层数\s*(\d+)\s*层$/, '$1 layer(s)'],
    [/^尺寸\s*[:：]?\s*(.*)$/i, 'Size: $1'],
    [/^编号\s*[:：]?\s*(.*)$/i, 'ID: $1'],
    [/^客户\s*[:：]?\s*(.*)$/i, 'Customer: $1'],
    [/^工艺\s*[:：]?\s*(.*)$/i, 'Process: $1'],
    [/^材质\s*[:：]?\s*(.*)$/i, 'Material: $1'],
    [/^硬度\s*[:：]?\s*(.*)$/i, 'Hardness: $1']
];



// V0.7.33：补充主要业务面板英文翻译。客户名、工件名和导入数据仍保持原文。
Object.assign(UI_I18N_EN, {
    '工艺规则配置': 'Loading Rule Settings',
    '装炉策略选择': 'Loading Strategy',
    '热场均衡装载': 'Thermal Balance Loading',
    '温度均匀，避免中心聚集，控制局部密度': 'Keep temperature uniform, avoid center clustering, and control local density.',
    '重量与安全规则': 'Weight & Safety Rules',
    '承重安全余量 (%)': 'Load Safety Margin (%)',
    '搁板分层平铺算法 (Shelf-Layered 3D Bin Packing)': 'Shelf-Layered 3D Bin Packing',
    '启用搁板分层平铺算法': 'Enable shelf-layered packing',
    '重量+体积优先排序 → 底部平铺 → 动态搁板 → 分层填充': 'Weight + volume priority → bottom layout → dynamic shelf → layered fill',
    '搁板厚度 (mm)': 'Shelf Thickness (mm)',
    '工件摆放姿态优化 (V2.0 新增)': 'Workpiece Orientation Optimization',
    '立放': 'Upright',
    '自动旋转长方体(最小面积面朝下，提高单层堆叠密度。': 'Auto-rotate cuboids with the smallest footprint down to improve layer density.',
    '圆盘翻转阈值': 'Disc Flip Threshold',
    '取消': 'Cancel',
    '保存规则': 'Save Rules',
    '重新推荐': 'Recommend Again',
    '风险低': 'Low Risk',
    '风险中': 'Medium Risk',
    '风险高': 'High Risk',
    '质量优先方案': 'Quality-First Plan',
    '本次工装组合 · 来源：AI 推荐': 'Current Tooling · AI Recommended',
    '规则工艺组': 'Rule Process Group',
    '人工拼炉组': 'Manual Merge Group',
    '待曲线确认': 'Curve Pending',
    '曲线状态：未接入真实曲线库': 'Curve: real process curve library not connected',
    '曲线状态：未接入真实曲线库': 'Curve: not connected to curve library',
    '可进入工装推荐': 'Ready for tooling recommendation',
    '本次工装组合': 'Current Tooling Set',
    '来源：AI 推荐': 'Source: AI Recommended',
    '工装推荐': 'Tooling Recommendation',
    '先选择一个工艺组，再点击「推荐工装」。': 'Select a process group, then click Recommend Tooling.',
    '重新推荐': 'Recommend Again',
    '采用': 'Apply',
    '已采用': 'Applied',
    '当前工作台方案': 'Current Workbench Plan',
    '正在查看历史方案': 'Viewing Historical Plan',
    '历史查看': 'History View',
    '保存到方案库': 'Save to Library',
    '打印方案': 'Print Plan',
    '当前选中方案': 'Selected Plan',
    'AI 诊断': 'AI Diagnosis',
    '方案状态': 'Plan Status',
    '主要瓶颈': 'Main Bottleneck',
    '空间': 'Space',
    '重量': 'Weight',
    '炉次数量': 'Furnace Count',
    '未装工件': 'Unpacked Items',
    '总装载量': 'Total Load',
    '总重量': 'Total Weight',
    '工装': 'Tooling',
    '标准料框': 'Standard Basket',
    '数量': 'Qty',
    '点击选择': 'Click to select',
    '工件': 'Item',
    '当前层': 'Current Layer',
    '等待选择工件': 'Waiting for item selection',
    '位置': 'Position',
    '可执行 · 已按全局安全间距 5mm 校验': 'Executable · Checked with global 5mm clearance',
    '点选 3D 工件后，使用方向键或右侧按钮微调；相机已锁定，保留滚轮缩放。': 'Select a 3D workpiece, then use arrow keys or the side buttons to adjust. Camera orbit is locked; wheel zoom remains.',
    '方向键移动 · R旋转 · S保存 · Esc退出': 'Arrow keys move · R rotate · S save · Esc exit',
    '炉内阶段 + 淬火阶段': 'Furnace Stage + Quench Stage',
    '当前操作 · 辐射暴露': 'Current Action · Radiation Exposure',
    '辐射暴露是静态诊断：可点击 3D 工件或左侧物料卡查看单件/批次遮挡原因。': 'Radiation exposure is a static diagnosis. Click a 3D workpiece or material card to inspect shielding reasons.',
    '低暴露工件': 'Lowest Exposure Item',
    '严重遮挡': 'Severe Shielding',
    '充分': 'Good',
    '遮挡': 'Blocked',
    '热源': 'Heat Source',
    '可达路径': 'Reachable Path',
    '被遮挡路径': 'Blocked Path',
    '装炉规则': 'Rules',
    '热场仿真': 'Thermal Simulation',
    '工艺仿真': 'Process Simulation',
    '装炉仿真': 'Loading Simulation',
    '方案分析': 'Plan Analysis',
    '方案库': 'Plan Library',
    '保存、加载、删除历史装炉方案': 'Save, load, and delete historical loading plans',
    '保存后的方案快照会显示在这里': 'Saved plan snapshots will appear here',
    '当前方案库仅支持新版“装炉数字孪生 JSON”。旧格式历史方案暂不支持直接导入工作台。': 'The library supports the new Digital Twin JSON format. Legacy plan records cannot be imported directly yet.'
});

function getUiLanguage() {
    const saved = localStorage.getItem(UI_LANGUAGE_KEY);
    return saved === 'en' ? 'en' : 'zh';
}

function getUiTheme() {
    const saved = localStorage.getItem(UI_THEME_KEY);
    return ['light', 'dark'].includes(saved) ? saved : 'light';
}

function setSceneThemeBackground(theme) {
    if (!scene || processSimulationActive) return;
    const colorMap = {
        light: 0xf5f7fa,
        dark: 0x0b1120,
    };
    try {
        scene.background = new THREE.Color(colorMap[theme] || colorMap.light);
    } catch (err) {
        console.warn('[theme] failed to set scene background', err);
    }
}

function setUiTheme(theme) {
    const nextTheme = ['light', 'dark'].includes(theme) ? theme : 'light';
    localStorage.setItem(UI_THEME_KEY, nextTheme);
    document.documentElement.setAttribute('data-ui-theme', nextTheme);
    document.body?.setAttribute('data-ui-theme', nextTheme);
    document.querySelectorAll('[data-ui-theme-btn]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-ui-theme-btn') === nextTheme);
    });
    setSceneThemeBackground(nextTheme);
}

function translateRawText(raw, lang) {
    if (lang !== 'en') return raw;
    const source = String(raw || '');
    const trimmed = source.trim();
    if (!trimmed) return raw;
    let translated = UI_I18N_EN[trimmed];
    if (!translated && Array.isArray(UI_I18N_PATTERNS)) {
        for (const [pattern, replacement] of UI_I18N_PATTERNS) {
            if (pattern.test(trimmed)) {
                translated = trimmed.replace(pattern, replacement);
                break;
            }
        }
    }
    if (!translated) return raw;
    const leading = source.match(/^\s*/)?.[0] || '';
    const trailing = source.match(/\s*$/)?.[0] || '';
    return leading + translated + trailing;
}

function applyI18nToTextNode(node, lang) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (!parent || parent.closest('.no-i18n, script, style, textarea, input, select')) return;
    if (!node.__i18nOriginal) node.__i18nOriginal = node.nodeValue;
    const nextValue = lang === 'zh' ? node.__i18nOriginal : translateRawText(node.__i18nOriginal, lang);
    if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
}

function applyI18nToAttributes(el, lang) {
    if (!el || el.closest?.('.no-i18n')) return;
    ['title', 'placeholder', 'aria-label'].forEach(attr => {
        if (!el.hasAttribute(attr)) return;
        const raw = el.getAttribute(attr) || '';
        if (!el.__i18nOriginalAttrs) el.__i18nOriginalAttrs = {};
        if (!Object.prototype.hasOwnProperty.call(el.__i18nOriginalAttrs, attr)) {
            el.__i18nOriginalAttrs[attr] = raw;
        }
        const original = el.__i18nOriginalAttrs[attr];
        const nextValue = lang === 'zh' ? original : translateRawText(original, lang);
        if (el.getAttribute(attr) !== nextValue) el.setAttribute(attr, nextValue);
    });
}

function applyUiLanguage(lang = getUiLanguage()) {
    const nextLang = lang === 'en' ? 'en' : 'zh';
    localStorage.setItem(UI_LANGUAGE_KEY, nextLang);
    document.documentElement.setAttribute('lang', nextLang === 'en' ? 'en' : 'zh-CN');
    document.documentElement.setAttribute('data-ui-lang', nextLang);
    document.body?.setAttribute('data-ui-lang', nextLang);
    document.querySelectorAll('[data-ui-lang-btn]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-ui-lang-btn') === nextLang);
    });

    uiI18nApplying = true;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => applyI18nToTextNode(node, nextLang));
    document.querySelectorAll('[title], [placeholder], [aria-label]').forEach(el => applyI18nToAttributes(el, nextLang));
    uiI18nApplying = false;
}

function scheduleUiLanguageRefresh() {
    if (uiI18nApplying || getUiLanguage() !== 'en') return;
    clearTimeout(scheduleUiLanguageRefresh._timer);
    scheduleUiLanguageRefresh._timer = setTimeout(() => applyUiLanguage('en'), 60);
}

function observeUiLanguageMutations() {
    if (uiI18nObserver || !document.body) return;
    uiI18nObserver = new MutationObserver(() => scheduleUiLanguageRefresh());
    uiI18nObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}



// ==================== V0.7.34: Full i18n polish helpers ====================
Object.assign(UI_I18N_EN, {
    'Excel 导入预览': 'Excel Import Preview',
    '请核对以下数据，确认后选择追加或替换当前列表': 'Review the data below, then append or replace the current list.',
    '产品名称': 'Product',
    '产品名': 'Product',
    '客户': 'Customer',
    '客户名称': 'Customer',
    '物料编码': 'Item Code',
    '形态': 'Shape',
    '尺寸': 'Size',
    '数量': 'Qty',
    '单重(kg)': 'Unit Wt. (kg)',
    '总重(kg)': 'Total Wt. (kg)',
    '材质': 'Material',
    '工艺': 'Process',
    '硬度': 'Hardness',
    '下单日期': 'Order Date',
    '交付日期': 'Due Date',
    '备注': 'Remarks',
    '状态': 'Status',
    '尺寸不足': 'Invalid size',
    '替换列表': 'Replace List',
    '追加到列表': 'Append to List',
    '取消': 'Cancel',
    '正常': 'Normal',
    '快速': 'Fast',
    '慢速': 'Slow',
    '极速': 'Max',
    '速度：': 'Speed:',
    '速度:': 'Speed:',
    '继续': 'Continue',
    '停止': 'Stop',
    '暂停': 'Pause',
    '播放': 'Play',
    '播放装炉仿真': 'Play Loading Simulation',
    '装炉仿真中': 'Loading Simulation',
    '累计到此步': 'Up to Step',
    '仅看本层': 'This Layer Only',
    '显示全部': 'Show All',
    '显示全部层': 'Show All Layers',
    '底层摆放': 'Bottom Layer Placement',
    '第': 'No.',
    '件': 'pcs',
    '炉': 'Furnace',
    '炉次': 'Heat',
    '热场': 'Thermal Field',
    '速度': 'Speed',
    '当前操作': 'Current Action',
    '当前操作 · 辐射暴露': 'Current Action · Radiation Exposure',
    '正在生成装炉方案': 'Generating Loading Plan',
    '渲染 3D 装炉结果': 'Rendering 3D Loading Result',
    '读取数据': 'Read Data',
    '试算排布': 'Calculate Layout',
    '渲染结果': 'Render Result',
    '完成': 'Done',
    '计算期间页面可能短暂停顿，请勿重复点击。': 'The page may pause briefly during calculation. Do not click repeatedly.',
    '打印现场摆料施工单': 'Print Field Loading Work Sheet',
    'PDF V2.8 支持横版施工图、竖版归档单、区域局部放大与现场试用小修。建议现场摆料选择“自动推荐”或“横版施工图”。': 'PDF V2.8 supports landscape field drawings, portrait archives, regional zoom and field-ready refinements. For shop-floor loading, choose Auto or Landscape Drawing.',
    '打印版式': 'Print Layout',
    '自动推荐': 'Auto',
    '系统按件数、层数和是否导出步骤图自动选择。': 'The system chooses by item count, layers and step drawings.',
    '横版施工图': 'Landscape Drawing',
    '大图、分步骤，推荐现场照图摆料。': 'Large drawings with steps; recommended for shop-floor loading.',
    '竖版归档单': 'Portrait Archive',
    '表格、签字、审核留档更方便。': 'Tables, signatures and review records.',
    '输出模式': 'Output Mode',
    '标准版': 'Standard',
    '封面、图例、步骤图和坐标清单。': 'Cover, legend, step drawings and coordinate list.',
    '精简现场版': 'Compact Field',
    '只输出封面 + 步骤图；默认关闭图例、坐标表和区域拆分，页数最少。': 'Cover + step drawings only; fewer pages.',
    '完整归档版': 'Full Archive',
    '偏向竖版和清单，方便签字留档。': 'Portrait-oriented records for signature/archive.',
    '页面内容': 'Pages',
    '任务封面': 'Cover',
    '工装、工艺、KPI、签字确认。': 'Tooling, process, KPI and sign-off.',
    '工件图例 / 工件包': 'Item Legend / Batch',
    '颜色、尺寸、数量说明。': 'Color, size and quantity notes.',
    '分步摆放图': 'Step Drawings',
    '每步新增件高亮，已放置件灰化。': 'New items highlighted per step; placed items dimmed.',
    '工件坐标清单': 'Coordinate List',
    'X / Y / Z 坐标复核与归档。': 'X / Y / Z coordinate review and archive.',
    '高密度区域放大': 'High-density Zoom',
    '单层件数过多时自动拆 A/B/C/D 区。': 'Split A/B/C/D zones for dense layers.',
    '同时导出 JSON': 'Export JSON too',
    '用于备份、回写或后续导入。': 'For backup, write-back or later import.',
    '图纸密度': 'Drawing Density',
    '自动': 'Auto',
    '按复杂度拆分步骤。': 'Split steps by complexity.',
    '大图优先': 'Larger Drawings',
    '每步件数更少，更清楚。': 'Fewer items per step, clearer drawings.',
    '节省纸张': 'Save Paper',
    '每页放更多件，页数更少。': 'More items per page, fewer pages.',
    '生成 PDF V2.8': 'Generate PDF V2.8',
    '正在生成 PDF': 'Generating PDF',
    '正在渲染第': 'Rendering page',
    '页': 'page',
    'PDF V2.8 使用逐页截图方式生成。页数较多时请等待，不要关闭页面。': 'PDF V2.8 is generated page by page. Please wait and do not close the page.',
    '方案库背景': 'Plan Library Background',
    '当前工作台方案': 'Current Workbench Plan',
    '暂无当前方案': 'No current plan',
    '正在只读查看': 'Read-only view',
    '历史查看': 'History View',
    '保存到方案库': 'Save to Library',
    '保存后进入历史方案，可用于查看、复用和对比。': 'Save as a history snapshot for review, reuse and comparison.',
    '打印方案': 'Print Plan',
    '生成方案后显示方案分析': 'Plan analysis appears after generation',
    '生成方案后显示装炉步骤仿真': 'Loading simulation appears after generation',
    '生成方案后显示真空淬火工艺仿真': 'Vacuum quench simulation appears after generation',
    '正在分析物料组合…': 'Analyzing material combination…',
    '暂无历史方案': 'No history yet',
    '选择历史方案后显示差异摘要': 'Select a history plan to view the comparison summary',
    '选择左侧方案查看详情': 'Select a plan on the left to view details',
    'PDF 内包含工件坐标清单': 'Include coordinate list in PDF',
    '在作业指导书中展示每件工件的 X / Y / Z 坐标，便于现场复核。': 'Show X / Y / Z coordinates for each item for field verification.',
    '导出 PDF': 'Export PDF',
    '请至少选择一个炉膛方案': 'Please select at least one furnace plan.',
    '未找到有效数据，请检查文件格式': 'No valid data found. Check the file format.',
    '文件解析失败：': 'File parsing failed: ',
    '当前没有可导出的装炉方案，请先生成方案。': 'No loading plan can be exported. Generate a plan first.',
    'PDF 导出组件未加载，请检查 html2pdf.js 是否正常引入。': 'PDF export component is not loaded. Check html2pdf.js.',
    'PDF 导出失败：': 'PDF export failed: ',
    '现场摆料施工单': 'Field Loading Work Sheet',
    '热处理装炉作业指导书': 'Heat Treatment Loading Work Instruction',
    '工件清单': 'Item List',
    '任务总览': 'Task Overview',
    '现场执行确认': 'Field Execution Confirmation',
    '现场注意事项': 'Field Notes',
    '坐标清单': 'Coordinate List',
    '编号': 'No.',
    '层': 'Layer',
    '客户/图号': 'Customer / Drawing',
    '尺寸 mm': 'Size mm',
    '坐标 mm': 'Coordinates mm',
    '单重': 'Unit Weight',
    '方体': 'Cuboid',
    '圆柱': 'Cylinder',
    '均衡方案': 'Balanced Plan',
    '空间优先': 'Space First',
    '表面均匀': 'Surface Uniformity'
});

UI_I18N_PATTERNS.push(
    [/^装炉仿真中\s*\((\d+)\/(\d+)\)\s*·\s*(.*?)\s*·\s*工件\s*(\d+)\/(\d+)\s*·\s*(.*)$/,
        'Loading Simulation ($1/$2) · $3 · Items $4/$5 · $6'],
    [/^正在渲染第\s*(\d+)\s*\/\s*(\d+)\s*页\.\.\.$/, 'Rendering page $1 / $2...'],
    [/^有\s*(\d+)\s*件工件无法装入当前炉膛：$/, '$1 items cannot be loaded into the current furnace:'],
    [/^当前 PDF 将导出已装炉方案；未装炉工件请结合页面容量提示另行安排后续炉次。$/, 'The PDF exports loaded furnaces only. Arrange unpacked items in later heats according to capacity hints.'],
    [/^(.+?)件\s*·\s*([\d.]+)kg\s*·\s*利用率([\d.]+)%$/, '$1 pcs · $2 kg · Utilization $3%'],
    [/^第\s*(\d+)\s*层\s*\/\s*底层$/, 'Layer $1 / Bottom'],
    [/^清单\s*(\d+)\/(\d+)$/, 'List $1/$2'],
    [/^步骤\s*(\d+)\/(\d+)$/, 'Step $1/$2'],
    [/^层\s*(\d+)$/, 'Layer $1'],
    [/^工件\s*(\d+)\/(\d+)$/, 'Items $1/$2'],
    [/^(.+?)\s*·\s*(\d+)\s*件$/, '$1 · $2 pcs'],
    [/^(.+?)\s*(\d+)\s*件$/, '$1 $2 pcs'],
    [/^X=([\d.]+) mm \/ Z=([\d.]+) mm \/ 间距=(.*?)mm$/, 'X=$1 mm / Z=$2 mm / Clearance=$3mm']
);

function ensureLanguageThemeControls() {
    const topBar = document.getElementById('top-bar');
    if (!topBar || document.getElementById('language-theme-controls')) return;

    const controls = document.createElement('div');
    controls.id = 'language-theme-controls';
    controls.className = 'language-theme-controls no-i18n';
    controls.innerHTML = `
        <div class="ltc-group" title="Language / 语言">
            <button type="button" data-ui-lang-btn="zh" title="中文" aria-label="中文界面">中</button>
            <button type="button" data-ui-lang-btn="en" title="English" aria-label="English UI">EN</button>
        </div>
        <div class="ltc-group" title="Theme / 主题">
            <button type="button" data-ui-theme-btn="light" title="Light" aria-label="Light theme">☀</button>
            <button type="button" data-ui-theme-btn="dark" title="Dark" aria-label="Dark theme">☾</button>
        </div>`;

    const spacer = topBar.querySelector('.top-spacer');
    const summary = document.getElementById('top-summary');
    if (spacer && summary && summary.parentNode === topBar) {
        topBar.insertBefore(controls, summary);
    } else if (spacer && spacer.nextSibling) {
        topBar.insertBefore(controls, spacer.nextSibling);
    } else {
        topBar.appendChild(controls);
    }

    controls.querySelectorAll('[data-ui-lang-btn]').forEach(btn => {
        btn.addEventListener('click', () => applyUiLanguage(btn.getAttribute('data-ui-lang-btn')));
    });
    controls.querySelectorAll('[data-ui-theme-btn]').forEach(btn => {
        btn.addEventListener('click', () => setUiTheme(btn.getAttribute('data-ui-theme-btn')));
    });

    setUiTheme(getUiTheme());
    applyUiLanguage(getUiLanguage());
    observeUiLanguageMutations();
}



// ==================== V0.8.2.1.2 PDF export bulletproof binding ====================
let pdfExportDelegationBoundV08212 = false;

function ensurePdfExportDomV08212() {
    let overlay = document.getElementById('pdf-select-overlay');
    let hiddenTemplate = document.getElementById('pdf-hidden-template');

    if (!hiddenTemplate) {
        hiddenTemplate = document.createElement('div');
        hiddenTemplate.id = 'pdf-hidden-template';
        hiddenTemplate.style.display = 'none';
        document.body.appendChild(hiddenTemplate);
    }

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'pdf-select-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.56);backdrop-filter:blur(8px);';
        overlay.innerHTML = `
            <div id="pdf-select-modal" style="width:min(920px,calc(100vw - 36px));max-height:88vh;overflow:auto;background:#fff;border-radius:22px;padding:24px;box-shadow:0 30px 100px rgba(15,23,42,.32);">
                <h2 style="margin:0 0 8px;font-size:22px;color:#0f172a;">打印现场摆料施工单</h2>
                <div style="color:#64748b;font-size:13px;line-height:1.7;margin-bottom:14px;">选择需要导出的炉次，然后生成 PDF。</div>
                <div id="pdf-unpacked-warning" class="pdf-unpacked-badge" style="display:none;"></div>
                <div id="pdf-furnace-list" style="display:flex;flex-direction:column;gap:10px;margin:14px 0 18px;"></div>
                <div class="pdf-options-section" style="margin:12px 0;">
                    <label style="display:flex;align-items:center;gap:8px;color:#475569;font-size:13px;">
                        <input type="checkbox" id="pdf-opt-json"> 同时导出 JSON
                    </label>
                </div>
                <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:18px;">
                    <button id="btn-pdf-cancel" type="button" style="padding:10px 20px;border:0;border-radius:12px;background:#e2e8f0;color:#334155;font-weight:800;cursor:pointer;">取消</button>
                    <button id="btn-pdf-confirm" type="button" style="padding:10px 24px;border:0;border-radius:12px;background:#2563eb;color:white;font-weight:800;cursor:pointer;">📄 导出 PDF</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    if (!document.getElementById('pdf-furnace-list')) {
        const modal = overlay.querySelector('#pdf-select-modal') || overlay.firstElementChild || overlay;
        const list = document.createElement('div');
        list.id = 'pdf-furnace-list';
        list.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin:14px 0 18px;';
        modal.appendChild(list);
    }
    if (!document.getElementById('pdf-unpacked-warning')) {
        const warning = document.createElement('div');
        warning.id = 'pdf-unpacked-warning';
        warning.className = 'pdf-unpacked-badge';
        warning.style.display = 'none';
        const list = document.getElementById('pdf-furnace-list');
        list.parentNode.insertBefore(warning, list);
    }
    if (!document.getElementById('btn-pdf-cancel') || !document.getElementById('btn-pdf-confirm')) {
        const modal = overlay.querySelector('#pdf-select-modal') || overlay.firstElementChild || overlay;
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:18px;';
        actions.innerHTML = '<button id="btn-pdf-cancel" type="button">取消</button><button id="btn-pdf-confirm" type="button">📄 导出 PDF</button>';
        modal.appendChild(actions);
    }

    return overlay;
}

function showPdfProgressV08212(message = '正在生成 PDF...') {
    let overlay = document.getElementById('pdf-export-progress-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'pdf-export-progress-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.42);backdrop-filter:blur(8px);';
        overlay.innerHTML = `
            <div style="width:min(520px,calc(100vw - 36px));background:#fff;border-radius:20px;padding:28px;box-shadow:0 30px 100px rgba(15,23,42,.32);border:1px solid rgba(148,163,184,.28);">
                <div style="font-size:22px;font-weight:900;color:#0f172a;margin-bottom:10px;">正在生成 PDF</div>
                <div id="pdf-export-progress-text" style="font-size:14px;color:#64748b;line-height:1.7;">${message}</div>
                <div style="height:8px;background:#e5e7eb;border-radius:999px;overflow:hidden;margin-top:20px;">
                    <div style="height:100%;width:42%;background:#2563eb;border-radius:999px;animation:pdfProgressSlideV08212 1.2s ease-in-out infinite alternate;"></div>
                </div>
            </div>
        `;
        if (!document.getElementById('pdf-progress-style-v08212')) {
            const style = document.createElement('style');
            style.id = 'pdf-progress-style-v08212';
            style.textContent = '@keyframes pdfProgressSlideV08212{from{transform:translateX(-35%)}to{transform:translateX(150%)}}';
            document.head.appendChild(style);
        }
        document.body.appendChild(overlay);
    } else {
        overlay.style.display = 'flex';
        const text = overlay.querySelector('#pdf-export-progress-text');
        if (text) text.textContent = message;
    }
    return overlay;
}

function hidePdfProgressV08212() {
    const overlay = document.getElementById('pdf-export-progress-overlay');
    if (overlay) overlay.style.display = 'none';
}

function openPdfExportModalSafeV08212(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }

    const furnaces = Array.isArray(globalFurnacesResult) ? globalFurnacesResult : [];
    if (!furnaces.length) {
        alert('请先生成装炉方案，再打印方案。');
        return;
    }

    try {
        ensurePdfExportDomV08212();
        showPdfSelectModal();
        const confirmBtn = document.getElementById('btn-pdf-confirm');
        if (confirmBtn) confirmBtn.onclick = confirmPdfExportSafeV08212;
        const cancelBtn = document.getElementById('btn-pdf-cancel');
        if (cancelBtn) cancelBtn.onclick = () => {
            const overlay = document.getElementById('pdf-select-overlay');
            if (overlay) overlay.style.display = 'none';
        };
    } catch (err) {
        console.error('[PDF] 打开导出弹窗失败:', err);
        alert('PDF 导出弹窗打开失败：' + (err?.message || err));
    }
}

async function confirmPdfExportSafeV08212(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }

    const selectedIds = getSelectedPdfFurnaceIds();
    if (!selectedIds.length) {
        alert('请至少选择一个炉膛方案');
        return;
    }

    const btn = document.getElementById('btn-pdf-confirm');
    const oldText = btn ? btn.textContent : '';
    const shouldExportJson = !!document.getElementById('pdf-opt-json')?.checked;
    const overlay = document.getElementById('pdf-select-overlay');

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = '正在生成...';
        }
        if (overlay) overlay.style.display = 'none';
        showPdfProgressV08212(`正在导出 ${selectedIds.length} 个炉次，请不要关闭页面。`);
        await generateSixPagePDF(selectedIds);
        if (shouldExportJson) exportCurrentPlanJson();
    } catch (err) {
        console.error('[PDF] 导出失败:', err);
        alert('PDF 导出失败：' + (err?.message || err));
    } finally {
        hidePdfProgressV08212();
        if (btn) {
            btn.disabled = false;
            btn.textContent = oldText || '📄 导出 PDF';
        }
    }
}

function bindPdfExportDelegationV08212() {
    if (pdfExportDelegationBoundV08212) return;
    pdfExportDelegationBoundV08212 = true;

    document.addEventListener('click', (event) => {
        const exportBtn = event.target.closest?.('#btn-export-pdf');
        if (exportBtn) {
            openPdfExportModalSafeV08212(event);
            return;
        }

        const confirmBtn = event.target.closest?.('#btn-pdf-confirm');
        if (confirmBtn) {
            void confirmPdfExportSafeV08212(event);
            return;
        }

        const cancelBtn = event.target.closest?.('#btn-pdf-cancel');
        if (cancelBtn) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            const overlay = document.getElementById('pdf-select-overlay');
            if (overlay) overlay.style.display = 'none';
        }
    }, true);
}


/**
 * 初始化应用程序，设置 Three.js 场景、创建默认炉膛卡片和物料卡片，并绑定所有事件监听器。
 * @returns {void}
 */
function init() {
    initThree();
    bindPdfExportDelegationV08212();
    bindRadiationItemSelection();
    bindRadiationMaterialCardSelection();
    bindRadiationDiagnosisActions();
    bindThermalHeatmapActions();
    ensureProcessModeButtons();
    bindAirflowCoolingActions();
    bindAtmosphereCoverageActions();
    bindQuenchMediumActions();
    updateTopSummary();
    hideExplodeBOMButtons();
    initLeftPanelTabs();
    bindFeishuSyncButton();
    bindFeishuResourceSyncButtons();
    ensurePlacementEditRightPanel();
    initRightPanelTabs();
    ensureLanguageThemeControls();
    initHeatMergeDesign();
    bindFeishuSyncButton();
    bindFeishuResourceSyncButtons();

    bindWorkbenchUiModeAutoRefresh();
    updateWorkbenchUiMode();
    bindLoadingSimulationStepClicks();
    bindCompareModeEvents();
    bindCurrentToolingHudControls();
    bindPlacementEditMode();
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
    if (btnPlayThermal) btnPlayThermal.addEventListener("click", playCurrentProcessAnimation);
    const btnPauseThermal = document.getElementById("btn-pause-thermal");
    if (btnPauseThermal) btnPauseThermal.addEventListener("click", pauseResumeCurrentProcessAnimation);
    const btnRenderThermal = document.getElementById("btn-render-thermal");
    if (btnRenderThermal) btnRenderThermal.addEventListener("click", renderCurrentProcessSimulation);
    const btnModeThermal = document.getElementById('btn-mode-thermal');
    if (btnModeThermal) btnModeThermal.addEventListener('click', () => switchProcessSimulationMode('thermal'));
    const btnModeRadiation = document.getElementById('btn-mode-radiation');
    if (btnModeRadiation) btnModeRadiation.addEventListener('click', () => switchProcessSimulationMode('radiation'));
    const btnModeAirflow = document.getElementById('btn-mode-airflow');
    if (btnModeAirflow) btnModeAirflow.addEventListener('click', () => switchProcessSimulationMode('airflow'));
    const btnModeAtmosphere = document.getElementById('btn-mode-atmosphere');
    if (btnModeAtmosphere) btnModeAtmosphere.addEventListener('click', () => switchProcessSimulationMode('atmosphere'));
    const btnModeQuench = document.getElementById('btn-mode-quench');
    if (btnModeQuench) btnModeQuench.addEventListener('click', () => switchProcessSimulationMode('quench'));
    const btnResetThermal = document.getElementById("btn-reset-thermal");
    if (btnResetThermal) btnResetThermal.addEventListener("click", resetCurrentThermalSimulation);
    const thermalSpeedSelect = ensureProcessSpeedSelectOptions();
    if (thermalSpeedSelect) thermalSpeedSelect.addEventListener('change', applyCurrentProcessSpeedChange);
    const processSceneThemeSelect = ensureProcessSceneThemeSelect();
    if (processSceneThemeSelect) processSceneThemeSelect.addEventListener('change', applyProcessSceneThemeChange);
    const thermalProgressRange = document.getElementById('thermal-progress-range');
    if (thermalProgressRange) thermalProgressRange.addEventListener('input', (event) => scrubCurrentProcessAnimation(parseInt(event.target.value, 10) || 0));
    const btnExportPdf = document.getElementById("btn-export-pdf");
    if (btnExportPdf) btnExportPdf.onclick = openPdfExportModalSafeV08212;
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
            void syncCurrentPlanToFeishuAfterLibrarySave(btnSavePlanLibrary);

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
        heatMergeState.appliedGroupId = null;
        heatMergeState.selectedGroupId = null;
        heatMergeState.dataSource = 'materials';
        renderMaterialTaskDataStatus();
        renderHeatMergeDesignPanel();
        scheduleWorkbenchUiModeUpdate();
    });

    const btnImportAppend = document.getElementById("btn-import-append");
    if (btnImportAppend) btnImportAppend.addEventListener("click", () => {
        applyImportData(false);
        heatMergeState.appliedGroupId = null;
        heatMergeState.selectedGroupId = null;
        heatMergeState.dataSource = 'materials';
        renderMaterialTaskDataStatus();
        renderHeatMergeDesignPanel();
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
    if (btnPdfConfirm) btnPdfConfirm.onclick = confirmPdfExportSafeV08212;
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
    renderMaterialTaskDataStatus();
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
            if (tab === 'merge') renderHeatMergeDesignPanel();
            if (tab === 'furnace') renderCurrentToolingPlanCard();
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

    // 检查是否有炉膛和有效生成物料。采用合炉组后，物料可能被筛选隐藏，
    // 因此这里读取实际生成输入，而不是只数 material-card DOM。
    const hasFurnaces = document.querySelectorAll('.furnace-card').length > 0;
    const effectiveItems = collectPackingItemsForCurrentGeneration();
    if (!hasFurnaces || effectiveItems.length === 0) {
        alert('请先配置本次工装，并在工件详情/合炉设计中选择有效物料');
        return;
    }

    // 生成入口简化：不再弹出“装炉仿真/直接生成”的二选一。
    // 方案生成后默认进入“方案分析”；装炉仿真已在方案工作台独立 Tab 中查看。
    executeWithAILoading();
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
async function executeWithAnimation() {
    showPlanGenerationProgress('装炉仿真');
    setPlanGenerationProgress(8, '读取生产任务与工装配置');
    setGenerateButtonBusy(true);
    await nextPaint();

    try {
        setPlanGenerationProgress(32, '生成摆放路径与分层数据');
        await nextPaint();
        executeAndRender();
        setPlanGenerationProgress(78, '准备逐步装炉动画');
        await sleep(220);
        setPlanGenerationProgress(100, '开始播放装炉仿真');
        await sleep(120);
    } finally {
        hidePlanGenerationProgress();
        setGenerateButtonBusy(false);
    }

    setTimeout(() => {
        playCurrentSimulation();
    }, 120);
}

/**
 * 执行装炉算法，显示生成进度，然后直接呈现结果，跳过逐帧动画。
 * @returns {Promise<void>}
 */
async function executeWithAILoading() {
    // V0.7.21：恢复 V0.7.19 的视觉结构，同时保留生成方案进度反馈。
    // 先让浏览器完成一次绘制，再执行同步装炉计算，避免点击后数秒无反馈。
    showPlanGenerationProgress('生成装炉方案');
    setPlanGenerationProgress(8, '读取生产任务与工装配置');
    setGenerateButtonBusy(true);

    await nextPaint();

    try {
        setPlanGenerationProgress(28, '执行装炉算法试算');
        await nextPaint();

        executeAndRender();

        setPlanGenerationProgress(82, '渲染 3D 装炉结果');
        await sleep(220);

        setPlanGenerationProgress(100, '方案生成完成');
        await sleep(160);
    } finally {
        hidePlanGenerationProgress();
        setGenerateButtonBusy(false);
    }
}

function nextPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function ensurePlanGenerationProgressOverlay() {
    let overlay = document.getElementById('plan-generation-progress-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'plan-generation-progress-overlay';
    overlay.innerHTML = `
        <div class="pgp-card">
            <div class="pgp-head">
                <div class="pgp-kicker">正在生成装炉方案</div>
                <div class="pgp-percent" id="pgp-percent">0%</div>
            </div>
            <div class="pgp-title" id="pgp-title">准备计算</div>
            <div class="pgp-bar"><div class="pgp-bar-fill" id="pgp-bar-fill"></div></div>
            <div class="pgp-steps">
                <span data-step="read" class="active">读取数据</span>
                <span data-step="pack">试算排布</span>
                <span data-step="render">渲染结果</span>
                <span data-step="done">完成</span>
            </div>
            <div class="pgp-hint">计算期间页面可能短暂停顿，请勿重复点击。</div>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function showPlanGenerationProgress(modeLabel = '生成方案') {
    const overlay = ensurePlanGenerationProgressOverlay();
    const kicker = overlay.querySelector('.pgp-kicker');
    if (kicker) kicker.textContent = `正在${modeLabel}`;
    overlay.classList.add('active');
    setPlanGenerationProgress(0, '准备计算');
}

function setPlanGenerationProgress(value, title) {
    const overlay = ensurePlanGenerationProgressOverlay();
    const pct = Math.max(0, Math.min(100, Math.round(value || 0)));
    const percentEl = overlay.querySelector('#pgp-percent');
    const fillEl = overlay.querySelector('#pgp-bar-fill');
    const titleEl = overlay.querySelector('#pgp-title');
    if (percentEl) percentEl.textContent = `${pct}%`;
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (titleEl && title) titleEl.textContent = title;

    const stepKey = pct >= 100 ? 'done' : pct >= 70 ? 'render' : pct >= 22 ? 'pack' : 'read';
    const order = ['read', 'pack', 'render', 'done'];
    overlay.querySelectorAll('.pgp-steps span').forEach(step => {
        const key = step.getAttribute('data-step');
        step.classList.toggle('active', order.indexOf(key) <= order.indexOf(stepKey));
    });
}

function hidePlanGenerationProgress() {
    const overlay = document.getElementById('plan-generation-progress-overlay');
    if (overlay) overlay.classList.remove('active');
}

function setGenerateButtonBusy(isBusy) {
    const btn = document.getElementById('btn-generate-plan');
    if (!btn) return;
    btn.disabled = !!isBusy;
    btn.classList.toggle('is-generating', !!isBusy);
    if (isBusy) {
        btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
        btn.textContent = '生成中…';
    } else if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
    }
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

// ==================== PLACEMENT EDIT MODE V1 ====================
let placementEditModeActive = false;
let placementEditSelectedItemId = null;
let placementEditStepMm = 10;
let placementEditPointerDown = null;
let placementEditDirty = false;
let placementEditControlsSnapshot = null;
let placementEditSessionSnapshot = null;
let placementEditSavedInSession = false;
let placementEditOriginalStateByKey = new Map();
let placementEditPreviousRightTab = 'analysis';

function getPlacementSnapshotKey(furnaceIndex, itemId) {
    return String(furnaceIndex) + '::' + String(itemId || '');
}

function getCurrentPlacementFurnace() {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return null;
    const idx = Math.max(0, Math.min(currentFurnaceIndex || 0, globalFurnacesResult.length - 1));
    return globalFurnacesResult[idx] || null;
}

function getPlacementItemById(itemId) {
    const furnace = getCurrentPlacementFurnace();
    if (!furnace || !itemId) return null;
    return (furnace.packedItems || []).find(item => String(item.id || item.itemId) === String(itemId)) || null;
}

function getPlacementItemLayer(item, furnace) {
    if (!item || !furnace) return 1;
    if (typeof item.layer === 'number' && item.layer >= 1) return Math.round(item.layer);

    const shelves = Array.isArray(furnace.shelvesUsed)
        ? [...furnace.shelvesUsed].sort((a, b) => Number(a.y || 0) - Number(b.y || 0))
        : [];
    let layer = 1;
    shelves.forEach(shelf => {
        if (Number(item.y || 0) >= Number(shelf.y || 0)) layer += 1;
    });
    return layer;
}


function serializePlacementItemState(item) {
    if (!item) return null;
    return {
        x: Number(item.x || 0),
        y: Number(item.y || 0),
        z: Number(item.z || 0),
        w: Number(item.w || 0),
        h: Number(item.h || 0),
        d: Number(item.d || 0),
        rotation: Number(item.rotation || item.manualRotation || 0),
        manualRotation: Number(item.manualRotation || item.rotation || 0),
        verticalRotation: Number(item.verticalRotation || 0),
        needsRotation: !!item.needsRotation,
        pdfFootprintW: item.pdfFootprintW,
        pdfFootprintD: item.pdfFootprintD,
        pdfPosture: item.pdfPosture,
        pdfRotationAxis: item.pdfRotationAxis,
        locked: !!item.locked,
        manualMoved: !!item.manualMoved,
        finalEdited: !!item.finalEdited
    };
}

function applyPlacementItemState(item, state) {
    if (!item || !state) return;
    item.x = state.x;
    item.y = state.y;
    item.z = state.z;
    item.w = state.w;
    item.h = state.h;
    item.d = state.d;
    item.rotation = state.rotation;
    item.manualRotation = state.manualRotation;
    item.verticalRotation = state.verticalRotation;
    item.needsRotation = state.needsRotation;
    item.pdfFootprintW = state.pdfFootprintW;
    item.pdfFootprintD = state.pdfFootprintD;
    item.pdfPosture = state.pdfPosture;
    item.pdfRotationAxis = state.pdfRotationAxis;
    item.locked = state.locked;
    item.manualMoved = state.manualMoved;
    item.finalEdited = state.finalEdited;
}

function capturePlacementEditSessionSnapshot() {
    const snapshot = [];
    placementEditOriginalStateByKey = new Map();
    (globalFurnacesResult || []).forEach((furnace, furnaceIndex) => {
        (furnace.packedItems || []).forEach(item => {
            const itemId = String(item.id || item.itemId || '');
            if (!itemId) return;
            const state = serializePlacementItemState(item);
            const key = getPlacementSnapshotKey(furnaceIndex, itemId);
            snapshot.push({ furnaceIndex, itemId, state: { ...state }, itemRef: item });
            placementEditOriginalStateByKey.set(key, { ...state });
            // 进入编辑时即记录当前 AI / 最终方案原始位置，供“恢复 AI 位置”和“不保存退出”使用。
            item.aiOriginalPosition = { ...state };
        });
    });
    return snapshot;
}

function restorePlacementEditSessionSnapshot() {
    if (!placementEditSessionSnapshot || !Array.isArray(placementEditSessionSnapshot)) return false;
    placementEditSessionSnapshot.forEach(entry => {
        const target = entry.itemRef || (() => {
            const furnace = globalFurnacesResult?.[entry.furnaceIndex];
            if (!furnace) return null;
            return (furnace.packedItems || []).find(it => String(it.id || it.itemId || '') === String(entry.itemId)) || null;
        })();
        if (target) applyPlacementItemState(target, entry.state);
    });
    return true;
}

function getPlacementOriginalStateForItem(item, furnaceIndex = currentFurnaceIndex) {
    if (!item) return null;
    const itemId = String(item.id || item.itemId || '');
    const key = getPlacementSnapshotKey(furnaceIndex, itemId);
    return placementEditOriginalStateByKey.get(key) || item.aiOriginalPosition || null;
}

function showPlacementEditStatus(level, message) {
    const statusEl = document.getElementById('pep-status');
    if (!statusEl) return;
    statusEl.className = `pep-status ${level || ''}`;
    statusEl.textContent = message || '';
}

function syncPlacementEditEntryButtons() {
    const active = !!placementEditModeActive;
    const dockBtn = document.getElementById('dock-placement-edit');
    if (dockBtn) {
        dockBtn.classList.toggle('active', active);
        dockBtn.title = active ? '退出人工摆放编辑' : '进入人工摆放编辑';
        const label = dockBtn.querySelector('.dock-label');
        const icon = dockBtn.querySelector('.dock-icon');
        if (label) label.textContent = active ? '退出' : '编辑';
        if (icon) icon.textContent = active ? '✓' : '✋';
    }

    // 旧 HUD 内按钮保留事件兼容，但不再作为主入口显示。
    const hudBtn = document.getElementById('btn-placement-edit');
    if (hudBtn) {
        hudBtn.classList.toggle('active', active);
        hudBtn.textContent = active ? '退出编辑' : '编辑摆放';
        hudBtn.setAttribute('aria-hidden', 'true');
        hudBtn.tabIndex = -1;
    }
}

function ensurePlacementOriginal(item) {
    if (!item) return;
    if (!item.aiOriginalPosition) {
        item.aiOriginalPosition = serializePlacementItemState(item);
    }
}


function getPlacementLayerVerticalLimit(item, furnace) {
    const fh = Number(furnace?.h || 0);
    const y = Number(item?.y || 0);
    const shelves = Array.isArray(furnace?.shelvesUsed)
        ? [...furnace.shelvesUsed].sort((a, b) => Number(a.y || 0) - Number(b.y || 0))
        : [];
    let lower = 0;
    let upper = fh;
    for (const shelf of shelves) {
        const sy = Number(shelf.y || 0);
        if (sy <= y + 0.5) {
            lower = Math.max(lower, sy + Number(shelf.thickness || placementRules.shelfThickness || 20));
        } else {
            upper = Math.min(upper, sy);
            break;
        }
    }
    return { lower, upper, heightLimit: Math.max(0, upper - y) };
}

function getPlacementValidation(item, furnace) {

    if (!item || !furnace) {
        return { level: 'warn', message: '请选择一个工件。' };
    }

    const spacing = Number(placementRules.minSpacing ?? 5) || 5;
    const issues = [];

    const x = Number(item.x || 0);
    const y = Number(item.y || 0);
    const z = Number(item.z || 0);
    const w = Number(item.w || 0);
    const h = Number(item.h || 0);
    const d = Number(item.d || 0);
    const fw = Number(furnace.w || 0);
    const fh = Number(furnace.h || 0);
    const fd = Number(furnace.d || 0);

    if (x < 0 || z < 0 || y < 0 || x + w > fw || z + d > fd || y + h > fh) {
        issues.push('超出工装边界');
    }

    const verticalLimit = getPlacementLayerVerticalLimit(item, furnace);
    if (verticalLimit.upper > 0 && y + h > verticalLimit.upper + 0.5) {
        issues.push(`高度超出当前层限制，可用 ${Math.max(0, verticalLimit.heightLimit).toFixed(0)}mm`);
    }

    if ((furnace.toolingType === 'ring-tooling' || furnace.basketType === 'ringnode') && fw > 0 && fd > 0) {
        const params = furnace.params || {};
        const outerRadius = Number(params.outerRadius || params.radialRadius || Math.min(fw, fd) / 2);
        const innerRadius = Number(params.centerVoidRadius || params.innerRadius || (params.innerDia ? params.innerDia / 2 : 0) || 0);
        const cx = x + w / 2 - fw / 2;
        const cz = z + d / 2 - fd / 2;
        const itemRadius = Math.sqrt((w / 2) * (w / 2) + (d / 2) * (d / 2));
        const centerDist = Math.sqrt(cx * cx + cz * cz);
        if (centerDist + itemRadius > outerRadius + 0.5) issues.push('超出环形外圈');
        if (innerRadius > 0 && centerDist - itemRadius < innerRadius - 0.5) issues.push('进入中心避让区');
    }

    const sameLayer = getPlacementItemLayer(item, furnace);
    const expanded = {
        x1: x - spacing,
        x2: x + w + spacing,
        z1: z - spacing,
        z2: z + d + spacing,
        y1: y - 1,
        y2: y + h + 1
    };

    const collision = (furnace.packedItems || []).find(other => {
        if (!other || other === item) return false;
        if (String(other.id || other.itemId) === String(item.id || item.itemId)) return false;
        if (getPlacementItemLayer(other, furnace) !== sameLayer) return false;

        const ox = Number(other.x || 0);
        const oy = Number(other.y || 0);
        const oz = Number(other.z || 0);
        const ow = Number(other.w || 0);
        const oh = Number(other.h || 0);
        const od = Number(other.d || 0);

        const yOverlap = expanded.y1 < oy + oh && expanded.y2 > oy;
        const xOverlap = expanded.x1 < ox + ow && expanded.x2 > ox;
        const zOverlap = expanded.z1 < oz + od && expanded.z2 > oz;
        return yOverlap && xOverlap && zOverlap;
    });

    if (collision) {
        issues.push(`与 ${collision.name || collision.id || '其它工件'} 间距不足`);
    }

    if (issues.length > 0) {
        return { level: 'danger', message: '存在风险：' + issues.join('；') };
    }

    return { level: 'ok', message: `可执行 · 已按全局安全间距 ${spacing}mm 校验` };
}

function formatPlacementCoord(item) {
    if (!item) return '-';
    return `X ${Number(item.x || 0).toFixed(0)} / Y ${Number(item.y || 0).toFixed(0)} / Z ${Number(item.z || 0).toFixed(0)} mm`;
}

function getActiveRightPanelTabKey() {
    return document.querySelector('.right-tab-btn.active')?.getAttribute('data-tab') || 'analysis';
}

function ensurePlacementEditRightPanel() {
    const tabs = document.querySelector('.right-panel-tabs');
    const rightPanel = document.getElementById('right-panel');
    if (!tabs || !rightPanel) return null;

    let tabBtn = document.querySelector('.right-tab-btn[data-tab="placement-edit"]');
    if (!tabBtn) {
        tabBtn = document.createElement('button');
        tabBtn.className = 'right-tab-btn placement-edit-tab';
        tabBtn.type = 'button';
        tabBtn.setAttribute('data-tab', 'placement-edit');
        tabBtn.textContent = '摆放编辑';
        tabs.appendChild(tabBtn);
    }

    let pane = document.getElementById('right-tab-placement-edit');
    if (!pane) {
        pane = document.createElement('div');
        pane.className = 'right-tab-pane placement-edit-workbench-pane';
        pane.id = 'right-tab-placement-edit';
        rightPanel.appendChild(pane);
    }

    const panel = document.getElementById('placement-edit-panel');
    if (panel && panel.parentElement !== pane) {
        pane.appendChild(panel);
    }
    if (panel) {
        panel.classList.remove('pep-bottom-ribbon', 'pep-mini', 'pep-dragging');
        panel.classList.add('pep-side-panel');
        panel.style.left = '';
        panel.style.top = '';
        panel.style.right = '';
        panel.style.bottom = '';
        panel.style.width = '';
    }

    if (pane) {
        // V0.7.29：快捷键说明不再以折叠卡片插在控制区内，避免遮挡“锁定/还原/保存”。
        const shortcuts = document.getElementById('pep-shortcuts-card');
        if (shortcuts) shortcuts.remove();
    }

    return pane;
}

function updatePlacementEditPanel(selection) {
    updatePlacementLayerControls();
    const empty = document.getElementById('pep-empty');
    const body = document.getElementById('pep-body');
    const nameEl = document.getElementById('pep-item-name');
    const metaEl = document.getElementById('pep-item-meta');
    const coordsEl = document.getElementById('pep-item-coords');
    const statusEl = document.getElementById('pep-status');
    const lockBtn = document.getElementById('pep-lock-btn');

    const item = selection?.item || getPlacementItemById(placementEditSelectedItemId);
    const furnace = getCurrentPlacementFurnace();
    const panel = document.getElementById('placement-edit-panel');

    if (!item) {
        if (panel) panel.classList.remove('pep-has-selection');
        if (empty) empty.style.display = 'block';
        if (body) body.style.display = 'none';
        if (statusEl) {
            statusEl.className = 'pep-status';
            statusEl.textContent = '等待选择工件';
        }
        return;
    }

    if (panel) panel.classList.add('pep-has-selection');
    if (empty) empty.style.display = 'none';
    if (body) body.style.display = 'grid';

    const layer = getPlacementItemLayer(item, furnace);
    if (nameEl) nameEl.textContent = item.name || item.showName || item.id || '未命名工件';
    if (metaEl) {
        const size = `${Number(item.w || 0).toFixed(0)}×${Number(item.h || 0).toFixed(0)}×${Number(item.d || 0).toFixed(0)} mm`;
        metaEl.textContent = `编号：${item.id || '-'} · 第 ${layer} 层 · 尺寸 ${size}`;
    }
    if (coordsEl) coordsEl.textContent = formatPlacementCoord(item);

    const validation = getPlacementValidation(item, furnace);
    if (statusEl) {
        statusEl.className = `pep-status ${validation.level}`;
        statusEl.textContent = validation.message + (item.locked ? ' · 已锁定' : '');
    }
    if (lockBtn) lockBtn.textContent = item.locked ? '解锁' : '锁定';
}


function updatePlacementLayerControls() {
    const layerLabel = document.getElementById('pep-layer-label');
    const layerMode = document.getElementById('pep-layer-mode');
    const prevBtn = document.getElementById('pep-layer-prev');
    const nextBtn = document.getElementById('pep-layer-next');
    const currentBtn = document.getElementById('pep-layer-current');
    const allBtn = document.getElementById('pep-layer-all');

    const state = typeof getPlacementEditLayerState === 'function'
        ? getPlacementEditLayerState()
        : { layers: [1], activeLayer: 1, showAllLayers: false, activeIndex: 0, layerCount: 1 };

    const layerCount = state.layerCount || state.layers?.length || 1;
    const activeLayer = state.activeLayer || 1;
    const activeIndex = Math.max(0, state.activeIndex || 0);

    if (layerLabel) {
        layerLabel.textContent = state.showAllLayers
            ? `全层参考 · 共 ${layerCount} 层`
            : `第 ${activeLayer} / ${layerCount} 层`;
    }
    if (layerMode) {
        layerMode.textContent = state.showAllLayers
            ? '全层参考中，移动前建议切回仅本层。'
            : '仅本层编辑，避免层间遮挡。';
    }
    if (prevBtn) prevBtn.disabled = state.showAllLayers || activeIndex <= 0;
    if (nextBtn) nextBtn.disabled = state.showAllLayers || activeIndex >= layerCount - 1;
    if (currentBtn) currentBtn.classList.toggle('active', !state.showAllLayers);
    if (allBtn) allBtn.classList.toggle('active', !!state.showAllLayers);
}

function setPlacementEditStep(step, silent = false) {
    const normalized = Number(step) || 10;
    placementEditStepMm = normalized;
    document.querySelectorAll('.pep-step-btn').forEach(btn => {
        btn.classList.toggle('active', Number(btn.getAttribute('data-step')) === normalized);
    });
    if (!silent) showPlacementEditStatus('ok', `移动步长已切换为 ${normalized}mm。`);
}

function setPlacementPointerEventConsumed(event) {
    if (!event) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
}

function applyPlacementEditControlsLock() {
    if (!controls) return;
    if (!placementEditControlsSnapshot) {
        placementEditControlsSnapshot = {
            enabled: controls.enabled,
            enableRotate: controls.enableRotate,
            enablePan: controls.enablePan,
            enableZoom: controls.enableZoom,
            mouseButtons: controls.mouseButtons ? { ...controls.mouseButtons } : null,
            touches: controls.touches ? { ...controls.touches } : null
        };
    }

    // 编辑摆放是“图纸操作模式”：锁定旋转/平移，保留滚轮缩放。
    controls.enabled = true;
    controls.enableRotate = false;
    controls.enablePan = false;
    controls.enableZoom = true;
    if (controls.mouseButtons && THREE?.MOUSE) {
        controls.mouseButtons.LEFT = null;
        controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
        controls.mouseButtons.RIGHT = null;
    }
    if (controls.touches && THREE?.TOUCH) {
        controls.touches.ONE = null;
        controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    }
    controls.update?.();
}

function restorePlacementEditControlsLock() {
    if (!controls || !placementEditControlsSnapshot) return;
    controls.enabled = placementEditControlsSnapshot.enabled;
    controls.enableRotate = placementEditControlsSnapshot.enableRotate;
    controls.enablePan = placementEditControlsSnapshot.enablePan;
    controls.enableZoom = placementEditControlsSnapshot.enableZoom;
    if (placementEditControlsSnapshot.mouseButtons && controls.mouseButtons) {
        controls.mouseButtons = { ...placementEditControlsSnapshot.mouseButtons };
    }
    if (placementEditControlsSnapshot.touches && controls.touches) {
        controls.touches = { ...placementEditControlsSnapshot.touches };
    }
    placementEditControlsSnapshot = null;
    controls.update?.();
}

function setPlacementEditModeActive(active) {
    const nextActive = !!active;
    const wasActive = placementEditModeActive;

    // 退出编辑模式：先关闭编辑态和视觉过滤，再根据是否保存决定还原。
    if (wasActive && !nextActive) {
        const shouldRestore = placementEditDirty && !placementEditSavedInSession;

        placementEditModeActive = false;
        document.body.classList.remove('placement-edit-mode');

        const panel = document.getElementById('placement-edit-panel');
        const btn = document.getElementById('btn-placement-edit');
        if (panel) panel.style.display = 'none';
        if (getActiveRightPanelTabKey() === 'placement-edit') {
            activateRightPanelTab(placementEditPreviousRightTab || 'analysis');
        }
        if (btn) {
            btn.classList.remove('active');
            btn.textContent = '编辑摆放';
        }
        syncPlacementEditEntryButtons();

        setPlacementEditMode(false);
        restorePlacementEditControlsLock();
        placementEditPointerDown = null;
        placementEditSelectedItemId = null;

        if (shouldRestore) {
            restorePlacementEditSessionSnapshot();
            placementEditDirty = false;
            // V1.6: 强制重建 3D 场景，避免直接移动过的 Mesh 保留旧位置。
            forceRebuildPlacementVisualScene();
            if (typeof showCapacityFeedback === 'function') {
                showCapacityFeedback('success', '已退出编辑，未保存的移动/旋转已自动还原，3D 视图已同步。');
            }
        }

        updatePlacementLayerControls();
        updatePlacementEditPanel(null);
        placementEditSessionSnapshot = null;
        placementEditSavedInSession = false;
        return;
    }

    placementEditModeActive = nextActive;
    document.body.classList.toggle('placement-edit-mode', placementEditModeActive);
    ensurePlacementEditRightPanel();
    const panel = document.getElementById('placement-edit-panel');
    const btn = document.getElementById('btn-placement-edit');
    if (panel) panel.style.display = placementEditModeActive ? 'block' : 'none';
    if (placementEditModeActive) {
        const currentTab = getActiveRightPanelTabKey();
        if (currentTab !== 'placement-edit') placementEditPreviousRightTab = currentTab || 'analysis';
        if (typeof expandRightPanel === 'function') expandRightPanel();
        activateRightPanelTab('placement-edit');
    }
    if (btn) {
        btn.classList.toggle('active', placementEditModeActive);
        btn.textContent = placementEditModeActive ? '退出编辑' : '编辑摆放';
    }
    syncPlacementEditEntryButtons();

    if (placementEditModeActive) {
        suspendProcessSimulationForPlacementEdit();
    }

    setPlacementEditMode(placementEditModeActive);
    updatePlacementLayerControls();

    if (placementEditModeActive) {
        placementEditSessionSnapshot = capturePlacementEditSessionSnapshot();
        placementEditDirty = false;
        placementEditSavedInSession = false;
        applyPlacementEditControlsLock();
        if (typeof focusPlacementEditTopView === 'function') {
            focusPlacementEditTopView();
        } else if (typeof setTightFitCamera === 'function') {
            setTightFitCamera(new THREE.Vector3(0, 1, 0), 0.08);
        }
        document.getElementById('dock-top-view')?.classList.add('active');
    }

    updatePlacementEditPanel(refreshPlacementEditSelection());
}

function selectPlacementEditSelection(selection) {
    placementEditSelectedItemId = selection?.itemId || null;
    if (selection?.item) ensurePlacementOriginal(selection.item);
    updatePlacementLayerControls();
    updatePlacementEditPanel(selection);
}

function forceRebuildPlacementVisualScene() {
    // V1.6: 直接移动 3D Mesh 后，数据还原并不会自动把已移动的 Mesh 拉回。
    // 因此需要清空 furnaceGroups，让 renderSingleFurnace 强制按 globalFurnacesResult 重建场景。
    clearFurnaceGroups();
    renderSingleFurnace(currentFurnaceIndex);
}

function rerenderPlacementEditScene() {
    const selectedId = placementEditSelectedItemId;
    forceRebuildPlacementVisualScene();
    if (selectedId) {
        const selection = selectPlacementEditItem(selectedId);
        selectPlacementEditSelection(selection);
    }
    updateCurrentToolingHud();
}

function suspendProcessSimulationForPlacementEdit() {
    // V1.6: 编辑摆放不能和热场/辐射/气流等仿真图层同时叠加。
    // 否则会出现“数据已还原，但仿真/展示层仍停留在旧位置”的双数据视觉错觉。
    try {
        clearThermalSimulationLayer();
        processSimulationActive = false;
        processSimulationMode = 'idle';
        renderThermalSimulationPanel(null, 'idle');
        syncThermalControlState(null);
        updateSimulationModeButtons();
    } catch (err) {
        console.warn('[placement-edit] failed to suspend process simulation', err);
    }
}


function placementRectIntersectsCircle(rect, cx, cz, radius) {
    const nearestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const nearestZ = Math.max(rect.z, Math.min(cz, rect.z + rect.d));
    const dx = nearestX - cx;
    const dz = nearestZ - cz;
    return dx * dx + dz * dz <= radius * radius;
}

function placementItemWouldHitTrayCornerPost(item, nextX, nextZ, nextW = null, nextD = null) {
    const furnace = getCurrentPlacementFurnace?.();
    const blockers = Array.isArray(furnace?.trayCornerPostBlockers) ? furnace.trayCornerPostBlockers : [];
    if (!item || blockers.length === 0) return false;
    const rect = {
        x: Number(nextX || 0),
        z: Number(nextZ || 0),
        w: Number(nextW ?? item.w ?? 0),
        d: Number(nextD ?? item.d ?? 0)
    };
    if (rect.w <= 0 || rect.d <= 0) return false;
    return blockers.some(blocker => {
        if (blocker.type !== 'circle-post') return false;
        return placementRectIntersectsCircle(rect, Number(blocker.x || 0), Number(blocker.z || 0), Number(blocker.radius || 0));
    });
}

function rejectTrayCornerPostEdit() {
    showPlacementEditStatus?.('danger', '该位置与料盘四角支撑杆冲突，已阻止移动。');
}

function movePlacementSelectedItem(dxStep, dzStep) {
    const item = getPlacementItemById(placementEditSelectedItemId);
    if (!item) return;
    if (item.locked) {
        updatePlacementEditPanel({ itemId: placementEditSelectedItemId, item });
        return;
    }

    ensurePlacementOriginal(item);
    const nextX = Number(item.x || 0) + Number(dxStep || 0) * placementEditStepMm;
    const nextZ = Number(item.z || 0) + Number(dzStep || 0) * placementEditStepMm;
    if (placementItemWouldHitTrayCornerPost(item, nextX, nextZ)) {
        rejectTrayCornerPostEdit();
        updatePlacementEditPanel({ itemId: placementEditSelectedItemId, item });
        return;
    }
    item.x = nextX;
    item.z = nextZ;
    item.manualMoved = true;
    item.finalEdited = true;
    placementEditDirty = true;

    // 直接更新当前 3D Mesh，避免整炉重建导致用户误以为按钮没有响应。
    // 如果找不到可更新对象，再回退到完整重渲染。
    if (typeof updatePlacementEditItemVisual === 'function' && updatePlacementEditItemVisual(placementEditSelectedItemId)) {
        updatePlacementEditPanel({ itemId: placementEditSelectedItemId, item });
    } else {
        rerenderPlacementEditScene();
    }
}


function rotatePlacementSelectedItem() {
    rotatePlacementSelectedItemHorizontal();
}

function getPlacementOriginalDims(item) {
    const raw = item?.originalDims || {};
    const l = Number(raw.l ?? raw.length ?? raw.dim1 ?? item?.w ?? 0);
    const w = Number(raw.w ?? raw.width ?? raw.dim2 ?? item?.d ?? 0);
    const h = Number(raw.h ?? raw.height ?? raw.dim3 ?? item?.h ?? 0);
    const vals = [l, w, h].filter(v => Number.isFinite(v) && v > 0);
    return { l, w, h, max: Math.max(...vals, 0), min: Math.min(...vals, 0) };
}

function rotatePlacementSelectedItemHorizontal() {
    const item = getPlacementItemById(placementEditSelectedItemId);
    if (!item) return;
    if (item.locked) {
        updatePlacementEditPanel({ itemId: placementEditSelectedItemId, item });
        return;
    }

    ensurePlacementOriginal(item);
    const cx = Number(item.x || 0) + Number(item.w || 0) / 2;
    const cz = Number(item.z || 0) + Number(item.d || 0) / 2;
    const oldW = Number(item.w || 0);
    const oldD = Number(item.d || 0);
    const nextW = oldD;
    const nextD = oldW;

    const nextX = cx - nextW / 2;
    const nextZ = cz - nextD / 2;
    if (placementItemWouldHitTrayCornerPost(item, nextX, nextZ, nextW, nextD)) {
        rejectTrayCornerPostEdit();
        return;
    }

    item.w = nextW;
    item.d = nextD;
    item.x = nextX;
    item.z = nextZ;
    item.manualRotation = ((Number(item.manualRotation || item.rotation || 0) + 90) % 360);
    item.rotation = item.manualRotation;
    item.rotationInfo = { ...(item.rotationInfo || {}), manualYawDeg: item.manualRotation };
    item.pdfFootprintW = item.w;
    item.pdfFootprintD = item.d;
    item.manualMoved = true;
    item.finalEdited = true;
    placementEditDirty = true;
    rerenderPlacementEditScene();
    focusPlacementEditTopView?.();
    if (Math.abs(oldW - oldD) < 0.5) {
        showPlacementEditStatus('warn', '已执行水平旋转，但该工件 X/Z 占地相同，俯视外观可能无明显变化。');
    }
}

function rotatePlacementSelectedItemVertical() {
    const item = getPlacementItemById(placementEditSelectedItemId);
    const furnace = getCurrentPlacementFurnace();
    if (!item || !furnace) return;
    if (item.locked) {
        updatePlacementEditPanel({ itemId: placementEditSelectedItemId, item });
        return;
    }

    ensurePlacementOriginal(item);

    const cx = Number(item.x || 0) + Number(item.w || 0) / 2;
    const cz = Number(item.z || 0) + Number(item.d || 0) / 2;
    let nextW = Number(item.w || 0);
    let nextH = Number(item.h || 0);
    let nextD = Number(item.d || 0);
    const dims = getPlacementOriginalDims(item);

    if (item.shape === 'cylinder' && dims.max > 0 && dims.min > 0) {
        const dia = dims.max;
        const thick = dims.min;
        const isSideStanding = Number(item.h || 0) > thick * 1.5;
        if (isSideStanding) {
            // 立放/侧放 → 平放：俯视为圆，Y 为厚度。
            nextW = dia;
            nextH = thick;
            nextD = dia;
            item.pdfPosture = 'flat';
            item.pdfRotationAxis = null;
        } else {
            // 平放 → 侧放：俯视为长胶囊/窄长占地，Y 为直径。
            nextW = thick;
            nextH = dia;
            nextD = dia;
            item.pdfPosture = 'side-standing';
            item.pdfRotationAxis = 'x';
        }
    } else {
        // 长方体：绕 X 轴翻转，交换 Y 高度与 Z 纵深。
        nextW = Number(item.w || 0);
        nextH = Number(item.d || 0);
        nextD = Number(item.h || 0);
        item.pdfPosture = 'vertical-rotated';
        item.pdfRotationAxis = 'x';
    }

    const limit = getPlacementLayerVerticalLimit({ ...item, h: nextH }, furnace);
    if (Number(item.y || 0) + nextH > limit.upper + 0.5) {
        showPlacementEditStatus('danger', `超高：旋转后高 ${nextH.toFixed(0)}mm，可用 ${limit.heightLimit.toFixed(0)}mm。`);
        return;
    }

    const nextX = cx - nextW / 2;
    const nextZ = cz - nextD / 2;
    if (placementItemWouldHitTrayCornerPost(item, nextX, nextZ, nextW, nextD)) {
        rejectTrayCornerPostEdit();
        return;
    }

    item.w = nextW;
    item.h = nextH;
    item.d = nextD;
    item.x = nextX;
    item.z = nextZ;
    item.verticalRotation = ((Number(item.verticalRotation || 0) + 90) % 180);
    item.rotationInfo = { ...(item.rotationInfo || {}), manualPitchDeg: item.verticalRotation };
    item.pdfFootprintW = item.w;
    item.pdfFootprintD = item.d;
    item.manualMoved = true;
    item.finalEdited = true;
    placementEditDirty = true;
    rerenderPlacementEditScene();
    focusPlacementEditTopView?.();
}

function togglePlacementLock() {
    const item = getPlacementItemById(placementEditSelectedItemId);
    if (!item) return;
    ensurePlacementOriginal(item);
    item.locked = !item.locked;
    item.finalEdited = true;
    placementEditDirty = true;
    updatePlacementEditPanel({ itemId: placementEditSelectedItemId, item });
}

function restorePlacementSelectedItem() {
    const item = getPlacementItemById(placementEditSelectedItemId);
    if (!item) return;
    const original = getPlacementOriginalStateForItem(item, currentFurnaceIndex);
    if (!original) {
        showPlacementEditStatus('warn', '未找到进入编辑前的位置快照，无法还原。');
        return;
    }
    applyPlacementItemState(item, original);
    item.manualMoved = false;
    item.finalEdited = false;
    placementEditDirty = true;
    rerenderPlacementEditScene();
    focusPlacementEditTopView?.();
    showPlacementEditStatus('ok', '已恢复到进入编辑前的位置。');
}

function savePlacementAdjustedPlan() {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;
    globalFurnacesResult.forEach(furnace => {
        (furnace.packedItems || []).forEach(item => {
            if (item.manualMoved || item.locked || item.finalEdited) {
                item.finalEdited = true;
                item.lastEditedAt = new Date().toISOString();
            }
        });
        furnace.finalEdited = true;
        furnace.lastEditedAt = new Date().toISOString();
    });
    placementEditSessionSnapshot = capturePlacementEditSessionSnapshot();
    placementEditDirty = false;
    placementEditSavedInSession = true;
    if (typeof showCapacityFeedback === 'function') {
        showCapacityFeedback('success', '✅ 已保存人工调整位置，后续打印方案将读取当前最终位置。');
    } else {
        alert('已保存人工调整位置');
    }
    refreshPlanLibraryWorkbench();
}

function isPlacementCanvasEventTarget(event) {
    const container = document.getElementById('canvas-container');
    if (!container || !event.target || !container.contains(event.target)) return false;
    if (event.target.closest('#current-tooling-hud, #placement-edit-panel, #empty-state, #furnace-thumb-bar, #three-dock, .view-dock, .current-tooling-hud')) {
        return false;
    }
    return true;
}


function setupPlacementEditPanelFloating() {
    // V0.7.27：人工调整改为右侧“摆放编辑”工作台，不再放在 3D 画面底部。
    ensurePlacementEditRightPanel();
    const panel = document.getElementById('placement-edit-panel');
    if (!panel) return;

    panel.classList.remove('pep-bottom-ribbon', 'pep-mini', 'pep-dragging');
    panel.classList.add('pep-side-panel');
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';

    const header = panel.querySelector('.pep-header');
    if (header) {
        header.classList.remove('pep-drag-handle');
        header.title = '';
    }

    // 清理 V0.7.22 悬浮面板临时按钮，避免刷新后旧样式残留。
    ['pep-mini-toggle', 'pep-reset-position'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });

    if (panel.dataset.sideWorkbenchSetup === '1') return;
    panel.dataset.sideWorkbenchSetup = '1';

    const closeBtn = document.getElementById('pep-close');
    if (closeBtn) {
        closeBtn.textContent = '退出编辑';
        closeBtn.title = '退出人工调整模式';
    }

    const title = panel.querySelector('.pep-title');
    const kicker = panel.querySelector('.pep-kicker');
    if (title) title.textContent = '摆放编辑';
    if (kicker) kicker.textContent = '方向键移动 · R旋转 · S保存 · Esc退出';

    // V0.7.30：保存按钮移到标题栏，右侧面板底部不再出现 sticky 保存条，避免遮挡上/下方内容。
    const saveRow = document.querySelector('#placement-edit-panel .pep-save-row');
    if (header && saveRow && saveRow.parentElement !== header) {
        saveRow.classList.add('pep-save-in-header');
        header.appendChild(saveRow);
    }
    const saveBtn = document.getElementById('pep-save-plan');
    if (saveBtn) saveBtn.textContent = '保存';

    const textMap = {
        'pep-layer-prev': '上',
        'pep-layer-next': '下',
        'pep-layer-current': '本层',
        'pep-layer-all': '全层',
        'pep-save-plan': '保存'
    };
    Object.entries(textMap).forEach(([id, text]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    });

    panel.querySelectorAll('[data-edit-action="move"]').forEach(btn => {
        const dx = Number(btn.getAttribute('data-dx')) || 0;
        const dz = Number(btn.getAttribute('data-dz')) || 0;
        if (dz < 0) btn.textContent = '前';
        else if (dz > 0) btn.textContent = '后';
        else if (dx < 0) btn.textContent = '左';
        else if (dx > 0) btn.textContent = '右';
    });
    const rotateH = panel.querySelector('[data-edit-action="rotate-horizontal"]');
    const rotateV = panel.querySelector('[data-edit-action="rotate-vertical"]');
    const restore = panel.querySelector('[data-edit-action="restore"]');
    if (rotateH) rotateH.textContent = '水平';
    if (rotateV) rotateV.textContent = '立放';
    if (restore) restore.textContent = '还原';

    const empty = document.getElementById('pep-empty');
    if (empty) empty.textContent = '点选 3D 工件后，使用方向键或右侧按钮微调；相机已锁定，保留滚轮缩放。';
}

function isPlacementEditTypingTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function handlePlacementEditKeyboard(event) {
    if (!placementEditModeActive) return;
    if (isPlacementEditTypingTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    let handled = true;
    const key = event.key;
    const keyLower = String(key || '').toLowerCase();
    const multiplier = event.shiftKey ? 5 : 1;

    if (key === 'ArrowUp') movePlacementSelectedItem(0, -1 * multiplier);
    else if (key === 'ArrowDown') movePlacementSelectedItem(0, 1 * multiplier);
    else if (key === 'ArrowLeft') movePlacementSelectedItem(-1 * multiplier, 0);
    else if (key === 'ArrowRight') movePlacementSelectedItem(1 * multiplier, 0);
    else if (keyLower === 'r') rotatePlacementSelectedItemHorizontal();
    else if (keyLower === 'v') rotatePlacementSelectedItemVertical();
    else if (keyLower === 'l') togglePlacementLock();
    else if (keyLower === 'z') restorePlacementSelectedItem();
    else if (keyLower === 's') savePlacementAdjustedPlan();
    else if (key === 'Escape') setPlacementEditModeActive(false);
    else if (key === '1') setPlacementEditStep(10);
    else if (key === '2') setPlacementEditStep(20);
    else if (key === '3') setPlacementEditStep(50);
    else if (key === '[') {
        if (typeof stepPlacementEditActiveLayer === 'function') stepPlacementEditActiveLayer(-1);
        placementEditSelectedItemId = null;
        updatePlacementEditPanel(null);
    } else if (key === ']') {
        if (typeof stepPlacementEditActiveLayer === 'function') stepPlacementEditActiveLayer(1);
        placementEditSelectedItemId = null;
        updatePlacementEditPanel(null);
    } else if (keyLower === 'a') {
        if (typeof setPlacementEditShowAllLayers === 'function') setPlacementEditShowAllLayers(true);
        updatePlacementEditPanel(refreshPlacementEditSelection());
    } else if (keyLower === 'c') {
        if (typeof setPlacementEditShowAllLayers === 'function') setPlacementEditShowAllLayers(false);
        updatePlacementEditPanel(refreshPlacementEditSelection());
    } else {
        handled = false;
    }

    if (handled) {
        event.preventDefault();
        event.stopPropagation();
    }
}

function bindPlacementEditMode() {
    setupPlacementEditPanelFloating();
    if (!window.__placementEditKeyboardBound) {
        window.__placementEditKeyboardBound = true;
        document.addEventListener('keydown', handlePlacementEditKeyboard, true);
    }
    const btn = document.getElementById('btn-placement-edit');
    if (btn) btn.addEventListener('click', () => {
        if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;
        setPlacementEditModeActive(!placementEditModeActive);
    });

    const close = document.getElementById('pep-close');
    if (close) close.addEventListener('click', () => setPlacementEditModeActive(false));

    document.querySelectorAll('.pep-step-btn').forEach(stepBtn => {
        stepBtn.addEventListener('click', () => {
            setPlacementEditStep(Number(stepBtn.getAttribute('data-step')) || 10, true);
        });
    });

    const panel = document.getElementById('placement-edit-panel');
    if (panel) {
        panel.addEventListener('click', (event) => {
            const actionBtn = event.target.closest('[data-edit-action]');
            if (actionBtn) {
                event.preventDefault();
                event.stopPropagation();
            }
            if (!actionBtn) return;
            const action = actionBtn.getAttribute('data-edit-action');
            if (action === 'move') {
                movePlacementSelectedItem(
                    Number(actionBtn.getAttribute('data-dx')) || 0,
                    Number(actionBtn.getAttribute('data-dz')) || 0
                );
            } else if (action === 'rotate' || action === 'rotate-horizontal') {
                rotatePlacementSelectedItemHorizontal();
            } else if (action === 'rotate-vertical') {
                rotatePlacementSelectedItemVertical();
            } else if (action === 'lock') {
                togglePlacementLock();
            } else if (action === 'restore') {
                restorePlacementSelectedItem();
            } else if (action === 'prev-layer') {
                if (typeof stepPlacementEditActiveLayer === 'function') stepPlacementEditActiveLayer(-1);
                placementEditSelectedItemId = null;
                updatePlacementEditPanel(null);
            } else if (action === 'next-layer') {
                if (typeof stepPlacementEditActiveLayer === 'function') stepPlacementEditActiveLayer(1);
                placementEditSelectedItemId = null;
                updatePlacementEditPanel(null);
            } else if (action === 'show-layer') {
                if (typeof setPlacementEditShowAllLayers === 'function') setPlacementEditShowAllLayers(false);
                updatePlacementEditPanel(refreshPlacementEditSelection());
            } else if (action === 'show-all') {
                if (typeof setPlacementEditShowAllLayers === 'function') setPlacementEditShowAllLayers(true);
                updatePlacementEditPanel(refreshPlacementEditSelection());
            }
        });
    }

    const saveBtn = document.getElementById('pep-save-plan');
    if (saveBtn) saveBtn.addEventListener('click', savePlacementAdjustedPlan);

    const container = document.getElementById('canvas-container');
    if (!container || container.dataset.placementEditBound === '1') return;
    container.dataset.placementEditBound = '1';

    container.addEventListener('pointerdown', (event) => {
        if (!placementEditModeActive || !isPlacementCanvasEventTarget(event)) return;
        placementEditPointerDown = {
            x: event.clientX,
            y: event.clientY,
            t: performance.now()
        };
        // 阻止 OrbitControls 在编辑模式下接管拖动。
        setPlacementPointerEventConsumed(event);
    }, true);

    container.addEventListener('pointermove', (event) => {
        if (!placementEditModeActive || !isPlacementCanvasEventTarget(event)) return;
        // 编辑模式只允许按钮微调，鼠标移动不改变相机。
        setPlacementPointerEventConsumed(event);
    }, true);

    container.addEventListener('pointerup', (event) => {
        if (!placementEditModeActive || !placementEditPointerDown || !isPlacementCanvasEventTarget(event)) return;
        const dx = event.clientX - placementEditPointerDown.x;
        const dy = event.clientY - placementEditPointerDown.y;
        const dt = performance.now() - placementEditPointerDown.t;
        placementEditPointerDown = null;

        setPlacementPointerEventConsumed(event);

        if (Math.sqrt(dx * dx + dy * dy) > 6 || dt > 600) return;

        const selection = selectPlacementEditItemAtClientPoint(event.clientX, event.clientY);
        selectPlacementEditSelection(selection);
    }, true);

    container.addEventListener('pointercancel', () => {
        if (!placementEditModeActive) return;
        placementEditPointerDown = null;
    }, true);
}

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
    if (dockRotate90) {
        // 45° 视角旋转已经覆盖微调查看需求，移除旧 90° 旋转按钮，避免工具栏重复。
        try { dockRotate90.remove(); } catch (_) { dockRotate90.style.display = 'none'; }
    }
    const dockExplode = document.getElementById('dock-explode');
    // const dockGravity = document.getElementById('dock-gravity');
    const dockThermal = document.getElementById('dock-thermal');

    function ensureDockButton(id, iconText, labelText, titleText, insertAfterEl) {
        let btn = document.getElementById(id);
        if (btn) return btn;
        btn = document.createElement('button');
        btn.className = 'dock-btn';
        btn.id = id;
        btn.type = 'button';
        btn.title = titleText || labelText;
        btn.innerHTML = `<span class="dock-icon">${iconText}</span><span class="dock-label">${labelText}</span>`;
        if (insertAfterEl && insertAfterEl.parentNode) {
            insertAfterEl.insertAdjacentElement('afterend', btn);
        } else {
            document.getElementById('dock-bar')?.appendChild(btn);
        }
        return btn;
    }

    const dockRotate45 = ensureDockButton('dock-rotate-45', '↺', '45°', '绕当前工装中心旋转 45°', dockSideView || dockFrontView || dockTopView);
    const dockCenterView = ensureDockButton('dock-center-view', '◎', '居中', '将当前工装重新居中到画面', dockRotate45);
    const dockPlacementEdit = ensureDockButton('dock-placement-edit', '✋', '编辑', '进入/退出人工摆放编辑', dockCenterView);
    if (dockPlacementEdit) dockPlacementEdit.classList.add('placement-edit-dock-btn');
    const dockExplodeVertical = ensureDockButton('dock-explode-vertical', '↕', '纵爆', '垂直方向爆炸图 / 再次点击关闭', dockExplode);
    const dockExplodeHorizontal = ensureDockButton('dock-explode-horizontal', '↔', '横爆', '水平方向爆炸图 / 再次点击关闭', dockExplodeVertical);
    if (dockExplode) {
        // UX V2.8：旧“爆炸”循环按钮不再需要，只保留“纵爆 / 横爆”两个明确按钮。
        dockExplode.style.display = 'none';
        dockExplode.setAttribute('aria-hidden', 'true');
        try { dockExplode.remove(); } catch (_) {}
    }

    if (dockTopView) {
        dockTopView.addEventListener('click', () => {
            setTightFitCamera(new THREE.Vector3(0, 1, 0));
            highlightDockBtn(dockTopView);
        });
    }
    function getCurrentCameraDirectionFallback() {
        if (!camera || !controls) return new THREE.Vector3(1, 0.55, 1).normalize();
        const offset = camera.position.clone().sub(controls.target);
        if (offset.lengthSq() < 0.0001) return new THREE.Vector3(1, 0.55, 1).normalize();
        return offset.normalize();
    }

    function rotateCurrentViewByAngle(angleRad) {
        if (!camera || !controls) {
            setTightFitCamera(new THREE.Vector3(1, 0, 0));
            return;
        }

        const dir = getCurrentCameraDirectionFallback();

        // 俯视状态下保持俯视，只旋转画面方向，不跳回平视。
        if (Math.abs(dir.y) > 0.92) {
            camera.up.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleRad);
            camera.lookAt(controls.target);
            controls.update();
            return;
        }

        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleRad);
        dir.normalize();
        setTightFitCamera(dir, 0.18);
    }

    function rotateCurrentView45() {
        rotateCurrentViewByAngle(Math.PI / 4);
    }

    function centerCurrentFurnaceView() {
        const dir = getCurrentCameraDirectionFallback();
        setTightFitCamera(dir, 0.18);
    }

    if (dockThermal) {
        dockThermal.addEventListener('click', () => {
            if (!guardProcessSimulationEntry()) {
                dockThermal.classList.remove('active');
                return;
            }
            renderCurrentThermalSimulation(0, true);
            dockThermal.classList.add('active');
        });
    }

    if (dockRotate45) {
        dockRotate45.addEventListener('click', () => {
            rotateCurrentView45();
            highlightDockBtn(dockRotate45);
        });
    }
    if (dockCenterView) {
        dockCenterView.addEventListener('click', () => {
            centerCurrentFurnaceView();
            highlightDockBtn(dockCenterView);
        });
    }
    if (dockPlacementEdit) {
        dockPlacementEdit.addEventListener('click', () => {
            if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
                showCapacityFeedback?.('warning', '请先生成装炉方案，再进入编辑摆放。');
                return;
            }
            setPlacementEditModeActive(!placementEditModeActive);
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
        if (dockExplodeVertical) dockExplodeVertical.classList.toggle('active', dockExplodeMode === 'vertical');
        if (dockExplodeHorizontal) dockExplodeHorizontal.classList.toggle('active', dockExplodeMode === 'horizontal');

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

    if (dockExplodeVertical) {
        dockExplodeVertical.addEventListener('click', async () => {
            if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
                dockExplodeMode = 'none';
                updateDockExplodeButton();
                return;
            }
            if (dockExplodeMode === 'vertical') {
                await resetExplode();
                dockExplodeMode = 'none';
            } else {
                await setExplodeVertical();
                dockExplodeMode = 'vertical';
            }
            updateDockExplodeButton();
            highlightDockBtn(dockExplodeVertical);
        });
    }

    if (dockExplodeHorizontal) {
        dockExplodeHorizontal.addEventListener('click', async () => {
            if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
                dockExplodeMode = 'none';
                updateDockExplodeButton();
                return;
            }
            if (dockExplodeMode === 'horizontal') {
                await resetExplode();
                dockExplodeMode = 'none';
            } else {
                await setExplodeHorizontal();
                dockExplodeMode = 'horizontal';
            }
            updateDockExplodeButton();
            highlightDockBtn(dockExplodeHorizontal);
        });
    }

    if (false && dockExplode) {
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

    if (toggleAxes) {
        const axesLabel = toggleAxes.querySelector('.dock-label');
        const axesIcon = toggleAxes.querySelector('.dock-icon');
        if (axesLabel) axesLabel.textContent = '方向轴';
        if (axesIcon) axesIcon.textContent = '🧭';
        toggleAxes.title = '显示/隐藏开发调试方向轴（默认隐藏）';
    }
    if (toggleRulers) {
        const rulerLabel = toggleRulers.querySelector('.dock-label');
        const rulerIcon = toggleRulers.querySelector('.dock-icon');
        if (rulerLabel) rulerLabel.textContent = '尺寸标注';
        if (rulerIcon) rulerIcon.textContent = '📏';
        toggleRulers.title = '显示/隐藏当前工装尺寸标注';
    }

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

    setupDockViewSettingsMenu();
    updateDockToolVisibilityForProcess();

})();

