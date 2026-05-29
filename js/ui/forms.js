// ==================== 表单管理模块 ====================

/**
 * 表单管理器 - 处理炉膛和工件表单
 */
class FormManager {
    constructor() {
        this.furnaceCounter = 0;
        this.itemCounter = 0;
    }

    /**
     * 添加炉膛行
     */
    addFurnaceRow(name, depth, width, height, maxWeight, count) {
        this.furnaceCounter++;
        const container = document.getElementById('furnaces-container');
        const row = document.createElement('div');
        row.className = 'item-row furnace-row';
        row.id = `furnace-row-${this.furnaceCounter}`;
        row.innerHTML = `
            <button class="btn-delete" onclick="document.getElementById('${row.id}').remove()">X</button>
            <div class="form-line">
                <label style="flex: 1.8;">炉膛资产名称 <input type="text" class="f-name" value="${name}"></label>
                <label style="flex: 1.2;">车间可用台数 <input type="number" class="f-count" value="${count}"></label>
            </div>
            <div class="form-line">
                <label>有效纵深 (Z/mm) <input type="number" class="f-depth" value="${depth}"></label>
                <label>有效宽度 (X/mm) <input type="number" class="f-width" value="${width}"></label>
            </div>
            <div class="form-line">
                <label>有效高度 (Y/mm) <input type="number" class="f-height" value="${height}"></label>
                <label>承重上限 (kg) <input type="number" class="f-weight" value="${maxWeight}"></label>
            </div>
        `;
        container.appendChild(row);
    }

    /**
     * 添加工件行
     */
    addItemRow(name, shape, count, dim1, dim2, dim3, totalWeight, color) {
        this.itemCounter++;
        const container = document.getElementById('items-container');
        const row = document.createElement('div');
        row.className = 'item-row';
        row.id = `item-row-${this.itemCounter}`;
        row.innerHTML = `
            <button class="btn-delete" onclick="document.getElementById('${row.id}').remove()">X</button>
            <div class="form-line">
                <label style="flex: 1.8;">工件批次名称 <input type="text" class="item-name" value="${name}"></label>
                <label style="flex: 1.2;">几何形态 <select class="item-shape" onchange="toggleShapeInputs(${this.itemCounter}, this.value)">
                    <option value="cuboid" ${shape==='cuboid'?'selected':''}>立方体</option>
                    <option value="cylinder" ${shape==='cylinder'?'selected':''}>圆柱体</option>
                </select></label>
            </div>
            <div class="form-line">
                <label>批次总量 <input type="number" class="item-count" value="${count}"></label>
                <label class="lbl-dim1"><span>${shape==='cylinder'?'直径':'长度'}</span> <input type="number" class="item-dim1" value="${dim1}"></label>
                <label class="lbl-dim2" style="display: ${shape==='cylinder'?'none':'block'}">宽度 <input type="number" class="item-dim2" value="${dim2}"></label>
            </div>
            <div class="form-line">
                <label>高度 <input type="number" class="item-dim3" value="${dim3}"></label>
                <label>整批总重(kg) <input type="number" class="item-weight" value="${totalWeight}"></label>
                <label style="max-width: 65px;">渲染色彩 <input type="color" class="item-color" value="${color}" style="padding:0; height:32px; cursor:pointer;"></label>
            </div>
        `;
        container.appendChild(row);
    }

    /**
     * 获取所有炉膛数据
     */
    getFurnacesData() {
        const furnaces = [];
        document.querySelectorAll('.furnace-row').forEach(row => {
            furnaces.push({
                name: row.querySelector('.f-name').value,
                count: parseInt(row.querySelector('.f-count').value || 1),
                width: parseFloat(row.querySelector('.f-width').value),
                height: parseFloat(row.querySelector('.f-height').value),
                depth: parseFloat(row.querySelector('.f-depth').value),
                maxWeight: parseFloat(row.querySelector('.f-weight').value)
            });
        });
        return furnaces;
    }

    /**
     * 获取所有工件数据
     */
    getItemsData() {
        const items = [];
        document.querySelectorAll('.item-row:not(.furnace-row)').forEach(row => {
            items.push({
                name: row.querySelector('.item-name').value,
                shape: row.querySelector('.item-shape').value,
                count: parseInt(row.querySelector('.item-count').value),
                dim1: parseFloat(row.querySelector('.item-dim1').value),
                dim2: parseFloat(row.querySelector('.item-dim2').value || 0),
                dim3: parseFloat(row.querySelector('.item-dim3').value),
                weight: parseFloat(row.querySelector('.item-weight').value),
                color: row.querySelector('.item-color').value
            });
        });
        return items;
    }

    /**
     * 获取间距设置
     */
    getSpacing() {
        return parseFloat(document.getElementById('global-spacing').value || 0);
    }

    /**
     * 初始化默认数据
     */
    initDefaultData(defaultFurnaces, defaultItems) {
        defaultFurnaces.forEach(f => {
            this.addFurnaceRow(f.name, f.depth, f.width, f.height, f.maxWeight, f.count);
        });
        defaultItems.forEach(item => {
            this.addItemRow(item.name, item.shape, item.count, item.dim1, item.dim2, item.dim3, item.weight, item.color);
        });
    }

    /**
     * 清空所有表单
     */
    clearAll() {
        document.getElementById('furnaces-container').innerHTML = '';
        document.getElementById('items-container').innerHTML = '';
        this.furnaceCounter = 0;
        this.itemCounter = 0;
    }
}

// 全局函数：切换形状输入
window.toggleShapeInputs = function(id, val) {
    const row = document.getElementById(`item-row-${id}`);
    if (!row) return;
    
    const lblDim2 = row.querySelector('.lbl-dim2');
    const lblDim1Span = row.querySelector('.lbl-dim1 span');
    if (val === 'cylinder') {
        lblDim2.style.display = 'none';
        lblDim1Span.innerText = "直径";
    } else {
        lblDim2.style.display = 'block';
        lblDim1Span.innerText = "长度";
    }
};

export default FormManager;