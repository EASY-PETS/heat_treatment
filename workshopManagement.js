/**
     * 从自建的 Azure 后端接口（飞书多维表格代理）动态拉取车间炉膛资产
     */
    _loadWorkshopFurnaces() {
        // MVP 试用阶段，可以通过登录成功后写入 sessionStorage 的用户标识来区分客户
        // 比如影在科技就是 'client_ensign_tech'
        const currentClientId = sessionStorage.getItem('client_id') || 'client_ensign_tech';

        // 提示加载中
        const container = document.getElementById('workshop-furnaces-container');
        if (container) {
            container.innerHTML = `<div style="color: #0071e3; font-size: 11px; text-align: center; padding: 10px;">⚡ 正在安全接入云端车间资产库...</div>`;
        }

        fetch('/api/furnaces', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-client-id': currentClientId // 核心隔离控制：告诉后端我是谁
            }
        })
        .then(response => {
            if (!response.ok) throw new Error('云端安全校验未通过');
            return response.json();
        })
        .then(data => {
            // 完美适配并覆盖你原先的数组
            this.workshopFurnaces = data.map((f, index) => ({
                id: 'ws_f_' + index,
                name: f.name,
                width: f.width,
                height: f.height,
                depth: f.depth,
                maxWeight: f.maxWeight,
                status: 'available'
            }));
            
            // 重新渲染车间可用炉膛列表
            this._renderWorkshopFurnaces();
            
            // 广播事件或直接刷新右侧刚做好的“全部炉膛快捷预览迷你大盘”
            window.dispatchEvent(new CustomEvent('furnace-list-changed'));
        })
        .catch(err => {
            console.error('从飞书同步资产失败:', err);
            if (container) {
                container.innerHTML = `<div style="color: var(--danger-color); font-size: 11px; text-align: center; padding: 10px;">❌ 云端同步失败，已启用离线降级方案</div>`;
            }
            // 兜底容错数据，防止断网时界面白屏
            this.workshopFurnaces = [
                { id: 'ws_f_backup', name: '标准应急台车炉(本地)', width: 400, height: 200, depth: 200, maxWeight: 15000, status: 'available' }
            ];
            this._renderWorkshopFurnaces();
        });
    }