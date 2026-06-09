/**
 * @deprecated 此模块管理的是炉膛资产库（Chamber层），非PRD定义的Workshop（车间与物理设备层）。
 *             功能与 furnaceManagement.js 重叠，建议合并。
 *             Phase 2 将重新设计 Equipment→Chamber→Tooling 三层数据模型。
 *
 * 模块1：车间管理（待重构）
 * 负责展示车间已有炉膛资产库，支持选择已有炉膛加入当前预装方案
 */
export class WorkshopManagement {
    constructor(formManager) {
        this.formManager = formManager;
        // 车间预设炉膛资产库
        this.workshopFurnaces = [];
        // 选中的炉膛（拖入预装方案的）
        this.selectedFurnaces = new Set();
    }

    /**
     * 初始化车间管理UI事件
     */
    init() {
        // 初始化抽屉
        this._initDrawer();
        // 加载车间炉膛资产
        this._loadWorkshopFurnaces();

        // 刷新按钮
        const btnRefresh = document.getElementById('btn-refresh-workshop');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', () => {
                this._loadWorkshopFurnaces();
                this._renderWorkshopFurnaces();
            });
        }

        // 将选中炉膛加入预装方案按钮
        const btnAddSelected = document.getElementById('btn-add-selected-to-plan');
        if (btnAddSelected) {
            btnAddSelected.addEventListener('click', () => {
                this._addSelectedToPlan();
            });
        }

        // 监听自定义炉膛变更事件，同步更新车间视图
        window.addEventListener('furnace-list-changed', () => {
            this._renderWorkshopFurnaces();
        });
    }

    /**
     * 初始化抽屉控制
     */
    _initDrawer() {
        const btnOpen = document.getElementById('btn-open-workshop-drawer');
        const btnClose = document.getElementById('btn-close-workshop-drawer');
        const drawer = document.getElementById('workshop-drawer');
        const overlay = document.getElementById('workshop-drawer-overlay');

        if (btnOpen && drawer && overlay) {
            btnOpen.addEventListener('click', () => {
                drawer.classList.add('open');
                overlay.classList.add('active');
            });
        }

        if (btnClose && drawer && overlay) {
            btnClose.addEventListener('click', () => {
                drawer.classList.remove('open');
                overlay.classList.remove('active');
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                drawer.classList.remove('open');
                overlay.classList.remove('active');
            });
        }
    }

    /**
     * 加载车间炉膛资产（预设 + localStorage）
     */
    _loadWorkshopFurnaces() {
        // 预设车间炉膛
        const presets = [
            {
                id: 'ws-001',
                name: '车间1号真空炉',
                width: 600, height: 600, depth: 900,
                maxWeight: 500,
                location: '一车间A区',
                status: 'available',
                lastMaintenance: '2024-12-15'
            },
            {
                id: 'ws-002',
                name: '车间2号台车炉',
                width: 900, height: 900, depth: 1200,
                maxWeight: 1000,
                location: '一车间B区',
                status: 'available',
                lastMaintenance: '2025-01-20'
            },
            {
                id: 'ws-003',
                name: '车间3号井式炉',
                width: 800, height: 1500, depth: 800,
                maxWeight: 800,
                location: '二车间A区',
                status: 'available',
                lastMaintenance: '2025-03-10'
            },
            {
                id: 'ws-004',
                name: '车间4号箱式炉',
                width: 500, height: 500, depth: 700,
                maxWeight: 400,
                location: '二车间B区',
                status: 'maintenance',
                lastMaintenance: '2025-05-01'
            },
            {
                id: 'ws-005',
                name: '车间5号真空炉',
                width: 1000, height: 800, depth: 1000,
                maxWeight: 1200,
                location: '三车间A区',
                status: 'available',
                lastMaintenance: '2025-02-28'
            },
            {
                id: 'ws-006',
                name: '车间6号台车炉',
                width: 700, height: 700, depth: 1000,
                maxWeight: 600,
                location: '三车间B区',
                status: 'available',
                lastMaintenance: '2025-04-15'
            }
        ];

        // 尝试从localStorage加载自定义车间炉膛
        let stored = [];
        try {
            const raw = localStorage.getItem('heatTreatment_workshopFurnaces');
            if (raw) {
                stored = JSON.parse(raw);
            }
        } catch (e) { /* ignore */ }

        // 去重：预设优先
        const presetIds = new Set(presets.map(p => p.id));
        const filteredStored = stored.filter(s => !presetIds.has(s.id));

        this.workshopFurnaces = [...presets, ...filteredStored];

        // 同步检查当前自定义炉膛中哪些已加入方案
        this._syncSelectedState();

        this._renderWorkshopFurnaces();
    }

    /**
     * 同步选中状态（检查当前方案中已有的炉膛）
     */
    _syncSelectedState() {
        const currentFurnaces = this.formManager.getFurnacesData();
        this.selectedFurnaces.clear();
        currentFurnaces.forEach(f => {
            if (f._workshopId) {
                this.selectedFurnaces.add(f._workshopId);
            }
        });
    }

    /**
     * 渲染车间炉膛列表
     */
    _renderWorkshopFurnaces() {
        const container = document.getElementById('workshop-furnaces-container');
        if (!container) return;

        this._syncSelectedState();

        if (this.workshopFurnaces.length === 0) {
            container.innerHTML = '<div style="color: #999; font-size: 12px; text-align: center; padding: 20px;">暂无车间炉膛资产</div>';
            return;
        }

        let html = '<div class="workshop-furnace-grid">';

        this.workshopFurnaces.forEach(wf => {
            const isInPlan = this.selectedFurnaces.has(wf.id);
            const isAvailable = wf.status === 'available';
            const statusLabel = wf.status === 'available' ? '✅ 可用' : '🔧 维护中';
            const statusClass = wf.status === 'available' ? 'ws-status-available' : 'ws-status-maintenance';

            html += '<div class="ws-furnace-card' + (isInPlan ? ' ws-selected' : '') + (!isAvailable ? ' ws-disabled' : '') + '" data-workshop-id="' + wf.id + '">';
            html += '<div class="ws-furnace-header">';
            html += '<span class="ws-furnace-name">' + wf.name + '</span>';
            html += '<span class="ws-status-badge ' + statusClass + '">' + statusLabel + '</span>';
            html += '</div>';
            html += '<div class="ws-furnace-spec">';
            html += '规格: ' + Math.round(wf.width) + ' × ' + Math.round(wf.height) + ' × ' + Math.round(wf.depth) + ' mm';
            html += '</div>';
            html += '<div class="ws-furnace-info">';
            html += '<span>📍 ' + wf.location + '</span>';
            html += '<span>⚖️ 承重: ' + wf.maxWeight + ' kg</span>';
            html += '</div>';
            html += '<div class="ws-furnace-info">';
            html += '<span>🛠 上次维护: ' + (wf.lastMaintenance || '未知') + '</span>';
            html += '</div>';
            html += '<div class="ws-furnace-actions">';
            if (isInPlan) {
                html += '<span class="ws-added-badge">✓ 已加入方案</span>';
            } else if (isAvailable) {
                html += '<button class="btn btn-secondary btn-xs ws-add-btn" data-workshop-id="' + wf.id + '" style="width:auto; padding:4px 10px; margin:0;">+ 加入方案</button>';
            } else {
                html += '<span style="font-size:10px; color:#999;">暂不可用</span>';
            }
            html += '</div>';
            html += '</div>';
        });

        html += '</div>';

        container.innerHTML = html;

        // 绑定"加入方案"按钮事件
        container.querySelectorAll('.ws-add-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wid = btn.getAttribute('data-workshop-id');
                this._addSingleFurnaceToPlan(wid);
            });
        });

        // 卡片点击也能加入
        container.querySelectorAll('.ws-furnace-card').forEach(card => {
            card.addEventListener('click', () => {
                const wid = card.getAttribute('data-workshop-id');
                const wf = this.workshopFurnaces.find(f => f.id === wid);
                if (wf && wf.status === 'available' && !this.selectedFurnaces.has(wid)) {
                    this._addSingleFurnaceToPlan(wid);
                }
            });
        });
    }

    /**
     * 将单个车间炉膛加入预装方案
     */
    _addSingleFurnaceToPlan(workshopId) {
        const wf = this.workshopFurnaces.find(f => f.id === workshopId);
        if (!wf || wf.status !== 'available') return;

        if (this.selectedFurnaces.has(workshopId)) {
            return; // 已加入
        }

        // 添加到表单管理器
        this.formManager.addFurnaceRow(
            wf.name + '(车间)',
            wf.width, wf.height, wf.depth,
            wf.maxWeight,
            1
        );

        // 标记已添加
        // 获取最后添加的炉膛并标记workshopId
        const furnaces = this.formManager.getFurnacesData();
        if (furnaces.length > 0) {
            const lastFurnace = furnaces[furnaces.length - 1];
            lastFurnace._workshopId = workshopId;
        }

        this.selectedFurnaces.add(workshopId);
        this._renderWorkshopFurnaces();

        // 触发优先级列表刷新
        window.dispatchEvent(new CustomEvent('furnace-deleted'));
    }

    /**
     * 将全部选中炉膛加入预装方案
     */
    _addSelectedToPlan() {
        let addedCount = 0;
        this.workshopFurnaces.forEach(wf => {
            if (wf.status === 'available' && !this.selectedFurnaces.has(wf.id)) {
                this.formManager.addFurnaceRow(
                    wf.name + '(车间)',
                    wf.width, wf.height, wf.depth,
                    wf.maxWeight,
                    1
                );
                const furnaces = this.formManager.getFurnacesData();
                if (furnaces.length > 0) {
                    furnaces[furnaces.length - 1]._workshopId = wf.id;
                }
                this.selectedFurnaces.add(wf.id);
                addedCount++;
            }
        });

        if (addedCount > 0) {
            this._renderWorkshopFurnaces();
            window.dispatchEvent(new CustomEvent('furnace-deleted'));
        } else {
            alert('所有可用车间炉膛已加入方案，或没有可用炉膛');
        }
    }

    /**
     * 获取车间炉膛数据
     */
    getWorkshopFurnaces() {
        return this.workshopFurnaces;
    }
}
