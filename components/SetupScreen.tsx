/**
 * Full-page setup guidance shown when server configuration is missing.
 * Rendered without touching the database.
 */
export default function SetupScreen({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <main className="mx-auto max-w-prose px-4 py-16">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6">
        <h1 className="text-xl font-bold text-amber-950">{title}</h1>
        <p className="mt-2 whitespace-pre-line text-sm text-amber-900">{message}</p>
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-amber-900">
          <li>
            Copy <code className="rounded bg-amber-100 px-1">.env.example</code> to{" "}
            <code className="rounded bg-amber-100 px-1">.env</code> and fill in the values.
          </li>
          <li>
            Create a PostgreSQL database and set <code className="rounded bg-amber-100 px-1">DATABASE_URL</code>.
          </li>
          <li>
            Run <code className="rounded bg-amber-100 px-1">npm run setup</code> (keeps existing
            settings) and <code className="rounded bg-amber-100 px-1">npm run migrate</code>.
          </li>
          <li>Restart the server. See README.md for details.</li>
        </ol>
      </div>
    </main>
  );
}
