-- Type-specific investment fields: shares/units/grams (quantity), price per
-- unit (Stocks/Mutual Fund), interest rate (DPS/FDR), purity (Gold).

alter table investments add column if not exists quantity numeric;
alter table investments add column if not exists price_per_unit_poisha bigint;
alter table investments add column if not exists interest_rate_pct numeric;
alter table investments add column if not exists purity varchar(10);
