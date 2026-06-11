// ==================== 模块1：炉膛管理 ====================

/**
 * 炉膛管理模块
 * 负责炉膛资产的创建、编辑、删除、优先级排序
 */
export class FurnaceManagement {
    constructor(formManager, sceneManager) {
        this.formManager = formManager;
        this.sceneManager = sceneManager;
        this.furnacePriorityOrder = [];
    }

    /**
     * 初始化炉膛管理 UI 事件
     */
    init() {
        // 绑定"增加料框资产"按钮
        const btnAddFurnace = document.getElementById('btn-add-furnace');
        if (btnAddFurnace) {
            btnAddFurnace.addEventListener('click', () => {
                this.formManager.addFurnaceRow('新增自定义料框', 1200, 900, 900, 1500, 1);
                this.refreshFurnacePriorityList();
            });
        }

        // 绑定"全炉速览"快捷按钮 (在优先级列表上方)
        const btnOverviewTop = document.getElementById('btn-furnace-overview-top');
        if (btnOverviewTop) {
            btnOverviewTop.addEventListener('click', () => {
                // 触发跳转到预览页并打开速览
                window.dispatchEvent(new CustomEvent('open-furnace-overview'));
            });
        }

        // 监听炉膛删除事件
        window.addEventListener('furnace-deleted', () => {
            this.refreshFurnacePriorityList();
        });

        // 初始化炉膛优先级排序
        this.refreshFurnacePriorityList();
    }

    /**
     * 获取当前炉膛优先级顺序
     */
    getFurnacePriorityOrder() {
        const container = document.getElementById('furnace-priority-list');
        if (!container) return this.furnacePriorityOrder;

        const nodes = container.querySelectorAll('.furnace-priority-node');
        if (nodes.length === 0) return this.furnacePriorityOrder;

        const order = [];
        nodes.forEach(node => {
            const name = node.getAttribute('data-furnace-name');
            if (name) order.push(name);
        });
        this.furnacePriorityOrder = order;
        return order;
    }

    /**
     * 刷新炉膛优先级排序列表
     */
    refreshFurnacePriorityList() {
        const container = document.getElementById('furnace-priority-list');
        if (!container) return;

        const furnaceData = this.formManager.getFurnacesData();

        if (furnaceData.length === 0) {
            container.innerHTML = '<div style="color: #666; font-size: 11px; text-align: center; padding: 10px;">添加炉膛后自动生成排序节点</div>';
            return;
        }

        const existingOrder = this.getFurnacePriorityOrder();
        const currentNames = furnaceData.map(f => f.name);
        const needsInit = existingOrder.length === 0 ||
            !currentNames.every(n => existingOrder.includes(n)) ||
            currentNames.length !== existingOrder.length;

        if (needsInit) {
            const seen = new Set(existingOrder);
            const newOrder = [...existingOrder.filter(n => currentNames.includes(n))];
            currentNames.forEach(n => {
                if (!seen.has(n)) {
                    newOrder.push(n);
                }
            });
            this.furnacePriorityOrder = newOrder;
        } else {
            this.furnacePriorityOrder = [...existingOrder];
        }

        // 计算每台炉膛的规格
        const furnaceSpecMap = {};
        furnaceData.forEach(f => {
            if (!furnaceSpecMap[f.name]) {
                furnaceSpecMap[f.name] = {
                    width: f.width,
                    height: f.height,
                    depth: f.depth,
                    count: 0,
                    instances: []
                };
            }
            furnaceSpecMap[f.name].count++;
        });

        let html = '';
        this.furnacePriorityOrder.forEach((fName, idx) => {
            const fData = furnaceData.find(f => f.name === fName);
            if (!fData) return;

            const spec = furnaceSpecMap[fName];
            const instanceCount = spec ? spec.count : 1;

            const numberBadge = '<span class="priority-num-badge">' + (idx + 1) + '</span>';

            let priorityLabel = '';
            if (idx === 0) {
                priorityLabel = '<span class="priority-label high">第1优先级·最优满载</span>';
            } else if (idx === 1) {
                priorityLabel = '<span class="priority-label high">第2优先级·优先装满</span>';
            } else if (idx >= this.furnacePriorityOrder.length - 2 && this.furnacePriorityOrder.length > 3) {
                priorityLabel = '<span class="priority-label low">后续装满</span>';
            }

            html += '<div class="furnace-priority-node" data-furnace-name="' + fName + '" draggable="true">';
            html += '<span class="priority-drag-handle">≡</span>';
            html += numberBadge;
            html += '<div class="priority-info">';
            html += '<span class="priority-name">' + fName + '</span>';
            html += '<span class="priority-dims">' + Math.round(fData.width) + ' × ' + Math.round(fData.height) + ' × ' + Math.round(fData.depth) + ' · ' + instanceCount + '可用数量</span>';
            html += '</div>';
            html += priorityLabel;
            html += '</div>';
        });

        container.innerHTML = html;
        this._bindPriorityDragEvents(container);
    }

    /**
     * 绑定拖拽排序事件
     */
    _bindPriorityDragEvents(container) {
        const nodes = container.querySelectorAll('.furnace-priority-node');
        let dragSrcEl = null;
        let dragSrcIndex = -1;

        nodes.forEach(node => {
            node.addEventListener('dragstart', (e) => {
                dragSrcEl = node;
                const allNodes = [...container.querySelectorAll('.furnace-priority-node')];
                dragSrcIndex = allNodes.indexOf(node);
                node.classList.add('dragging');
                node.style.opacity = '0.5';
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', node.getAttribute('data-furnace-name'));
            });

            node.addEventListener('dragenter', (e) => {
                e.preventDefault();
                if (node !== dragSrcEl) {
                    node.classList.add('drag-over');
                }
            });

            node.addEventListener('dragleave', () => {
                node.classList.remove('drag-over');
            });

            node.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });

            node.addEventListener('drop', (e) => {
                e.stopPropagation();
                node.classList.remove('drag-over');

                const allNodes = [...container.querySelectorAll('.furnace-priority-node')];
                const dstIdx = allNodes.indexOf(node);

                if (dragSrcEl !== node && dragSrcIndex >= 0 && dstIdx >= 0) {
                    if (dragSrcIndex < dstIdx) {
                        container.insertBefore(dragSrcEl, node.nextSibling);
                    } else {
                        container.insertBefore(dragSrcEl, node);
                    }

                    this._refreshPriorityNumbers();
                    this.getFurnacePriorityOrder();

                    dragSrcEl.style.transition = 'background 0.3s, box-shadow 0.3s';
                    dragSrcEl.style.background = '#2d2d1a';
                    dragSrcEl.style.boxShadow = '0 0 12px rgba(243,156,18,0.3)';
                    setTimeout(() => {
                        dragSrcEl.style.background = '';
                        dragSrcEl.style.boxShadow = '';
                    }, 400);
                }

                return false;
            });

            node.addEventListener('dragend', () => {
                node.classList.remove('dragging');
                node.style.opacity = '1';
                nodes.forEach(n => n.classList.remove('drag-over'));
            });
        });
    }

    /**
     * 刷新优先级编号
     */
    _refreshPriorityNumbers() {
        const container = document.getElementById('furnace-priority-list');
        if (!container) return;
        const nodes = container.querySelectorAll('.furnace-priority-node');

        nodes.forEach((node, idx) => {
            const numBadge = node.querySelector('.priority-num-badge');
            if (numBadge) {
                numBadge.textContent = idx + 1;
            }

            const labelEl = node.querySelector('.priority-label');
            if (labelEl) {
                if (idx === 0) {
                    labelEl.textContent = '第1优先级·最优满载';
                    labelEl.className = 'priority-label high';
                } else if (idx === 1) {
                    labelEl.textContent = '第2优先级·优先装满';
                    labelEl.className = 'priority-label high';
                } else if (idx >= nodes.length - 2 && nodes.length > 3) {
                    labelEl.textContent = '后续装满';
                    labelEl.className = 'priority-label low';
                } else {
                    labelEl.textContent = '';
                    labelEl.className = 'priority-label';
                }
            }
        });
    }
}
