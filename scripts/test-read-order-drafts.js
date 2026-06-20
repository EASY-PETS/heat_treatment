require('dotenv').config();
const axios = require('axios');

const {
  FEISHU_APP_ID,
  FEISHU_APP_SECRET,
  FEISHU_ORDER_DRAFTS_APP_TOKEN,
  FEISHU_ORDER_DRAFTS_TABLE_ID
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

async function readOrderDrafts() {
  const token = await getTenantAccessToken();

  const url =
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_ORDER_DRAFTS_APP_TOKEN}` +
    `/tables/${FEISHU_ORDER_DRAFTS_TABLE_ID}/records`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    params: {
      page_size: 20
    }
  });

  if (res.data.code !== 0) {
    throw new Error(`读取订单草稿表失败：${JSON.stringify(res.data)}`);
  }

  const records = res.data.data.items || [];

  console.log(`成功读取订单草稿表，共 ${records.length} 条记录：`);

  records.forEach((record, index) => {
    console.log('\n----------------------');
    console.log(`第 ${index + 1} 条`);
    console.log('record_id:', record.record_id);
    console.log('fields:', JSON.stringify(record.fields, null, 2));
  });
}

readOrderDrafts().catch((err) => {
  console.error(err.message);
  process.exit(1);
});