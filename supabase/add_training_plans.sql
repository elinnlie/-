-- FitFlow training plans migration
-- Safe to run once on an existing phase 2 database.

alter table public.fitflow_profiles
  add column if not exists training_plans jsonb not null default '[]'::jsonb;

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
    'trainingPlans', coalesce(
      (select training_plans from public.fitflow_profiles where user_id = auth.uid()),
      '[]'::jsonb
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
    user_id, app_name, training_plans, sex, age, height, weight, body_fat, activity, goal, updated_at
  ) values (
    current_user_id,
    coalesce(nullif(input_state #>> '{settings,appName}', ''), 'FitFlow'),
    coalesce(input_state -> 'trainingPlans', '[]'::jsonb),
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
    training_plans = excluded.training_plans,
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
