-- FitFlow phase 2 database schema
-- Run this file once in Supabase SQL Editor, then enable Anonymous Sign-Ins.

create extension if not exists pgcrypto;

create table if not exists public.fitflow_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_name text not null default 'FitFlow',
  sex text check (sex in ('female', 'male')),
  age integer check (age between 14 and 90),
  height numeric check (height between 120 and 230),
  weight numeric check (weight between 30 and 300),
  body_fat numeric check (body_fat between 3 and 60),
  activity numeric,
  goal text check (goal in ('lose', 'maintain', 'gain')),
  updated_at timestamptz not null default now()
);

create table if not exists public.fitflow_trainings (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  training_date date not null,
  body_parts text[] not null default '{}',
  exercises jsonb not null default '[]'::jsonb,
  note text not null default '',
  volume numeric not null default 0,
  created_at_ms bigint not null,
  updated_at_ms bigint not null,
  unique (user_id, id)
);

create table if not exists public.fitflow_meals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_date date not null,
  meal_name text not null,
  items jsonb not null default '[]'::jsonb,
  calories numeric not null default 0,
  created_at_ms bigint not null,
  updated_at_ms bigint not null,
  unique (user_id, id)
);

create table if not exists public.fitflow_weights (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  weight_date date not null,
  value numeric not null check (value between 30 and 300),
  factors text[] not null default '{}',
  created_at_ms bigint not null,
  unique (user_id, weight_date)
);

create index if not exists fitflow_trainings_user_date_idx
  on public.fitflow_trainings (user_id, training_date desc);
create index if not exists fitflow_meals_user_date_idx
  on public.fitflow_meals (user_id, meal_date desc);
create index if not exists fitflow_weights_user_date_idx
  on public.fitflow_weights (user_id, weight_date desc);

alter table public.fitflow_profiles enable row level security;
alter table public.fitflow_trainings enable row level security;
alter table public.fitflow_meals enable row level security;
alter table public.fitflow_weights enable row level security;

drop policy if exists "fitflow_profiles_owner" on public.fitflow_profiles;
create policy "fitflow_profiles_owner" on public.fitflow_profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "fitflow_trainings_owner" on public.fitflow_trainings;
create policy "fitflow_trainings_owner" on public.fitflow_trainings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "fitflow_meals_owner" on public.fitflow_meals;
create policy "fitflow_meals_owner" on public.fitflow_meals
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "fitflow_weights_owner" on public.fitflow_weights;
create policy "fitflow_weights_owner" on public.fitflow_weights
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.fitflow_profiles to authenticated;
grant select, insert, update, delete on public.fitflow_trainings to authenticated;
grant select, insert, update, delete on public.fitflow_meals to authenticated;
grant select, insert, update, delete on public.fitflow_weights to authenticated;

create or replace function public.get_fitflow_state()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'settings', jsonb_build_object(
      'appName', coalesce(
        (select app_name from public.fitflow_profiles where user_id = auth.uid()),
        'FitFlow'
      )
    ),
    'profile', (
      select case
        when sex is null then null
        else jsonb_build_object(
          'sex', sex,
          'age', age,
          'height', height,
          'weight', weight,
          'bodyFat', body_fat,
          'activity', activity,
          'goal', goal
        )
      end
      from public.fitflow_profiles
      where user_id = auth.uid()
    ),
    'trainings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id::text,
        'date', training_date::text,
        'parts', to_jsonb(body_parts),
        'exercises', exercises,
        'note', note,
        'volume', volume,
        'createdAt', created_at_ms,
        'updatedAt', updated_at_ms
      ) order by training_date, created_at_ms)
      from public.fitflow_trainings
      where user_id = auth.uid()
    ), '[]'::jsonb),
    'foods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id::text,
        'date', meal_date::text,
        'meal', meal_name,
        'items', items,
        'calories', calories,
        'createdAt', created_at_ms,
        'updatedAt', updated_at_ms
      ) order by meal_date, created_at_ms)
      from public.fitflow_meals
      where user_id = auth.uid()
    ), '[]'::jsonb),
    'weights', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id::text,
        'date', weight_date::text,
        'value', value,
        'factors', to_jsonb(factors),
        'createdAt', created_at_ms
      ) order by weight_date, created_at_ms)
      from public.fitflow_weights
      where user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

create or replace function public.save_fitflow_state(input_state jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  profile_data jsonb := input_state -> 'profile';
  row_data jsonb;
begin
  if current_user_id is null then
    raise exception 'Anonymous device session is required';
  end if;

  insert into public.fitflow_profiles (
    user_id, app_name, sex, age, height, weight, body_fat, activity, goal, updated_at
  ) values (
    current_user_id,
    coalesce(nullif(input_state #>> '{settings,appName}', ''), 'FitFlow'),
    nullif(profile_data ->> 'sex', ''),
    nullif(profile_data ->> 'age', '')::integer,
    nullif(profile_data ->> 'height', '')::numeric,
    nullif(profile_data ->> 'weight', '')::numeric,
    nullif(profile_data ->> 'bodyFat', '')::numeric,
    nullif(profile_data ->> 'activity', '')::numeric,
    nullif(profile_data ->> 'goal', ''),
    now()
  )
  on conflict (user_id) do update set
    app_name = excluded.app_name,
    sex = excluded.sex,
    age = excluded.age,
    height = excluded.height,
    weight = excluded.weight,
    body_fat = excluded.body_fat,
    activity = excluded.activity,
    goal = excluded.goal,
    updated_at = now();

  delete from public.fitflow_trainings where user_id = current_user_id;
  for row_data in select value from jsonb_array_elements(coalesce(input_state -> 'trainings', '[]'::jsonb))
  loop
    insert into public.fitflow_trainings (
      id, user_id, training_date, body_parts, exercises, note, volume, created_at_ms, updated_at_ms
    ) values (
      (row_data ->> 'id')::uuid,
      current_user_id,
      (row_data ->> 'date')::date,
      array(select jsonb_array_elements_text(coalesce(row_data -> 'parts', '[]'::jsonb))),
      coalesce(row_data -> 'exercises', '[]'::jsonb),
      coalesce(row_data ->> 'note', ''),
      coalesce(nullif(row_data ->> 'volume', '')::numeric, 0),
      coalesce(nullif(row_data ->> 'createdAt', '')::bigint, 0),
      coalesce(nullif(row_data ->> 'updatedAt', '')::bigint, 0)
    );
  end loop;

  delete from public.fitflow_meals where user_id = current_user_id;
  for row_data in select value from jsonb_array_elements(coalesce(input_state -> 'foods', '[]'::jsonb))
  loop
    insert into public.fitflow_meals (
      id, user_id, meal_date, meal_name, items, calories, created_at_ms, updated_at_ms
    ) values (
      (row_data ->> 'id')::uuid,
      current_user_id,
      (row_data ->> 'date')::date,
      coalesce(nullif(row_data ->> 'meal', ''), '未分类'),
      coalesce(row_data -> 'items', '[]'::jsonb),
      coalesce(nullif(row_data ->> 'calories', '')::numeric, 0),
      coalesce(nullif(row_data ->> 'createdAt', '')::bigint, 0),
      coalesce(nullif(row_data ->> 'updatedAt', '')::bigint, 0)
    );
  end loop;

  delete from public.fitflow_weights where user_id = current_user_id;
  for row_data in select value from jsonb_array_elements(coalesce(input_state -> 'weights', '[]'::jsonb))
  loop
    insert into public.fitflow_weights (
      id, user_id, weight_date, value, factors, created_at_ms
    ) values (
      (row_data ->> 'id')::uuid,
      current_user_id,
      (row_data ->> 'date')::date,
      (row_data ->> 'value')::numeric,
      array(select jsonb_array_elements_text(coalesce(row_data -> 'factors', '[]'::jsonb))),
      coalesce(nullif(row_data ->> 'createdAt', '')::bigint, 0)
    );
  end loop;
end;
$$;

revoke all on function public.get_fitflow_state() from public;
revoke all on function public.save_fitflow_state(jsonb) from public;
grant execute on function public.get_fitflow_state() to authenticated;
grant execute on function public.save_fitflow_state(jsonb) to authenticated;
