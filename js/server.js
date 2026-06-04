/**
 * server.js - 智能预装炉云端安全中转中心
 *
 * 该服务器作为 Three.js 前端应用的后端中转，主要负责：
 * 1. 提供静态文件托管服务。
 * 2. 安全地获取并刷新飞书 (Feishu) 的 tenant access token。
 * 3. 根据客户端 ID (x-client-id) 安全地从飞书多维表格中拉取指定客户的炉膛配置数据。
 * 4. 实现多租户数据隔离，确保不同客户只能访问自己的配置。
 *
 * Dependencies:
 *   - express: 用于构建 Web 服务器。
 *   - axios: 用于发起 HTTP 请求，与飞书 API 交互。
 *   - path: Node.js 内置模块，用于处理文件路径。
 *   - cors: 处理跨域请求，方便本地开发调试。
 */
const express = require("express");
const axios = require("axios");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors()); // 允许跨域（本地开发调试用）

// 1. 动态自适应 Azure 端口环境
const PORT = process.env.PORT || 3000;

// 2. 飞书核心凭证（强烈建议在 Azure 后台配置环境变量，绝对不要硬编码写死）
const FEISHU_CONFIG = {
    app_id: process.env.FEISHU_APP_ID || "你的飞书自建应用_APP_ID",
    app_secret: process.env.FEISHU_APP_SECRET || "你的飞书自建应用_APP_SECRET"
};

// 3. 内存级多租户数据库映射（MVP试用阶段最轻量的隔离方案）
// 不同的客户登录后，通过各自的 ID 映射到完全独立的飞书多维表格中
const TENANT_DATABASE = {
    "client_suoli": {
        companyName: "台州索力机械",
        appToken: "XpL0bSHcNakoBmsdW9oc5vbmnlb", // 浏览器地址栏中的 base 后面那一串
        furnaceTableId: "tblZs52nGvlaBDwQ",         // 炉膛子表的 TableId
        itemsTableId: "tblpjfR2NJbT0Avi",            // 物料子表的 TableId
        plansTableId: "tblfNkCOrscyswPa"
    },
    "client_qiujing": {
        companyName: "永康求精科技",
        appToken: "XpL0bSHcNakoBmsdW9oc5vbmnlb",
        furnaceTableId: "tblXaD6ZugdcAUXU",
        itemsTableId: "tblrt8asMgbaYHcA",
        plansTableId: "tbl6GJpeyrDyApQn"
    }
};

// 4. 飞书 Access Token 本地缓存变量（飞书Token有效期为2小时，缓存可以极大加快接口响应）
let cachedToken = null;
let tokenExpiryTime = 0;

/**
 * 核心安全机制：自动获取并续期飞书凭证的中间件
 * 验证并刷新飞书租户访问凭证。如果凭证过期或不存在，则向飞书开放平台请求新的凭证。
 * 凭证成功获取后，会缓存下来并在有效期内复用，以优化性能。
 * @param {object} req - Express 请求对象，feishu_token 将被挂载到此对象上。
 * @param {object} res - Express 响应对象。
 * @param {function} next - Express 中间件的下一个函数。
 * @returns {Promise<void>}
 */
async function ensureFeishuToken(req, res, next) {
    const currentTime = Date.now();
    // 如果缓存未过期（预留60秒缓冲区），直接复用
    if (cachedToken && currentTime < (tokenExpiryTime - 60000)) {
        req.feishu_token = cachedToken;
        return next();
    }

    try {
        console.log("正在向飞书中心申请新的租户凭证...");
        const response = await axios.post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
            app_id: FEISHU_CONFIG.app_id,
            app_secret: FEISHU_CONFIG.app_secret
        });
        
        if (response.data.code === 0) {
            cachedToken = response.data.tenant_access_token;
            // expire 是秒，转换为毫秒
            tokenExpiryTime = currentTime + (response.data.expire * 1000);
            req.feishu_token = cachedToken;
            next();
        } else {
            throw new Error(`飞书鉴权失败: ${response.data.msg}`);
        }
    } catch (err) {
        console.error("飞书凭证握手发生致命错误:", err.message);
        res.status(500).json({ error: "云端中转鉴权失败，请检查飞书自建应用状态" });
    }
}

/**
 * 接口1：安全拉取指定客户专属的炉膛资产
 * 请求头必须携带 x-client-id 来决定读取哪张表。
 * @param {object} req - Express 请求对象，包含客户 ID 和飞书 token。
 * @param {object} res - Express 响应对象。
 * @returns {Promise<void>}
 */
app.get("/api/furnaces", ensureFeishuToken, async (req, res) => {
    const clientId = req.headers["x-client-id"];
    const tenant = TENANT_DATABASE[clientId];

    if (!tenant) {
        return res.status(403).json({ error: "未授权或非法的客户身份标识，拒绝数据访问" });
    }

    try {
        console.log(`正在为客户 [${tenant.companyName}] 路由拉取飞书多维表格资产...`);
        // 请求飞书多维表格记录列表（默认单页最大支持500条，对炉膛完全够用）
        const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${tenant.appToken}/tables/${tenant.furnaceTableId}/records?page_size=100`;
        
        const fsResponse = await axios.get(url, {
            headers: { "Authorization": `Bearer ${req.feishu_token}` }
        });

        if (fsResponse.data.code !== 0) {
            return res.status(500).json({ error: `飞书表格返回错误: ${fsResponse.data.msg}` });
        }

        const records = fsResponse.data.data.items || [];
        
        // 关键数据清洗清洗：将飞书的 fields 结构扁平化为你前端 JS 模块所需的标准对象
        const formattedFurnaces = records.map(item => {
            const fields = item.fields;
            return {
                name: fields.炉膛名称 || "未命名炉膛",
                width: Number(fields.长度) || 0,
                height: Number(fields.宽度) || 0,
                depth: Number(fields.高度) || 0,
                maxWeight: Number(fields.最大承重) || 0,
                quantity: 1
            };
        });

        res.json(formattedFurnaces);

    } catch (error) {
        console.error(`拉取客户 [${clientId}] 数据失败:`, error.message);
        res.status(500).json({ error: "服务器内部拉取飞书表格失败" });
    }
});

// 5. 静态文件托管：让 Azure 直接代理你的前端解耦目录
// 项目根目录在上层（因为此文件位于 js/ 目录内）
const ROOT_DIR = path.resolve(__dirname, "..");
app.use(express.static(ROOT_DIR));

/**
 * 兜底路由：处理所有未匹配的 GET 请求，并返回主页文件 `furnace.html`。
 * @param {object} req - Express 请求对象。
 * @param {object} res - Express 响应对象。
 * @returns {void}
 */
app.get("*", (req, res) => {
    res.sendFile(path.resolve(ROOT_DIR, "furnace.html"));
});

/**
 * 启动 Express 服务器，监听指定端口。
 * @returns {void}
 */
app.listen(PORT, () => {
    console.log(`🚀 热处理云端排产引擎已成功在端口 ${PORT} 挂载！`);
});
