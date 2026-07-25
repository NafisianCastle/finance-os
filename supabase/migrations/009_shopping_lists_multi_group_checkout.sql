-- Shopping trips can mix categories (groceries + electronics) and payment
-- methods (cash + card). Checkout now creates one transaction per distinct
-- (account, category) group instead of forcing everything into one bucket.
-- linked_transaction_id / linked_transaction_ids both stay populated for a
-- transition period so old clients that only know the singular column keep
-- working until they sync the new client code.

alter table shopping_lists add column if not exists linked_transaction_ids jsonb;

alter table shopping_list_items add column if not exists account_id uuid;
