require('dotenv').config();
const axios = require('axios');

const {
  FEISHU_APP_ID,
  FEISHU_APP_SECRET,
  FEISHU_PRODUCTION_TASKS_APP_TOKEN,
  FEISHU_PRODUCTION_TASKS_TABLE_ID
} = process.env;

async function getTenantAccessToken() {
  const res = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET
    }
  );

  if (res.data.code !== 0) {
    throw new Error(`获取 tenant_access_token 失败：${JSON.stringify(res.data)}`);
  }

  return res.data.tenant_access_token;
}

async function main() {
  const token = await getTenantAccessToken();

  const url =
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_PRODUCTION_TASKS_APP_TOKEN}` +
    `/tables/${FEISHU_PRODUCTION_TASKS_TABLE_ID}/fields`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    params: {
      page_size: 100
    }
  });

  if (res.data.code !== 0) {
    throw new Error(`读取生产任务表字段失败：${JSON.stringify(res.data)}`);
  }

  const fields = res.data.data.items || [];

  console.log(`生产任务表字段数量：${fields.length}`);
  console.log('\n字段列表：');

  fields.forEach((field, index) => {
    console.log(`${index + 1}. ${field.field_name} | type: ${field.type}`);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});