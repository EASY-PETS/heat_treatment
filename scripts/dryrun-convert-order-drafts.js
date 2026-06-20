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

async function readOrderDrafts(token) {
  const url =
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_ORDER_DRAFTS_APP_TOKEN}` +
    `/tables/${FEISHU_ORDER_DRAFTS_TABLE_ID}/records`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    params: {
      page_size: 100
    }
  });

  if (res.data.code !== 0) {
    throw new Error(`读取订单草稿表失败：${JSON.stringify(res.data)}`);
  }

  return res.data.data.items || [];
}

function isConvertibleDraft(fields) {
  return fields['订单状态'] === '待转换' && fields['是否生成生产任务'] === true;
}

function convertDraftToProductionTask(record) {
  const fields = record.fields || {};

  return {
    来源草稿记录ID: record.record_id,

    // 生产任务基础信息
    任务编号: `TASK-${Date.now()}`,
    任务状态: '待排产',
    客户名称: fields['客户名称'] || '',
    产品名称: fields['产品名称'] || fields['工件名称'] || '',
    物料编号: fields['物料编号'] || '',
    材质: fields['材质'] || '',
    工艺: fields['工艺'] || '',

    // 尺寸信息
    长度: Number(fields['长度'] || 0),
    宽度: Number(fields['宽度'] || 0),
    直径: Number(fields['直径'] || 0),

    // 数量重量
    数量: Number(fields['数量'] || 0),
    总重量: Number(fields['总重量'] || fields['总重量kg'] || 0),

    // 工艺要求
    硬度要求: fields['硬度要求'] || '',
    交期时间: fields['交期时间'] || fields['交期'] || '',

    // 备注
    来源订单状态: fields['订单状态'] || '',
    草稿编号: fields['草稿编号'] || '',
    备注: fields['备注'] || ''
  };
}

async function main() {
  const token = await getTenantAccessToken();
  const records = await readOrderDrafts(token);

  console.log(`读取订单草稿表成功，共 ${records.length} 条`);

  const convertibleRecords = records.filter((record) =>
    isConvertibleDraft(record.fields || {})
  );

  console.log(`符合转换条件的订单草稿：${convertibleRecords.length} 条`);

  if (convertibleRecords.length === 0) {
    console.log('\n没有找到可转换草稿。请确认：');
    console.log('1. 订单状态 = 待转换');
    console.log('2. 是否生成生产任务 = true / 已勾选');
    return;
  }

  const previewTasks = convertibleRecords.map(convertDraftToProductionTask);

  console.log('\n====== dryRun 生产任务预览，不会写入飞书 ======');

  previewTasks.forEach((task, index) => {
    console.log(`\n--- 生产任务预览 ${index + 1} ---`);
    console.log(JSON.stringify(task, null, 2));
  });

  console.log('\n====== dryRun 完成 ======');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});