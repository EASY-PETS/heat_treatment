require('dotenv').config();

const keys = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_ORDER_DRAFTS_APP_TOKEN',
  'FEISHU_ORDER_DRAFTS_TABLE_ID',
  'FEISHU_PRODUCTION_TASKS_APP_TOKEN',
  'FEISHU_PRODUCTION_TASKS_TABLE_ID'
];

console.log('检查 .env 配置：');

for (const key of keys) {
  const value = process.env[key];

  if (!value) {
    console.log(`❌ ${key}: 未读取到`);
  } else {
    console.log(`✅ ${key}: 已读取，长度 ${value.length}`);
  }
}