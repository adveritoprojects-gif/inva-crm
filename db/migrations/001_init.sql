-- 001_init.sql — PCT Project Desk core schema (PostgreSQL)
-- Money is stored as exact numeric; dates are date-only (no timezone shift).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id           uuid PRIMARY KEY,
  revision     integer     NOT NULL DEFAULT 1,
  number       text        NOT NULL,
  title        text        NOT NULL,
  student      text        NOT NULL,
  phone        text        NOT NULL DEFAULT '',
  university   text        NOT NULL DEFAULT '',
  writer       text        NOT NULL DEFAULT '',
  words        integer     NOT NULL DEFAULT 0,
  received     date        NOT NULL,
  due          date        NOT NULL,
  status       text        NOT NULL,
  percent      integer     NOT NULL DEFAULT 0,
  pending      text        NOT NULL DEFAULT '',
  notes        text        NOT NULL DEFAULT '',
  total        numeric(14,2) NOT NULL DEFAULT 0,
  paid         numeric(14,2) NOT NULL DEFAULT 0,
  writer_total numeric(14,2) NOT NULL DEFAULT 0,
  writer_paid  numeric(14,2) NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT projects_revision_positive  CHECK (revision >= 1),
  CONSTRAINT projects_number_normalized  CHECK (number = upper(btrim(number)) AND length(number) > 0),
  CONSTRAINT projects_title_present      CHECK (btrim(title) <> ''),
  CONSTRAINT projects_student_present    CHECK (btrim(student) <> ''),
  CONSTRAINT projects_words_range        CHECK (words >= 0 AND words <= 10000000),
  CONSTRAINT projects_dates_ordered      CHECK (due >= received),
  CONSTRAINT projects_status_valid       CHECK (status IN ('Not started','In progress','On hold','Completed','Delivered')),
  CONSTRAINT projects_percent_range      CHECK (percent >= 0 AND percent <= 100),
  CONSTRAINT projects_completed_full     CHECK (
    (status IN ('Completed','Delivered')) = false OR percent = 100
  ),
  CONSTRAINT projects_total_range        CHECK (total >= 0 AND total <= 100000000),
  CONSTRAINT projects_paid_range         CHECK (paid >= 0 AND paid <= 100000000),
  CONSTRAINT projects_writer_total_range CHECK (writer_total >= 0 AND writer_total <= 100000000),
  CONSTRAINT projects_writer_paid_range  CHECK (writer_paid >= 0 AND writer_paid <= 100000000),
  CONSTRAINT projects_paid_within_total  CHECK (paid <= total),
  CONSTRAINT projects_writer_within      CHECK (writer_paid <= writer_total)
);

-- PCT numbers are unique under the application's trim+uppercase normalization.
CREATE UNIQUE INDEX IF NOT EXISTS projects_number_unique ON projects (number);
CREATE INDEX IF NOT EXISTS projects_due_idx    ON projects (due, number);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects (status);

CREATE TABLE IF NOT EXISTS project_revisions (
  id          uuid PRIMARY KEY,
  project_id  uuid    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  description text    NOT NULL,
  requested   date    NOT NULL,
  due         date    NOT NULL,
  status      text    NOT NULL DEFAULT 'Requested',
  notes       text    NOT NULL DEFAULT '',

  CONSTRAINT project_revisions_position_positive CHECK (position >= 0),
  CONSTRAINT project_revisions_description_present CHECK (btrim(description) <> ''),
  CONSTRAINT project_revisions_dates_ordered CHECK (due >= requested),
  CONSTRAINT project_revisions_status_valid CHECK (status IN ('Requested','In progress','Completed')),
  CONSTRAINT project_revisions_unique_position UNIQUE (project_id, position)
);

CREATE INDEX IF NOT EXISTS project_revisions_project_idx
  ON project_revisions (project_id, position);

-- Sessions: only the SHA-256 hash of the random token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id                uuid PRIMARY KEY,
  token_hash        text        NOT NULL UNIQUE,
  auth_fingerprint  text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- Login-attempt counters (single-owner throttle: 10 attempts / 15 minutes).
CREATE TABLE IF NOT EXISTS login_attempts (
  id           bigserial PRIMARY KEY,
  attempt_key  text        NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_key_time_idx
  ON login_attempts (attempt_key, attempted_at);
