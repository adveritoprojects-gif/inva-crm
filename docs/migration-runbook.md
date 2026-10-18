# Migration runbook — SQLite edition / earlier hosted CRM → PostgreSQL

This is the safe, manual path for moving existing projects into the
PostgreSQL-backed PCT Project Desk. Nothing is switched over automatically, and
the original database is never deleted or modified by this app.

The compatible JSON export/import path is preferred over any direct database
copy because it runs the same validation the app uses and keeps the v1 field
names, ids, PCT numbers, dates and phone strings intact.

---

## 0. Before you begin

1. **Pick a quiet moment.** While migrating, avoid editing records in the old
   edition so the export does not miss a change.
2. **Copy the old database file/path** to a separate location (e.g.
   `pct-crm.db.bak-2026-01-01`). Keep it indefinitely as a rollback copy.
3. Confirm you can sign in to the old edition and that its export button works.

Expected time: 10–20 minutes, plus verification.

---

## 1. Export a full JSON backup from the old edition

Use the old app's **Download full backup** button, or its API:

```bash
curl -sS -b cookies.txt 'https://OLD-APP/api/export?format=json' -o pct-backup.json
```

The file must contain the v1 envelope:

```json
{
  "format": "pct-project-desk",
  "version": 1,
  "exportedAt": "…",
  "currency": "INR",
  "timezone": "Asia/Kolkata",
  "projects": [ … ]
}
```

Record the numbers for later comparison:

```bash
# Projects and revision requests in the backup
node -e "
const b=require('./pct-backup.json');
console.log('projects:', b.projects.length);
console.log('revisions:', b.projects.reduce((n,p)=>n+(p.revisions?.length||0),0));
console.log('student balance sum:', b.projects.reduce((n,p)=>n+((p.total||0)-(p.paid||0)),0).toFixed(2));
console.log('writer balance sum:', b.projects.reduce((n,p)=>n+((p.writerTotal||0)-(p.writerPaid||0)),0).toFixed(2));
"
```

Optional cross-check straight from the old SQLite file (read-only):

```bash
sqlite3 pct-crm.db.bak-2026-01-01 \
  "SELECT count(*) FROM projects; SELECT count(*) FROM revisions;"
```

---

## 2. Create a new, empty PostgreSQL database

Do **not** reuse an existing production database.

```bash
createdb pct_crm          # or create it in your managed provider

export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/pct_crm'
npm run migrate           # applies db/migrations/001_init.sql
```

---

## 3. Import the backup

**Option A — the UI.** Sign in to the new app, confirm the register says
“No projects yet”, press **Import JSON backup**, choose `pct-backup.json`, and
confirm. The import is refused unless the register is empty.

**Option B — the API.**

```bash
curl -sS -X POST https://NEW-APP/api/restore \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://NEW-APP' \
  -b cookies.txt \
  --data-binary @pct-backup.json
# => {"imported":N,"projects":N,"revisions":M,"warnings":[]}
```

Notes:

- 20 MB limit; the whole import runs in **one transaction** — either every
  record is imported or none is.
- Duplicate project ids or duplicate PCT numbers inside the backup are
  rejected, and the register stays empty.
- Older backups that lack `writer`, `writerTotal`, `writerPaid`, `total`,
  `paid` or `revisions` receive the documented empty/zero defaults; restored
  record versions start at ≥ 1.
- Money values that cannot be represented exactly with two decimals (e.g.
  `1234.567`) are **rejected with a message naming the record** instead of
  being silently rounded. Fix those values in the old edition (or in the JSON),
  re-export, and import again.

If the import reports issues, nothing was written; correct the listed records
and retry.

---

## 4. Verify the migration

Run these against the **new** database:

```bash
psql "$DATABASE_URL" -c "
  SELECT
    (SELECT count(*) FROM projects)          AS projects,
    (SELECT count(*) FROM project_revisions) AS revisions,
    (SELECT COALESCE(sum(total - paid), 0)        FROM projects) AS student_balance,
    (SELECT COALESCE(sum(writer_total - writer_paid), 0) FROM projects) AS writer_balance;
"
```

Compare with the counts from step 1 — all four figures must match.

### 4.1 Projects: ids, PCT numbers, dates and phone strings

```bash
psql "$DATABASE_URL" -c "
  SELECT number, id, received, due, phone, status, percent, total, paid, writer_total, writer_paid
  FROM projects
  ORDER BY number COLLATE \"C\";
"
```

Check against the old edition for a sample of at least five records:

- PCT numbers are **trimmed and uppercased** (`PCT-1024`, not ` pct-1024 `).
- `id` values are unchanged from the backup.
- `received` / `due` are `YYYY-MM-DD` and identical to the old values (no
  off-by-one-day shift).
- `phone` strings are identical — leading zeros and country codes included.

Programmatic comparison of ids and phones (strongly recommended):

```bash
node -e "
const b=require('./pct-backup.json').projects;
console.log(b.length + ' ids in backup');
" > /tmp/ids-count.txt; cat /tmp/ids-count.txt

psql "$DATABASE_URL" -At -c "SELECT id, number, phone FROM projects ORDER BY number COLLATE \"C\";" > /tmp/new-records.tsv
node -e "
const {execSync}=require('child_process');
const backup=require('./pct-backup.json').projects.slice()
  .map(p=>({id:p.id,number:String(p.number).trim().toUpperCase(),phone:p.phone||''}))
  .sort((a,b)=>a.number<b.number?-1:1);
const rows=require('fs').readFileSync('/tmp/new-records.tsv','utf8').trim().split('\n')
  .map(l=>{const [id,number,phone]=l.split('\t');return {id,number,phone:phone||''};});
let bad=0;
for(const r of rows){
  const o=backup.find(b=>b.number===r.number);
  if(!o){console.log('MISSING in backup:',r.number);bad++;continue;}
  if(o.id!==r.id){console.log('ID MISMATCH',r.number);bad++;}
  if(o.phone!==r.phone){console.log('PHONE MISMATCH',r.number,JSON.stringify(o.phone),'->',JSON.stringify(r.phone));bad++;}
}
console.log(bad===0?'OK: ids, numbers and phones match':'PROBLEMS: '+bad);
"
```

### 4.2 Revision requests

```bash
psql "$DATABASE_URL" -c "
  SELECT p.number, r.position, r.id, r.status, r.requested, r.due
  FROM project_revisions r JOIN projects p ON p.id = r.project_id
  ORDER BY p.number COLLATE \"C\", r.position;
"
```

- The number of rows equals the revision count recorded in step 1.
- Within each project, `position` runs `0..n-1` in the original display order.
- Open requests (`Requested`, `In progress`) are still open — nothing was
  auto-completed.

### 4.3 Aggregate student/writer balances per project

```bash
psql "$DATABASE_URL" -c "
  SELECT number, (total - paid) AS student_balance, (writer_total - writer_paid) AS writer_balance
  FROM projects ORDER BY number COLLATE \"C\";
"
```

Compare the totals with the old edition's dashboard figures.

### 4.4 Application-level checks

1. Sign in to the new app.
2. Dashboard card numbers match the old edition (active, due in 2 days,
   overdue, payment pending, writer payments pending, open revisions).
3. Open a record, confirm every field, its payments and its revision cards.
4. Save the record once and confirm the version increments (and check a second
   tab gets the “changed in another tab” message instead of overwriting).
5. Press **Export Excel**, confirm both the `Projects` and `Revisions` sheets
   contain all records.
6. Press **Download full backup** and archive the new
   `pct-project-desk-backup-YYYY-MM-DD.json` next to the original.

---

## 5. Cut-over

1. Stop editing in the old edition.
2. Keep the old database and its backup file untouched, read-only, for at least
   one month.
3. Point users at the new app; take a JSON backup plus a `pg_dump` on the first
   day after cut-over.

## 6. If verification fails

- **Do not** import again into a nonempty register — the app will refuse
  (correctly) and change nothing.
- To retry cleanly, empty the **new** database only:
  `psql "$DATABASE_URL" -c 'TRUNCATE projects CASCADE;'` (this also clears
  revisions), then re-import from the JSON backup.
- Anything unexpected: keep both databases, and compare using the queries in
  section 4 before deciding.

## 7. Rolling back

The PostgreSQL edition never modifies the old database, so rollback is simply
continuing to use the old edition. If you had already started using the new
app, take its **Download full backup** JSON first, then re-import it into the
old edition (the v1 format is shared).
