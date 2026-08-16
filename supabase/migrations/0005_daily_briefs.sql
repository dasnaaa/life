-- Daily Brief: AI-Brief-Generierung (Paket 7)
--
-- Ein Brief besteht aus mehreren Sektionen (email/news/messages/calendar),
-- die pro Nutzer und Tag jeweils genau einmal existieren sollen -
-- Regenerieren muss updaten statt zu duplizieren.
create unique index if not exists daily_briefs_user_date_section_uidx
  on daily_briefs (user_id, brief_date, section);
