# FitFlow

一个手机优先、无登录页面的全栈健身记录平台。前端负责交互与离线缓存，Supabase 提供匿名设备身份、PostgreSQL 数据库和行级数据隔离，Netlify 提供网页与后端配置接口。

## 已实现功能

- 每日训练部位、动作、组数、次数、重量与总训练量记录，支持修改和删除
- 常见基础动作推荐，同时支持自定义动作
- 按第一餐、第二餐、第三餐和加餐记录饮食，一餐可添加多种食物
- 根据身高、体重、年龄、体脂、活动水平和目标估算 BMR、TDEE 与每日热量
- 增肌、维持、减脂三种目标和蛋白质、脂肪、碳水建议
- 体重趋势记录，以及结合盐分、碳水、训练酸痛、睡眠等因素解释短期波动
- 本机离线缓存、云数据库同步、旧版数据自动迁移、JSON 导入导出
- 无登录页面：浏览器后台自动创建匿名设备身份

## 数据现在存在哪里

1. 浏览器 `localStorage` 保存一份离线缓存，断网时仍可使用。
2. 配置 Supabase 后，数据同时写入 PostgreSQL 云数据库。
3. 数据表启用了 Row Level Security，每个匿名设备身份只能访问自己的记录。

匿名身份会保存在浏览器中。清理浏览器站点数据会生成新的身份，因此仍建议保留 JSON 备份。跨设备迁移码会在后续版本增加。

## Supabase 初始化

1. 新建 Supabase 项目。
2. 在 Authentication → Providers 中启用 Anonymous Sign-Ins。
3. 打开 SQL Editor，执行 `supabase/schema.sql`。
4. 在 Project Settings → API 中复制 Project URL 和 anon public key。

## Netlify 环境变量（可选）

当前仓库已内置 Supabase 的浏览器发布密钥，可以直接部署。若后续更换数据库项目，可在 Netlify 的 Site configuration → Environment variables 中添加以下变量覆盖内置配置：

```text
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_ANON_KEY=你的-anon-public-key
```

部署后，页面顶部状态会从“连接中”变为“已同步”。首次连接会自动把第一阶段的本机数据迁移到云数据库。

## 本机使用

直接打开 `index.html` 仍然可用；网络可用时会连接云数据库，网络不可用时自动使用本机缓存。

## 重要说明

热量与体重解释仅用于健康管理参考。公式适合建立起始基线，建议连续记录 2–3 周后，根据 7 日平均体重趋势每次调整 100–150 kcal。
