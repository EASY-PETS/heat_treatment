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
import * as THREE from 'three';
import {
    isAnimating, animPaused, animStopped,
    globalFurnacesResult, globalUnpackedItems, aggregationStats,
    currentFurnaceIndex, selectedFurnaceCardId,
    masterRenderer, itemsGroup, usedColors,
    currentBasketType, displaySettings,
    defaultToolingType, furnaceTooling, toolingTemplates,
    setAnimPaused, setAnimStopped, setCurrentFurnaceIndex,
    setFdpCollapsed, setMdpCollapsed,
    placementRules,
    setGlobalFurnacesResult, setGlobalUnpackedItems, setGlobalSpacingValue,
    setGlobalPredictions,
    setCurrentBasketType, setDisplaySettings, setDefaultToolingType,
    clearFurnaceGroups,
    furnaceGroups, controls, camera,
    setFurnaceCounter, setMaterialCounter,
    setSelectedFurnaceCardId, setSelectedMaterialCardId,
    clearMaterialFilters, clearProcessFilters, clearHardnessFilters,
    clearUsedColors
} from './state.js';
import {
    initThree, initMasterThree, renderSingleFurnace,
    buildFurnaceGroup,
    getSelectedMaterialName,
    playLoadingAnimation, renderMasterPlan,
    findResultIndexByFid, generateUniqueColor,
    refreshAllDisplayVisibility,
    toggleExplodedView, showLayeredBOM,
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
    initMasterView, parseExcelData, showImportPreview, applyImportData,
    openJsonImportModal, parseJsonPlan, renderJsonPreview, importJsonPlanToMaster
} from './ui.js';
import { executePacking } from './furnace-engine.js';
import { showPdfSelectModal, exportSingleFurnacePDF, getSelectedPdfFurnaceIds } from './pdf-export.js';
import { generateSixPagePDF } from './pdf-six-page.js';

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
            name: d.name, shape: d.shape, count: d.count,
            dim1: d.dim1, dim2: d.dim2, dim3: d.dim3,
            weight: d.totalWeight, color: d.color,
            material: d.material || "", process: d.process || "",
            customer: d.customer || "", itemCode: d.itemCode || "",
            showName: d.showName || ""
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
    const strategy = placementRules.strategy || 'balanced';
    const result = executePacking(furnacePoolInput, itemsInput, spacing, strategy);

    setGlobalFurnacesResult(result.completedFurnaces);
    setGlobalUnpackedItems(result.unpackedItems);

    // V5.0 P0: 存储预测结果供后续 UI 渲染使用
    if (result.predictions) {
        setGlobalPredictions(result.predictions);
    }

    document.getElementById("btn-export-pdf").style.display = "inline-block";
    document.getElementById("btn-animate").style.display = "inline-block";

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
    }
    renderAISummaryBar(onCenterFurnaceClick);
    updateTopSummary();

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

/**
 * 清空所有装炉结果，重置3D场景和UI
 */
export function clearFurnaceResults() {
    setGlobalFurnacesResult(null);
    setGlobalUnpackedItems([]);
    clearFurnaceGroups();
    if (itemsGroup) {
        while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
    }
    document.getElementById("btn-export-pdf").style.display = "none";
    document.getElementById("btn-animate").style.display = "none";
    document.getElementById("furnace-nav").style.display = "none";
    hideExplodeBOMButtons();
    document.getElementById("empty-state").style.display = "block";
    renderAISummaryBar(null);
    // 可选：显示提示
    showCapacityFeedback('info', '筛选条件已变更，请重新生成方案');
}
window._clearFurnaceResults = clearFurnaceResults; // 供 ui.js 调用

/**
 * V2.7: 控制爆炸图和施工清单按钮的显示/隐藏
 * @returns {void}
 */
function updateExplodeBOMButtons() {
    const btnExplode = document.getElementById("btn-explode");
    const btnBOM = document.getElementById("btn-bom");
    if (btnExplode) btnExplode.style.display = "inline-block";
    if (btnBOM) btnBOM.style.display = "inline-block";
}

/**
 * 隐藏爆炸图和施工清单按钮。
 * @returns {void}
 */
function hideExplodeBOMButtons() {
    const btnExplode = document.getElementById("btn-explode");
    const btnBOM = document.getElementById("btn-bom");
    if (btnExplode) btnExplode.style.display = "none";
    if (btnBOM) btnBOM.style.display = "none";
}

/**
 * 导航至上一个或下一个炉膛方案。
 * @param {number} direction - 导航方向，-1 为上一个，1 为下一个。
 * @returns {void}
 */
function navigateFurnace(direction) {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;
    const newIndex = (currentFurnaceIndex + direction + globalFurnacesResult.length) % globalFurnacesResult.length;
    setCurrentFurnaceIndex(newIndex);
    // 移动相机到对应炉膛的位置
    const group = furnaceGroups.get(newIndex);
    if (group) {
        controls.target.copy(group.position);
        controls.update();
    }
    const filterName = getSelectedMaterialName();
    renderSingleFurnace(newIndex, filterName);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(newIndex);
    renderAISummaryBar(onCenterFurnaceClick);
    // 新增：刷新缩略图高亮
    renderFurnaceThumbnails(
        globalFurnacesResult,
        currentFurnaceIndex,
        handleThumbFurnaceClick
    );
}

function handleThumbFurnaceClick(clickedIdx) {
    setCurrentFurnaceIndex(clickedIdx);

    const filterName = getSelectedMaterialName();
    renderSingleFurnace(clickedIdx, filterName);

    updateFurnaceNav();
    updateLeftPanelActiveForIndex(clickedIdx);
    renderAISummaryBar(onCenterFurnaceClick);

    renderFurnaceThumbnails(
        globalFurnacesResult,
        clickedIdx,
        handleThumbFurnaceClick
    );
}

/**
 * 点击中心统计面板的炉膛项时触发，切换到对应的炉膛方案。
 * @param {number} idx - 炉膛索引。
 * @returns {void}
 */
function onCenterFurnaceClick(idx) {
    setCurrentFurnaceIndex(idx);
    const filterName = getSelectedMaterialName();
    renderSingleFurnace(idx, filterName);
    updateFurnaceNav();
    updateLeftPanelActiveForIndex(idx);
    renderAISummaryBar(onCenterFurnaceClick);
    // 新增：刷新缩略图高亮
    renderFurnaceThumbnails(
        globalFurnacesResult,
        currentFurnaceIndex,
        handleThumbFurnaceClick
    );
}

/**
 * 显示总览视图 (Master View)，初始化或重新渲染主场景。
 * @returns {void}
 */
function showMasterView() {
    document.getElementById("master-view").classList.add("active");
    document.getElementById("furnace-nav").style.display = "none";
    document.getElementById("canvas-container").style.display = "none";
    document.getElementById("anim-control-bar").classList.remove("visible");
    hideExplodeBOMButtons();
    if (!masterRenderer) {
        setTimeout(() => {
            initMasterThree();
            initMasterView(renderMasterPlan);
        }, 100);
    } else {
        initMasterView(renderMasterPlan);
    }
}

/**
 * 隐藏总览视图 (Master View)，并恢复主场景的可见性。
 * @returns {void}
 */
function hideMasterView() {
    document.getElementById("master-view").classList.remove("active");
    document.getElementById("canvas-container").style.display = "block";
    if (globalFurnacesResult && globalFurnacesResult.length > 0) {
        document.getElementById("furnace-nav").style.display = "flex";
        updateExplodeBOMButtons();
    }
}

/**
 * 初始化应用程序，设置 Three.js 场景、创建默认炉膛卡片和物料卡片，并绑定所有事件监听器。
 * @returns {void}
 */
function init() {
    initThree();
    updateTopSummary();
    hideExplodeBOMButtons();

    // ==================== EVENT LISTENERS ====================

    document.getElementById("btn-master").addEventListener("click", showMasterView);
    document.getElementById("btn-master-back").addEventListener("click", hideMasterView);
    document.getElementById("btn-master-import-json").addEventListener("click", openJsonImportModal);
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
    document.getElementById("btn-animate").addEventListener("click", playLoadingAnimation);
    document.getElementById("btn-export-pdf").addEventListener("click", showPdfSelectModal);

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

    document.getElementById("btn-add-furnace").addEventListener("click", openToolingAddModal);
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
            document.getElementById("btn-export-pdf").style.display = "none";
            document.getElementById("btn-animate").style.display = "none";
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
    document.getElementById("btn-import-replace").addEventListener("click", () => applyImportData(true));
    document.getElementById("btn-import-append").addEventListener("click", () => applyImportData(false));
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
        document.getElementById("pdf-select-overlay").style.display = "none";

        // 🔧 V3.1: 使用六页式 PDF 生成器
        generateSixPagePDF(selectedIds);
    });
    document.getElementById("btn-ji-parse").addEventListener("click", () => {
        const jsonStr = document.getElementById("ji-json-textarea").value.trim();
        if (!jsonStr) {
            document.getElementById("ji-error-msg").textContent = "请先输入或粘贴 JSON 内容";
            document.getElementById("ji-error-msg").classList.add("visible");
            return;
        }
        const result = parseJsonPlan(jsonStr);
        if (!result.ok) {
            document.getElementById("ji-error-msg").textContent = "❌ 解析失败：" + result.error;
            document.getElementById("ji-error-msg").classList.add("visible");
            document.getElementById("btn-ji-import").disabled = true;
            return;
        }
        document.getElementById("ji-error-msg").classList.remove("visible");
        renderJsonPreview(result.data);
        document.getElementById("btn-ji-import").disabled = false;
        window._jiParsedPlan = result.data;
    });
    document.getElementById("btn-ji-import").addEventListener("click", () => {
        if (!window._jiParsedPlan) return;
        importJsonPlanToMaster(window._jiParsedPlan, () => initMasterView(renderMasterPlan));
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
    executeAndRender();  // 先执行算法+渲染结果
    // 然后触发动画播放
    setTimeout(() => {
        playLoadingAnimation();
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

/** 当前在弹窗中选中的工装类型 key */
let selectedAddToolingType = null;

/**
 * 工装类型对应的图标映射
 */
const TOOLING_ICONS = {
    'standard-basket': '📦',
    'mesh-basket': '🧺',
    'special-jig': '🔩',
    'material-tray': '🍽️',
    'hanger': '🪝',
    'ring-tooling': '🔄'
};

const TOOLING_SVGS = {
    'standard-basket': 'assets/icons/tooling-standard.svg',
    'mesh-basket': 'assets/icons/tooling-mesh.svg',
    'material-tray': 'assets/icons/tooling-tray.svg',
    'ring-tooling': 'assets/icons/tooling-ring.svg'
};

/**
 * 工装类型对应的默认尺寸预设
 */
const TOOLING_DEFAULT_DIMS = {
    'standard-basket': { name: '标准料框', width: 900, height: 900, depth: 1200, maxWeight: 1000 },
    'mesh-basket': { name: '网篮', width: 800, height: 300, depth: 800, maxWeight: 500 },
    'special-jig': { name: '专用夹具', width: 600, height: 400, depth: 900, maxWeight: 500 },
    'material-tray': { name: '料盘', width: 900, height: 900, depth: 1200, maxWeight: 1000 },
    'hanger': { name: '挂具', width: 600, height: 600, depth: 900, maxWeight: 500 },
    'ring-tooling': { name: '环形工装', width: 900, height: 900, depth: 900, maxWeight: 500 }
};

/**
 * 工装类型对应的实拍图映射（路径相对于 furnace.html）
 */
const TOOLING_IMAGES = {
    'standard-basket': 'images/tooling/standard-basket.jpg',
    'mesh-basket': 'images/tooling/mesh-basket.jpg',
    'special-jig': 'images/tooling/special-jig.jpg',
    'material-tray': 'images/tooling/material-tray.jpg',
    'hanger': 'images/tooling/hanger.jpg',
    'ring-tooling': 'images/tooling/ring-tooling.jpg'
};

/**
 * 打开工装类型选择 + 尺寸配置弹窗
 */
function openToolingAddModal() {
    const overlay = document.getElementById('tooling-add-overlay');
    if (!overlay) return;

    // 渲染工装类型卡片
    renderToolingTypeCards();

    // 默认选中 defaultToolingType
    const initialType = furnaceTooling[defaultToolingType]?.deprecated
        ? 'standard-basket'
        : defaultToolingType;
    selectAddToolingType(initialType);

    overlay.classList.add('active');

    // 绑定事件（使用 once 模拟，先移除旧监听器再添加新的）
    const btnConfirm = document.getElementById('btn-ta-confirm');
    const btnCancel = document.getElementById('btn-ta-cancel');
    const newConfirm = btnConfirm.cloneNode(true);
    const newCancel = btnCancel.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newConfirm, btnConfirm);
    btnCancel.parentNode.replaceChild(newCancel, btnCancel);

    newConfirm.addEventListener('click', confirmAddTooling);
    newCancel.addEventListener('click', closeToolingAddModal);

    // 点击遮罩关闭
    overlay.onclick = (e) => {
        if (e.target === overlay) closeToolingAddModal();
    };
}

/**
 * 关闭工装添加弹窗
 */
function closeToolingAddModal() {
    const overlay = document.getElementById('tooling-add-overlay');
    if (overlay) overlay.classList.remove('active');
    selectedAddToolingType = null;
}

/**
 * 渲染工装类型卡片列表
 */
function renderToolingTypeCards() {
    const container = document.getElementById('tooling-type-cards');
    if (!container) return;

    let html = '';
    Object.entries(furnaceTooling).forEach(([key, cfg]) => {
        if (cfg.deprecated) return;
        const svgPath = TOOLING_SVGS[key];
        const iconHtml = svgPath
            ? '<img class="tooling-svg-icon" src="' + svgPath + '" alt="' + cfg.label + '">'
            : (TOOLING_ICONS[key] || '🔧');
                const procStr = cfg.allowedProcesses.length > 0
                    ? cfg.allowedProcesses.join('、')
                    : '全部工艺';
        const placementLabels = { 'free': '自由摆放', 'fixed': '固定卡位', 'vertical': '垂直悬挂', 'radial': '径向排列' };
        const placementLabel = placementLabels[cfg.placementMode] || cfg.placementMode;

        html += '<div class="tooling-type-card" data-tooling="' + key + '" onclick="window._selectAddToolingType(\'' + key + '\')">';
        html += '<span class="ttc-icon">' + iconHtml + '</span>';
        html += '<span class="ttc-name">' + cfg.label + '</span>';
        html += '<div class="ttc-info">';
        html += '<span>📐 最大' + cfg.maxLayers + '层</span>';
        html += '<span>📌 ' + placementLabel + '</span>';
        html += '<span>🏭 ' + procStr + '</span>';
        html += '</div>';
        html += '</div>';
    });

    container.innerHTML = html;
}

/**
 * 选中工装类型，更新右侧尺寸默认值和预览
 * @param {string} toolingKey - 工装类型 key
 */
function selectAddToolingType(toolingKey) {
    selectedAddToolingType = toolingKey;
    const cfg = furnaceTooling[toolingKey];
    if (!cfg) return;

    // 更新卡片选中状态
    document.querySelectorAll('.tooling-type-card').forEach(card => {
        card.classList.toggle('selected', card.getAttribute('data-tooling') === toolingKey);
    });

    // 填充默认尺寸
    const dims = TOOLING_DEFAULT_DIMS[toolingKey] || TOOLING_DEFAULT_DIMS['standard-basket'];
    document.getElementById('ta-name').value = cfg.label;
    document.getElementById('ta-width').value = dims.width;
    document.getElementById('ta-height').value = dims.height;
    document.getElementById('ta-depth').value = dims.depth;
    document.getElementById('ta-weight').value = dims.maxWeight;
    document.getElementById('ta-count').value = 1;
    document.getElementById('ta-spacing').value = '';

    // 更新预览区
    const placementLabels = { 'free': '自由摆放', 'fixed': '固定卡位', 'vertical': '垂直悬挂', 'radial': '径向排列' };
    const placementLabel = placementLabels[cfg.placementMode] || cfg.placementMode;
    const procStr = cfg.allowedProcesses.length > 0
        ? cfg.allowedProcesses.join('、')
        : '全部允许';
    const preview = document.getElementById('ta-preview');
    if (preview) {
        preview.innerHTML =
            '<div class="tap-row"><span class="tap-label">工装类型</span><span class="tap-value">' + cfg.label + '</span></div>' +
            '<div class="tap-row"><span class="tap-label">摆放模式</span><span class="tap-value">' + placementLabel + '</span></div>' +
            '<div class="tap-row"><span class="tap-label">最大层数</span><span class="tap-value">' + cfg.maxLayers + ' 层</span></div>' +
            '<div class="tap-row"><span class="tap-label">允许工艺</span><span class="tap-value">' + procStr + '</span></div>' +
            '<div class="tap-row"><span class="tap-label">3D 料框</span><span class="tap-value">' + (cfg.basketType || 'grid') + '</span></div>';
    }

    // 启用确认按钮
    const confirmBtn = document.getElementById('btn-ta-confirm');
    if (confirmBtn) confirmBtn.disabled = false;

    // 更新工装实拍图
    const imgEl = document.getElementById('ta-preview-img');
    const placeholder = document.getElementById('ta-preview-img-placeholder');
    const imgSrc = TOOLING_IMAGES[toolingKey] || '';
    const icon = TOOLING_ICONS[toolingKey] || '🔧';

    // 生成默认 SVG 占位图
    const defaultSvgSrc = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 0 400 280">' +
        '<rect width="400" height="280" fill="#1e1e2e" rx="8"/>' +
        '<rect x="2" y="2" width="396" height="276" fill="none" stroke="#3e3e52" stroke-width="2" stroke-dasharray="8,4" rx="7"/>' +
        '<text x="200" y="120" text-anchor="middle" font-size="64">' + icon + '</text>' +
        '<text x="200" y="180" text-anchor="middle" font-size="20" fill="#888" font-family="sans-serif">' + cfg.label + '</text>' +
        '<text x="200" y="210" text-anchor="middle" font-size="13" fill="#555" font-family="sans-serif">暂无实拍图</text>' +
        '</svg>'
    );

    if (imgEl) {
        if (imgSrc) {
            imgEl.src = imgSrc;
            imgEl.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
            // 图片加载失败时显示默认占位图
            imgEl.onerror = () => {
                imgEl.src = defaultSvgSrc;
                imgEl.style.display = 'block';
                imgEl.onerror = null; // 防止 SVG 也失败导致无限循环
                if (placeholder) placeholder.style.display = 'none';
            };
        } else {
            // 无图片路径时直接显示默认占位图
            imgEl.src = defaultSvgSrc;
            imgEl.style.display = 'block';
            imgEl.onerror = null;
            if (placeholder) placeholder.style.display = 'none';
        }
    }
}

/**
 * 确认添加：读取配置 → 调用 createFurnaceCard → 关闭弹窗
 */
function confirmAddTooling() {
    if (!selectedAddToolingType) {
        alert('请先在左侧选择工装类型');
        return;
    }

    const name = document.getElementById('ta-name').value.trim() || '料框';
    const width = parseFloat(document.getElementById('ta-width').value) || 900;
    const height = parseFloat(document.getElementById('ta-height').value) || 1200;
    const depth = parseFloat(document.getElementById('ta-depth').value) || 900;
    const maxWeight = parseFloat(document.getElementById('ta-weight').value) || 1000;
    const count = parseInt(document.getElementById('ta-count').value) || 1;
    const plannedHeats = 0;
    const spacingVal = document.getElementById('ta-spacing').value;
    const actualSpacing = spacingVal !== '' ? parseFloat(spacingVal) : null;

    const cfg = furnaceTooling[selectedAddToolingType];
    const basketType = cfg ? cfg.basketType : 'grid';

    const result = createFurnaceCard(name, depth, width, height, maxWeight, count, plannedHeats, actualSpacing,
        basketType, selectedAddToolingType);
    updateTopSummary();

    // 自动选中新添加的料框，确保 3D 视图展示新料框
    selectFurnaceCard(result.cardId);

    // 刷新主 3D 场景，渲染空料框
    renderEmptyToolingOnly();

    closeToolingAddModal();
}

/**
 * 仅渲染空工装料框到主 3D 场景（不执行装炉算法）
 */
function renderEmptyToolingOnly() {
    if (!itemsGroup) return;

    // 清理旧内容
    clearFurnaceGroups();
    while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);

    const cards = document.querySelectorAll(".furnace-card");
    if (cards.length === 0) return;

    document.getElementById("empty-state").style.display = "none";

    let idx = 0;
    cards.forEach(card => {
        const d = getFurnaceDataFromCard(card);
        const fid = parseInt(card.getAttribute("data-fid")) || idx;
        // 读取工装参数（环形工装等需要）
        const extrasStr = card.getAttribute('data-extras');
        const params = extrasStr ? JSON.parse(extrasStr) : {};
        // 只渲染空工装，无工件
        // 注意：getFurnaceDataFromCard 返回 width/height/depth，
        // 但 buildFurnaceGroup 期望 w/h/d，需要显式映射
        const emptyFurnace = {
            w: d.width,
            h: d.height,
            d: d.depth,
            name: d.name,
            basketType: d.basketType,
            toolingType: d.toolingType,
            maxLayers: d.maxLayers,
            allowedProcesses: d.allowedProcesses,
            placementMode: d.placementMode,
            maxWeight: d.maxWeight,
            actualSpacing: d.actualSpacing,
            id: fid,
            fid: fid,
            packedItems: [],
            shelvesUsed: [],
            params: params
        };
        const group = buildFurnaceGroup(emptyFurnace, idx, null);
        group.visible = false;
        itemsGroup.add(group);
        furnaceGroups.set(idx, group);
        idx++;
    });

    // 确定要显示的料框索引：优先选中的料框，否则显示最后一个（最新添加的）
    let visibleIdx = cards.length - 1; // 默认最后一个
    if (selectedFurnaceCardId) {
        const selectedCard = document.getElementById(selectedFurnaceCardId);
        if (selectedCard) {
            const selFid = parseInt(selectedCard.getAttribute("data-fid"));
            cards.forEach((c, i) => {
                if (parseInt(c.getAttribute("data-fid")) === selFid) visibleIdx = i;
            });
        }
    }
    setCurrentFurnaceIndex(visibleIdx);
    const visibleGroup = furnaceGroups.get(visibleIdx);
    if (visibleGroup) visibleGroup.visible = true;

    document.getElementById("furnace-nav").style.display = "none";
    hideExplodeBOMButtons();

    // 更新相机位置，以选中/最新料框尺寸为参考
    const targetCard = cards[visibleIdx];
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

// ==================== 重置 & 折叠功能 ====================

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

    // 4. 清空 3D 场景
    if (itemsGroup) {
        while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
    }
    // 5. 隐藏方案相关 UI
    document.getElementById('btn-export-pdf').style.display = 'none';
    document.getElementById('btn-animate').style.display = 'none';
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
        renderEmptyToolingOnly();
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

    // 5. 清空 3D 场景所有内容
    if (itemsGroup) {
        while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
    }
    // 6. 隐藏所有方案相关 UI
    document.getElementById('btn-export-pdf').style.display = 'none';
    document.getElementById('btn-animate').style.display = 'none';
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
}

/**
 * 折叠/展开左面板
 */
function toggleLeftPanel() {
    const panel = document.getElementById('left-panel');
    const btn = document.getElementById('btn-toggle-left-panel');
    const expandBtn = document.getElementById('panel-expand-btn-left');

    if (panel.classList.contains('collapsed')) {
        // 展开
        panel.classList.remove('collapsed');
        if (btn) btn.textContent = '◀';
        if (expandBtn) expandBtn.style.display = 'none';
    } else {
        // 折叠
        panel.classList.add('collapsed');
        if (btn) btn.textContent = '▶';
        if (expandBtn) expandBtn.style.display = 'flex';
    }
}

/**
 * 折叠/展开右面板
 */
function toggleRightPanel() {
    const panel = document.getElementById('right-panel');
    const btn = document.getElementById('btn-toggle-right-panel');
    const expandBtn = document.getElementById('panel-expand-btn-right');

    if (panel.classList.contains('collapsed')) {
        // 展开
        panel.classList.remove('collapsed');
        if (btn) btn.textContent = '▶';
        if (expandBtn) expandBtn.style.display = 'none';
    } else {
        // 折叠
        panel.classList.add('collapsed');
        if (btn) btn.textContent = '◀';
        if (expandBtn) expandBtn.style.display = 'flex';
    }
}

/**
 * 折叠/展开中心方案统计面板
 */
// 暴露全局函数供 onclick 调用
window._selectAddToolingType = selectAddToolingType;

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
    const dockExplode = document.getElementById('dock-explode');
    const dockGravity = document.getElementById('dock-gravity');
    const dockThermal = document.getElementById('dock-thermal');

    if (dockTopView) {
        dockTopView.addEventListener('click', () => {
            setTightFitCamera(new THREE.Vector3(0, 1, 0));
            highlightDockBtn(dockTopView);
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
    if (dockExplode) {
        dockExplode.addEventListener('click', () => {
            toggleExplodedView();
            highlightDockBtn(dockExplode);
        });
    }
    if (dockGravity) {
        let gravityActive = false;
        dockGravity.addEventListener('click', () => {
            gravityActive = !gravityActive;
            dockGravity.classList.toggle('active', gravityActive);
            showCapacityFeedback('success', gravityActive ? '⚖️ 重心标记已显示' : '⚖️ 重心标记已隐藏');
        });
    }
    if (dockThermal) {
        let thermalActive = false;
        dockThermal.addEventListener('click', () => {
            thermalActive = !thermalActive;
            dockThermal.classList.toggle('active', thermalActive);
            showCapacityFeedback('success', thermalActive ? '🔥 热场可视化已开启' : '🔥 热场可视化已关闭');
        });
    }

    function highlightDockBtn(activeBtn) {
        document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
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
