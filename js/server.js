// server.js - 智能预装炉云端安全中转中心
const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

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
        const response = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
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
 * 请求头必须携带 x-client-id 来决定读取哪张表
 */
app.get('/api/furnaces', ensureFeishuToken, async (req, res) => {
    const clientId = req.headers['x-client-id'];
    const tenant = TENANT_DATABASE[clientId];

    if (!tenant) {
        return res.status(403).json({ error: "未授权或非法的客户身份标识，拒绝数据访问" });
    }

    try {
        console.log(`正在为客户 [${tenant.companyName}] 路由拉取飞书多维表格资产...`);
        // 请求飞书多维表格记录列表（默认单页最大支持500条，对炉膛完全够用）
        const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${tenant.appToken}/tables/${tenant.furnaceTableId}/records?page_size=100`;
        
        const fsResponse = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${req.feishu_token}` }
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
const ROOT_DIR = path.resolve(__dirname, '..');
app.use(express.static(ROOT_DIR));

// 兜底路由，指向主页
app.get('*', (req, res) => {
    res.sendFile(path.resolve(ROOT_DIR, 'furnace.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 热处理云端排产引擎已成功在端口 ${PORT} 挂载！`);
});