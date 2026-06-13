// plan-library.js
// 方案库模块：只负责本地方案保存、列表渲染、详情渲染、删除、加载触发。
// 不负责装炉算法、不负责 3D、不负责恢复工作台，恢复动作由 app.js 通过 onLoad 回调传入。

import { downloadJsonFile } from './plan-record.js';
import { showCapacityFeedback } from './ui.js';

const PLAN_LIBRARY_STORAGE_KEY = 'heat_treatment_plan_library_v1';

export function getPlanLibraryItems() {
    try {
        return JSON.parse(localStorage.getItem(PLAN_LIBRARY_STORAGE_KEY) || '[]');
    } catch (e) {
        console.warn('读取方案库失败：', e);
        return [];
    }
}

export function setPlanLibraryItems(items) {
    localStorage.setItem(PLAN_LIBRARY_STORAGE_KEY, JSON.stringify(items));
}

function escapeHtmlText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return map[ch] || ch;
    });
}

function safeFileName(name) {
    return String(name || '装炉方案').replace(/[\\/:*?"<>|]/g, '_');
}

export function buildPlanLibrarySummary(record, fallbackStrategy = '-') {
    const furnaces = record.loadingPlan?.furnaces || [];
    const materials = record.materials || [];

    const totalItems = furnaces.reduce((sum, f) => {
        return sum + ((f.packedItems && f.packedItems.length) || 0);
    }, 0);

    const totalWeight = furnaces.reduce((sum, f) => {
        return sum + Number(f.totalWeightKg ?? f.totalWeight ?? 0);
    }, 0);

    const firstFurnace = furnaces[0] || {};
    const dim = firstFurnace.dimensions || {};

    return {
        furnaceCount: furnaces.length,
        materialBatchCount: materials.length,
        totalItems,
        totalWeightKg: totalWeight,
        firstFurnaceName: firstFurnace.instanceName || firstFurnace.furnaceInstanceId || firstFurnace.typeName || '-',
        firstFurnaceSize: dim.width
            ? `${dim.width}×${dim.height}×${dim.depth}mm`
            : '-',
        strategy: record.loadingPlan?.strategy || record.process?.strategy || fallbackStrategy || '-'
    };
}

export function createPlanLibraryController(options) {
    const {
        canSaveCurrentPlan,
        buildCurrentRecord,
        getFallbackStrategy,
        onLoadRecord
    } = options;

    function saveCurrentPlanToLibrary() {
        if (!canSaveCurrentPlan()) {
            alert('请先生成装炉方案，再保存到方案库');
            return;
        }

        const today = new Date().toISOString().slice(0, 10);
        const defaultTitle = `装炉方案_${today}`;
        const inputTitle = prompt('请输入方案名称', defaultTitle);

        if (inputTitle === null) return;

        const title = inputTitle.trim() || defaultTitle;
        const record = buildCurrentRecord(title);
        const now = new Date().toISOString();

        const item = {
            id: `PLAN-${Date.now()}`,
            title,
            createdAt: now,
            updatedAt: now,
            summary: buildPlanLibrarySummary(record, getFallbackStrategy?.()),
            record
        };

        const items = getPlanLibraryItems();
        items.unshift(item);

        try {
            setPlanLibraryItems(items);
            showCapacityFeedback('success', `✅ 已保存到方案库：${title}`);
        } catch (e) {
            console.error(e);
            alert('保存失败：浏览器本地存储空间可能不足。可以先导出 JSON 备份。');
        }
    }

    function renderPlanLibraryList() {
        const listEl = document.getElementById('master-list');
        const detailEl = document.getElementById('master-detail-panel');

        if (!listEl || !detailEl) return;

        const items = getPlanLibraryItems();

        if (items.length === 0) {
            listEl.innerHTML = `
                <div style="font-size:12px;color:#888;padding:12px;">
                    暂无已保存方案。请先生成方案，然后点击顶部“保存方案”。
                </div>
            `;
            detailEl.innerHTML = '<strong>暂无方案</strong>';
            return;
        }

        listEl.innerHTML = `
            <div style="font-size:11px;color:#666;margin-bottom:10px;padding:4px 0;">
                共 ${items.length} 个方案
            </div>
        `;

        items.forEach((item, idx) => {
            const s = item.summary || {};
            const card = document.createElement('div');
            card.className = 'master-plan-card' + (idx === 0 ? ' active' : '');
            card.setAttribute('data-plan-id', item.id);

            card.innerHTML = `
                <button class="mpc-delete" data-action="delete-library-plan" title="删除此方案">✕</button>
                <div class="mpc-title">${escapeHtmlText(item.title)}</div>
                <button class="btn-sm" data-action="load-library-plan">加载</button>
                <div class="mpc-meta">
                    ${escapeHtmlText(s.firstFurnaceName || '-')}<br>
                    ${escapeHtmlText((item.createdAt || '').slice(0, 10))} · ${escapeHtmlText(s.strategy || '-')}<br>
                    ${s.furnaceCount || 0} 炉 · ${s.totalItems || 0} 件 · ${(s.totalWeightKg || 0).toFixed(1)}kg
                </div>
                <span class="mpc-tag imported">方案库</span>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.closest('[data-action="delete-library-plan"]')) return;

                document.querySelectorAll('.master-plan-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                renderPlanLibraryDetail(item.id);
            });

            card.querySelector('[data-action="delete-library-plan"]').addEventListener('click', (e) => {
                e.stopPropagation();
                deletePlanLibraryItem(item.id);
            });

            const loadBtn = card.querySelector('[data-action="load-library-plan"]');
            if (loadBtn) {
                loadBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    loadPlanLibraryItem(item.id);
                });
            }

            listEl.appendChild(card);
        });

        renderPlanLibraryDetail(items[0].id);
    }

    function renderPlanLibraryDetail(planId) {
        const detailEl = document.getElementById('master-detail-panel');
        if (!detailEl) return;

        const items = getPlanLibraryItems();
        const item = items.find(x => x.id === planId);

        if (!item) {
            detailEl.innerHTML = '<strong>方案不存在</strong>';
            return;
        }

        const s = item.summary || {};

        detailEl.innerHTML = `
            <div style="padding:12px;line-height:1.8;font-size:12px;">
                <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                    <button class="btn-sm" id="btn-load-library-plan">加载到工作台</button>
                    <button class="btn-sm" id="btn-export-library-plan-json">导出JSON</button>
                    <button class="btn-sm btn-reset-danger" id="btn-delete-library-plan">删除</button>
                </div>

                <strong style="font-size:14px;">${escapeHtmlText(item.title)}</strong><br>
                创建时间：${escapeHtmlText(item.createdAt || '-')}<br>
                炉次数量：${s.furnaceCount || 0}<br>
                工件数量：${s.totalItems || 0}<br>
                总重量：${(s.totalWeightKg || 0).toFixed(1)}kg<br>
                首炉尺寸：${escapeHtmlText(s.firstFurnaceSize || '-')}<br>
                策略：${escapeHtmlText(s.strategy || '-')}
            </div>
        `;

        document.getElementById('btn-load-library-plan').addEventListener('click', () => {
            loadPlanLibraryItem(item.id);
        });

        document.getElementById('btn-export-library-plan-json').addEventListener('click', () => {
            downloadJsonFile(item.record, `${safeFileName(item.title)}.json`);
        });

        document.getElementById('btn-delete-library-plan').addEventListener('click', () => {
            deletePlanLibraryItem(item.id);
        });
    }

    function deletePlanLibraryItem(planId) {
        const items = getPlanLibraryItems();
        const item = items.find(x => x.id === planId);

        if (!item) return;
        if (!confirm(`确定删除方案「${item.title}」吗？`)) return;

        const nextItems = items.filter(x => x.id !== planId);
        setPlanLibraryItems(nextItems);
        renderPlanLibraryList();
    }

    function loadPlanLibraryItem(planId) {
        const items = getPlanLibraryItems();
        const item = items.find(x => x.id === planId);

        if (!item || !item.record) {
            alert('方案数据不存在');
            return;
        }

        onLoadRecord(item.record, item);
    }

    return {
        saveCurrentPlanToLibrary,
        renderPlanLibraryList,
        renderPlanLibraryDetail,
        deletePlanLibraryItem,
        loadPlanLibraryItem
    };
}