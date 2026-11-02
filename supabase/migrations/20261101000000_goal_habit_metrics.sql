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
                        -- Match JavaScript String.trim(), including Unicode whitespace.
                        and length(btrim(metric->>'habitId', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0
                        and metric->'overridePinned' = 'false'::jsonb
                    )
                ), false
            )
        )
    );
