-- 勤怠に「在宅勤務」のフラグを足す（交通費なし no_transport とは別のフラグ）
-- ・在宅の日はアプリが備考の先頭に「在宅」と入れる
-- ・提出書類のチェック（交通費の要否）は今までどおり no_transport だけで判定し、この列は見ない
-- ・既存の行はすべて false（在宅なし）になる。行の書き込みではないので、提出済みの月の行にも影響しない
-- ・以前の版のアプリはこの列を読み書きしないので、この SQL を先に当てても以前の版はそのまま動く

alter table public.attendance_records
  add column if not exists work_from_home boolean not null default false;
