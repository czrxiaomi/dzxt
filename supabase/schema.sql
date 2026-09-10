-- ============================================================================
-- 花地湾打字练习系统 · Supabase Schema（复用 class-points 项目作为后端）
-- ============================================================================
-- 执行位置：Supabase Dashboard → SQL Editor（class-points / jhnaadntxxcbhjvkwzrn 项目）
-- 本脚本幂等：可重复执行，不会删除既有数据。
--
-- 【初始管理员账号 创建说明（重要，先读）】
--   方式 A（推荐）：
--     1) 在 Supabase Dashboard → Authentication → Users → "Add user"，
--        填写管理员邮箱与临时密码（密码至少 6 位），完成创建；
--     2) 在 SQL Editor 执行以下语句把该账号提升为管理员（把邮箱换成实际值）：
--          update public.profiles
--             set role = 'admin', is_active = true
--           where email = 'admin@example.com';
--     3) 如需演示用学生账号，用 Add user 再建一个学生邮箱，无需改 role（默认 student）。
-- 【教师账号（网页注册）】
--   教师可直接在网站注册页选择“教师”身份注册，注册即写入 role = 'teacher'，
--   教师与管理员同权（管理文章 / 学生启用停用 / 查看全部成绩）。
--   若需把某教师账号提升为系统管理员，执行：
--       update public.profiles set role = 'admin' where email = 'teacher@example.com';
--   再次执行该脚本不会覆盖已设置的 role。
--   方式 B：直接在 SQL Editor 执行下面的片段（密码请替换为强密码，仅演示用）：
--     insert into auth.users
--       (instance_id, id, aud, role, email, encrypted_password,
--        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
--     values
--       ('00000000-0000-0000-0000-000000000000',
--        gen_random_uuid(), 'authenticated', 'authenticated',
--        'admin@example.com',
--        crypt('Admin@123456', gen_salt('bf')),
--        now(), '{"provider":"email","providers":["email"]}',
--        '{"full_name":"系统管理员"}', now(), now());
--     update public.profiles set role='admin' where email='admin@example.com';
--   （方式 B 需先开启 Database → Extensions → pgcrypto / gen_random_uuid 可用，
--    较繁琐，日常管理推荐方式 A。）
--
-- 【与既有表冲突提示】
--   本系统在 class-points 项目内新建三张独立业务表：profiles / passages / typing_records。
--   若该项目已存在同名表（例如既有积分系统也建过 profiles），请先人工核对列结构，
--   本脚本采用 CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS 的幂等写法，
--   不会删除既有数据，但可能因列冲突报错，需人工适配。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. profiles：用户资料（学生 / 教师 / 管理员）
--    由注册触发器自动写入，前端无需手工插入。
--    role 取值：student（学生，默认）/ teacher（教师，网页注册）/ admin（系统管理员，后台提权）
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  student_no  text unique,                          -- 学号（学生必填，教师/管理员可为空）
  class_name  text,                                 -- 班级（学生必填，教师/管理员可为空）
  role        text not null default 'student'
              check (role in ('student', 'teacher', 'admin')),
  is_active   boolean not null default true,        -- 停用标记（false 后无法登录）
  created_at  timestamptz not null default now()
);

-- 老表兜底补列（幂等，仅当列缺失时添加）
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists student_no text;
alter table public.profiles add column if not exists class_name text;
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists is_active boolean not null default true;

-- 老表 role 取值升级（student/teacher/admin），幂等
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'teacher', 'admin'));

-- 学号唯一索引（兼容多行 NULL 学号：教师/管理员无需学号）
create unique index if not exists profiles_student_no_uniq
  on public.profiles (student_no)
  where student_no is not null;

-- 常用查询索引
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_class_name_idx on public.profiles (class_name);


-- ----------------------------------------------------------------------------
-- 2. passages：练习文章库
-- ----------------------------------------------------------------------------
create table if not exists public.passages (
  id          bigserial primary key,
  title       text not null,
  category    text not null default 'chinese'
              check (category in ('chinese', 'english')),
  difficulty  integer not null default 1
              check (difficulty between 1 and 3),
  content     text not null,
  enabled     boolean not null default true,        -- 是否上架（学生可见）
  created_at  timestamptz not null default now()
);

create index if not exists passages_enabled_idx
  on public.passages (enabled, category, difficulty);


-- ----------------------------------------------------------------------------
-- 3. typing_records：打字成绩
-- ----------------------------------------------------------------------------
create table if not exists public.typing_records (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  passage_id    bigint not null references public.passages (id) on delete restrict,
  accuracy      numeric(5,2) not null default 0,    -- 正确率 %
  speed         numeric(6,2) not null default 0,    -- 净速度（字/分钟，只算正确输入）
  raw_speed     numeric(6,2) not null default 0,    -- 毛速度（总输入/分钟）
  keystrokes    integer not null default 0,         -- 总按键数
  errors        integer not null default 0,         -- 错误字符数
  duration_sec  integer not null default 0,         -- 用时（秒）
  finished_at   timestamptz not null default now()  -- 完成时间
);

create index if not exists typing_records_user_idx
  on public.typing_records (user_id, finished_at desc);
create index if not exists typing_records_passage_idx
  on public.typing_records (passage_id, finished_at desc);


-- ============================================================================
-- RLS 辅助函数（安全限定 search_path，防注入）
-- ============================================================================
-- is_manager：当前登录用户是否为教师或管理员（teacher/admin 同权管理，security definer 读取 profiles，不受 RLS 递归影响）
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'teacher') and p.is_active = true
  );
$$;

-- 学号占用预检（注册前调用，返回 true 表示已被注册）
create or replace function public.is_student_no_taken(p_student_no text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.student_no = p_student_no
  );
$$;

revoke all on function public.is_manager() from public;
grant execute on function public.is_manager() to anon, authenticated;

revoke all on function public.is_student_no_taken(text) from public;
grant execute on function public.is_student_no_taken(text) to anon, authenticated;


-- ============================================================================
-- 注册触发器：auth.users 插入后自动写入 profiles
--   role 取自注册 metadata：前端选“教师”注册 → teacher；其余（学生/后台 Add user）→ student
--   管理员账号由后台 Add user 创建后手动 update role = 'admin'（见文件头说明）
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, student_no, class_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), ''),
    nullif(new.raw_user_meta_data ->> 'student_no', ''),
    nullif(new.raw_user_meta_data ->> 'class_name', ''),
    case when new.raw_user_meta_data ->> 'role' = 'teacher' then 'teacher' else 'student' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- profiles 更新守卫：防止普通用户/教师自行提权，约束启用停用权限
--   管理员：可改任意字段（含角色提权/降级）
--   教师：可改自己的资料（不可改角色）；可改任意“学生”的启用/停用状态
--   学生：只能改自己的资料，不可改角色与启用状态
-- ============================================================================
create or replace function public.protect_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur_role text;
begin
  select p.role into cur_role
    from public.profiles p
   where p.id = auth.uid();

  if cur_role = 'admin' then
    return new;                         -- 管理员放行
  end if;

  if new.role is distinct from old.role then
    raise exception '只有系统管理员可以修改账号角色';
  end if;

  if cur_role = 'teacher' then
    -- 教师修改学生行：仅允许切换启用状态
    if new.id <> auth.uid() and old.role <> 'student' then
      raise exception '教师只能管理学生账号的启用状态';
    end if;
    if new.id <> auth.uid() and (new.is_active is not distinct from old.is_active) then
      raise exception '教师只能修改学生的启用状态';
    end if;
    return new;
  end if;

  -- 普通学生：只能改自己，且不可改启用状态
  if new.id <> auth.uid() then
    raise exception '只能修改自己的资料';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception '无权修改账号启用状态';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_update on public.profiles;
create trigger protect_profile_update
  before update on public.profiles
  for each row execute function public.protect_profile_update();


-- ============================================================================
-- RLS 开启与策略
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.passages enable row level security;
alter table public.typing_records enable row level security;


-- ---- profiles 策略 ----
-- 查看：本人 或 教师/管理员（教师可查看全部学生资料用于管理）
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_manager());

-- 更新：本人 或 教师/管理员（学生可改自己资料；教师/管理员可停用/启用学生）
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_manager())
  with check (id = auth.uid() or public.is_manager());

-- 插入：仅允许教师/管理员创建（正常注册由触发器完成，不再向客户端开放 insert）
drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin"
  on public.profiles for insert
  to authenticated
  with check (public.is_manager());

-- 删除：不向客户端开放（删除账号请在 Authentication 用户管理或后台处理，级联清理成绩）


-- ---- passages 策略 ----
-- 读：登录用户可读全部上架文章；教师/管理员额外可读未上架文章
drop policy if exists "passages_select" on public.passages;
create policy "passages_select"
  on public.passages for select
  to authenticated
  using (enabled = true or public.is_manager());

-- 增/改/删：仅教师/管理员
drop policy if exists "passages_insert_admin" on public.passages;
create policy "passages_insert_admin"
  on public.passages for insert
  to authenticated
  with check (public.is_manager());

drop policy if exists "passages_update_admin" on public.passages;
create policy "passages_update_admin"
  on public.passages for update
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());

drop policy if exists "passages_delete_admin" on public.passages;
create policy "passages_delete_admin"
  on public.passages for delete
  to authenticated
  using (public.is_manager());


-- ---- typing_records 策略 ----
-- 读：本人可读自己的成绩；教师/管理员可读全部
drop policy if exists "typing_records_select" on public.typing_records;
create policy "typing_records_select"
  on public.typing_records for select
  to authenticated
  using (user_id = auth.uid() or public.is_manager());

-- 写：仅本人可插入自己的成绩（防篡改：不允许改/删成绩）
drop policy if exists "typing_records_insert_own" on public.typing_records;
create policy "typing_records_insert_own"
  on public.typing_records for insert
  to authenticated
  with check (user_id = auth.uid());


-- ============================================================================
-- 可选：插入一篇示例文章（便于首次预览；可删除）
-- ============================================================================
insert into public.passages (title, category, difficulty, content, enabled)
select '静夜思 · 李白', 'chinese', 1,
       '床前明月光，疑是地上霜。举头望明月，低头思故乡。', true
where not exists (select 1 from public.passages where title = '静夜思 · 李白');

insert into public.passages (title, category, difficulty, content, enabled)
select 'The Quick Brown Fox', 'english', 1,
       'The quick brown fox jumps over the lazy dog. Practice makes perfect. Keep going and never give up.', true
where not exists (select 1 from public.passages where title = 'The Quick Brown Fox');


-- ============================================================================
-- 清理旧版辅助函数（is_admin 已由 is_manager 取代）
-- 置于文件末尾：此时旧策略已全部重建为 is_manager，删除 is_admin 不依赖残留
-- ============================================================================
drop function if exists public.is_admin();
