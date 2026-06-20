require("dotenv").config();

/**
 * server.js - 智能预装炉云端安全中转中心
 *
 * V0.8.4.1: 飞书生产任务读取 + 方案写回 + 设备/工装同步 + 方案/PDF链接字段写回 + 机器人群通知
 * - 使用 FEISHU_APP_ID / FEISHU_APP_SECRET 获取 tenant_access_token
 * - 从多维表格「生产任务表」读取记录
 * - 自动跳过空记录，只返回待排产/待同步任务
 * - 保留 record_id / taskId / 来源信息，方便后续写回飞书状态
 * - 写回方案成功后，可通过飞书机器人向群聊发送通知；未配置群时回退为本人通知
 */
const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors()); // 本地开发调试用；正式部署建议限制 origin

const PORT = process.env.PORT || 3000;

const FEISHU_CONFIG = {
    app_id: process.env.FEISHU_APP_ID || "你的飞书自建应用_APP_ID",
    app_secret: process.env.FEISHU_APP_SECRET || "你的飞书自建应用_APP_SECRET"
};

const FEISHU_NOTIFY_CONFIG = {
    // V0.8.4.1 通知机器人：优先发群，未配置群时回退发本人。
    // 推荐启动方式：
    // export FEISHU_NOTIFY_CHAT_ID="oc_xxx"        # 群通知，优先
    // export FEISHU_NOTIFY_EMAIL="xxx@example.com" # 本人通知，兜底
    receiveIdType: process.env.FEISHU_NOTIFY_RECEIVE_ID_TYPE || '',
    receiveId: process.env.FEISHU_NOTIFY_RECEIVE_ID || '',
    chatId: process.env.FEISHU_NOTIFY_CHAT_ID || '',
    email: process.env.FEISHU_NOTIFY_EMAIL || '',
    enabled: String(process.env.FEISHU_NOTIFY_ENABLED || 'true').toLowerCase() !== 'false'
};

// MVP 多租户映射。后续正式版建议迁移到数据库或服务器配置文件。
const TENANT_DATABASE = {
    "client_suoli": {
        companyName: "台州索力机械",
        // 生产任务表：优先读取 .env，未配置时回退到原来的表。
        appToken: process.env.FEISHU_PRODUCTION_TASKS_APP_TOKEN || "XpL0bSHcNakoBmsdW9oc5vbmnlb",
        customerTableId: "tbl9mAgWItjQTicX",
        furnaceTableId: "tblZs52nGvlaBDwQ",
        itemsTableId: process.env.FEISHU_PRODUCTION_TASKS_TABLE_ID || "tblpjfR2NJbT0Avi",
        toolingTableId: "tblGuHwpcFqDzBiP",
        plansTableId: "tblfNkCOrscyswPa",
        // 订单草稿表：用于 /api/feishu/order-drafts/convert
        orderDraftsAppToken: process.env.FEISHU_ORDER_DRAFTS_APP_TOKEN || "XpL0bSHcNakoBmsdW9oc5vbmnlb",
        orderDraftsTableId: process.env.FEISHU_ORDER_DRAFTS_TABLE_ID || ""
    },
    "client_qiujing": {
        companyName: "永康求精科技",
        appToken: "XpL0bSHcNakoBmsdW9oc5vbmnlb",
        customerTableId: "tbl9mAgWItjQTicX",
        furnaceTableId: "tblZs52nGvlaBDwQ",
        itemsTableId: "tblpjfR2NJbT0Avi",
        toolingTableId: "tblGuHwpcFqDzBiP",
        plansTableId: "tblfNkCOrscyswPa"
    }
};

let cachedToken = null;
let tokenExpiryTime = 0;

function getTenantFromRequest(req) {
    const clientId = req.headers["x-client-id"] || req.query.client_id || req.query.clientId || process.env.DEFAULT_CLIENT_ID || "client_suoli";
    return { clientId, tenant: TENANT_DATABASE[clientId] };
}

async function ensureFeishuToken(req, res, next) {
    const currentTime = Date.now();
    if (cachedToken && currentTime < (tokenExpiryTime - 60000)) {
        req.feishu_token = cachedToken;
        return next();
    }

    try {
        if (!FEISHU_CONFIG.app_id || !FEISHU_CONFIG.app_secret || FEISHU_CONFIG.app_id.includes("你的飞书")) {
            return res.status(500).json({
                ok: false,
                error: "FEISHU_APP_ID / FEISHU_APP_SECRET 未配置。请先在终端或 Azure 环境变量中配置。"
            });
        }

        console.log("正在向飞书中心申请新的租户凭证...");
        const response = await axios.post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
            app_id: FEISHU_CONFIG.app_id,
            app_secret: FEISHU_CONFIG.app_secret
        });

        if (response.data.code === 0) {
            cachedToken = response.data.tenant_access_token;
            tokenExpiryTime = currentTime + (Number(response.data.expire || 7200) * 1000);
            req.feishu_token = cachedToken;
            return next();
        }

        throw new Error(`飞书鉴权失败: ${response.data.msg || "unknown"}`);
    } catch (err) {
        console.error("飞书凭证握手发生错误:", err.response?.data || err.message);
        return res.status(500).json({
            ok: false,
            error: "云端中转鉴权失败，请检查飞书自建应用 App ID / App Secret / 发布状态",
            detail: err.response?.data || err.message
        });
    }
}

function isPlainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
}

function flattenFeishuValue(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;

    if (Array.isArray(value)) {
        return value.map(item => flattenFeishuValue(item)).filter(v => v !== "").join(" ").trim();
    }

    if (isPlainObject(value)) {
        if (value.text !== undefined) return flattenFeishuValue(value.text);
        if (value.name !== undefined) return flattenFeishuValue(value.name);
        if (value.value !== undefined) return flattenFeishuValue(value.value);
        if (value.link !== undefined) return flattenFeishuValue(value.link);
        return Object.values(value).map(v => flattenFeishuValue(v)).filter(v => v !== "").join(" ").trim();
    }

    return String(value);
}

function readField(fields, names, fallback = "") {
    for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(fields, name)) {
            const value = flattenFeishuValue(fields[name]);
            if (value !== "" && value !== null && value !== undefined) return value;
        }
    }
    return fallback;
}

function readNumber(fields, names, fallback = 0) {
    const value = readField(fields, names, "");
    if (value === "") return fallback;
    const n = Number(String(value).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : fallback;
}

function readDate(fields, names) {
    for (const name of names) {
        if (!Object.prototype.hasOwnProperty.call(fields, name)) continue;
        const raw = fields[name];
        if (typeof raw === "number") {
            const d = new Date(raw);
            if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        }
        const value = flattenFeishuValue(raw);
        if (!value) continue;
        if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) {
            const [y, m, d] = value.split("-").map(v => String(v).padStart(2, "0"));
            return `${y}-${m}-${d}`;
        }
        if (/^\d{4}[./]\d{1,2}[./]\d{1,2}$/.test(value)) {
            const [y, m, d] = value.split(/[./]/).map(v => String(v).padStart(2, "0"));
            return `${y}-${m}-${d}`;
        }
    }
    return "";
}

function normalizeShape(shapeText) {
    const raw = String(shapeText || "").trim().toLowerCase();
    if (!raw) return "cuboid";
    if (raw.includes("圆") || raw.includes("cyl")) return "cylinder";
    return "cuboid";
}

function normalizeTaskRecord(record) {
    const fields = record.fields || {};
    const status = String(readField(fields, ["状态", "任务状态"], "")).trim();
    const shape = normalizeShape(readField(fields, ["形状", "工件形状"], ""));

    const diameter = readNumber(fields, ["直径", "D", "外径", "直径D"], 0);
    const length = readNumber(fields, ["长度", "长", "L", "长度L"], 0);
    const width = readNumber(fields, ["宽度", "宽", "W", "宽度W"], 0);
    const height = readNumber(fields, ["高度", "高", "H", "高度H", "厚度"], 0);
    const count = readNumber(fields, ["数量", "件数", "数量pcs"], 0);

    const totalWeightRaw = readNumber(fields, ["总重量", "总重量kg", "总重", "重量kg", "重量"], 0);
    const unitWeight = readNumber(fields, ["单重", "单重kg", "单件重量", "单件重量kg"], 0);
    const totalWeight = totalWeightRaw || (unitWeight && count ? unitWeight * count : 0);

    let dim1 = length;
    let dim2 = width;
    let dim3 = height;

    if (shape === "cylinder") {
        dim1 = diameter || length || width || height || 0;
        dim2 = dim1;
        dim3 = height || length || 0;
    }

    const itemCode = String(readField(fields, ["物料编码", "产品编码", "图号", "零件号"], "")).trim();
    const showName = String(readField(fields, ["产品名称", "工件名称", "名称"], "未命名工件")).trim();
    const customer = String(readField(fields, ["客户名称", "客户", "客户简称"], "")).trim();
    const taskId = String(readField(fields, ["任务编号", "订单编号", "生产任务号"], record.record_id || "")).trim();

    const material = String(readField(fields, ["材质", "材料"], "")).trim();
    const process = String(readField(fields, ["工艺", "热处理工艺", "工艺路线"], "")).trim();
    const hardness = String(readField(fields, ["硬度要求", "硬度", "硬度范围"], "")).trim();
    const deliveryDate = readDate(fields, ["交期时间", "交期", "交付日期", "交货日期"]);
    const remark = String(readField(fields, ["备注", "说明"], "")).trim();

    return {
        source: "feishu",
        recordId: record.record_id,
        taskId,
        status,
        name: customer && showName ? `${showName}_${customer}` : showName,
        showName,
        customer,
        itemCode,
        shape,
        dim1,
        dim2,
        dim3,
        diameter: shape === "cylinder" ? dim1 : 0,
        length,
        width,
        height,
        count,
        totalWeight,
        unitWeight: unitWeight || (count ? Number((totalWeight / count).toFixed(4)) : 0),
        material,
        process,
        hardness,
        deliveryDate,
        remark,
        rawFields: fields
    };
}

function normalizeAvailableStatus(statusText) {
    const status = String(statusText || '').trim();
    if (!status) return '';
    return status;
}

function normalizeBooleanLike(value, fallback = false) {
    if (value === true || value === false) return value;
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (['true', 'yes', 'y', '1', '是', '支持', '启用', '可用'].includes(raw)) return true;
    if (['false', 'no', 'n', '0', '否', '不支持', '停用', '禁用'].includes(raw)) return false;
    return fallback;
}

function normalizeToolingType(typeText) {
    const raw = String(typeText || '').trim().toLowerCase();
    if (!raw) return 'standard-basket';
    if (raw.includes('standard-basket') || raw.includes('标准') || raw.includes('料框')) return 'standard-basket';
    if (raw.includes('mesh-basket') || raw.includes('网篮') || raw.includes('密网') || raw.includes('蜂窝')) return 'mesh-basket';
    if (raw.includes('material-tray') || raw.includes('料盘') || raw.includes('托盘') || raw.includes('tray')) return 'material-tray';
    if (raw.includes('ring-tooling') || raw.includes('环形') || raw.includes('圆盘') || raw.includes('ring')) return 'ring-tooling';
    return 'standard-basket';
}

function getBasketTypeForTooling(toolingType) {
    return {
        'standard-basket': 'grid',
        'mesh-basket': 'honeycomb',
        'material-tray': 'tray',
        'ring-tooling': 'ringnode'
    }[toolingType] || 'grid';
}

function buildResourceSyncMeta(record, tableName) {
    return {
        source: 'feishu',
        tableName,
        recordId: record.record_id || '',
        syncedAt: new Date().toISOString()
    };
}

function pushIssue(issues, level, field, message) {
    issues.push({ level, field, message });
}

function validateFurnaceResource(resource) {
    const issues = [];
    if (!resource.name || resource.name === '未命名设备') pushIssue(issues, 'warning', '设备名称', '缺少设备名称');
    if (!resource.width) pushIssue(issues, 'error', '宽度X', '缺少宽度X');
    if (!resource.height) pushIssue(issues, 'error', '高度Y', '缺少高度Y');
    if (!resource.depth) pushIssue(issues, 'error', '深度Z', '缺少深度Z');
    if (!resource.maxWeight) pushIssue(issues, 'warning', '最大承重Kg', '未填写最大承重');
    if (!resource.workshop) pushIssue(issues, 'warning', '车间', '未填写所属车间');
    return issues;
}

function normalizeFurnaceResourceRecord(record) {
    const fields = record.fields || {};
    const status = normalizeAvailableStatus(readField(fields, ['状态', '设备状态'], ''));
    const width = readNumber(fields, ['宽度X', '宽度', '宽', 'X'], 0);
    const height = readNumber(fields, ['高度Y', '高度', '高', 'Y'], 0);
    const depth = readNumber(fields, ['深度Z', '深度', '纵深', '长度', '长', 'Z'], 0);
    const resource = {
        source: 'feishu',
        resourceType: 'furnace',
        recordId: record.record_id,
        deviceNo: String(readField(fields, ['设备编号', '炉膛编号', '编号'], record.record_id || '')).trim(),
        name: String(readField(fields, ['设备名称', '炉膛名称', '名称'], '未命名设备')).trim(),
        workshop: String(readField(fields, ['车间', '所属车间', '生产车间'], '')).trim(),
        deviceType: String(readField(fields, ['设备类型', '炉型', '类型'], '')).trim(),
        width,
        height,
        depth,
        dimensions: `${width || 0}×${height || 0}×${depth || 0}mm`,
        maxWeight: readNumber(fields, ['最大承重Kg', '最大承重kg', '最大承重', '承重Kg', '承重kg', '承重'], 0),
        supportedProcesses: String(readField(fields, ['支持工艺', '可用工艺', '工艺'], '')).trim(),
        status,
        remark: String(readField(fields, ['备注', '说明'], '')).trim(),
        syncMeta: buildResourceSyncMeta(record, '设备炉膛表'),
        rawFields: fields
    };
    resource.validationIssues = validateFurnaceResource(resource);
    resource.isValid = !resource.validationIssues.some(issue => issue.level === 'error');
    return resource;
}

function validateToolingResource(resource) {
    const issues = [];
    if (!resource.name || resource.name === '飞书工装') pushIssue(issues, 'warning', '工装名称', '缺少工装名称');
    if (!resource.width) pushIssue(issues, 'error', '宽度X', '缺少宽度X');
    if (!resource.height) pushIssue(issues, 'error', '高度Y', '缺少高度Y');
    if (!resource.depth) pushIssue(issues, 'error', '深度Z', '缺少深度Z');
    if (!resource.maxWeight) pushIssue(issues, 'warning', '最大承重Kg', '未填写最大承重');
    if (!resource.availableCount) pushIssue(issues, 'warning', '可用数量', '未填写可用数量，系统按 1 个处理');
    if (!resource.supportedProcesses) pushIssue(issues, 'info', '适用工艺', '未限制适用工艺');
    if (!resource.workshop) pushIssue(issues, 'info', '所属车间', '未填写所属车间');
    return issues;
}

function normalizeToolingResourceRecord(record) {
    const fields = record.fields || {};
    const rawType = readField(fields, ['工装类型', '类型', '料框类型'], 'standard-basket');
    const toolingType = normalizeToolingType(rawType);
    const width = readNumber(fields, ['宽度X', '宽度', '宽', '外径', '直径', 'X'], 0);
    const height = readNumber(fields, ['高度Y', '高度', '高', 'Y'], 0);
    const depth = readNumber(fields, ['深度Z', '深度', '纵深', '长度', '长', 'Z'], 0);
    const availableCount = readNumber(fields, ['可用数量', '数量', '库存数量', '现有数量'], 1) || 1;
    const hasShelfText = readField(fields, ['是否支持搁板', '支持搁板', '是否有搁板', '搁板'], '');
    const hasShelf = normalizeBooleanLike(hasShelfText, false);
    const resource = {
        source: 'feishu',
        resourceType: 'tooling',
        recordId: record.record_id,
        toolingNo: String(readField(fields, ['工装编号', '料框编号', '编号'], record.record_id || '')).trim(),
        name: String(readField(fields, ['工装名称', '料框名称', '名称'], '飞书工装')).trim(),
        rawType: String(rawType || '').trim(),
        toolingType,
        basketType: getBasketTypeForTooling(toolingType),
        width,
        height,
        depth,
        dimensions: `${width || 0}×${height || 0}×${depth || 0}mm`,
        maxWeight: readNumber(fields, ['最大承重Kg', '最大承重kg', '最大承重', '承重Kg', '承重kg', '承重'], 0),
        availableCount,
        count: availableCount,
        hasShelf,
        maxLayers: readNumber(fields, ['最大层数', '层数', '可用层数'], hasShelf ? 5 : 1) || (hasShelf ? 5 : 1),
        shelfThickness: readNumber(fields, ['搁板厚度', '搁板厚度mm', '隔板厚度'], hasShelf ? 20 : 0),
        workshop: String(readField(fields, ['所属车间', '车间', '生产车间'], '')).trim(),
        supportedProcesses: String(readField(fields, ['支持工艺', '适用工艺', '工艺'], '')).trim(),
        status: normalizeAvailableStatus(readField(fields, ['状态', '工装状态'], '')),
        remark: String(readField(fields, ['备注', '说明'], '')).trim(),
        syncMeta: buildResourceSyncMeta(record, '工装表'),
        rawFields: fields
    };
    resource.validationIssues = validateToolingResource(resource);
    resource.isValid = !resource.validationIssues.some(issue => issue.level === 'error');
    return resource;
}

function isActiveResourceStatus(status) {
    const raw = String(status || '').trim();
    if (!raw) return true;
    return !['停用', '禁用', '报废', '维修中', '维护中', '不可用'].includes(raw);
}

function isNonEmptyFields(fields) {
    return fields && Object.keys(fields).length > 0;
}

async function fetchBitableRecords({ token, appToken, tableId, pageSize = 100, maxPages = 20 }) {
    const all = [];
    let pageToken = "";
    let page = 0;

    do {
        page += 1;
        const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search?page_size=${pageSize}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
        const response = await axios.post(url, {}, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json; charset=utf-8"
            }
        });

        if (response.data.code !== 0) {
            const error = new Error(`飞书表格返回错误: ${response.data.msg || "unknown"}`);
            error.feishu = response.data;
            throw error;
        }

        const data = response.data.data || {};
        all.push(...(data.items || []));
        pageToken = data.page_token || "";
        if (!data.has_more) break;
    } while (pageToken && page < maxPages);

    return all;
}


async function fetchBitableFields({ token, appToken, tableId }) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`;
    const response = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8"
        }
    });

    if (response.data.code !== 0) {
        const error = new Error(`飞书字段读取错误: ${response.data.msg || "unknown"}`);
        error.feishu = response.data;
        throw error;
    }

    const items = response.data?.data?.items || [];
    return new Map(items.map(field => [field.field_name, field]));
}

function isWritableTextField(field) {
    if (!field) return false;
    if (field.is_primary) return true;
    const ui = String(field.ui_type || '').toLowerCase();
    return Number(field.type) === 1 || ui.includes('text') || ui.includes('url');
}

function isWritableNumberField(field) {
    if (!field) return false;
    const ui = String(field.ui_type || '').toLowerCase();
    return Number(field.type) === 2 || ui.includes('number');
}

function isWritableUrlField(field) {
    if (!field) return false;
    const ui = String(field.ui_type || '').toLowerCase();
    return Number(field.type) === 15 || ui.includes('url') || ui.includes('link');
}

function isWritableDateField(field) {
    if (!field) return false;
    const ui = String(field.ui_type || '').toLowerCase();
    return Number(field.type) === 5 || ui.includes('date') || ui.includes('time');
}

function isWritableSingleSelectField(field) {
    if (!field) return false;
    const ui = String(field.ui_type || '').toLowerCase();
    return Number(field.type) === 3 || ui.includes('singleselect') || ui.includes('single_select') || ui.includes('select');
}

function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
}

function addLinkOrTextIfWritable(output, fieldMap, name, value, label = '') {
    const field = fieldMap.get(name);
    if (!field) return false;
    const text = String(value || '').trim();
    if (!text) return false;

    if (isWritableUrlField(field)) {
        if (!isHttpUrl(text)) return false;
        output[name] = { text: label || text, link: text };
        return true;
    }

    return addTextIfWritable(output, fieldMap, name, text);
}

function addDateTimeIfWritable(output, fieldMap, name, value) {
    const field = fieldMap.get(name);
    if (!field || value === undefined || value === null || value === '') return false;

    if (isWritableDateField(field)) {
        const t = typeof value === 'number' ? value : new Date(value).getTime();
        if (!Number.isFinite(t)) return false;
        output[name] = t;
        return true;
    }

    return addTextIfWritable(output, fieldMap, name, value);
}

function addSingleSelectIfWritable(output, fieldMap, name, value) {
    const field = fieldMap.get(name);
    if (!field || value === undefined || value === null || value === '') return false;
    const text = String(value).trim();
    if (!text) return false;

    if (isWritableSingleSelectField(field)) {
        const options = Array.isArray(field.property?.options) ? field.property.options : [];
        const hasMatchingOption = options.some(opt => String(opt.name || opt.value || opt.text || '').trim() === text);
        if (!hasMatchingOption && options.length > 0) return false;
        if (!hasMatchingOption && options.length === 0) return false;
        output[name] = text;
        return true;
    }

    return addTextIfWritable(output, fieldMap, name, text);
}

function clampNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function roundTo(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const factor = 10 ** digits;
    return Math.round(n * factor) / factor;
}

function normalizePercentRate(value) {
    const n = clampNumber(value, 0);
    if (n > 1) return roundTo(n / 100, 4);
    return roundTo(n, 4);
}

function normalizePercentNumber(value) {
    const n = clampNumber(value, 0);
    if (n <= 1 && n > 0) return roundTo(n * 100, 2);
    return roundTo(n, 2);
}

function addTextIfWritable(output, fieldMap, name, value, maxLength = 30000) {
    const field = fieldMap.get(name);
    if (!field || !isWritableTextField(field)) return false;
    if (value === undefined || value === null || value === '') return false;
    let text = String(value);
    if (text.length > maxLength) {
        text = `${text.slice(0, maxLength)}\n...TRUNCATED_BY_SERVER...`;
    }
    output[name] = text;
    return true;
}

function addNumberIfWritable(output, fieldMap, name, value) {
    const field = fieldMap.get(name);
    if (!field || !isWritableNumberField(field)) return false;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    output[name] = n;
    return true;
}

function buildFeishuPlanRecordFields(payload, fieldMap) {
    const fields = {};
    const sourceTaskText = Array.isArray(payload.taskIds) ? payload.taskIds.filter(Boolean).join(', ') : '';
    const recordText = Array.isArray(payload.sourceRecordIds) ? payload.sourceRecordIds.filter(Boolean).join(', ') : '';
    const writebackKey = String(payload.writebackKey || '').trim();
    const keyRemark = writebackKey ? `
[writebackKey:${writebackKey}]` : '';

    addTextIfWritable(fields, fieldMap, '方案名称', payload.planName || 'AI装炉方案');
    addTextIfWritable(fields, fieldMap, '来源任务', sourceTaskText || recordText);
    addTextIfWritable(fields, fieldMap, '客户', payload.customer || '');
    addTextIfWritable(fields, fieldMap, '工艺组', payload.processGroup || payload.process || '');
    addTextIfWritable(fields, fieldMap, '策略', payload.strategy || '');
    addTextIfWritable(fields, fieldMap, '风险等级', payload.riskLevel || '');
    addTextIfWritable(fields, fieldMap, '工装组合', Array.isArray(payload.toolingNames) ? payload.toolingNames.join(', ') : payload.toolingNames || '');
    addTextIfWritable(fields, fieldMap, '方案JSON', payload.planJson || '', 50000);

    // V0.8.3：可选字段。只有飞书方案记录表中存在且类型可写时才写入，避免客户表结构未升级时报错。
    addTextIfWritable(fields, fieldMap, '方案摘要', payload.planSummary || '', 5000);
    addLinkOrTextIfWritable(fields, fieldMap, '方案链接', payload.planLink || payload.webPlanLink || '', '打开系统方案');
    addLinkOrTextIfWritable(fields, fieldMap, 'Web方案链接', payload.planLink || payload.webPlanLink || '', '打开系统方案');
    addLinkOrTextIfWritable(fields, fieldMap, 'PDF链接', payload.pdfLink || payload.pdfUrl || '', '查看施工单 PDF');
    addLinkOrTextIfWritable(fields, fieldMap, '施工单PDF', payload.pdfLink || payload.pdfUrl || '', '查看施工单 PDF');
    addTextIfWritable(fields, fieldMap, 'PDF状态', payload.pdfStatus || '本地导出，待上传');
    addSingleSelectIfWritable(fields, fieldMap, '生成状态', payload.generationStatus || '已生成');
    addDateTimeIfWritable(fields, fieldMap, '生成时间', payload.generatedAt || new Date().toISOString());
    addTextIfWritable(fields, fieldMap, '错误信息', payload.errorMessage || '');

    addTextIfWritable(fields, fieldMap, '写回标识', writebackKey);
    addTextIfWritable(fields, fieldMap, '备注', `${payload.remark || ''}${keyRemark}`.trim());

    addNumberIfWritable(fields, fieldMap, '炉次数', clampNumber(payload.furnaceCount, 0));
    addNumberIfWritable(fields, fieldMap, '装载重量kg', roundTo(payload.totalWeightKg ?? payload.totalWeight, 2));
    addNumberIfWritable(fields, fieldMap, '重量利用率', normalizePercentRate(payload.weightUtilization));
    addNumberIfWritable(fields, fieldMap, '空间利用率', normalizePercentNumber(payload.spaceUtilization));

    return fields;
}

function buildTaskStatusUpdateFields(status) {
    const normalizedStatus = String(status || '已生成方案').trim() || '已生成方案';
    return { "状态": normalizedStatus };
}

function planRecordContainsWritebackKey(record, writebackKey) {
    if (!record || !writebackKey) return false;
    const fields = record.fields || {};
    const keyText = String(writebackKey).trim();
    const direct = String(readField(fields, ['写回标识'], '')).trim();
    if (direct && direct === keyText) return true;
    const remark = String(readField(fields, ['备注', '说明'], '') || '');
    if (remark.includes(`[writebackKey:${keyText}]`) || remark.includes(keyText)) return true;
    return false;
}

async function findExistingPlanByWritebackKey({ token, appToken, tableId, writebackKey }) {
    if (!writebackKey) return null;
    try {
        const records = await fetchBitableRecords({ token, appToken, tableId, pageSize: 100, maxPages: 10 });
        return records.find(record => planRecordContainsWritebackKey(record, writebackKey)) || null;
    } catch (err) {
        console.warn('飞书重复写回检查失败，将继续创建方案记录:', err.feishu || err.message);
        return null;
    }
}

function summarizeWritebackPayload(payload) {
    return {
        planName: payload.planName || '',
        sourceRecordCount: Array.isArray(payload.sourceRecordIds) ? payload.sourceRecordIds.length : 0,
        taskCount: Array.isArray(payload.taskIds) ? payload.taskIds.length : 0,
        furnaceCount: payload.furnaceCount || 0,
        totalWeightKg: payload.totalWeightKg ?? payload.totalWeight ?? 0,
        writebackKey: payload.writebackKey || '',
        planLink: payload.planLink || '',
        pdfLink: payload.pdfLink || ''
    };
}

async function createBitableRecord({ token, appToken, tableId, fields }) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
    const response = await axios.post(url, { fields }, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8"
        }
    });

    if (response.data.code !== 0) {
        const error = new Error(`飞书新增记录失败: ${response.data.msg || "unknown"}`);
        error.feishu = response.data;
        throw error;
    }
    return response.data.data?.record || response.data.data;
}

async function updateBitableRecord({ token, appToken, tableId, recordId, fields }) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`;
    const response = await axios.put(url, { fields }, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8"
        }
    });

    if (response.data.code !== 0) {
        const error = new Error(`飞书更新记录失败: ${response.data.msg || "unknown"}`);
        error.feishu = response.data;
        throw error;
    }
    return response.data.data?.record || response.data.data;
}

// V0.8.5：订单草稿 -> 生产任务转换辅助函数。
function toFeishuNumber(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
}

function toFeishuDateValue(value) {
    if (!value) return undefined;
    if (typeof value === 'number') return value;

    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : undefined;
}

function setConvertField(target, key, value) {
    if (value === undefined || value === null || value === '') return;
    target[key] = value;
}

function isConvertibleOrderDraft(fields) {
    const status = String(fields?.['订单状态'] || '').trim();
    const checked = normalizeBooleanLike(fields?.['是否生成生产任务'], false);
    return status === '待转换' && checked === true;
}

function buildProductionTaskFieldsFromOrderDraft(record) {
    const fields = record.fields || {};
    const taskFields = {};

    const getText = (name) => flattenFeishuValue(fields[name]);
    const getFirstText = (names) => {
        for (const name of names) {
            const value = flattenFeishuValue(fields[name]);
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return '';
    };

    setConvertField(taskFields, '任务编号', `TASK-${Date.now()}`);
    setConvertField(taskFields, '状态', '待排产');

    setConvertField(taskFields, '客户名称', getText('客户名称'));
    setConvertField(taskFields, '产品名称', getFirstText(['产品名称', '工件名称']));
    setConvertField(taskFields, '物料编码', getFirstText(['物料编码', '物料编号']));

    setConvertField(taskFields, '形状', getText('形状'));
    setConvertField(taskFields, '材质', getText('材质'));
    setConvertField(taskFields, '工艺', getText('工艺'));
    setConvertField(taskFields, '硬度要求', getText('硬度要求'));
    setConvertField(taskFields, '渗层要求', getText('渗层要求'));

    setConvertField(taskFields, '长度', toFeishuNumber(getText('长度')));
    setConvertField(taskFields, '宽度', toFeishuNumber(getText('宽度')));
    setConvertField(taskFields, '高度', toFeishuNumber(getText('高度')));
    setConvertField(taskFields, '直径', toFeishuNumber(getText('直径')));
    setConvertField(taskFields, '数量', toFeishuNumber(getText('数量')));
    setConvertField(taskFields, '总重量', toFeishuNumber(getFirstText(['总重量', '总重量kg'])));

    setConvertField(taskFields, '来料时间', toFeishuDateValue(fields['来料时间']));
    setConvertField(taskFields, '交期时间', toFeishuDateValue(fields['交期时间'] || fields['交期']));

    setConvertField(taskFields, '包炉', getText('包炉'));
    setConvertField(taskFields, '物流', getText('物流'));
    setConvertField(taskFields, '优先级', getText('优先级'));

    setConvertField(taskFields, '备注', getText('备注'));
    setConvertField(taskFields, '来源草稿记录ID', record.record_id);

    return taskFields;
}

function buildOrderDraftUpdateFieldsAfterConvert(productionTaskRecordId) {
    return {
        订单状态: '已转换',
        生产任务记录ID: productionTaskRecordId,
        转换结果: `转换成功，生产任务记录ID：${productionTaskRecordId}`
    };
}

function getFeishuNotifyTarget() {
    if (!FEISHU_NOTIFY_CONFIG.enabled) {
        return { enabled: false, reason: 'FEISHU_NOTIFY_ENABLED=false' };
    }

    const explicitReceiveId = String(FEISHU_NOTIFY_CONFIG.receiveId || '').trim();
    const explicitReceiveIdType = String(FEISHU_NOTIFY_CONFIG.receiveIdType || '').trim();
    if (explicitReceiveId) {
        return {
            enabled: true,
            receiveIdType: explicitReceiveIdType || (explicitReceiveId.startsWith('oc_') ? 'chat_id' : 'email'),
            receiveId: explicitReceiveId,
            targetKind: 'explicit'
        };
    }

    const chatId = String(FEISHU_NOTIFY_CONFIG.chatId || '').trim();
    if (chatId) {
        return { enabled: true, receiveIdType: 'chat_id', receiveId: chatId, targetKind: 'chat' };
    }

    const email = String(FEISHU_NOTIFY_CONFIG.email || '').trim();
    if (email) {
        return { enabled: true, receiveIdType: 'email', receiveId: email, targetKind: 'email' };
    }

    return { enabled: false, reason: 'FEISHU_NOTIFY_CHAT_ID / FEISHU_NOTIFY_EMAIL / FEISHU_NOTIFY_RECEIVE_ID 均未配置' };
}

function buildPlanNotificationText(payload, resultContext = {}) {
    const taskText = Array.isArray(payload.taskIds) && payload.taskIds.length ? payload.taskIds.join(', ') : '-';
    const toolingText = Array.isArray(payload.toolingNames) && payload.toolingNames.length ? payload.toolingNames.join(', ') : '-';
    const weightRate = Number(payload.weightUtilization);
    const spaceRate = Number(payload.spaceUtilization);
    const planRecordId = resultContext.planRecordId || '';
    const updatedTaskCount = Number(resultContext.updatedTaskCount || 0);
    const failedTaskCount = Number(resultContext.failedTaskCount || 0);
    const pdfStatus = payload.pdfStatus || '本地导出，待上传';
    const planLink = payload.planLink || '';
    const pdfLink = payload.pdfLink || '';

    return [
        '✅ 装炉方案已生成',
        '',
        `方案：${payload.planName || '-'}`,
        `任务：${taskText}`,
        `客户：${payload.customer || '-'}`,
        `工艺：${payload.processGroup || '-'}`,
        `工装：${toolingText}`,
        `炉次数：${payload.furnaceCount || 0}`,
        `装载重量：${Number(payload.totalWeightKg || payload.totalWeight || 0).toFixed(1)} kg`,
        `重量利用率：${Number.isFinite(weightRate) ? weightRate.toFixed(1) : '-'}%`,
        `空间利用率：${Number.isFinite(spaceRate) ? spaceRate.toFixed(1) : '-'}%`,
        '',
        `方案记录：${planRecordId || '已写回飞书'}`,
        `任务状态：已更新 ${updatedTaskCount} 条${failedTaskCount ? `，失败 ${failedTaskCount} 条` : ''}`,
        `PDF状态：${pdfStatus}`,
        planLink ? `方案链接：${planLink}` : '',
        pdfLink && /^https?:\/\//i.test(pdfLink) ? `PDF链接：${pdfLink}` : ''
    ].filter(Boolean).join('\n');
}

async function sendFeishuBotText({ token, text, receiveIdType, receiveId }) {
    const target = receiveIdType && receiveId
        ? { enabled: true, receiveIdType, receiveId }
        : getFeishuNotifyTarget();

    if (!target.enabled) {
        return { ok: false, skipped: true, reason: target.reason || '机器人通知未配置' };
    }

    const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(target.receiveIdType)}`;
    const response = await axios.post(url, {
        receive_id: target.receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: String(text || '') })
    }, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
        }
    });

    if (response.data.code !== 0) {
        const error = new Error(`飞书机器人通知失败: ${response.data.msg || 'unknown'}`);
        error.feishu = response.data;
        throw error;
    }

    return {
        ok: true,
        skipped: false,
        receiveIdType: target.receiveIdType,
        receiveIdMasked: target.receiveId.includes('@') ? target.receiveId.replace(/(^.).*(@.*$)/, '$1***$2') : `${target.receiveId.slice(0, 4)}***`,
        targetKind: target.targetKind || target.receiveIdType,
        data: response.data.data || response.data
    };
}

async function notifyPlanWritebackSuccess({ token, payload, planRecordId, updatedTaskCount, failedTaskCount, duplicateSkipped }) {
    if (duplicateSkipped) {
        return { ok: false, skipped: true, reason: '重复写回跳过，不发送机器人通知' };
    }
    const text = buildPlanNotificationText(payload, { planRecordId, updatedTaskCount, failedTaskCount });
    return sendFeishuBotText({ token, text });
}

app.get("/api/health", (req, res) => {
    res.json({ ok: true, service: "AI heat treatment furnace server", version: "0.8.4.1" });
});

/**
 * V0.8.0：读取飞书生产任务表，返回标准物料任务 JSON。
 * Header: x-client-id: client_suoli
 */
app.get("/api/feishu/tasks", ensureFeishuToken, async (req, res) => {
    const { clientId, tenant } = getTenantFromRequest(req);
    if (!tenant) {
        return res.status(403).json({ ok: false, error: "未授权或非法的客户身份标识", clientId });
    }

    try {
        const records = await fetchBitableRecords({
            token: req.feishu_token,
            appToken: tenant.appToken,
            tableId: tenant.itemsTableId,
            pageSize: Number(req.query.page_size) || 100
        });

        const acceptedStatuses = ["待排产", "待同步", "未排产", "待生成方案"];
        const includeEmptyStatus = String(req.query.include_empty_status || "false") === "true";
        const nonEmptyRecords = records.filter(item => isNonEmptyFields(item.fields));
        const normalizedTasks = nonEmptyRecords.map(normalizeTaskRecord);
        const tasks = normalizedTasks.filter(task => {
            if (!task.status) return includeEmptyStatus;
            return acceptedStatuses.includes(task.status);
        });

        return res.json({
            ok: true,
            version: "0.8.2",
            source: "feishu",
            clientId,
            companyName: tenant.companyName,
            appToken: tenant.appToken,
            tableId: tenant.itemsTableId,
            totalRecords: records.length,
            emptyRecords: records.length - nonEmptyRecords.length,
            skippedByStatus: normalizedTasks.length - tasks.length,
            acceptedStatuses,
            taskCount: tasks.length,
            tasks
        });
    } catch (error) {
        console.error("读取飞书生产任务失败:", error.feishu || error.message);
        return res.status(500).json({
            ok: false,
            error: "读取飞书生产任务失败",
            detail: error.feishu || error.message
        });
    }
});


/**
 * V0.8.2：读取飞书设备 / 炉膛资源表。
 * Header: x-client-id: client_suoli
 */
app.get("/api/feishu/furnaces", ensureFeishuToken, async (req, res) => {
    const { clientId, tenant } = getTenantFromRequest(req);
    if (!tenant) {
        return res.status(403).json({ ok: false, error: "未授权或非法的客户身份标识", clientId });
    }

    try {
        const records = await fetchBitableRecords({
            token: req.feishu_token,
            appToken: tenant.appToken,
            tableId: tenant.furnaceTableId,
            pageSize: Number(req.query.page_size) || 100
        });
        const includeInactive = String(req.query.include_inactive || 'false') === 'true';
        const nonEmptyRecords = records.filter(item => isNonEmptyFields(item.fields));
        const furnaces = nonEmptyRecords
            .map(normalizeFurnaceResourceRecord)
            .filter(item => includeInactive || isActiveResourceStatus(item.status));

        return res.json({
            ok: true,
            version: "0.8.2",
            source: "feishu",
            clientId,
            companyName: tenant.companyName,
            appToken: tenant.appToken,
            tableId: tenant.furnaceTableId,
            totalRecords: records.length,
            emptyRecords: records.length - nonEmptyRecords.length,
            skippedInactive: nonEmptyRecords.length - furnaces.length,
            furnaceCount: furnaces.length,
            invalidCount: furnaces.filter(item => item.isValid === false).length,
            warningCount: furnaces.filter(item => Array.isArray(item.validationIssues) && item.validationIssues.length).length,
            syncAt: new Date().toISOString(),
            furnaces
        });
    } catch (error) {
        console.error("读取飞书设备炉膛失败:", error.feishu || error.message);
        return res.status(500).json({
            ok: false,
            version: "0.8.2",
            error: "读取飞书设备炉膛失败",
            detail: error.feishu || error.message
        });
    }
});

/**
 * V0.8.2：读取飞书工装 / 料框资源表。
 * Header: x-client-id: client_suoli
 */
app.get("/api/feishu/tooling", ensureFeishuToken, async (req, res) => {
    const { clientId, tenant } = getTenantFromRequest(req);
    if (!tenant) {
        return res.status(403).json({ ok: false, error: "未授权或非法的客户身份标识", clientId });
    }

    try {
        const records = await fetchBitableRecords({
            token: req.feishu_token,
            appToken: tenant.appToken,
            tableId: tenant.toolingTableId,
            pageSize: Number(req.query.page_size) || 100
        });
        const includeInactive = String(req.query.include_inactive || 'false') === 'true';
        const nonEmptyRecords = records.filter(item => isNonEmptyFields(item.fields));
        const tooling = nonEmptyRecords
            .map(normalizeToolingResourceRecord)
            .filter(item => includeInactive || isActiveResourceStatus(item.status));

        return res.json({
            ok: true,
            version: "0.8.2",
            source: "feishu",
            clientId,
            companyName: tenant.companyName,
            appToken: tenant.appToken,
            tableId: tenant.toolingTableId,
            totalRecords: records.length,
            emptyRecords: records.length - nonEmptyRecords.length,
            skippedInactive: nonEmptyRecords.length - tooling.length,
            toolingCount: tooling.length,
            invalidCount: tooling.filter(item => item.isValid === false).length,
            warningCount: tooling.filter(item => Array.isArray(item.validationIssues) && item.validationIssues.length).length,
            syncAt: new Date().toISOString(),
            tooling
        });
    } catch (error) {
        console.error("读取飞书工装资源失败:", error.feishu || error.message);
        return res.status(500).json({
            ok: false,
            version: "0.8.2",
            error: "读取飞书工装资源失败",
            detail: error.feishu || error.message
        });
    }
});



/**
 * V0.8.1：保存当前方案到飞书方案记录表，并可同步更新来源任务状态。
 * Header: x-client-id: client_suoli
 * Body: {
 *   planName, furnaceCount, totalWeightKg, weightUtilization, spaceUtilization,
 *   sourceRecordIds: [], taskIds: [], planJson, updateTaskStatus: true
 * }
 */
app.post("/api/feishu/plans", ensureFeishuToken, async (req, res) => {
    const { clientId, tenant } = getTenantFromRequest(req);
    if (!tenant) {
        return res.status(403).json({ ok: false, error: "未授权或非法的客户身份标识", clientId });
    }

    try {
        const payload = req.body || {};
        const forceCreate = payload.forceCreate === true;
        console.log('[Feishu Plan Writeback] request:', summarizeWritebackPayload(payload));

        const fieldMap = await fetchBitableFields({
            token: req.feishu_token,
            appToken: tenant.appToken,
            tableId: tenant.plansTableId
        });

        const fields = buildFeishuPlanRecordFields(payload, fieldMap);
        if (!fields["方案名称"]) fields["方案名称"] = payload.planName || `AI装炉方案_${new Date().toISOString().slice(0, 10)}`;

        const writebackKey = String(payload.writebackKey || '').trim();
        let createdPlan = null;
        let duplicateSkipped = false;
        let existingPlan = null;

        if (writebackKey && !forceCreate) {
            existingPlan = await findExistingPlanByWritebackKey({
                token: req.feishu_token,
                appToken: tenant.appToken,
                tableId: tenant.plansTableId,
                writebackKey
            });
        }

        if (existingPlan) {
            duplicateSkipped = true;
            createdPlan = existingPlan;
            console.log(`[Feishu Plan Writeback] duplicate skipped: ${writebackKey} -> ${existingPlan.record_id}`);
        } else {
            createdPlan = await createBitableRecord({
                token: req.feishu_token,
                appToken: tenant.appToken,
                tableId: tenant.plansTableId,
                fields
            });
            console.log(`[Feishu Plan Writeback] plan created: ${createdPlan?.record_id || createdPlan?.id || 'unknown'}`);
        }

        const updateTaskStatus = payload.updateTaskStatus !== false;
        const uniqueRecordIds = Array.from(new Set((payload.sourceRecordIds || []).filter(Boolean)));
        const updatedTasks = [];
        const failedTasks = [];
        const skippedTasks = [];

        if (updateTaskStatus && uniqueRecordIds.length > 0) {
            const statusFields = buildTaskStatusUpdateFields(payload.taskStatus || "已生成方案");
            for (const recordId of uniqueRecordIds) {
                try {
                    const updated = await updateBitableRecord({
                        token: req.feishu_token,
                        appToken: tenant.appToken,
                        tableId: tenant.itemsTableId,
                        recordId,
                        fields: statusFields
                    });
                    updatedTasks.push({ recordId, ok: true, record: updated });
                } catch (taskErr) {
                    failedTasks.push({ recordId, ok: false, detail: taskErr.feishu || taskErr.message });
                }
            }
        } else if (!updateTaskStatus) {
            skippedTasks.push({ reason: 'updateTaskStatus=false' });
        }

        const planRecordId = createdPlan?.record_id || createdPlan?.id || existingPlan?.record_id || '';
        let notification = { ok: false, skipped: true, reason: 'not attempted' };
        if (payload.notifyBot !== false) {
            try {
                notification = await notifyPlanWritebackSuccess({
                    token: req.feishu_token,
                    payload,
                    planRecordId,
                    updatedTaskCount: updatedTasks.length,
                    failedTaskCount: failedTasks.length,
                    duplicateSkipped
                });
                if (notification.ok) {
                    console.log(`[Feishu Bot] notification sent for plan ${planRecordId || payload.planName || ''}`);
                } else if (notification.skipped) {
                    console.log(`[Feishu Bot] notification skipped: ${notification.reason}`);
                }
            } catch (notifyErr) {
                console.warn('[Feishu Bot] notification failed:', notifyErr.feishu || notifyErr.message);
                notification = { ok: false, skipped: false, error: notifyErr.feishu || notifyErr.message };
            }
        } else {
            notification = { ok: false, skipped: true, reason: 'payload.notifyBot=false' };
        }

        return res.json({
            ok: true,
            version: "0.8.4.1",
            source: "feishu",
            clientId,
            companyName: tenant.companyName,
            planTableId: tenant.plansTableId,
            taskTableId: tenant.itemsTableId,
            duplicateSkipped,
            createdPlan,
            existingPlan: duplicateSkipped ? existingPlan : null,
            writtenFields: duplicateSkipped ? {} : fields,
            writebackKey,
            updatedTaskCount: updatedTasks.length,
            failedTaskCount: failedTasks.length,
            skippedTaskCount: skippedTasks.length,
            updatedTasks,
            failedTasks,
            skippedTasks,
            notification
        });
    } catch (error) {
        console.error("写回飞书方案失败:", error.feishu || error.message);
        return res.status(500).json({
            ok: false,
            version: "0.8.4.1",
            error: "写回飞书方案失败",
            detail: error.feishu || error.message
        });
    }
});

/**
 * V0.8.5：订单草稿 -> 生产任务。
 * Header: x-client-id: client_suoli
 * Body: { dryRun?: boolean }
 * - dryRun=true：只预览，不写入飞书。
 * - dryRun=false：只转换第一条，避免误批量写入。
 */
app.post("/api/feishu/order-drafts/convert", ensureFeishuToken, async (req, res) => {
    const { clientId, tenant } = getTenantFromRequest(req);
    if (!tenant) {
        return res.status(403).json({ ok: false, error: "未授权或非法的客户身份标识", clientId });
    }

    const orderDraftsAppToken = tenant.orderDraftsAppToken || process.env.FEISHU_ORDER_DRAFTS_APP_TOKEN || tenant.appToken;
    const orderDraftsTableId = tenant.orderDraftsTableId || process.env.FEISHU_ORDER_DRAFTS_TABLE_ID;
    const productionTasksAppToken = process.env.FEISHU_PRODUCTION_TASKS_APP_TOKEN || tenant.appToken;
    const productionTasksTableId = process.env.FEISHU_PRODUCTION_TASKS_TABLE_ID || tenant.itemsTableId;

    if (!orderDraftsAppToken || !orderDraftsTableId) {
        return res.status(500).json({
            ok: false,
            version: "0.8.5",
            error: "订单草稿表未配置",
            detail: "请检查 FEISHU_ORDER_DRAFTS_APP_TOKEN / FEISHU_ORDER_DRAFTS_TABLE_ID"
        });
    }

    if (!productionTasksAppToken || !productionTasksTableId) {
        return res.status(500).json({
            ok: false,
            version: "0.8.5",
            error: "生产任务表未配置",
            detail: "请检查 FEISHU_PRODUCTION_TASKS_APP_TOKEN / FEISHU_PRODUCTION_TASKS_TABLE_ID"
        });
    }

    try {
        const dryRun = req.body?.dryRun !== false;

        const records = await fetchBitableRecords({
            token: req.feishu_token,
            appToken: orderDraftsAppToken,
            tableId: orderDraftsTableId,
            pageSize: Number(req.body?.pageSize || req.query.page_size) || 100
        });

        const nonEmptyRecords = records.filter(item => isNonEmptyFields(item.fields));
        const convertibleRecords = nonEmptyRecords.filter(record => isConvertibleOrderDraft(record.fields || {}));

        const previewTasks = convertibleRecords.map(record => ({
            draftRecordId: record.record_id,
            taskFields: buildProductionTaskFieldsFromOrderDraft(record)
        }));

        if (dryRun) {
            return res.json({
                ok: true,
                version: "0.8.5",
                dryRun: true,
                clientId,
                companyName: tenant.companyName,
                totalRecords: records.length,
                nonEmptyRecords: nonEmptyRecords.length,
                convertibleCount: convertibleRecords.length,
                previewTasks
            });
        }

        const first = previewTasks[0];

        if (!first) {
            return res.json({
                ok: true,
                version: "0.8.5",
                dryRun: false,
                convertedCount: 0,
                message: "没有可转换订单"
            });
        }

        const createdTask = await createBitableRecord({
            token: req.feishu_token,
            appToken: productionTasksAppToken,
            tableId: productionTasksTableId,
            fields: first.taskFields
        });

        const productionTaskRecordId = createdTask?.record_id || createdTask?.id || "";

        await updateBitableRecord({
            token: req.feishu_token,
            appToken: orderDraftsAppToken,
            tableId: orderDraftsTableId,
            recordId: first.draftRecordId,
            fields: buildOrderDraftUpdateFieldsAfterConvert(productionTaskRecordId)
        });

        return res.json({
            ok: true,
            version: "0.8.5",
            dryRun: false,
            convertedCount: 1,
            result: {
                draftRecordId: first.draftRecordId,
                productionTaskRecordId,
                taskFields: first.taskFields
            }
        });
    } catch (error) {
        console.error("订单草稿转换生产任务失败:", error.feishu || error.message);
        return res.status(500).json({
            ok: false,
            version: "0.8.5",
            error: "订单草稿转换生产任务失败",
            detail: error.feishu || error.message
        });
    }
});

function cleanFeishuBotMessageText(text) {
    return String(text || "")
        .replace(/<at[^>]*>.*?<\/at>/g, "")
        .replace(/@\S+/g, "")
        .trim();
}

function parseFeishuTextMessageContent(content) {
    if (!content) return "";

    if (typeof content === "string") {
        try {
            const parsed = JSON.parse(content);
            return parsed.text || parsed.content || content;
        } catch {
            return content;
        }
    }

    if (content.text) return content.text;
    return JSON.stringify(content);
}

function parseOrderDraftFromText(text) {
    const result = {};
    const lines = String(text || "")
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        const match = line.match(/^(.+?)[：:]\s*(.+)$/);
        if (!match) continue;

        const key = match[1].trim();
        const value = match[2].trim();

        if (["客户", "客户名称"].includes(key)) result.customer = value;
        if (["产品", "产品名称", "工件", "工件名称"].includes(key)) result.productName = value;
        if (["物料", "物料编码", "物料编号", "图号"].includes(key)) result.itemCode = value;
        if (["形状"].includes(key)) result.shape = value;
        if (["材质", "材料"].includes(key)) result.material = value;
        if (["工艺", "热处理工艺"].includes(key)) result.process = value;
        if (["硬度", "硬度要求"].includes(key)) result.hardness = value;
        if (["渗层", "渗层要求"].includes(key)) result.caseDepth = value;

        if (["长度", "长"].includes(key)) result.length = value;
        if (["宽度", "宽"].includes(key)) result.width = value;
        if (["高度", "高", "厚度"].includes(key)) result.height = value;
        if (["直径", "外径"].includes(key)) result.diameter = value;

        if (["数量", "件数"].includes(key)) result.count = value;
        if (["总重量", "总重量kg", "重量"].includes(key)) result.totalWeight = value;

        if (["来料时间"].includes(key)) result.arrivalDate = value;
        if (["交期", "交期时间", "交货日期"].includes(key)) result.deliveryDate = value;

        if (["备注", "说明"].includes(key)) result.remark = value;
    }

    return result;
}

function buildOrderDraftFieldsFromParsedOrder(parsed, fieldMap, rawText, messageId) {
    const fields = {};

    // 机器人只生成“待确认”草稿，不直接进入生产任务。
    // 后面由客服在飞书里确认后，把订单状态改成“待转换”，并勾选“是否生成生产任务”。
    addSingleSelectIfWritable(fields, fieldMap, "订单状态", "待确认");
    addTextIfWritable(fields, fieldMap, "客户名称", parsed.customer || "");
    addTextIfWritable(fields, fieldMap, "产品名称", parsed.productName || "");
    addTextIfWritable(fields, fieldMap, "工件名称", parsed.productName || "");
    addTextIfWritable(fields, fieldMap, "物料编码", parsed.itemCode || "");
    addTextIfWritable(fields, fieldMap, "物料编号", parsed.itemCode || "");

    addSingleSelectIfWritable(fields, fieldMap, "形状", parsed.shape || "");
    addTextIfWritable(fields, fieldMap, "形状", parsed.shape || "");

    addTextIfWritable(fields, fieldMap, "材质", parsed.material || "");
    addTextIfWritable(fields, fieldMap, "工艺", parsed.process || "");
    addTextIfWritable(fields, fieldMap, "硬度要求", parsed.hardness || "");
    addTextIfWritable(fields, fieldMap, "渗层要求", parsed.caseDepth || "");

    addNumberIfWritable(fields, fieldMap, "长度", readNumber({ value: parsed.length }, ["value"], 0));
    addNumberIfWritable(fields, fieldMap, "宽度", readNumber({ value: parsed.width }, ["value"], 0));
    addNumberIfWritable(fields, fieldMap, "高度", readNumber({ value: parsed.height }, ["value"], 0));
    addNumberIfWritable(fields, fieldMap, "直径", readNumber({ value: parsed.diameter }, ["value"], 0));
    addNumberIfWritable(fields, fieldMap, "数量", readNumber({ value: parsed.count }, ["value"], 0));
    addNumberIfWritable(fields, fieldMap, "总重量", readNumber({ value: parsed.totalWeight }, ["value"], 0));
    addNumberIfWritable(fields, fieldMap, "总重量kg", readNumber({ value: parsed.totalWeight }, ["value"], 0));

    addDateTimeIfWritable(fields, fieldMap, "来料时间", parsed.arrivalDate || "");
    addDateTimeIfWritable(fields, fieldMap, "交期时间", parsed.deliveryDate || "");
    addDateTimeIfWritable(fields, fieldMap, "交期", parsed.deliveryDate || "");

    addTextIfWritable(fields, fieldMap, "备注", parsed.remark || "");
    addTextIfWritable(fields, fieldMap, "原始消息", rawText || "", 5000);
    addTextIfWritable(fields, fieldMap, "飞书消息ID", messageId || "");

    if (fieldMap.has("是否生成生产任务")) {
        fields["是否生成生产任务"] = false;
    }

    return fields;
}

/**
 * V0.8.6：飞书机器人事件入口
 * 用于：群聊 @ 机器人 → 解析文字 → 写入订单草稿表
 */
app.post("/api/feishu/bot/events", async (req, res, next) => {
    const body = req.body || {};

    // 飞书 URL 验证：必须快速返回 challenge
    if (body.type === "url_verification" || body.challenge) {
        return res.json({
            challenge: body.challenge
        });
    }

    return ensureFeishuToken(req, res, next);
}, async (req, res) => {
    const body = req.body || {};
    const event = body.event || {};
    const message = event.message || {};
    const sender = event.sender || {};

    try {
        const rawContent = message.content || "";
        const rawText = cleanFeishuBotMessageText(parseFeishuTextMessageContent(rawContent));
        const messageType = message.message_type || "";
        const messageId = message.message_id || "";
        const chatId = message.chat_id || "";

        console.log("[Feishu Bot Event] messageType:", messageType);
        console.log("[Feishu Bot Event] text:", rawText);

        // 第一版只处理文本消息
        if (messageType && messageType !== "text") {
            return res.json({
                ok: true,
                skipped: true,
                reason: `暂不处理 ${messageType} 类型消息`
            });
        }

        if (!rawText) {
            return res.json({
                ok: true,
                skipped: true,
                reason: "消息内容为空"
            });
        }

        const parsedOrder = parseOrderDraftFromText(rawText);

        if (!parsedOrder.customer && !parsedOrder.productName) {
            if (chatId) {
                await sendFeishuBotText({
                    token: req.feishu_token,
                    receiveIdType: "chat_id",
                    receiveId: chatId,
                    text: [
                        "我收到了消息，但没有识别到订单信息。",
                        "",
                        "请按这个格式发送：",
                        "客户：索力机械",
                        "产品名称：齿轮",
                        "材质：40Cr",
                        "工艺：真空淬火",
                        "数量：30",
                        "总重量：120kg",
                        "交期：2026-06-30"
                    ].join("\n")
                });
            }

            return res.json({
                ok: true,
                skipped: true,
                reason: "未识别到订单字段",
                rawText
            });
        }

        const { clientId, tenant } = getTenantFromRequest(req);
        if (!tenant) {
            return res.status(403).json({
                ok: false,
                error: "未授权或非法的客户身份标识",
                clientId
            });
        }

        const orderDraftsAppToken = tenant.orderDraftsAppToken || process.env.FEISHU_ORDER_DRAFTS_APP_TOKEN || tenant.appToken;
        const orderDraftsTableId = tenant.orderDraftsTableId || process.env.FEISHU_ORDER_DRAFTS_TABLE_ID;

        if (!orderDraftsAppToken || !orderDraftsTableId) {
            return res.status(500).json({
                ok: false,
                error: "订单草稿表未配置",
                detail: "请检查 FEISHU_ORDER_DRAFTS_APP_TOKEN / FEISHU_ORDER_DRAFTS_TABLE_ID"
            });
        }

        const fieldMap = await fetchBitableFields({
            token: req.feishu_token,
            appToken: orderDraftsAppToken,
            tableId: orderDraftsTableId
        });

        const draftFields = buildOrderDraftFieldsFromParsedOrder(
            parsedOrder,
            fieldMap,
            rawText,
            messageId
        );

        const createdDraft = await createBitableRecord({
            token: req.feishu_token,
            appToken: orderDraftsAppToken,
            tableId: orderDraftsTableId,
            fields: draftFields
        });

        const draftRecordId = createdDraft?.record_id || createdDraft?.id || "";

        if (chatId) {
            await sendFeishuBotText({
                token: req.feishu_token,
                receiveIdType: "chat_id",
                receiveId: chatId,
                text: [
                    "✅ 已生成订单草稿，请在飞书「订单草稿表」确认。",
                    "",
                    `客户：${parsedOrder.customer || "-"}`,
                    `产品：${parsedOrder.productName || "-"}`,
                    `材质：${parsedOrder.material || "-"}`,
                    `工艺：${parsedOrder.process || "-"}`,
                    `数量：${parsedOrder.count || "-"}`,
                    `总重量：${parsedOrder.totalWeight || "-"}`,
                    `交期：${parsedOrder.deliveryDate || "-"}`,
                    "",
                    `草稿记录ID：${draftRecordId}`
                ].join("\n")
            });
        }

        return res.json({
            ok: true,
            version: "0.8.6",
            message: "订单草稿已创建",
            draftRecordId,
            parsedOrder,
            writtenFields: draftFields,
            sender
        });
    } catch (error) {
        console.error("飞书机器人整理订单失败:", error.feishu || error.message);
        return res.status(500).json({
            ok: false,
            version: "0.8.6",
            error: "飞书机器人整理订单失败",
            detail: error.feishu || error.message
        });
    }
});

/**
 * V0.8.4.1：机器人通知测试接口。
 * Header: x-client-id: client_suoli
 * Body: { text?: string, receiveId?: string, receiveIdType?: 'email'|'chat_id'|'open_id'|'user_id' }
 */
app.post("/api/feishu/notify-test", ensureFeishuToken, async (req, res) => {
    try {
        const body = req.body || {};
        const text = body.text || '✅ 热处理装炉引擎测试消息：机器人通知接口已打通。';
        const result = await sendFeishuBotText({
            token: req.feishu_token,
            text,
            receiveId: body.receiveId,
            receiveIdType: body.receiveIdType
        });
        return res.json({ ok: !!result.ok, version: '0.8.4.1', notification: result });
    } catch (error) {
        console.error('[Feishu Bot] test notification failed:', error.feishu || error.message);
        return res.status(500).json({
            ok: false,
            version: '0.8.4.1',
            error: '飞书机器人测试通知失败',
            detail: error.feishu || error.message
        });
    }
});

/**
 * 保留旧接口：读取炉膛资产。
 */
app.get("/api/furnaces", ensureFeishuToken, async (req, res) => {
    const { clientId, tenant } = getTenantFromRequest(req);
    if (!tenant) {
        return res.status(403).json({ error: "未授权或非法的客户身份标识，拒绝数据访问" });
    }

    try {
        console.log(`正在为客户 [${tenant.companyName}] 路由拉取炉膛资产...`);
        const records = await fetchBitableRecords({
            token: req.feishu_token,
            appToken: tenant.appToken,
            tableId: tenant.furnaceTableId,
            pageSize: 100
        });

        const formattedFurnaces = records
            .filter(item => isNonEmptyFields(item.fields))
            .map(item => {
                const fields = item.fields || {};
                return {
                    recordId: item.record_id,
                    name: readField(fields, ["炉膛名称", "设备名称", "名称"], "未命名炉膛"),
                    width: readNumber(fields, ["宽度X", "宽度", "宽", "长度"], 0),
                    height: readNumber(fields, ["高度Y", "高度", "高"], 0),
                    depth: readNumber(fields, ["深度Z", "深度", "长度", "长"], 0),
                    maxWeight: readNumber(fields, ["最大承重kg", "最大承重", "承重"], 0),
                    quantity: readNumber(fields, ["可用数量", "数量"], 1) || 1
                };
            });

        res.json(formattedFurnaces);
    } catch (error) {
        console.error(`拉取客户 [${clientId}] 炉膛数据失败:`, error.feishu || error.message);
        res.status(500).json({ error: "服务器内部拉取飞书表格失败", detail: error.feishu || error.message });
    }
});

// 静态文件托管：兼容 server.js 放在项目根目录或 js/ 目录两种情况。
const ROOT_DIR = fs.existsSync(path.resolve(__dirname, "furnace.html"))
    ? __dirname
    : path.resolve(__dirname, "..");
app.use(express.static(ROOT_DIR));

app.get("*", (req, res) => {
    res.sendFile(path.resolve(ROOT_DIR, "furnace.html"));
});

app.listen(PORT, () => {
    console.log(`🚀 热处理云端排产引擎 V0.8.5 已在端口 ${PORT} 启动`);
});
