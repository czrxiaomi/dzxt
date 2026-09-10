# PRD：广东实验中学荔湾学校花地湾校区（初中部）学生打字练习系统

版本：v1.0
日期：2026-09-09
定位：学校机房 / 家用练习用 Web 应用（响应式，主力 Chrome / Safari / Edge）

---

## 一、产品定位与命名

- 系统名：广东实验中学荔湾学校花地湾校区（初中部）学生打字练习系统
- 简称：花地湾打字练习
- 这是**独立新项目**，与"班级积分系统"无关；但**云端后端复用**现有 Supabase 项目 class-points（jhnaadntxxcbhjvkwzrn）作为数据库与认证服务。

## 二、目标用户与角色

| 角色 | 说明 | 权限 |
|---|---|---|
| 学生 student | 初中部学生 | 注册 / 登录 / 打字练习 / 查看自己成绩 |
| 教师/管理员 admin | 老师或管理员 | 管理学生账号、管理练习文章库、查看全体成绩统计 |
| 游客 | 未登录 | 只能看到登录/注册引导页，不能进入练习 |

## 三、功能需求

### 3.1 学生端
1. 注册：邮箱 + 密码 + 姓名 + 学号 + 班级；学号唯一校验；注册后自动登录。
2. 登录：邮箱 + 密码；错误提示友好。
3. 首页：欢迎语、个人信息卡、最近成绩、练习入口。
4. 打字练习（核心）：
   - 从文章库随机/自选一篇中文或英文文章练习。
   - 逐字输入比对：正确字变绿、错误字变红，实时统计正确率、速度（字/分钟）。
   - 打完显示成绩：正确率、净速度、用时、错误数；自动保存到云端。
   - 练习过程中**禁止复制/粘贴**文本内容（防作弊）。
5. 历史成绩：查看自己历次练习记录（时间、文章、正确率、速度）。

### 3.2 后端管理系统（教师端）
1. 管理员登录：账号角色判定为 admin 才可进入管理端。
2. 学生管理：列表 / 搜索 / 查看（重置密码由 Supabase 控制台处理，前端只做停用/启用可选）。
3. 文章库管理：新增 / 编辑 / 删除练习文章（标题、分类：中文/英文、难度、正文）。
4. 成绩统计：按文章 / 按班级 / 按学生查看正确率与速度汇总。

### 3.3 通用要求
- 文字内容**禁止复制**：页面正文、文章内容不可选中复制；管理端编辑区除外（管理员可复制）。
- 登录/注册等表单值复制不做强制拦截（避免可用性差），只对练习文章与成绩展示做保护。
- 防右键、防 Ctrl/Cmd+C、防拖拽选中、禁用文本选择。
- 防 bug：输入框失焦、粘贴事件、键盘事件统一处理，练习中途退出有确认提示；断网时提示保存失败并保留本地草稿重试。

## 四、UI / UX 要求（重要，评审重点）

- 风格关键词：**iOS 同款 Liquid Glass（液态玻璃）**、柔光玻璃（毛玻璃磨砂）、华为同款粒子光效（氛围粒子/星尘微光）、沉浸光感。
- **克制原则**：不过度花哨。浅色优雅基调，玻璃卡片、柔和渐变光晕、极淡粒子漂浮；动效轻、稳、快。
- 参考质感：背景为浅色渐变（青白/雾蓝/暖白可选），卡片背景 `backdrop-filter: blur + 半透明白`，1px 半透明白描边，柔和投影。
- 中文字体优先系统字体栈（PingFang SC），避免加载慢的 webfont。
- 全站统一设计令牌（CSS 变量）：主色、玻璃透明度、圆角、间距、阴影。
- **背景水印**：页面底层有**很淡**的水印文字「大家好我是小咪--@bilibili制作」，透明度极低，不干扰阅读；水印同时出现在学生端与管理端。

## 五、非功能与防 bug 要求

1. 静态前端为主，无构建步骤（方便 GitHub Pages 直接部署）。
2. Supabase JS SDK 通过 CDN 引入（`@supabase/supabase-js` UMD）。
3. 严格错误处理：所有 await 包裹 try/catch，网络失败给出明确提示，禁止白屏。
4. 表单校验：邮箱格式、密码长度 ≥ 6、学号必填、班级必填；错误就地提示。
5. 路由守卫：未登录访问练习页跳登录；admin 访问学生页校验角色。
6. 刷新不丢登录态：Supabase 本地 session 自动恢复。
7. 并发/防抖：成绩保存防重复提交（提交中禁用按钮）。
8. 浏览器兼容：目标 Safari / Chrome / Edge 最新两个大版本；Safari 需 `-webkit-backdrop-filter` 前缀。

## 六、数据模型（Supabase class-points 项目内新建）

### 表 profiles（学生/管理员资料）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | 关联 auth.users.id |
| email | text | 邮箱（冗余，方便列表） |
| full_name | text | 姓名 |
| student_no | text unique nullable | 学号（学生必填） |
| class_name | text nullable | 班级 |
| role | text | `student` / `admin`，默认 student |
| created_at | timestamptz | 注册时间 |

### 表 passages（练习文章库）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigserial PK | |
| title | text | 标题 |
| category | text | `chinese` / `english` |
| difficulty | int | 1-3 |
| content | text | 练习正文 |
| enabled | boolean | 是否上架 |
| created_at | timestamptz | |

### 表 typing_records（打字成绩）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigserial PK | |
| user_id | uuid FK profiles.id | 学生 |
| passage_id | bigint FK passages.id | 文章 |
| accuracy | numeric(5,2) | 正确率 % |
| speed | numeric(6,2) | 净速度（字/分钟，只算正确输入） |
| raw_speed | numeric(6,2) | 毛速度（总输入/分钟） |
| keystrokes | int | 总按键数 |
| errors | int | 错误字符数 |
| duration_sec | int | 用时秒 |
| finished_at | timestamptz | 完成时间 |

### 安全策略
- RLS：profiles 本人可读写自己；admin 可读写所有（按 auth.email 判断或按 profiles.role）。
- passages：登录用户可读 enabled=1；admin 可写。
- typing_records：本人可读写；admin 可读所有。
- 建表 SQL 保存到 `supabase/schema.sql`。

## 七、页面清单（静态多页）

| 路径 | 页面 | 说明 |
|---|---|---|
| index.html | 门户/登录注册 | 学生端登录+注册切换；管理员入口链接 |
| student.html | 学生主页 | 欢迎、个人信息、开始练习、历史成绩 |
| practice.html | 打字练习页 | 选文章或随机 → 练习 → 结果 |
| admin.html | 管理端 | 学生管理 / 文章库 / 统计（TAB 切换） |
| assets/css/style.css | 全局样式 | 设计令牌 + 玻璃 UI + 粒子 + 水印 |
| assets/js/*.js | 业务脚本 | supabase 初始化、auth、练习引擎、admin CRUD、防复制、水印 |

## 八、部署与验收流程

1. 本地开发目录：`/Users/chenzirui/Desktop/gslw-typing-system`
2. **必须先在本机 Safari 打开预览，评审 UI 与流程**，通过后再部署。
3. Supabase：在 class-points 项目 SQL Editor 执行 `supabase/schema.sql`，再插入初始管理员账号与示例文章。
4. GitHub：创建仓库 `gslw-typing-system`（或用户指定名），推送静态前端到 main 分支，开启 GitHub Pages，部署到 `https://<user>.github.io/<repo>/`。
5. 环境配置：`assets/js/config.js` 保存 project URL 与 anon key（可公开），数据库密码不进入前端。

## 九、验收清单
- [ ] Safari 预览：玻璃质感达标、不花哨、粒子淡雅
- [ ] 未登录不能进入学生页/练习页
- [ ] 注册 → 自动登录 → 可选文章 → 练习 → 成绩自动入库
- [ ] 历史成绩可查
- [ ] 文字/文章不可复制（学生端），管理端编辑可复制
- [ ] 水印「大家好我是小咪--@bilibili制作」可见且很淡
- [ ] 断网/报错有提示不白屏
- [ ] 管理端可增删改文章、看统计
- [ ] GitHub Pages 线上访问正常
