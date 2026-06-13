// tooling-modal.js

export function createToolingModalController(deps) {
    const {
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

        getSelectedFurnaceCardId
    } = deps;

    let selectedAddToolingType = null;

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

    const TOOLING_DEFAULT_DIMS = {
        'standard-basket': { name: '标准料框', width: 900, height: 900, depth: 1200, maxWeight: 1000 },
        'mesh-basket': { name: '网篮', width: 800, height: 300, depth: 800, maxWeight: 500 },
        'special-jig': { name: '专用夹具', width: 600, height: 400, depth: 900, maxWeight: 500 },
        'material-tray': { name: '料盘', width: 900, height: 900, depth: 1200, maxWeight: 1000 },
        'hanger': { name: '挂具', width: 600, height: 600, depth: 900, maxWeight: 500 },
        'ring-tooling': { name: '环形工装', width: 900, height: 900, depth: 900, maxWeight: 500 }
    };

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

    return {
        openToolingAddModal,
        closeToolingAddModal,
        selectAddToolingType,
        renderEmptyToolingOnly
    };
}