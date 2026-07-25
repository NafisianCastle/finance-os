-- 002 added investor_name/declared_profit_poisha/project_start_date/project_end_date
-- but left the original current_value_poisha/start_date columns NOT NULL. The app
-- no longer writes those columns, so every investment upsert violates them.

alter table investments alter column current_value_poisha drop not null;
alter table investments alter column start_date drop not null;

update investments set start_date = project_start_date where start_date is null and project_start_date is not null;
