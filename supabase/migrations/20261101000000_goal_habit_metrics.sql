-- Replace the original generated check atomically. IF EXISTS also permits replay.
alter table public.goals
    drop constraint if exists goals_metric_check,
    add constraint goals_metric_check check (
        metric is null or (
            jsonb_typeof(metric) = 'object' and coalesce(
                jsonb_typeof(metric->'label') = 'string'
                and jsonb_typeof(metric->'target') = 'number'
                and jsonb_typeof(metric->'current') = 'number'
                and jsonb_typeof(metric->'unit') = 'string'
                and jsonb_typeof(metric->'overridePinned') = 'boolean'
                and (
                    (metric->>'source' in ('manual', 'liftingtracker') and not (metric ? 'habitId'))
                    or (
                        metric->>'source' = 'habit'
                        and jsonb_typeof(metric->'habitId') = 'string'
                        and metric->>'habitId' ~ '[^[:space:]]'
                        and metric->'overridePinned' = 'false'::jsonb
                    )
                ), false
            )
        )
    );
