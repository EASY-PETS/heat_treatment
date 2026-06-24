(() => {
    const params = new URLSearchParams(window.location.search);

    const API_BASE =
        params.get('api') ||
        (
            location.hostname === '127.0.0.1' ||
            location.hostname === 'localhost'
                ? 'http://74.248.33.0'
                : ''
        );
    const CLIENT_ID = localStorage.getItem('heat_mobile_client_id') || 'client_suoli';

    const state = {
        activePage: 'orders',
        orders: [],
        orderFilter: 'all',
        loadingOrders: false,
        tasks: [],
        taskFilter: 'all',
        loadingTasks: false,
        plans: [],
        planFilter: 'all',
        loadingPlans: false,
        selectedPlanId: '',
        comparePlanIds: []
    };

    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => Array.from(document.querySelectorAll(selector));

    function normalizeDate(value) {
        if (!value) return '-';
        if (typeof value === 'number') {
            const d = new Date(value);
            return Number.isNaN(d.getTime()) ? '-' : d.toISOString().slice(0, 10);
        }
        const text = String(value).trim();
        if (!text) return '-';
        return text.slice(0, 10);
    }

    function formatWeight(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return '-';
        return `${Math.round(n * 10) / 10}kg`;
    }

    function safeText(value, fallback = '-') {
        const text = String(value ?? '').trim();
        return text || fallback;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function showToast(message) {
        const toast = $('#toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
    }

    function setActivePage(page) {
        state.activePage = page;

        $$('.page').forEach(el => {
            el.classList.toggle('is-active', el.dataset.page === page);
        });

        $$('.tab-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.target === page);
        });

        if (page === 'orders' && state.orders.length === 0 && !state.loadingOrders) loadOrders();
        if (page === 'tasks' && state.tasks.length === 0 && !state.loadingTasks) loadTasks();
        if (page === 'plans' && state.plans.length === 0 && !state.loadingPlans) loadPlans();
    }

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json; charset=utf-8',
                'x-client-id': CLIENT_ID,
                ...(options.headers || {})
            }
        });

        const text = await response.text();
        let data = null;

        try {
            data = text ? JSON.parse(text) : null;
        } catch (error) {
            throw new Error(`后端没有返回有效 JSON：${text.slice(0, 100)}`);
        }

        if (!response.ok || data?.ok === false) {
            const msg = data?.error || data?.message || `HTTP ${response.status}`;
            throw new Error(msg);
        }

        return data;
    }

    function getOrderStatusClass(status) {
        if (status === '已转换') return 'done';
        if (status === '待转换') return 'waiting';
        if (status === '退回修改' || status === '信息不完整') return 'risk';
        return '';
    }

    function getOrderDims(order) {
        if (order.shape === 'cylinder' || String(order.shapeText || '').includes('圆')) {
            return `Φ${safeText(order.diameter)} × ${safeText(order.height)}mm`;
        }
        return `${safeText(order.length)} × ${safeText(order.width)} × ${safeText(order.height)}mm`;
    }

    function renderOrders() {
        const list = $('#ordersList');
        const count = $('#ordersCount');
        if (!list) return;

        const filtered = state.orderFilter === 'all'
            ? state.orders
            : state.orders.filter(order => safeText(order.status, '') === state.orderFilter);

        if (count) count.textContent = `${filtered.length} 条`;

        const readyOrdersCount = state.orders.filter(order => safeText(order.status, '') === '待转换').length;
        const batchBtn = $('#batchConvertBtn');
        if (batchBtn) {
            batchBtn.textContent = readyOrdersCount > 0
                ? `生成已确认订单（${readyOrdersCount}）`
                : '暂无可生成';
            batchBtn.disabled = readyOrdersCount === 0;
            batchBtn.classList.toggle('disabled', readyOrdersCount === 0);
        }

        if (!filtered.length) {
            list.innerHTML = `
                <article class="empty-card">
                    <div class="empty-icon">📋</div>
                    <h3>暂无订单草稿</h3>
                    <p>请先在飞书群 @机器人 提交订单，或检查订单是否已经转换。</p>
                </article>
            `;
            return;
        }

        list.innerHTML = filtered.map(order => {
            const status = safeText(order.status, '待确认');
            const isConverted = status === '已转换';
            const isReady = status === '待转换';
            const cardClass = isConverted ? 'converted' : (isReady ? 'confirmed' : '');
            const missing = safeText(order.missingFields, '');
            const uncertain = safeText(order.uncertainFields, '');
            const title = safeText(order.productName, '未命名产品');
            const customer = safeText(order.customer);
            const sub = [safeText(order.itemCode, ''), customer].filter(Boolean).join(' · ') || safeText(order.recordId);

            return `
                <article class="order-card ${cardClass}">
                    <div class="card-head">
                        <div>
                            <h3 class="card-title">${escapeHtml(title)}</h3>
                            <p class="card-subtitle">${escapeHtml(sub)}</p>
                        </div>
                        <span class="status ${getOrderStatusClass(status)}">${escapeHtml(status)}</span>
                    </div>

                    <div class="meta-grid">
                        <div class="meta-item"><span>客户</span><strong>${escapeHtml(customer)}</strong></div>
                        <div class="meta-item"><span>工艺</span><strong>${escapeHtml(safeText(order.process))}</strong></div>
                        <div class="meta-item"><span>材质 / 硬度</span><strong>${escapeHtml(safeText(order.material))} · ${escapeHtml(safeText(order.hardness))}</strong></div>
                        <div class="meta-item"><span>数量 / 重量</span><strong>${escapeHtml(safeText(order.count))}件 · ${escapeHtml(formatWeight(order.totalWeight))}</strong></div>
                        <div class="meta-item"><span>尺寸</span><strong>${escapeHtml(getOrderDims(order))}</strong></div>
                        <div class="meta-item"><span>交期</span><strong>${escapeHtml(normalizeDate(order.deliveryDate))}</strong></div>
                    </div>

                    ${missing ? `<p class="warning-line">⚠️ 缺失字段：${escapeHtml(missing)}</p>` : ''}
                    ${uncertain ? `<p class="warning-line">⚠️ 待确认字段：${escapeHtml(uncertain)}</p>` : ''}
                    ${isReady ? `<p class="success-line">✅ 已确认，等待顶部“生成已确认订单”统一生成生产任务。</p>` : ''}
                    ${isConverted ? `<p class="success-line">✅ 已转换为生产任务：${escapeHtml(safeText(order.productionTaskRecordId))}</p>` : ''}
                    ${order.remark ? `<p class="card-note">${escapeHtml(order.remark)}</p>` : ''}
                    ${order.rawMessage ? `<details class="raw-message"><summary>查看原始消息</summary><pre>${escapeHtml(order.rawMessage)}</pre></details>` : ''}

                    <div class="card-actions single-primary">
                        ${
                            isConverted
                                ? `<button class="action-btn status-only" type="button" disabled>已生成生产任务</button>`
                                : isReady
                                    ? `<button class="action-btn status-only" type="button" disabled>已确认，等待生成</button>`
                                    : `<button class="action-btn primary" data-action="confirm-order" data-record-id="${escapeHtml(order.recordId)}" type="button">确认转任务</button>`
                        }
                        <button class="action-btn copy-link-btn" data-action="copy-order" data-record-id="${escapeHtml(order.recordId)}" type="button">复制订单</button>
                    </div>
                </article>
            `;
        }).join('');
    }

    async function loadOrders() {
        const list = $('#ordersList');
        const count = $('#ordersCount');

        state.loadingOrders = true;
        if (list) list.innerHTML = `<article class="loading-card">正在同步飞书订单草稿...</article>`;
        if (count) count.textContent = '加载中';

        try {
            const data = await fetchJson(`${API_BASE}/api/feishu/order-drafts`);
            state.orders = Array.isArray(data.drafts) ? data.drafts : [];
            renderOrders();
            showToast(`已同步 ${state.orders.length} 条订单草稿`);
        } catch (error) {
            if (count) count.textContent = '失败';
            if (list) {
                list.innerHTML = `
                    <article class="error-card">
                        <strong>订单草稿同步失败</strong>
                        <p>${escapeHtml(error.message)}</p>
                        <p>请确认 server.js 已升级到 V1.0，并检查 /api/health。</p>
                    </article>
                `;
            }
            showToast(`同步失败：${error.message}`);
        } finally {
            state.loadingOrders = false;
        }
    }

    async function confirmOrder(recordId) {
        if (!recordId) return;
        if (!window.confirm('确认该订单草稿无误，并允许生成生产任务吗？')) return;

        showToast('正在确认订单...');
        try {
            await fetchJson(`${API_BASE}/api/feishu/order-drafts/${encodeURIComponent(recordId)}/confirm`, {
                method: 'POST',
                body: JSON.stringify({ source: 'mobile.html' })
            });
            showToast('订单已确认');
            await loadOrders();
        } catch (error) {
            showToast(`确认失败：${error.message}`);
        }
    }

    async function rejectOrder(recordId) {
        if (!recordId) return;
        if (!window.confirm('确认退回该订单草稿？')) return;

        showToast('正在退回订单...');
        try {
            await fetchJson(`${API_BASE}/api/feishu/order-drafts/${encodeURIComponent(recordId)}/reject`, {
                method: 'POST',
                body: JSON.stringify({ source: 'mobile.html' })
            });
            showToast('订单已退回');
            await loadOrders();
        } catch (error) {
            showToast(`退回失败：${error.message}`);
        }
    }

    function buildOrderCopyText(order) {
        return [
            `客户：${safeText(order.customer)}`,
            `产品名称：${safeText(order.productName)}`,
            `物料编码：${safeText(order.itemCode)}`,
            `材质：${safeText(order.material)}`,
            `工艺：${safeText(order.process)}`,
            `数量：${safeText(order.count)}`,
            `总重量：${formatWeight(order.totalWeight)}`,
            `交期：${normalizeDate(order.deliveryDate)}`,
            `硬度要求：${safeText(order.hardness)}`,
            `形状：${safeText(order.shapeText)}`,
            order.shape === 'cylinder' ? `直径：${safeText(order.diameter)}` : `长度：${safeText(order.length)}`,
            order.shape === 'cylinder' ? `高度：${safeText(order.height)}` : `宽度：${safeText(order.width)}`,
            order.shape === 'cylinder' ? '' : `高度：${safeText(order.height)}`,
            `备注：${safeText(order.remark, '')}`
        ].filter(Boolean).join('\n');
    }

    async function batchConvertOrders() {
        if (!window.confirm('确认将所有“已确认/待转换”的订单生成生产任务吗？')) return;

        showToast('正在批量生成生产任务...');
        try {
            const data = await fetchJson(`${API_BASE}/api/feishu/order-drafts/convert`, {
                method: 'POST',
                body: JSON.stringify({ dryRun: false, batch: true })
            });
            showToast(`已生成 ${data.convertedCount || 0} 条，跳过 ${data.skippedCount || 0} 条`);
            await loadOrders();
            await loadTasks();
        } catch (error) {
            showToast(`批量生成失败：${error.message}`);
        }
    }

    function getTaskStatusClass(status) {
        if (status === '已生成方案') return 'done';
        if (status === '待排产' || !status) return 'waiting';
        return '';
    }

    function renderTasks() {
        const list = $('#tasksList');
        const count = $('#tasksCount');
        if (!list) return;

        const filtered = state.taskFilter === 'all'
            ? state.tasks
            : state.tasks.filter(task => safeText(task.status, '') === state.taskFilter);

        if (count) count.textContent = `${filtered.length} 条`;

        const readyOrdersCount = state.orders.filter(order => safeText(order.status, '') === '待转换').length;
        const batchBtn = $('#batchConvertBtn');
        if (batchBtn) {
            batchBtn.textContent = readyOrdersCount > 0
                ? `生成已确认订单（${readyOrdersCount}）`
                : '暂无可生成';
            batchBtn.disabled = readyOrdersCount === 0;
            batchBtn.classList.toggle('disabled', readyOrdersCount === 0);
        }

        if (!filtered.length) {
            list.innerHTML = `
                <article class="empty-card">
                    <div class="empty-icon">🏭</div>
                    <h3>暂无生产任务</h3>
                    <p>请先在飞书群生成生产任务，或检查任务状态是否为「待排产」。</p>
                </article>
            `;
            return;
        }

        list.innerHTML = filtered.map(task => {
            const dims = task.shape === 'cylinder'
                ? `Φ${safeText(task.diameter || task.dim1)} × ${safeText(task.height || task.dim3)}mm`
                : `${safeText(task.length || task.dim1)} × ${safeText(task.width || task.dim2)} × ${safeText(task.height || task.dim3)}mm`;
            const title = safeText(task.name || `${task.showName || ''}_${task.customer || ''}`, '未命名任务');

            return `
                <article class="task-card">
                    <div class="card-head">
                        <div>
                            <h3 class="card-title">${escapeHtml(title)}</h3>
                            <p class="card-subtitle">${escapeHtml(safeText(task.taskId || task.recordId))}</p>
                        </div>
                        <span class="status ${getTaskStatusClass(task.status)}">${escapeHtml(safeText(task.status, '待排产'))}</span>
                    </div>

                    <div class="meta-grid">
                        <div class="meta-item"><span>客户</span><strong>${escapeHtml(safeText(task.customer))}</strong></div>
                        <div class="meta-item"><span>工艺</span><strong>${escapeHtml(safeText(task.process))}</strong></div>
                        <div class="meta-item"><span>材质 / 硬度</span><strong>${escapeHtml(safeText(task.material))} · ${escapeHtml(safeText(task.hardness))}</strong></div>
                        <div class="meta-item"><span>数量 / 重量</span><strong>${escapeHtml(safeText(task.count))}件 · ${escapeHtml(formatWeight(task.totalWeight))}</strong></div>
                        <div class="meta-item"><span>尺寸</span><strong>${escapeHtml(dims)}</strong></div>
                        <div class="meta-item"><span>交期</span><strong>${escapeHtml(normalizeDate(task.deliveryDate))}</strong></div>
                    </div>

                    ${task.remark ? `<p class="card-note">${escapeHtml(task.remark)}</p>` : ''}

                    <div class="card-actions">
                        <button class="action-btn secondary" data-action="copy-task" data-task-id="${escapeHtml(task.taskId || task.recordId)}" type="button">复制任务号</button>
                        <button class="action-btn primary" data-action="open-ipad" type="button">去 iPad 生成方案</button>
                    </div>
                </article>
            `;
        }).join('');
    }

    async function loadTasks() {
        const list = $('#tasksList');
        const count = $('#tasksCount');

        state.loadingTasks = true;
        if (list) list.innerHTML = `<article class="loading-card">正在同步飞书生产任务...</article>`;
        if (count) count.textContent = '加载中';

        try {
            const data = await fetchJson(`${API_BASE}/api/feishu/tasks`);
            state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
            renderTasks();
            showToast(`已同步 ${state.tasks.length} 条生产任务`);
        } catch (error) {
            if (count) count.textContent = '失败';
            if (list) {
                list.innerHTML = `
                    <article class="error-card">
                        <strong>飞书任务同步失败</strong>
                        <p>${escapeHtml(error.message)}</p>
                        <p>请确认 Node server.js 正常运行，并检查 /api/health。</p>
                    </article>
                `;
            }
            showToast(`同步失败：${error.message}`);
        } finally {
            state.loadingTasks = false;
        }
    }

    async function copyText(text, fallbackMessage = '已复制') {
        try {
            await navigator.clipboard.writeText(text);
            showToast(fallbackMessage);
        } catch {
            showToast(text.slice(0, 80) || '无内容');
        }
    }


    function formatPercent(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return '-';
        return `${Math.round(n * 10) / 10}%`;
    }

    function getPlanStatusClass(plan) {
        const risk = String(plan.riskLevel || '').trim();
        if (risk.includes('高')) return 'risk-high';
        if (risk.includes('中')) return 'risk-mid';
        if (risk.includes('低')) return 'risk-low';
        return plan.generationStatus === '已生成' ? 'done' : 'waiting';
    }

    function getFilteredPlans() {
        if (state.planFilter === 'all') return state.plans;
        if (state.planFilter === '已生成') {
            return state.plans.filter(plan => safeText(plan.generationStatus, '') === '已生成' || safeText(plan.status, '') === '已生成');
        }
        if (state.planFilter === '低风险') {
            return state.plans.filter(plan => safeText(plan.riskLevel, '').includes('低'));
        }
        if (state.planFilter === '中高风险') {
            return state.plans.filter(plan => {
                const risk = safeText(plan.riskLevel, '');
                return risk.includes('中') || risk.includes('高');
            });
        }
        return state.plans;
    }

    
    function getPlanMobileSummary(plan) {
        const summary = plan?.mobileSummary && typeof plan.mobileSummary === 'object'
            ? plan.mobileSummary
            : {};
        const enabled = !!summary.enabled;
        return {
            enabled,
            finalVersionName: safeText(summary.finalVersionName, ''),
            currentVersionName: safeText(summary.currentVersionName, ''),
            currentVersionTypeLabel: safeText(summary.currentVersionTypeLabel, ''),
            executionStatus: safeText(summary.executionStatus, enabled ? '已生成方案' : ''),
            adjustmentSummary: safeText(summary.adjustmentSummary, ''),
            compareConclusion: safeText(summary.compareConclusion, ''),
            simulationConclusion: safeText(summary.simulationConclusion, ''),
            needSimulation: !!summary.needSimulation,
            simulationLevel: safeText(summary.simulationLevel, ''),
            simulationModules: Array.isArray(summary.simulationModules) ? summary.simulationModules : [],
            versions: Array.isArray(summary.versions) ? summary.versions : []
        };
    }

    function getMobilePlanTags(plan) {
        const summary = getPlanMobileSummary(plan);
        const tags = [];
        if (summary.finalVersionName) tags.push({ text: '最终版', cls: 'final' });
        else if (summary.currentVersionName) tags.push({ text: '版本链', cls: 'version' });
        if (summary.adjustmentSummary) tags.push({ text: '总工调整', cls: 'adjusted' });
        if (summary.needSimulation) tags.push({ text: '建议仿真', cls: 'simulation' });
        return tags;
    }

    function renderMobilePlanTags(plan) {
        const tags = getMobilePlanTags(plan);
        if (!tags.length) return '';
        return `<div class="mobile-plan-tags">${tags.map(tag => `<span class="${tag.cls}">${escapeHtml(tag.text)}</span>`).join('')}</div>`;
    }

    function renderMobileSummarySection(plan) {
        const summary = getPlanMobileSummary(plan);
        if (!summary.enabled) {
            return `
                <section class="mobile-summary-panel muted">
                    <div class="detail-section-title">执行与对比摘要</div>
                    <p>当前飞书方案记录尚未包含“最终执行版 / 总工调整说明 / 仿真摘要”。电脑端保存最终版并再次写回飞书后，这里会显示只读摘要。</p>
                </section>
            `;
        }

        const versionName = summary.finalVersionName || summary.currentVersionName || '未标注版本';
        const simClass = summary.needSimulation ? 'warning' : 'safe';
        const simText = summary.simulationConclusion || (summary.needSimulation ? '建议进一步仿真复核。' : '暂无仿真风险提示。');

        return `
            <section class="mobile-summary-panel">
                <div class="detail-section-title">最终执行与版本摘要</div>
                <div class="execution-hero">
                    <span>${escapeHtml(summary.executionStatus || (summary.finalVersionName ? '最终版已确认' : '当前版本'))}</span>
                    <strong>${escapeHtml(versionName)}</strong>
                    ${summary.currentVersionTypeLabel ? `<small>${escapeHtml(summary.currentVersionTypeLabel)}</small>` : ''}
                </div>

                <div class="mobile-summary-card">
                    <span>总工调整说明</span>
                    <p>${escapeHtml(summary.adjustmentSummary || '暂无人工调整说明。')}</p>
                </div>

                <div class="mobile-summary-card">
                    <span>对比结论</span>
                    <p>${escapeHtml(summary.compareConclusion || '暂无版本对比结论。')}</p>
                </div>

                <div class="mobile-summary-card ${simClass}">
                    <span>仿真摘要 / 建议</span>
                    <p>${escapeHtml(simText)}</p>
                    ${summary.simulationModules.length ? `<div class="sim-module-tags">${summary.simulationModules.map(item => `<em>${escapeHtml(item)}</em>`).join('')}</div>` : ''}
                </div>

                ${summary.versions.length ? `
                    <div class="version-mini-list">
                        ${summary.versions.slice().reverse().slice(0, 4).map(v => `
                            <div class="version-mini-item ${v.isFinal ? 'final' : ''} ${v.isCurrent ? 'current' : ''}">
                                <strong>${escapeHtml(v.versionName || '方案版本')}</strong>
                                <span>${escapeHtml(v.versionTypeLabel || '')}${v.isCurrent ? ' · 当前' : ''}${v.isFinal ? ' · 最终' : ''}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </section>
        `;
    }

    function buildMobilePlanDecisionText(plan) {
        const summary = getPlanMobileSummary(plan);
        if (summary.compareConclusion) return summary.compareConclusion;
        if (summary.finalVersionName) return `当前方案已有最终执行版：${summary.finalVersionName}`;
        if (summary.currentVersionName) return `当前方案已有版本记录：${summary.currentVersionName}`;
        return safeText(plan.summary, '暂无方案对比结论。');
    }


function renderPlanCompareBar() {
        const bar = $('#planCompareBar');
        const clearBtn = $('#clearCompareBtn');
        if (!bar) return;

        const selected = state.comparePlanIds
            .map(id => state.plans.find(plan => plan.recordId === id))
            .filter(Boolean);

        if (clearBtn) {
            clearBtn.textContent = selected.length ? `清空对比（${selected.length}）` : '暂无对比';
            clearBtn.disabled = selected.length === 0;
            clearBtn.classList.toggle('disabled', selected.length === 0);
        }

        if (!selected.length) {
            bar.classList.add('is-hidden');
            bar.innerHTML = '';
            return;
        }

        bar.classList.remove('is-hidden');

        if (selected.length === 1) {
            const only = selected[0];
            bar.innerHTML = `
                <h3>已选择 1 个方案</h3>
                <p>${escapeHtml(buildMobilePlanDecisionText(only)).slice(0, 120)}</p>
                <p>再选择一个方案后，可以快速对比执行状态、风险、重量利用率和空间利用率。</p>
            `;
            return;
        }

        const [a, b] = selected;
        const aSummary = getPlanMobileSummary(a);
        const bSummary = getPlanMobileSummary(b);

        bar.innerHTML = `
            <h3>手机端方案摘要对比</h3>
            <p>${escapeHtml(safeText(a.planName))} vs ${escapeHtml(safeText(b.planName))}</p>
            <table class="compare-table">
                <tr><th>指标</th><th>方案 A</th><th>方案 B</th></tr>
                <tr><td>执行版本</td><td>${escapeHtml(aSummary.finalVersionName || aSummary.currentVersionName || '-')}</td><td>${escapeHtml(bSummary.finalVersionName || bSummary.currentVersionName || '-')}</td></tr>
                <tr><td>客户</td><td>${escapeHtml(safeText(a.customer))}</td><td>${escapeHtml(safeText(b.customer))}</td></tr>
                <tr><td>工艺</td><td>${escapeHtml(safeText(a.process))}</td><td>${escapeHtml(safeText(b.process))}</td></tr>
                <tr><td>重量利用率</td><td>${escapeHtml(formatPercent(a.weightUtilizationPercent))}</td><td>${escapeHtml(formatPercent(b.weightUtilizationPercent))}</td></tr>
                <tr><td>空间利用率</td><td>${escapeHtml(formatPercent(a.spaceUtilizationPercent))}</td><td>${escapeHtml(formatPercent(b.spaceUtilizationPercent))}</td></tr>
                <tr><td>风险</td><td>${escapeHtml(safeText(a.riskLevel))}</td><td>${escapeHtml(safeText(b.riskLevel))}</td></tr>
                <tr><td>结论</td><td>${escapeHtml(buildMobilePlanDecisionText(a)).slice(0, 80)}</td><td>${escapeHtml(buildMobilePlanDecisionText(b)).slice(0, 80)}</td></tr>
            </table>
        `;
    }

    function renderPlanDetail() {
        const panel = $('#planDetailPanel');
        if (!panel) return;

        const plan = state.plans.find(item => item.recordId === state.selectedPlanId);
        if (!plan) {
            panel.classList.add('is-hidden');
            panel.innerHTML = '';
            return;
        }

        panel.classList.remove('is-hidden');
        panel.innerHTML = `
            <h3>${escapeHtml(safeText(plan.planName, '未命名方案'))}</h3>
            <p class="detail-subtitle">${escapeHtml(safeText(plan.sourceTask, '无来源任务'))} · ${escapeHtml(safeText(plan.customer))}</p>
            ${renderMobilePlanTags(plan)}

            <div class="meta-grid">
                <div class="meta-item"><span>工艺</span><strong>${escapeHtml(safeText(plan.process))}</strong></div>
                <div class="meta-item"><span>策略</span><strong>${escapeHtml(safeText(plan.strategy))}</strong></div>
                <div class="meta-item"><span>工装组合</span><strong>${escapeHtml(safeText(plan.toolingNames))}</strong></div>
                <div class="meta-item"><span>炉次数</span><strong>${escapeHtml(safeText(plan.furnaceCount))}</strong></div>
                <div class="meta-item"><span>装载重量</span><strong>${escapeHtml(formatWeight(plan.totalWeightKg))}</strong></div>
                <div class="meta-item"><span>生成时间</span><strong>${escapeHtml(normalizeDate(plan.generatedAt))}</strong></div>
            </div>

            <div class="metric-row">
                <div class="metric-pill"><span>重量利用率</span><strong>${escapeHtml(formatPercent(plan.weightUtilizationPercent))}</strong></div>
                <div class="metric-pill"><span>空间利用率</span><strong>${escapeHtml(formatPercent(plan.spaceUtilizationPercent))}</strong></div>
                <div class="metric-pill"><span>风险等级</span><strong>${escapeHtml(safeText(plan.riskLevel))}</strong></div>
            </div>

            ${renderMobileSummarySection(plan)}

            <div class="detail-section-title">方案摘要</div>
            <div class="detail-summary">${escapeHtml(safeText(plan.summary, '暂无方案摘要。')).replaceAll('\n', '<br>')}</div>

            <p class="plan-readonly-note">手机端为只读执行视图：查看最终执行版、总工调整说明、对比结论和仿真摘要。复杂编辑、版本恢复和仿真运行仍在电脑端 / iPad 完成。</p>

            <div class="card-actions single-primary">
                ${(plan.constructionSheetUrl || plan.pdfLink) ? `<button class="action-btn primary" data-action="open-construction-sheet" data-record-id="${escapeHtml(plan.recordId)}" type="button">查看现场施工单</button>` : ''}
                <button class="action-btn secondary" data-action="toggle-compare-plan" data-record-id="${escapeHtml(plan.recordId)}" type="button">${state.comparePlanIds.includes(plan.recordId) ? '取消对比' : '加入对比'}</button>
                <button class="action-btn secondary" data-action="close-plan-detail" type="button">收起详情</button>
            </div>
        `;
    }

    function renderPlans() {
        const list = $('#plansList');
        const count = $('#plansCount');
        if (!list) return;

        const filtered = getFilteredPlans();
        if (count) count.textContent = `${filtered.length} 条`;

        renderPlanCompareBar();
        renderPlanDetail();

        if (!filtered.length) {
            list.innerHTML = `
                <article class="empty-card">
                    <div class="empty-icon">🔥</div>
                    <h3>暂无装炉方案</h3>
                    <p>请先在 iPad / PC 生成装炉方案，并保存/写回飞书方案记录表。</p>
                </article>
            `;
            return;
        }

        list.innerHTML = filtered.map(plan => {
            const selected = state.comparePlanIds.includes(plan.recordId);
            const statusText = safeText(plan.riskLevel, safeText(plan.generationStatus, '已生成'));
            return `
                <article class="task-card plan-card">
                    <div class="card-head">
                        <div>
                            <h3 class="card-title">${escapeHtml(safeText(plan.planName, '未命名方案'))}</h3>
                            <p class="card-subtitle">${escapeHtml(safeText(plan.sourceTask, plan.recordId))}</p>
                            ${renderMobilePlanTags(plan)}
                        </div>
                        <span class="status ${getPlanStatusClass(plan)}">${escapeHtml(statusText)}</span>
                    </div>

                    <div class="meta-grid">
                        <div class="meta-item"><span>客户</span><strong>${escapeHtml(safeText(plan.customer))}</strong></div>
                        <div class="meta-item"><span>工艺</span><strong>${escapeHtml(safeText(plan.process))}</strong></div>
                        <div class="meta-item"><span>策略</span><strong>${escapeHtml(safeText(plan.strategy))}</strong></div>
                        <div class="meta-item"><span>工装</span><strong>${escapeHtml(safeText(plan.toolingNames))}</strong></div>
                        <div class="meta-item"><span>炉次数 / 重量</span><strong>${escapeHtml(safeText(plan.furnaceCount))}炉 · ${escapeHtml(formatWeight(plan.totalWeightKg))}</strong></div>
                        <div class="meta-item"><span>生成时间</span><strong>${escapeHtml(normalizeDate(plan.generatedAt))}</strong></div>
                    </div>

                    <div class="metric-row">
                        <div class="metric-pill"><span>重量利用率</span><strong>${escapeHtml(formatPercent(plan.weightUtilizationPercent))}</strong></div>
                        <div class="metric-pill"><span>空间利用率</span><strong>${escapeHtml(formatPercent(plan.spaceUtilizationPercent))}</strong></div>
                        <div class="metric-pill"><span>状态</span><strong>${escapeHtml(safeText(plan.generationStatus, '已生成'))}</strong></div>
                    </div>

                    ${plan.summary ? `<p class="card-note">${escapeHtml(plan.summary).slice(0, 120)}${String(plan.summary).length > 120 ? '...' : ''}</p>` : ''}

                    <div class="card-actions single-primary">
                        <button class="action-btn primary" data-action="view-plan-detail" data-record-id="${escapeHtml(plan.recordId)}" type="button">查看详情</button>
                        <button class="action-btn secondary" data-action="toggle-compare-plan" data-record-id="${escapeHtml(plan.recordId)}" type="button">${selected ? '取消对比' : '加入对比'}</button>
                    </div>
                </article>
            `;
        }).join('');
    }

    async function loadPlans() {
        const list = $('#plansList');
        const count = $('#plansCount');

        state.loadingPlans = true;
        if (list) list.innerHTML = `<article class="loading-card">正在同步飞书方案记录...</article>`;
        if (count) count.textContent = '加载中';

        try {
            const data = await fetchJson(`${API_BASE}/api/feishu/plans`);
            state.plans = Array.isArray(data.plans) ? data.plans : [];
            renderPlans();
            showToast(`已同步 ${state.plans.length} 条方案记录`);
        } catch (error) {
            if (count) count.textContent = '失败';
            if (list) {
                list.innerHTML = `
                    <article class="error-card">
                        <strong>方案记录同步失败</strong>
                        <p>${escapeHtml(error.message)}</p>
                        <p>请确认 server.js 已升级到 V1.2，并检查 /api/health。</p>
                    </article>
                `;
            }
            showToast(`同步失败：${error.message}`);
        } finally {
            state.loadingPlans = false;
        }
    }

    function toggleComparePlan(recordId) {
        if (!recordId) return;
        const exists = state.comparePlanIds.includes(recordId);
        if (exists) {
            state.comparePlanIds = state.comparePlanIds.filter(id => id !== recordId);
        } else {
            if (state.comparePlanIds.length >= 2) {
                showToast('最多同时对比 2 个方案');
                return;
            }
            state.comparePlanIds.push(recordId);
        }
        renderPlans();
    }

    function openPlanLink(recordId) {
        const plan = state.plans.find(item => item.recordId === recordId);
        const link = String(plan?.planLink || plan?.webPlanLink || '').trim();
        if (!link) {
            showToast('当前方案没有可打开的系统链接');
            return;
        }
        window.open(link, '_blank');
    }

    function openConstructionSheet(recordId) {
        const plan = state.plans.find(item => item.recordId === recordId);
        const link = String(plan?.constructionSheetUrl || plan?.pdfLink || '').trim();
        if (!link) {
            showToast('当前方案没有施工单链接');
            return;
        }
        window.open(link, '_blank');
    }

    function bindEvents() {
        $$('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => setActivePage(btn.dataset.target));
        });

        $('#refreshBtn')?.addEventListener('click', () => {
            if (state.activePage === 'orders') loadOrders();
            else if (state.activePage === 'tasks') loadTasks();
            else if (state.activePage === 'plans') loadPlans();
            else showToast('当前页面接口待接入');
        });

        $('#batchConvertBtn')?.addEventListener('click', batchConvertOrders);

        $$('.chip[data-order-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.orderFilter = btn.dataset.orderFilter || 'all';
                $$('.chip[data-order-filter]').forEach(item => item.classList.remove('is-active'));
                btn.classList.add('is-active');
                renderOrders();
            });
        });

        $$('.chip[data-task-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.taskFilter = btn.dataset.taskFilter || 'all';
                $$('.chip[data-task-filter]').forEach(item => item.classList.remove('is-active'));
                btn.classList.add('is-active');
                renderTasks();
            });
        });

        $$('.chip[data-plan-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.planFilter = btn.dataset.planFilter || 'all';
                $$('.chip[data-plan-filter]').forEach(item => item.classList.remove('is-active'));
                btn.classList.add('is-active');
                renderPlans();
            });
        });

        $('#clearCompareBtn')?.addEventListener('click', () => {
            state.comparePlanIds = [];
            renderPlans();
        });

        document.body.addEventListener('click', async (event) => {
            const target = event.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            const recordId = target.dataset.recordId;

            if (action === 'confirm-order') {
                confirmOrder(recordId);
            }

            if (action === 'reject-order') {
                showToast('V1.1 暂不开放退回修改，请在飞书表格中处理');
            }

            if (action === 'copy-order') {
                const order = state.orders.find(item => item.recordId === recordId);
                if (order) copyText(buildOrderCopyText(order), '已复制订单信息');
            }

            if (action === 'copy-task') {
                const taskId = target.dataset.taskId || '';
                copyText(taskId, '已复制任务号');
            }

            if (action === 'open-ipad') {
                showToast('请在 iPad 打开 furnace.html 生成装炉方案');
            }

            if (action === 'view-plan-detail') {
                state.selectedPlanId = recordId;
                renderPlans();
                $('#planDetailPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            if (action === 'close-plan-detail') {
                state.selectedPlanId = '';
                renderPlans();
            }

            if (action === 'toggle-compare-plan') {
                toggleComparePlan(recordId);
            }

            if (action === 'open-plan-link') {
                showToast('3D方案恢复待接入，当前版本暂不开放打开方案');
            }

            if (action === 'open-construction-sheet') {
                openConstructionSheet(recordId);
            }
        });
    }

    function initFromQuery() {
        const params = new URLSearchParams(window.location.search);
        const page = params.get('tab') || params.get('page');
        if (['orders', 'tasks', 'plans'].includes(page)) {
            setActivePage(page);
            return;
        }
        setActivePage('orders');
    }

    bindEvents();
    initFromQuery();

    // 后台预加载任务，让切换更快。
    setTimeout(() => {
        if (state.tasks.length === 0 && !state.loadingTasks) loadTasks();
    }, 600);

    setTimeout(() => {
        if (state.plans.length === 0 && !state.loadingPlans) loadPlans();
    }, 1200);
})();
