// workbench-record.js

export function createWorkbenchRecordController(deps) {
    const {
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
    } = deps;

    function restoreWorkbenchInputsFromRecord(record) {
        // 清空当前左侧炉膛卡片和右侧物料卡片
        document.querySelectorAll('.furnace-card').forEach(c => c.remove());
        document.querySelectorAll('.material-card').forEach(c => c.remove());

        setSelectedFurnaceCardId(null);
        setSelectedMaterialCardId(null);
        setFurnaceCounter(0);
        setMaterialCounter(0);
        clearUsedColors();

        clearMaterialFilters();
        clearProcessFilters();
        clearHardnessFilters();

        // 避免 createMaterialCard 批量创建时反复清空结果和弹提示
        const oldClearResults = window._clearFurnaceResults;
        window._clearFurnaceResults = null;

        try {
            const toolingList = record.tooling || [];
            toolingList.forEach(tool => {
                const dim = tool.dimensions || {};

                const result = createFurnaceCard(
                    tool.toolingName || '历史工装',
                    dim.depth || 900,
                    dim.width || 900,
                    dim.height || 900,
                    tool.maxLoadKg || 1000,
                    tool.availableCount || 1,
                    0,
                    tool.actualSpacingMm ?? 5,
                    tool.basketType || 'grid',
                    tool.toolingType || 'standard-basket'
                );

                const card = document.getElementById(result.cardId);
                if (card && tool.params) {
                    card.setAttribute('data-extras', JSON.stringify(tool.params));
                }
            });

            const materialList = record.materials || [];
            materialList.forEach(mat => {
                const dim = mat.dimensions || {};
                const color = generateUniqueColor(usedColors);

                createMaterialCard(
                    mat.name || '历史工件',
                    mat.shape || 'cuboid',
                    mat.quantity || 1,
                    dim.length || dim.diameter || dim.width || 50,
                    dim.width || dim.length || 50,
                    dim.height || 50,
                    mat.totalWeightKg || 0,
                    color,
                    {
                        material: mat.material || '',
                        process: mat.process || '',
                        hardness: mat.hardnessTarget || '',
                        orderDate: mat.orderDate || '',
                        deliveryDate: mat.deliveryDate || '',
                        remark: mat.remark || '',
                        customer: mat.customer || '',
                        itemCode: mat.itemCode || '',
                        showName: mat.showName || mat.name || '',
                        cadImage: mat.cadImage || ''
                    }
                );
            });
        } finally {
            window._clearFurnaceResults = oldClearResults;
        }

        renderFilterBars(clearFurnaceResults);
        updateTopSummary();
    }

    function loadDigitalTwinRecordToWorkbench(record) {
        const furnaces = getRuntimeFurnacesFromRecord(record);

        setGlobalFurnacesResult(furnaces);
        setGlobalUnpackedItems(record.loadingPlan?.unpackedItems || []);
        setCurrentFurnaceIndex(0);
        setSelectedFurnaceCardId(null);
        setSelectedMaterialCardId(null);

        clearFurnaceGroups();
        if (furnaces.length > 0) {
            showPlanActionButtons();
            renderSingleFurnace(0, getSelectedMaterialName());
            updateFurnaceNav();
            updateExplodeBOMButtons();

            renderFurnaceThumbnails(
                furnaces,
                0,
                (clickedIdx) => {
                    setCurrentFurnaceIndex(clickedIdx);
                    renderSingleFurnace(clickedIdx, getSelectedMaterialName());
                    updateFurnaceNav();
                    renderAISummaryBar(onCenterFurnaceClick);
                    renderFurnaceThumbnails(furnaces, clickedIdx, () => {});
                }
            );
        }

        renderAISummaryBar(onCenterFurnaceClick);
        updateTopSummary();
    }

    function applyDigitalTwinRecordToWorkbench(record, options = {}) {
        const {
            sourceTitle = '',
            closeLibrary = false,
            showSuccess = false
        } = options;

        const savedRules =
            record.loadingPlan?.rules ||
            record.process?.rules ||
            null;

        if (savedRules) {
            setPlacementRules(savedRules);
        }

        restoreWorkbenchInputsFromRecord(record);
        loadDigitalTwinRecordToWorkbench(record);

        const analysis = analyzeFurnaces(
            getRuntimeFurnacesFromRecord(record),
            record.loadingPlan?.unpackedItems || [],
            record.predictions || []
        );

        renderPlanAnalysisPanel(analysis);
        activateRightPanelTab('analysis');

        if (closeLibrary) {
            hideMasterView();
        }

        if (showSuccess) {
            showCapacityFeedback('success', `✅ 已加载方案：${sourceTitle || record.meta?.title || '历史方案'}`);
        }
    }

    return {
        restoreWorkbenchInputsFromRecord,
        loadDigitalTwinRecordToWorkbench,
        applyDigitalTwinRecordToWorkbench
    };
}