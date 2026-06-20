require('dotenv').config();
const axios = require('axios');

const {
  FEISHU_APP_ID,
  FEISHU_APP_SECRET,
  FEISHU_ORDER_DRAFTS_APP_TOKEN,
  FEISHU_ORDER_DRAFTS_TABLE_ID,
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

function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toDateValue(value) {
  if (!value) return undefined;

  // 飞书日期字段通常可以直接用读取出来的毫秒时间戳
  if (typeof value === 'number') return value;

  // 如果是字符串日期，尝试转成毫秒时间戳
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function setIfValue(target, key, value) {
  if (value === undefined || value === null || value === '') return;
  target[key] = value;
}

function createTaskFieldsFromDraft(record) {
  const fields = record.fields || {};

  const taskFields = {};

  setIfValue(taskFields, '任务编号', `TASK-${Date.now()}`);
  setIfValue(taskFields, '状态', '待排产');

  setIfValue(taskFields, '客户名称', fields['客户名称']);
  setIfValue(taskFields, '产品名称', fields['产品名称'] || fields['工件名称']);

  // 注意：你的生产任务表叫“物料编码”，不是“物料编号”
  setIfValue(taskFields, '物料编码', fields['物料编码'] || fields['物料编号']);

  setIfValue(taskFields, '材质', fields['材质']);
  setIfValue(taskFields, '工艺', fields['工艺']);
  setIfValue(taskFields, '硬度要求', fields['硬度要求']);
  setIfValue(taskFields, '渗层要求', fields['渗层要求']);

  setIfValue(taskFields, '长度', toNumber(fields['长度']));
  setIfValue(taskFields, '宽度', toNumber(fields['宽度']));
  setIfValue(taskFields, '高度', toNumber(fields['高度']));
  setIfValue(taskFields, '直径', toNumber(fields['直径']));
  setIfValue(taskFields, '数量', toNumber(fields['数量']));
  setIfValue(taskFields, '总重量', toNumber(fields['总重量'] || fields['总重量kg']));

  setIfValue(taskFields, '来料时间', toDateValue(fields['来料时间']));
  setIfValue(taskFields, '交期时间', toDateValue(fields['交期时间'] || fields['交期']));

  setIfValue(taskFields, '备注', fields['备注']);
  setIfValue(taskFields, '来源草稿记录ID', record.record_id);

  return taskFields;
}

async function createProductionTask(token, taskFields) {
  const url =
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_PRODUCTION_TASKS_APP_TOKEN}` +
    `/tables/${FEISHU_PRODUCTION_TASKS_TABLE_ID}/records`;

  const res = await axios.post(
    url,
    {
      fields: taskFields
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    }
  );

  if (res.data.code !== 0) {
    throw new Error(`创建生产任务失败：${JSON.stringify(res.data)}`);
  }

  return res.data.data.record;
}

async function updateOrderDraftAfterConvert(token, draftRecordId, productionTaskRecordId) {
  const url =
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_ORDER_DRAFTS_APP_TOKEN}` +
    `/tables/${FEISHU_ORDER_DRAFTS_TABLE_ID}/records/${draftRecordId}`;

  const res = await axios.put(
    url,
    {
      fields: {
        订单状态: '已转换',
        生产任务记录ID: productionTaskRecordId,
        转换结果: `转换成功，生产任务记录ID：${productionTaskRecordId}`
      }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    }
  );

  if (res.data.code !== 0) {
    throw new Error(`回写订单草稿失败：${JSON.stringify(res.data)}`);
  }

  return res.data.data.record;
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
    console.log('没有可转换订单。');
    return;
  }

  // 第一轮测试只处理第一条，避免误批量写入
  const record = convertibleRecords[0];
  const taskFields = createTaskFieldsFromDraft(record);

  console.log('\n准备创建生产任务：');
  console.log(JSON.stringify(taskFields, null, 2));

  const taskRecord = await createProductionTask(token, taskFields);

  console.log('\n✅ 生产任务创建成功');
  console.log('生产任务 record_id:', taskRecord.record_id);

  await updateOrderDraftAfterConvert(token, record.record_id, taskRecord.record_id);

  console.log('\n✅ 订单草稿已回写');
  console.log('订单状态：已转换');
  console.log('生产任务记录ID:', taskRecord.record_id);

  console.log('\n第 5B 步完成。');
}

main().catch((err) => {
  console.error('\n❌ 转换失败');
  console.error(err.message);
  process.exit(1);
});